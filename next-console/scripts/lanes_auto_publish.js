#!/usr/bin/env node

/**
 * Lane Page Factory — Auto Publish
 *
 * Full autonomous pipeline: manufacture → produce → verify → report → email.
 * No manual approval needed. The factory decides readiness based on validation gates.
 *
 * 13-step pipeline:
 *   PHASE 1: MANUFACTURE
 *     1. Load data (registry, webflow_slugs, published_pages, approval_state)
 *     2. Compute autonomous eligibility → ready_to_manufacture[]
 *     3. Sort by hub priority (or cluster priority)
 *     4. Take top N candidates
 *     5. For each candidate:
 *        a. buildPackageForLane() → full page spec
 *        b. buildBodyContent() + buildFaqSchemaEmbed() + buildBreadcrumbSchemaEmbed()
 *        c. runFullValidation() → quality gates
 *        d. Duplicate check (slug + title + H1 uniqueness)
 *        e. IF fails → transitionState("blocked") → skip
 *        f. IF passes → transitionState("manufactured")
 *
 *   PHASE 2: PRODUCE
 *     6. For each manufactured lane:
 *        a. buildWebflowFields() → 25 CMS fields
 *        b. shipOneLane() → Webflow API
 *        c. IF success → transitionState("published_pending_verification")
 *        d. IF fails → transitionState("failed")
 *        e. safeRegistryUpdate([entry])
 *        f. Wait --interval seconds (stagger)
 *     7. Batch site publish (publishSiteToProduction)
 *     8. Regenerate sitemap
 *
 *   PHASE 3: VERIFY + REPORT
 *     9. Verify live URLs
 *    10. Build SEO boost report
 *    11. Build receipt
 *    12. Send email
 *    13. Print summary
 *
 * Flags:
 *   --count N            Number of lanes to produce (default 5)
 *   --interval N         Seconds between each Webflow publish (default 4)
 *   --notify EMAIL       Email recipient (default: troy@wearewarp.com)
 *   --dry-run            Manufacture + validate only, skip Webflow + email
 *   --filter-mode X      LTL, FTL, etc. (default: LTL)
 *   --cluster CITIES     Cluster-first priority (e.g. "chicago-dallas-atlanta")
 *   --force              Retry previously failed lanes
 *   --json               Machine-readable output
 *
 * Outputs:
 *   artifacts/lane_factory_run_report.json
 *   artifacts/publish_next/<slug>/package.json (per lane)
 *
 * Exit codes:
 *   0 — produced N lanes
 *   2 — candidates exhausted before N
 *   1 — fatal error
 */

import { config } from "dotenv";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { getProjectRoot } from "../lib/fs/project-root.js";
import { computeFactoryInventory, transitionState } from "../lib/approval-gate.js";
import { runFullValidation } from "../lib/lane-page-validator.js";
import {
  buildPackageForLane, buildBodyContent, buildFaqSchemaEmbed,
  buildBreadcrumbSchemaEmbed, buildWebflowFields, shipOneLane,
  computeHubPriority, computeClusterPriority,
  loadLearningStateForPriority, parseClusterCities,
  publishSiteToProduction,
} from "../lib/lane-factory.js";
import { safeRegistryUpdate, loadRegistry } from "../lib/publish-registry-disk.js";
import {
  createManifest, setIntended, addPublished, addFailed, addBlocked,
  setDeploy, setEmail, setSampleLiveUrls, addWarning,
  finalizeManifest, saveManifest, printManifestSummary,
} from "../lib/publish-manifest.js";
import { expectedUrlForSlug, buildPageUrl } from "../lib/page-url.js";

const ROOT = getProjectRoot();

// Load .env.local
config({ path: path.join(ROOT, ".env.local") });

// --- CLI flags ---
const args = process.argv.slice(2);
const JSON_OUTPUT = args.includes("--json");
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");
function getFlag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}
const TARGET_COUNT = parseInt(getFlag("count", "5"), 10);
const INTERVAL = parseInt(getFlag("interval", "4"), 10);
const NOTIFY_EMAIL = getFlag("notify", "troy@wearewarp.com");
const FILTER_MODE = getFlag("filter-mode", "LTL");
const CLUSTER_FLAG = getFlag("cluster", null);
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");

