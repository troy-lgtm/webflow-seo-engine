#!/usr/bin/env node

/**
 * Build Publish Audit Bundle
 *
 * Runs the full audit pipeline in sequence:
 *   1. Build publish decision from lane registry
 *   2. Build published pages latest from lane registry
 *   3. Build publish confirmation report
 *   4. Verify live pages (sample HTTP checks)
 *   5. Build SEO impact estimate
 *   6. Build SEO momentum report (if metrics snapshots exist)
 *   7. Run publish integrity checks
 *
 * CRITICAL: When run manually outside a real deploy context, all generated
 * artifacts are explicitly marked as:
 *   - classification: local_simulation
 *   - confirmed_posted_today: false
 *   - trust_level: low
 *   - reason_codes includes "manual_audit_bundle_run"
 *
 * A manual local audit can NEVER impersonate production.
 *
 * Usage:
 *   node scripts/build_publish_audit_bundle.js
 *   npm run audit:publish
 *
 * Flags:
 *   --skip-verification    Skip live URL verification (faster, no network)
 *   --mode <mode>          Override publish mode (production|staging|dry)
 */

import fs from "fs";
import { getProjectRoot, resolveFromRoot } from "../lib/fs/project-root.js";
import { loadJsonArtifact } from "../lib/artifacts/load-artifact.js";
import {
  buildPublishDecision,
  writePublishDecision,
  appendPublishRunHistory,
  buildRunSummary,
  buildPublishedPagesFromRegistry,
  writePublishedPagesLatest,
  buildPublishConfirmationReport,
} from "../lib/publish-audit.js";
import { classifyPublishRun, DISPLAY_LABELS, TRUST_LEVELS } from "../lib/publish-classification.js";
import { estimateSeoImpact } from "../lib/seo-impact-estimator.js";
import { buildSeoMomentumReport } from "../lib/seo-momentum.js";
import { runPublishIntegrityChecks } from "../lib/publish-integrity-checks.js";

const ROOT = getProjectRoot();
const args = process.argv.slice(2);
const skipVerification = args.includes("--skip-verification");
const modeOverride = (() => {
  const idx = args.indexOf("--mode");
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
})();

function step(label, fn) {
  process.stdout.write(`  ${label}... `);
  try {
    const result = fn();
    console.log("OK");
    return result;
  } catch (err) {
    console.log("FAILED");
    console.error(`    ${err.message}`);
    return null;
  }
}

async function asyncStep(label, fn) {
  process.stdout.write(`  ${label}... `);
  try {
    const result = await fn();
    console.log("OK");
    return result;
  } catch (err) {
    console.log("FAILED");
    console.error(`    ${err.message}`);
    return null;
  }
}

