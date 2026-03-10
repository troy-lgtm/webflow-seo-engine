#!/usr/bin/env node

/**
 * Publish Next N Lanes
 *
 * Iterates through lane_inventory.json in order, skips duplicates against:
 *   1) data/published_pages.json (our registry)
 *   2) data/webflow_existing_slugs.json (imported from Webflow CMS export)
 *
 * For each non-duplicate, calls the ship pipeline (build → Webflow draft → staging → email).
 *
 * Flags:
 *   --count N         Number of lanes to publish (default 5)
 *   --mode staging    "staging" or "live" (default "staging")
 *   --dry-run         Skip Webflow API calls and email — artifacts only
 *   --offset N        Start from Nth inventory item (default 0)
 *   --filter-mode X   Only publish LTL, FTL, or Cargo Van / Box Truck (default: LTL — one mode per lane to start)
 *
 * Outputs:
 *   artifacts/publish_next_report.json — run report
 *
 * Exit codes:
 *   0 — published N lanes successfully
 *   2 — inventory exhausted before N successes
 *   1 — fatal error
 */

import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { getProjectRoot } from "../lib/fs/project-root.js";
import { runFullValidation, computeLanePageQualityScore } from "../lib/lane-page-validator.js";
import {
  buildPackageForLane, buildBodyContent, buildFaqSchemaEmbed,
  buildBreadcrumbSchemaEmbed, buildWebflowFields, shipOneLane,
  computeHubPriority, computeClusterPriority,
  loadLearningStateForPriority, parseClusterCities,
  publishSiteToProduction,
} from "../lib/lane-factory.js";
import { safeRegistryUpdate } from "../lib/publish-registry-disk.js";
import { getApprovedPublishSet, transitionState } from "../lib/approval-gate.js";
import {
  createManifest, setIntended, addPublished, addFailed, addBlocked,
  setDeploy, setEmail, setSampleLiveUrls, addWarning,
  finalizeManifest, saveManifest, printManifestSummary,
} from "../lib/publish-manifest.js";

const ROOT = getProjectRoot();

// Load .env.local
config({ path: path.join(ROOT, ".env.local") });

// --- Parse CLI flags ---
const args = process.argv.slice(2);
function getFlag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}
const TARGET_COUNT = parseInt(getFlag("count", "5"), 10);
const MODE = getFlag("mode", "staging"); // "staging" | "live" | "dry-run"
const DRY_RUN = args.includes("--dry-run") || MODE === "dry-run";
const FILTER_MODE = getFlag("filter-mode", "LTL");
const OFFSET = parseInt(getFlag("offset", "0"), 10);
const ALLOW_EMPTY_WEBFLOW_SLUGS = args.includes("--allow-empty-webflow-slugs");
const NO_HUB_PRIORITY = args.includes("--no-hub-priority");
const CLUSTER_FLAG = getFlag("cluster", null);
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");

// --- Load data files ---

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

// --- Main ---