// --- Main ---

async function main() {
  const startTime = Date.now();
  const clusterCities = parseClusterCities(CLUSTER_FLAG);

  // Create publish manifest
  const runManifest = createManifest({
    scriptName: "lanes_auto_publish.js",
    triggerSource: "autonomous-factory",
    dryRun: DRY_RUN,
  });

  if (!JSON_OUTPUT) {
    console.log("");
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  LANE PAGE FACTORY — AUTO PUBLISH                ║");
    console.log("╚══════════════════════════════════════════════════╝");
    if (DRY_RUN) {
      console.log("  ╔═══════════════════════════════╗");
      console.log("  ║         DRY RUN MODE          ║");
      console.log("  ║  No Webflow writes            ║");
      console.log("  ║  No emails sent               ║");
      console.log("  ╚═══════════════════════════════╝");
    }
    console.log(`  Target:      ${TARGET_COUNT} lanes`);
    console.log(`  Mode:        ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
    console.log(`  Filter:      ${FILTER_MODE}`);
    console.log(`  Interval:    ${INTERVAL}s between publishes`);
    console.log(`  Notify:      ${NOTIFY_EMAIL}`);
    if (clusterCities) console.log(`  Cluster:     ${[...clusterCities].join(", ")}`);
    if (FORCE) console.log(`  Force:       retrying previously failed lanes`);
    console.log(`  Run ID:      ${runManifest.run_id}`);
    console.log("");
  }

  // ──────────────────────────────────────────────────────────────────────
  // STEP 1: Load data & compute eligibility
  // ──────────────────────────────────────────────────────────────────────

  const inventory = computeFactoryInventory({ filterMode: FILTER_MODE });

  // Candidates: ready_to_manufacture + (if --force, include failed)
  let candidates = [...inventory.ready_to_manufacture];
  if (FORCE) {
    candidates.push(...inventory.failed);
  }
  // Also include approved lanes (manually approved, skip manufacturing validation)
  candidates.push(...inventory.approved);

  if (!JSON_OUTPUT) {
    console.log("── Step 1: Eligibility ─────────────────────────────");
    console.log(`  Registry lanes:        ${inventory.totals.registry}`);
    console.log(`  Already live:          ${inventory.totals.overlap}`);
    console.log(`  Already published:     ${inventory.totals.already_published}`);
    console.log(`  Ready to manufacture:  ${inventory.totals.ready_to_manufacture}`);
    console.log(`  Approved (manual):     ${inventory.totals.approved}`);
    if (FORCE) console.log(`  Failed (retrying):     ${inventory.totals.failed}`);
    console.log(`  Blocked:               ${inventory.totals.blocked}`);
    console.log(`  Candidates:            ${candidates.length}`);
    console.log("");
  }

  if (candidates.length === 0) {
    if (!JSON_OUTPUT) {
      console.log("  No candidates available. Nothing to do.");
    }
    process.exit(0);
  }

  // ──────────────────────────────────────────────────────────────────────
  // STEP 2: Sort by priority
  // ──────────────────────────────────────────────────────────────────────

  const { entries: published } = loadRegistry();
  const publishedSlugSet = new Set(
    published.filter(p => !p.dry_run).map(p => (p.slug || "").toLowerCase())
  );

  if (clusterCities) {
    candidates = candidates
      .map(lane => ({ ...lane, _score: computeClusterPriority(lane, clusterCities, publishedSlugSet) }))
      .sort((a, b) => b._score - a._score);
  } else {
    const learningState = loadLearningStateForPriority();
    candidates = candidates
      .map(lane => ({ ...lane, _score: computeHubPriority(lane, publishedSlugSet, learningState) }))
      .sort((a, b) => b._score - a._score);
  }

  // Take top N
  const topCandidates = candidates.slice(0, TARGET_COUNT);

  if (!JSON_OUTPUT) {
    console.log("── Step 2: Priority ────────────────────────────────");
    console.log(`  Top candidate:   ${topCandidates[0]?.slug} (score: ${topCandidates[0]?._score?.toFixed(1)})`);
    console.log(`  Evaluating:      ${topCandidates.length} candidates`);
    console.log("");
  }

  // ──────────────────────────────────────────────────────────────────────
  // PHASE 1: MANUFACTURE (Steps 3-5)
  // ──────────────────────────────────────────────────────────────────────

  const manufactured = [];
  const blockedResults = [];
  const batchSlugs = new Set();
  const batchTitles = new Set();
  const batchH1s = new Set();

  // Add existing published slugs/titles/H1s to dedup sets (skip dry-run entries)
  for (const p of published) {
    if (p.dry_run) continue;
    if (p.slug) batchSlugs.add(p.slug.toLowerCase());
    if (p.seo_title) batchTitles.add(p.seo_title);
    if (p.h1) batchH1s.add(p.h1);
  }

  if (!JSON_OUTPUT) {
    console.log("── Phase 1: Manufacture ────────────────────────────");
  }

  for (const lane of topCandidates) {
    try {
      // Build package
      const pkg = buildPackageForLane(
        lane.origin, lane.destination,
        lane.mode || FILTER_MODE, "smb"
      );

      // Duplicate checks (slug, title, H1)
      if (batchSlugs.has(pkg.page.slug.toLowerCase())) {
        const reason = "duplicate slug (already published or within batch)";
        transitionState(lane.slug, lane.mode || FILTER_MODE, "blocked", {
          by: "lanes_auto_publish.js",
          reason,
          rule_id: "FACTORY-DUP-SLUG",
        });
        blockedResults.push({ slug: lane.slug, reason });
        addBlocked(runManifest, { slug: lane.slug, reason, rule_id: "FACTORY-DUP-SLUG" });
        if (!JSON_OUTPUT) console.log(`  \u2717 ${lane.slug} — BLOCKED: ${reason}`);
        continue;
      }
      if (batchTitles.has(pkg.page.seo_title)) {
        const reason = "duplicate seo_title";
        transitionState(lane.slug, lane.mode || FILTER_MODE, "blocked", {
          by: "lanes_auto_publish.js",
          reason,
          rule_id: "FACTORY-DUP-TITLE",
        });
        blockedResults.push({ slug: lane.slug, reason });
        addBlocked(runManifest, { slug: lane.slug, reason, rule_id: "FACTORY-DUP-TITLE" });
        if (!JSON_OUTPUT) console.log(`  \u2717 ${lane.slug} — BLOCKED: ${reason}`);
        continue;
      }
      if (batchH1s.has(pkg.page.h1)) {
        const reason = "duplicate h1";
        transitionState(lane.slug, lane.mode || FILTER_MODE, "blocked", {
          by: "lanes_auto_publish.js",
          reason,
          rule_id: "FACTORY-DUP-H1",
        });
        blockedResults.push({ slug: lane.slug, reason });
        addBlocked(runManifest, { slug: lane.slug, reason, rule_id: "FACTORY-DUP-H1" });
        if (!JSON_OUTPUT) console.log(`  \u2717 ${lane.slug} — BLOCKED: ${reason}`);
        continue;
      }

      // Validate content
      const bodyHtml = buildBodyContent(pkg.page);
      const faqEmbed = buildFaqSchemaEmbed(pkg.page);
      const breadcrumbEmbed = buildBreadcrumbSchemaEmbed(pkg.page);
      const validation = runFullValidation(pkg.page, bodyHtml, faqEmbed, breadcrumbEmbed);

      pkg.page.quality_score = validation.quality_score;
      pkg.page.banned_content_scan_result = validation.banned_content_found.length === 0 ? "clean" : validation.banned_content_found;
      pkg.page.rendered_html_validation_result = validation.valid ? "passed" : validation.errors.map(e => e.message);

      if (!validation.valid) {
        const failedGates = Object.entries(validation.gates).filter(([, v]) => !v).map(([k]) => k);
        const reason = `Validation: ${failedGates.join(", ")} | score: ${validation.quality_score}`;
        transitionState(lane.slug, lane.mode || FILTER_MODE, "blocked", {
          by: "lanes_auto_publish.js",
          reason,
          rule_id: failedGates[0],
        });
        blockedResults.push({ slug: lane.slug, reason, quality_score: validation.quality_score });
        addBlocked(runManifest, { slug: lane.slug, reason, rule_id: failedGates[0] });
        if (!JSON_OUTPUT) console.log(`  \u2717 ${lane.slug} — BLOCKED: ${reason}`);
        continue;
      }

      // Passed — transition to manufactured
      transitionState(lane.slug, lane.mode || FILTER_MODE, "manufactured", {
        by: "lanes_auto_publish.js",
        note: `quality: ${validation.quality_score}, run: ${runManifest.run_id}`,
      });

      // Track in dedup sets
      batchSlugs.add(pkg.page.slug.toLowerCase());
      batchTitles.add(pkg.page.seo_title);
      batchH1s.add(pkg.page.h1);

      manufactured.push({
        lane,
        pkg,
        bodyHtml,
        faqEmbed,
        breadcrumbEmbed,
        quality_score: validation.quality_score,
      });

      if (!JSON_OUTPUT) {
        console.log(`  \u2713 ${lane.slug} — manufactured (quality: ${validation.quality_score})`);
      }
    } catch (err) {
      blockedResults.push({ slug: lane.slug, reason: err.message });
      addFailed(runManifest, { slug: lane.slug, reason: err.message });
      if (!JSON_OUTPUT) console.log(`  ! ${lane.slug} — ERROR: ${err.message}`);
    }
  }

  if (!JSON_OUTPUT) {
    console.log(`\n  Manufactured: ${manufactured.length}  |  Blocked: ${blockedResults.length}`);
    console.log("");
  }

  // ──────────────────────────────────────────────────────────────────────
  // PHASE 2: PRODUCE (Steps 6-8)
  // ──────────────────────────────────────────────────────────────────────

  const producedResults = [];
  const failedResults = [];

  if (manufactured.length === 0) {
    if (!JSON_OUTPUT) console.log("  No lanes manufactured. Skipping production phase.");
  } else {
    if (!JSON_OUTPUT) {
      console.log("── Phase 2: Produce ────────────────────────────────");
    }

    for (let i = 0; i < manufactured.length; i++) {
      const { lane, pkg } = manufactured[i];
      const slug = pkg.page.slug;

      try {
        const result = await shipOneLane(pkg, {
          dryRun: DRY_RUN,
          publishStaging: !DRY_RUN,
          artifactsDir: ARTIFACTS_DIR,
        });

        if (!result.dryRun) {
          // Transition: manufactured → published_pending_verification
          transitionState(slug, lane.mode || FILTER_MODE, "published_pending_verification", {
            by: "lanes_auto_publish.js",
            note: `itemId: ${result.itemId}, run: ${runManifest.run_id}`,
          });
        }

        // Registry entry
        const entry = {
          canonical_path: pkg.canonicalPath,
          slug,
          seo_title: pkg.page.seo_title,
          h1: pkg.page.h1,
          intro: pkg.page.intro,
          origin_city: lane.origin.replace(/,.*/, "").trim(),
          origin_state: (lane.origin.match(/,\s*(\w+)/) || [])[1] || "",
          destination_city: lane.destination.replace(/,.*/, "").trim(),
          destination_state: (lane.destination.match(/,\s*(\w+)/) || [])[1] || "",
          mode: lane.mode || FILTER_MODE,
          segment: "smb",
          published_at_iso: new Date().toISOString(),
          wave_id: "factory-auto-publish",
          content_fingerprint: pkg.contentFingerprint,
          webflow_item_id: result.itemId || null,
          dry_run: result.dryRun,
        };

        safeRegistryUpdate([entry], { source: "lanes_auto_publish" });

        producedResults.push({
          slug,
          origin: lane.origin,
          destination: lane.destination,
          mode: lane.mode || FILTER_MODE,
          item_id: result.itemId,
          dry_run: result.dryRun,
          quality_score: manufactured[i].quality_score,
        });

        addPublished(runManifest, {
          slug,
          webflow_item_id: result.itemId,
          url: expectedUrlForSlug(slug),
        });

        if (!JSON_OUTPUT) {
          console.log(`  \u2713 ${slug} — ${result.dryRun ? "dry-run" : "produced"} (item: ${result.itemId})`);
        }

        // Stagger between publishes (skip for last item)
        if (i < manufactured.length - 1 && !DRY_RUN && INTERVAL > 0) {
          await new Promise(r => setTimeout(r, INTERVAL * 1000));
        }
      } catch (err) {
        transitionState(slug, lane.mode || FILTER_MODE, "failed", {
          by: "lanes_auto_publish.js",
          reason: err.message,
          rule_id: "FACTORY-SHIP-FAIL",
        });
        failedResults.push({ slug, error: err.message });
        addFailed(runManifest, { slug, reason: err.message });
        if (!JSON_OUTPUT) console.log(`  \u2717 ${slug} — FAILED: ${err.message}`);
      }
    }

    if (!JSON_OUTPUT) {
      console.log(`\n  Produced: ${producedResults.length}  |  Failed: ${failedResults.length}`);
      console.log("");
    }

    // Step 7: Batch site publish
    if (!DRY_RUN && producedResults.length > 0) {
      const siteId = process.env.WEBFLOW_SITE_ID;
      if (siteId) {
        if (!JSON_OUTPUT) console.log("  Publishing site to production...");
        try {
          await publishSiteToProduction(siteId, process.env.WEBFLOW_API_TOKEN);
          setDeploy(runManifest, { provider: "webflow", status: "published_to_production" });
          if (!JSON_OUTPUT) console.log("    \u2713 Site published to production");
        } catch (e) {
          setDeploy(runManifest, { provider: "webflow", status: "publish_error", error: e.message });
          if (!JSON_OUTPUT) console.log(`    \u2717 Site publish error: ${e.message}`);
        }
      }
    }

    // Step 8: Regenerate sitemap
    if (producedResults.length > 0) {
      if (!JSON_OUTPUT) console.log("  Regenerating sitemaps...");
      try {
        execSync("node scripts/generate_all_sitemaps.js --published-only", {
          cwd: ROOT,
          stdio: "pipe",
        });
        if (!JSON_OUTPUT) console.log("    \u2713 Sitemaps regenerated");
      } catch (e) {
        if (!JSON_OUTPUT) console.log(`    \u2717 Sitemap generation error: ${e.message}`);
        addWarning(runManifest, `Sitemap generation failed: ${e.message}`);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // PHASE 3: VERIFY + REPORT (Steps 9-13)
  // ──────────────────────────────────────────────────────────────────────

  if (!JSON_OUTPUT) {
    console.log("");
    console.log("── Phase 3: Verify + Report ────────────────────────");
  }

  // Step 9: Verify live URLs (only for non-dry-run)
  const verifiedUrls = [];
  if (!DRY_RUN && producedResults.length > 0) {
    if (!JSON_OUTPUT) console.log("  Verifying live URLs...");
    try {
      const { verifyLiveUrlWithRetry } = await import("../lib/publish-receipt.js");
      for (const p of producedResults.filter(r => !r.dry_run)) {
        const url = expectedUrlForSlug(p.slug);
        try {
          const verified = await verifyLiveUrlWithRetry(url, { maxRetries: 3, delayMs: 5000 });
          if (verified) {
            transitionState(p.slug, p.mode, "verified_live", {
              by: "lanes_auto_publish.js",
              note: `Verified at ${url}`,
            });
            verifiedUrls.push(url);
            if (!JSON_OUTPUT) console.log(`    \u2713 ${p.slug} — verified live`);
          } else {
            if (!JSON_OUTPUT) console.log(`    \u2717 ${p.slug} — not yet live (pending verification)`);
          }
        } catch {
          if (!JSON_OUTPUT) console.log(`    \u2717 ${p.slug} — verification error`);
        }
      }
    } catch {
      if (!JSON_OUTPUT) console.log("    Skipped URL verification (publish-receipt unavailable)");
    }
  }

  // Step 10: SEO boost report
  if (producedResults.length > 0) {
    try {
      const { buildSeoBoostReport, saveSeoBoostReport } = await import("../lib/seo-boost-report.js");
      const pages = producedResults.map(p => ({
        slug: p.slug,
        origin: p.origin,
        destination: p.destination,
        mode: p.mode,
        url: expectedUrlForSlug(p.slug),
        quality_score: p.quality_score,
        verified_live: verifiedUrls.includes(expectedUrlForSlug(p.slug)),
      }));
      const seoReport = buildSeoBoostReport(pages);
      saveSeoBoostReport(seoReport);
      if (!JSON_OUTPUT) console.log("  \u2713 SEO boost report saved");
    } catch {
      if (!JSON_OUTPUT) console.log("  Skipped SEO boost report (module unavailable)");
    }
  }

  // Step 11: Build receipt — deferred until after manifest is finalized (see below)

  // ── Steps 12-13: Finalize manifest → build receipt → send email ──
  //
  // Data flow: manifest → receipt → email
  // The receipt is the canonical source of truth for the email renderer.
  // buildConfirmationEmailHtml() expects a receipt object, not raw data.

  // Step 12a: Finalize manifest first (receipt needs finalized manifest)
  setIntended(runManifest, topCandidates.length);

  const sampleUrls = verifiedUrls.length > 0
    ? verifiedUrls.slice(0, 5)
    : producedResults.filter(r => !r.dry_run).slice(0, 5).map(r => expectedUrlForSlug(r.slug));
  setSampleLiveUrls(runManifest, sampleUrls);

  // Step 12b: Build receipt from finalized manifest + verification results
  // This produces the canonical data shape that buildConfirmationEmailHtml expects.
  // Receipt is built first (for email rendering), then updated with email status,
  // then saved ONCE after everything is complete.
  let factoryReceipt = null;
  let verificationResults = [];
  if (producedResults.length > 0) {
    try {
      const { buildReceipt } = await import("../lib/publish-receipt.js");

      // Build verification results in the format buildReceipt expects:
      //   Array<{ slug, url, status, httpStatus, identityMatch, error }>
      verificationResults = producedResults.filter(r => !r.dry_run).map(p => {
        const url = expectedUrlForSlug(p.slug);
        const isVerified = verifiedUrls.includes(url);
        return {
          slug: p.slug,
          url,
          status: isVerified ? "verified_live" : "published_unverified",
          httpStatus: isVerified ? 200 : null,
          identityMatch: isVerified,
          error: isVerified ? null : "not yet verified",
        };
      });

      factoryReceipt = buildReceipt(runManifest, verificationResults);
      // Don't save yet — email status will be added below
    } catch {
      if (!JSON_OUTPUT) console.log("  Skipped receipt build (module unavailable)");
    }
  }

  // Step 12c: Send email using the receipt (canonical data shape)
  // Uses lib/email-sender.js — the canonical email path for the repo.
  // Requires EMAIL_USER, EMAIL_APP_PASSWORD, and EMAIL_TO in .env.local.
  // Run `npm run email:doctor` to verify credentials.
  let emailSent = false;
  if (!DRY_RUN && producedResults.filter(r => !r.dry_run).length > 0 && NOTIFY_EMAIL && factoryReceipt) {
    try {
      const { buildConfirmationEmailHtml } = await import("../lib/publish-receipt.js");
      const { createTransportFromEnv, verifyTransport } = await import("../lib/email-sender.js");

      // Override EMAIL_TO with --notify flag value for this send
      const originalEmailTo = process.env.EMAIL_TO;
      process.env.EMAIL_TO = NOTIFY_EMAIL;

      // Pass the receipt — the exact shape buildConfirmationEmailHtml expects
      const emailHtml = buildConfirmationEmailHtml(factoryReceipt);

      const transporter = await createTransportFromEnv();

      // Verify SMTP connection before sending (matches lib/email-sender.js pattern)
      const verification = await verifyTransport(transporter);
      if (!verification.ok) {
        throw new Error(`SMTP verification failed: ${verification.error}`);
      }

      const liveCount = producedResults.filter(r => !r.dry_run).length;
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: NOTIFY_EMAIL,
        subject: `[WARP Factory] ${liveCount} lane page${liveCount === 1 ? "" : "s"} produced — ${new Date().toLocaleDateString()}`,
        html: emailHtml,
      });

      // Restore original EMAIL_TO
      if (originalEmailTo !== undefined) {
        process.env.EMAIL_TO = originalEmailTo;
      } else {
        delete process.env.EMAIL_TO;
      }

      emailSent = true;
      if (!JSON_OUTPUT) console.log(`  \u2713 Email sent to ${NOTIFY_EMAIL}`);
    } catch (emailErr) {
      if (!JSON_OUTPUT) console.log(`  \u2717 Email failed: ${emailErr.message}`);
      addWarning(runManifest, `Email failed: ${emailErr.message}`);
    }
  }

  // Step 12d: Set email status on manifest, finalize, and save
  setEmail(runManifest, {
    attempted: !DRY_RUN && producedResults.length > 0,
    sent: emailSent,
    recipient: NOTIFY_EMAIL,
    skipReason: DRY_RUN ? "dry-run mode" : emailSent ? null : "email not configured or failed",
  });

  finalizeManifest(runManifest);
  const { path: manifestPath } = saveManifest(runManifest);

  // Step 12e: Re-build receipt with finalized manifest (now includes email status) and save
  if (producedResults.length > 0) {
    try {
      const { buildReceipt, saveReceipt } = await import("../lib/publish-receipt.js");
      factoryReceipt = buildReceipt(runManifest, verificationResults);
      saveReceipt(factoryReceipt);
      if (!JSON_OUTPUT) console.log("  \u2713 Receipt saved");
    } catch {
      if (!JSON_OUTPUT) console.log("  Skipped receipt save (module unavailable)");
    }
  }

  // Step 13: Write run report
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const runReport = {
    run_id: runManifest.run_id,
    generated_at: new Date().toISOString(),
    elapsed_seconds: parseFloat(elapsed),
    dry_run: DRY_RUN,
    filter_mode: FILTER_MODE,
    cluster: CLUSTER_FLAG || null,
    target_count: TARGET_COUNT,
    interval_seconds: INTERVAL,
    notify_email: NOTIFY_EMAIL,
    manufactured: manufactured.length,
    produced: producedResults.length,
    blocked: blockedResults.length,
    failed: failedResults.length,
    verified_live: verifiedUrls.length,
    email_sent: emailSent,
    produced_slugs: producedResults.map(r => r.slug),
    blocked_slugs: blockedResults.map(r => r.slug),
    failed_slugs: failedResults.map(r => r.slug),
    verified_urls: verifiedUrls,
  };

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "lane_factory_run_report.json"),
    JSON.stringify(runReport, null, 2) + "\n"
  );

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(runReport, null, 2));
    process.exit(producedResults.length >= TARGET_COUNT ? 0 : 2);
  }

  // Print manifest summary
  printManifestSummary(runManifest);

  // Final summary
  console.log("");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Manufactured:    ${manufactured.length}`);
  console.log(`  Produced:        ${producedResults.length}`);
  console.log(`  Blocked:         ${blockedResults.length}`);
  console.log(`  Failed:          ${failedResults.length}`);
  console.log(`  Verified live:   ${verifiedUrls.length}`);
  console.log(`  Email sent:      ${emailSent ? "YES" : "NO"}`);
  console.log(`  Elapsed:         ${elapsed}s`);
  console.log(`  Report:          artifacts/lane_factory_run_report.json`);
  console.log(`  Manifest:        ${manifestPath}`);
  console.log("═══════════════════════════════════════════════════");

  process.exit(producedResults.length >= TARGET_COUNT ? 0 : 2);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