async function main() {
  console.log("=== Publish Audit Bundle ===\n");

  // Load lane registry
  const laneSnap = loadJsonArtifact("artifacts/lane_registry_snapshot.json");
  const corridorSnap = loadJsonArtifact("artifacts/corridor_snapshot.json");
  const lanes = laneSnap?.lanes || [];

  if (lanes.length === 0) {
    console.error("  ERROR: No lanes in lane_registry_snapshot.json. Run snapshots:seo first.");
    process.exit(1);
  }

  console.log(`  Lanes: ${lanes.length}`);
  console.log(`  Mode: ${modeOverride || "dry"}`);
  console.log("");

  // Step 1: Build publish decision
  // CRITICAL: This script is always a local/manual invocation.
  // We explicitly mark it as local_simulation with _source = "manual_audit_bundle"
  // so the classification layer can never confuse it with a real deploy.
  const publishDecision = step("Build publish decision", () => {
    const blockedReasons = [];
    for (const lane of lanes) {
      if (lane.status === "blocked" && lane.blocked_reasons) {
        for (const reason of (Array.isArray(lane.blocked_reasons) ? lane.blocked_reasons : [lane.blocked_reasons])) {
          blockedReasons.push({
            rule_id: typeof reason === "string" ? reason : (reason.rule_id || reason.ruleId || "unknown"),
            page_key: lane.lane_slug,
            details: typeof reason === "object" ? reason : {},
          });
        }
      }
    }

    const decision = buildPublishDecision({
      mode: modeOverride || "dry",
      environment: "local",
      siteBaseUrl: "https://www.wearewarp.com",
      deploy: {
        provider: "local",
        deployment_id: "local-audit",
        deployment_url: "http://localhost:3001",
        commit_sha: "local",
        branch: "local",
        status: modeOverride === "production" ? "success" : "unknown",
      },
      lanes,
      blockedReasons,
      allowed: true,
      errors: [],
    });

    // Force local simulation markers — a manual audit bundle can NEVER
    // impersonate production regardless of --mode flag
    decision._source = "manual_audit_bundle";

    // Re-classify after marking source
    const cls = classifyPublishRun(decision, null);
    decision.classification = cls.classification;
    decision.display_status = cls.display_status;
    decision.confirmed_posted_today = cls.confirmed_posted_today;
    decision.trust_level = cls.trust_level;

    writePublishDecision(decision);
    return decision;
  });

  if (!publishDecision) {
    console.error("\n  FATAL: Could not build publish decision. Aborting.");
    process.exit(1);
  }

  // Print classification clearly
  console.log(`\n  Classification: ${publishDecision.classification}`);
  console.log(`  Display Status: ${publishDecision.display_status}`);
  console.log(`  Trust Level:    ${publishDecision.trust_level}`);
  console.log(`  Confirmed:      ${publishDecision.confirmed_posted_today}`);
  console.log("");

  // Step 2: Append run history
  step("Append run history", () => {
    const summary = buildRunSummary(publishDecision);
    appendPublishRunHistory(summary);
    return summary;
  });

  // Step 3: Build published pages latest
  step("Build published pages latest", () => {
    const pagesData = buildPublishedPagesFromRegistry({
      runId: publishDecision.run_id,
      timestamp: publishDecision.timestamp,
      lanes,
      blockedReasons: publishDecision.blocked_reasons,
      siteBaseUrl: publishDecision.site_base_url,
    });
    writePublishedPagesLatest(pagesData);
    return pagesData;
  });

  // Step 4: Verify live pages (optional)
  if (!skipVerification) {
    await asyncStep("Verify live pages", async () => {
      // Use dynamic import to call the verification script logic
      const { execSync } = await import("child_process");
      try {
        execSync(`node ${resolveFromRoot("scripts", "verify_live_pages.js")}`, {
          cwd: ROOT,
          stdio: "pipe",
          timeout: 60000,
        });
      } catch (err) {
        // Don't fail the whole bundle if verification fails (pages may not be live)
        console.log("\n    (verification completed with errors — see artifacts/live_page_verification.json)");
      }
      return loadJsonArtifact("artifacts/live_page_verification.json");
    });
  } else {
    console.log("  Verify live pages... SKIPPED (--skip-verification)");
  }

  // Step 5: Build publish confirmation report
  step("Build confirmation report", () => {
    return buildPublishConfirmationReport({
      publishDecision,
    });
  });

  // Step 6: Build SEO impact estimate
  step("Build SEO impact estimate", () => {
    return estimateSeoImpact({
      publishDecision,
      lanes,
      corridorSnapshot: corridorSnap,
    });
  });

  // Step 7: Build SEO momentum report (if metrics exist)
  const metricsSnap = loadJsonArtifact("artifacts/metrics_snapshot.json");
  if (metricsSnap) {
    step("Build SEO momentum report", () => {
      return buildSeoMomentumReport({
        metricsSnapshot: metricsSnap,
        publishDecision,
      });
    });
  } else {
    console.log("  Build SEO momentum report... SKIPPED (no metrics_snapshot.json)");
  }

  // Step 8: Run publish integrity checks
  const integrity = step("Run integrity checks", () => {
    return runPublishIntegrityChecks();
  });

  // Summary
  console.log("\n  ── Artifacts Written ──");
  const artifacts = [
    "artifacts/publish_decision.json",
    "artifacts/publish_run_history.json",
    "artifacts/published_pages_latest.json",
    "artifacts/publish_confirmation_report.json",
    "artifacts/seo_impact_estimate.json",
    "artifacts/publish_integrity_report.json",
  ];
  if (!skipVerification) artifacts.splice(3, 0, "artifacts/live_page_verification.json");
  if (metricsSnap) artifacts.push("artifacts/seo_momentum_report.json");

  for (const a of artifacts) {
    const exists = fs.existsSync(resolveFromRoot(a));
    console.log(`  ${exists ? "\u2713" : "\u2717"} ${a}`);
  }

  // Classification summary
  console.log("\n  ── Classification ──");
  console.log(`  Type:       ${publishDecision.classification}`);
  console.log(`  Status:     ${publishDecision.display_status}`);
  console.log(`  Trust:      ${publishDecision.trust_level}`);
  console.log(`  Confirmed:  ${publishDecision.confirmed_posted_today}`);

  // Integrity summary
  if (integrity) {
    console.log("\n  ── Integrity ──");
    console.log(`  Status: ${integrity.overall_status}`);
    console.log(`  High:   ${integrity.summary.high}`);
    console.log(`  Medium: ${integrity.summary.medium}`);
    console.log(`  Low:    ${integrity.summary.low}`);
  }

  // Impact summary
  const impact = loadJsonArtifact("artifacts/seo_impact_estimate.json");
  if (impact) {
    console.log("\n  ── Expected SEO Impact (Month 2) ──");
    const m2 = impact.expected.month_2;
    console.log(`  Indexed pages: ${m2.indexed_pages.low}-${m2.indexed_pages.high}`);
    console.log(`  Impressions:   ${m2.impressions.low}-${m2.impressions.high}`);
    console.log(`  Clicks:        ${m2.clicks.low}-${m2.clicks.high}`);
    console.log(`  Quote starts:  ${m2.quote_starts.low}-${m2.quote_starts.high}`);
    console.log(`  Bookings:      ${m2.bookings.low}-${m2.bookings.high}`);
  }

  console.log("\n  Done.\n");
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