async function main() {
  const clusterCities = parseClusterCities(CLUSTER_FLAG);

  // Create publish manifest for this run
  const runManifest = createManifest({
    scriptName: "publish_next.js",
    triggerSource: "manual",
    dryRun: DRY_RUN,
  });

  console.log("=== WARP Publish Next ===");
  if (DRY_RUN) {
    console.log("  ╔═══════════════════════════════╗");
    console.log("  ║         DRY RUN MODE          ║");
    console.log("  ║  No pages will be published   ║");
    console.log("  ║  No emails will be sent       ║");
    console.log("  ╚═══════════════════════════════╝");
  }
  console.log(`  Target:      ${TARGET_COUNT} lanes`);
  console.log(`  Mode:        ${DRY_RUN ? "DRY RUN" : MODE}`);
  console.log(`  Filter mode: ${FILTER_MODE}`);
  if (clusterCities) console.log(`  Cluster:     ${[...clusterCities].join(", ")}`);
  console.log(`  Offset:      ${OFFSET}`);
  console.log(`  Run ID:      ${runManifest.run_id}`);
  console.log("");

  // Load data — prefer lane_registry.json (real lanes), fall back to lane_inventory.json (legacy)
  const registryPath = path.join(ROOT, "data", "lane_registry.json");
  const inventoryPath = path.join(ROOT, "data", "lane_inventory.json");
  let inventory;
  if (fs.existsSync(registryPath)) {
    // Real lane registry: each entry has modes[] array — expand to mode-per-row format for compatibility
    const registry = loadJSON(registryPath);
    inventory = [];
    for (const lane of registry) {
      for (const mode of (lane.modes || ["LTL"])) {
        inventory.push({ origin: lane.origin, destination: lane.destination, mode, slug: lane.slug, lane_set: lane.lane_set, order: lane.order });
      }
    }
    console.log(`  Lane source: data/lane_registry.json (${registry.length} real lanes → ${inventory.length} mode combos)`);
  } else {
    inventory = loadJSON(inventoryPath);
    console.log(`  Lane source: data/lane_inventory.json (legacy)`);
  }
  const webflowSlugs = loadJSON(path.join(ROOT, "data", "webflow_existing_slugs.json"));
  const published = loadJSON(path.join(ROOT, "data", "published_pages.json"));

  if (inventory.length === 0) {
    console.error("ERROR: No lane data found. Run: node scripts/build_lane_registry.js");
    process.exit(1);
  }

  // --- Empty Webflow slugs guardrail ---
  if (webflowSlugs.length === 0) {
    console.warn("  ⚠  WARNING: Webflow existing slugs not imported. Real publish is unsafe.");
    console.warn("     Run: npm run webflow:slugs:import -- <path-to-webflow-export.csv>");
    console.warn("");
    if (!DRY_RUN && !ALLOW_EMPTY_WEBFLOW_SLUGS) {
      console.error("  BLOCKED: Cannot publish with empty webflow_existing_slugs.json.");
      console.error("  Import slugs first, or pass --allow-empty-webflow-slugs to override.");
      process.exit(1);
    }
  }

  // Build exclusion sets — prefer approval gate when approvals exist
  const { eligible: approvedLanes, excludedSlugs: approvalExcluded, reasons: approvalReasons } =
    getApprovedPublishSet({ filterMode: FILTER_MODE });
  const useApprovalGate = approvedLanes.length > 0;

  let excludedSlugs;
  if (useApprovalGate) {
    // Approval gate active — use its exclusion set (already includes webflow + published + blocked)
    excludedSlugs = approvalExcluded;
    console.log(`  Approval gate: ACTIVE (${approvedLanes.length} approved, ${excludedSlugs.size} excluded)`);
  } else {
    // No approvals yet — fall back to legacy exclusion behavior
    excludedSlugs = new Set();
    for (const s of webflowSlugs) {
      excludedSlugs.add(String(s).toLowerCase().trim());
    }
    for (const p of published) {
      if (p.slug) excludedSlugs.add(p.slug.toLowerCase().trim());
    }
    console.log(`  Approval gate: OFF (no approved lanes — using inventory)`);
  }

  console.log(`  Inventory:   ${inventory.length} total combos`);
  console.log(`  Excluded:    ${excludedSlugs.size} existing slugs (${webflowSlugs.length} Webflow + ${published.length} published)`);
  console.log("");

  // Filter inventory and apply hub-priority sort
  // When approval gate is active, candidates come from the approved set
  let candidates;
  if (useApprovalGate) {
    candidates = approvedLanes.slice(OFFSET);
    console.log(`  Candidates from approval gate: ${candidates.length} approved lanes`);
  } else {
    candidates = inventory
      .filter(lane => lane.mode === FILTER_MODE)
      .slice(OFFSET);
  }

  if (clusterCities) {
    // Cluster-first ranking overrides hub priority
    const publishedSlugSet = new Set(
      published.filter(p => !p.dry_run).map(p => (p.slug || "").toLowerCase())
    );
    candidates = candidates
      .map(lane => ({ ...lane, _hubScore: computeClusterPriority(lane, clusterCities, publishedSlugSet) }))
      .sort((a, b) => b._hubScore - a._hubScore);
    console.log(`  Cluster priority: ON (top candidate score: ${candidates[0]?._hubScore?.toFixed(1) || 0})`);
  } else if (!NO_HUB_PRIORITY) {
    // Build set of already-published slugs for reverse-lane bonus
    const publishedSlugSet = new Set(
      published.filter(p => !p.dry_run).map(p => (p.slug || "").toLowerCase())
    );
    // Load learning state for archetype priority boost
    const learningState = loadLearningStateForPriority();
    const hasLearning = learningState?.archetype_weights && Object.keys(learningState.archetype_weights).length > 0;
    candidates = candidates
      .map(lane => ({ ...lane, _hubScore: computeHubPriority(lane, publishedSlugSet, learningState) }))
      .sort((a, b) => b._hubScore - a._hubScore);
    console.log(`  Hub priority: ON (top candidate score: ${candidates[0]?._hubScore?.toFixed(1) || 0})`);
    if (hasLearning) console.log(`  Learning boost: ACTIVE (${Object.keys(learningState.archetype_weights).length} archetype weights loaded)`);
  } else {
    console.log(`  Hub priority: OFF (inventory order)`);
  }

  const report = {
    started_at: new Date().toISOString(),
    target_count: TARGET_COUNT,
    mode: DRY_RUN ? "dry-run" : MODE,
    filter_mode: FILTER_MODE,
    attempted: 0,
    skipped_duplicates: [],
    published_success: [],
    failures: [],
    remaining_candidates: 0,
  };

  let successCount = 0;

  for (const lane of candidates) {
    if (successCount >= TARGET_COUNT) break;

    const slug = lane.slug;

    // Duplicate gate: check against both exclusion sets
    if (excludedSlugs.has(slug)) {
      report.skipped_duplicates.push({
        slug,
        origin: lane.origin,
        destination: lane.destination,
        mode: lane.mode,
        reason: "slug exists in Webflow export or published registry",
        rule_id: "DUP-SLUG-01",
      });
      addBlocked(runManifest, { slug, reason: "duplicate slug", rule_id: "DUP-SLUG-01" });
      console.log(`  SKIP (duplicate): ${slug}`);
      continue;
    }

    // Attempt publish
    report.attempted++;
    console.log(`  [${successCount + 1}/${TARGET_COUNT}] Publishing: ${lane.origin} → ${lane.destination} (${lane.mode}) | slug: ${slug}`);

    try {
      const pkg = buildPackageForLane(lane.origin, lane.destination, lane.mode, "smb");

      // --- LANE PAGE VALIDATION GATE ---
      // Build content for validation
      const bodyHtml = buildBodyContent(pkg.page);
      const faqEmbed = buildFaqSchemaEmbed(pkg.page);
      const breadcrumbEmbed = buildBreadcrumbSchemaEmbed(pkg.page);
      const validation = runFullValidation(pkg.page, bodyHtml, faqEmbed, breadcrumbEmbed);

      // Store validation result on the package
      pkg.page.quality_score = validation.quality_score;
      pkg.page.banned_content_scan_result = validation.banned_content_found.length === 0 ? "clean" : validation.banned_content_found;
      pkg.page.rendered_html_validation_result = validation.valid ? "passed" : validation.errors.map(e => e.message);

      if (!validation.valid) {
        const failedGates = Object.entries(validation.gates).filter(([, v]) => !v).map(([k]) => k);
        const blockMsg = `Validation BLOCKED: ${failedGates.join(", ")} | score: ${validation.quality_score}`;
        report.failures.push({
          slug,
          origin: lane.origin,
          destination: lane.destination,
          mode: lane.mode,
          error: blockMsg,
          rule_ids: failedGates,
          quality_score: validation.quality_score,
          errors: validation.errors.slice(0, 5).map(e => e.message),
        });
        addBlocked(runManifest, { slug, reason: blockMsg, rule_id: failedGates[0] });
        // Transition approval state → blocked (validation failure)
        if (useApprovalGate) {
          transitionState(slug, lane.mode, "blocked", {
            by: "publish_next.js",
            reason: blockMsg,
            rule_id: failedGates[0],
          });
        }
        console.log(`    ✗ BLOCKED: ${blockMsg}`);

        // Write blocked artifact for inspection
        const laneDir = path.join(ARTIFACTS_DIR, "publish_next", slug);
        fs.mkdirSync(laneDir, { recursive: true });
        fs.writeFileSync(
          path.join(laneDir, "validation_blocked.json"),
          JSON.stringify({ validation, slug, generated_at: new Date().toISOString() }, null, 2)
        );
        continue;
      }

      console.log(`    ✓ Validation passed (score: ${validation.quality_score})`);

      const result = await shipOneLane(pkg, {
        dryRun: DRY_RUN,
        publishStaging: MODE === "staging" || MODE === "live",
        artifactsDir: ARTIFACTS_DIR,
      });

      // Success — add to published registry (in memory + disk)
      const entry = {
        canonical_path: pkg.canonicalPath,
        slug: pkg.page.slug,
        seo_title: pkg.page.seo_title,
        h1: pkg.page.h1,
        intro: pkg.page.intro,
        origin_city: lane.origin.replace(/,.*/, "").trim(),
        origin_state: (lane.origin.match(/,\s*(\w+)/) || [])[1] || "",
        destination_city: lane.destination.replace(/,.*/, "").trim(),
        destination_state: (lane.destination.match(/,\s*(\w+)/) || [])[1] || "",
        mode: lane.mode,
        segment: "smb",
        published_at_iso: new Date().toISOString(),
        wave_id: "publish-next",
        content_fingerprint: pkg.contentFingerprint,
        webflow_item_id: result.itemId || null,
        dry_run: result.dryRun,
      };

      published.push(entry);
      excludedSlugs.add(slug); // prevent within-run duplicates

      report.published_success.push({
        slug,
        origin: lane.origin,
        destination: lane.destination,
        mode: lane.mode,
        item_id: result.itemId,
        approval_id: result.approvalId,
        dry_run: result.dryRun,
      });
      addPublished(runManifest, {
        slug,
        webflow_item_id: result.itemId,
        url: `https://www.wearewarp.com/lanes/${slug}`,
      });

      // Transition approval state → published_pending_verification
      if (useApprovalGate && !result.dryRun) {
        transitionState(slug, lane.mode, "published_pending_verification", {
          by: "publish_next.js",
          note: `Run ${runManifest.run_id}`,
        });
      }

      successCount++;
      console.log(`    ✓ Published (${result.dryRun ? "dry-run" : "live"}) — item: ${result.itemId}`);
    } catch (err) {
      report.failures.push({
        slug,
        origin: lane.origin,
        destination: lane.destination,
        mode: lane.mode,
        error: err.message,
        rule_id: "SHIP-FAIL-01",
      });
      addFailed(runManifest, { slug, reason: err.message });
      // Transition approval state → failed
      if (useApprovalGate) {
        transitionState(slug, lane.mode, "failed", {
          by: "publish_next.js",
          reason: err.message,
          rule_id: "SHIP-FAIL-01",
        });
      }
      console.log(`    ✗ FAILED: ${err.message}`);
    }
  }

  // Count remaining
  const publishedSlugs = new Set([...excludedSlugs]);
  report.remaining_candidates = candidates.filter(l => !publishedSlugs.has(l.slug)).length;

  // Persist published registry — using shared safe merge module
  {
    const newRegistryEntries = report.published_success.map(s => {
      // Find the corresponding entry in the in-memory published array
      const entry = published.find(p => p.slug === s.slug);
      return entry || { slug: s.slug, webflow_item_id: s.item_id, published_at_iso: new Date().toISOString(), dry_run: DRY_RUN };
    });
    const regResult = safeRegistryUpdate(newRegistryEntries, { source: "publish_next" });
    console.log(`  Registry: ${regResult.added} added, ${regResult.updated} updated, ${regResult.total} total`);
    for (const w of regResult.warnings) {
      console.log(`  ⚠ Registry: ${w}`);
      addWarning(runManifest, w);
    }
  }

  // If live, publish site to production custom domains (batched)
  if (!DRY_RUN && report.published_success.length > 0) {
    const siteId = process.env.WEBFLOW_SITE_ID;
    if (siteId) {
      console.log("\n  Publishing site to production custom domains...");
      try {
        await publishSiteToProduction(siteId, process.env.WEBFLOW_API_TOKEN);
        console.log("    ✓ Site published to production (www.wearewarp.com)");
        setDeploy(runManifest, { provider: "webflow", status: "published_to_production" });
      } catch (e) {
        console.log(`    ✗ Site production publish error: ${e.message}`);
        setDeploy(runManifest, { provider: "webflow", status: "publish_error", error: e.message });
      }
    }
  }

  // Write report
  report.finished_at = new Date().toISOString();
  fs.mkdirSync(path.join(ARTIFACTS_DIR), { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "publish_next_report.json"),
    JSON.stringify(report, null, 2)
  );

  // Write publish audit trail
  if (report.published_success.length > 0) {
    console.log("\n  Writing publish audit trail...");
    try {
      const {
        buildPublishDecision: buildPD,
        writePublishDecision: writePD,
        appendPublishRunHistory: appendHistory,
        buildRunSummary,
        writePublishedPagesLatest,
        buildPublishConfirmationReport: buildReport,
      } = await import("../lib/publish-audit.js");

      const isLive = !DRY_RUN && MODE !== "dry-run";
      const decision = buildPD({
        mode: isLive ? "production" : "staging",
        environment: isLive ? "vercel-production" : "local",
        siteBaseUrl: "https://www.wearewarp.com",
        deploy: {
          provider: "webflow",
          deployment_id: report.published_success[0]?.item_id || "batch",
          deployment_url: "unknown",
          commit_sha: "unknown",
          branch: "unknown",
          status: isLive ? "success" : "unknown",
        },
        lanes: report.published_success.map(s => ({
          lane_slug: s.slug,
          status: "indexed",
          indexable: true,
          corridor: "unknown",
        })),
        blockedReasons: report.skipped_duplicates.map(d => ({
          rule_id: d.rule_id || "DUP-SLUG-01",
          page_key: d.slug,
          details: { reason: d.reason },
        })),
        allowed: true,
        errors: report.failures.map(f => f.error),
      });

      writePD(decision);
      appendHistory(buildRunSummary(decision));

      writePublishedPagesLatest({
        runId: decision.run_id,
        timestamp: decision.timestamp,
        liveIndexablePages: report.published_success.map(s => ({
          page_path: `/lanes/${s.slug}`,
          page_type: "lane",
          lane_slug: s.slug,
          corridor_id: "unknown",
        })),
        liveNoindexPages: [],
        blockedPages: report.skipped_duplicates.map(d => ({
          page_key: d.slug,
          rule_id: d.rule_id || "DUP-SLUG-01",
        })),
      });

      buildReport({ publishDecision: decision });
      console.log("    ✓ Audit trail written");
    } catch (auditErr) {
      console.log(`    ✗ Audit trail failed: ${auditErr.message}`);
    }
  }

  // Set intended count and finalize manifest
  setIntended(runManifest, report.attempted + report.skipped_duplicates.length);
  setEmail(runManifest, {
    attempted: false,
    sent: false,
    skipReason: "publish_next does not send email directly",
  });

  // Set sample live URLs from published pages
  const sampleUrls = report.published_success
    .filter(s => !s.dry_run)
    .slice(0, 5)
    .map(s => `https://www.wearewarp.com/lanes/${s.slug}`);
  setSampleLiveUrls(runManifest, sampleUrls);

  // Finalize and save manifest
  finalizeManifest(runManifest);
  const { path: manifestPath } = saveManifest(runManifest);

  // Emit machine-readable run_id for publish_text_batch.js handoff
  console.log(`PUBLISH_RUN_ID=${runManifest.run_id}`);

  // Print manifest summary (the new standard output)
  printManifestSummary(runManifest);

  // Legacy summary
  console.log("");
  console.log("=== Legacy Summary ===");
  console.log(`  Attempted:       ${report.attempted}`);
  console.log(`  Published:       ${report.published_success.length}`);
  console.log(`  Skipped (dupes): ${report.skipped_duplicates.length}`);
  console.log(`  Failures:        ${report.failures.length}`);
  console.log(`  Remaining:       ${report.remaining_candidates}`);
  console.log(`  Report:          ${path.join(ARTIFACTS_DIR, "publish_next_report.json")}`);
  console.log(`  Registry:        ${path.join(ROOT, "data", "published_pages.json")}`);
  console.log(`  Manifest:        ${manifestPath}`);
  console.log(`  Audit:           artifacts/publish_decision.json`);

  if (successCount >= TARGET_COUNT) {
    console.log(`\n  ✓ Target met: ${successCount}/${TARGET_COUNT} published.`);
    process.exit(0);
  } else {
    console.log(`\n  ✗ Inventory exhausted: ${successCount}/${TARGET_COUNT} published.`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
