#!/usr/bin/env node

/**
 * Build Metrics Snapshot
 *
 * Pulls data from all metric providers, normalizes join keys,
 * computes coverage, runs sanity checks, and writes artifacts.
 *
 * Outputs:
 *   artifacts/metrics_snapshot.json
 *   artifacts/metrics_sanity_report.json
 *
 * Usage:
 *   node scripts/build_metrics_snapshot.js
 *   npm run metrics:snapshot
 */

import fs from "fs";
import crypto from "crypto";
import { resolveFromRoot } from "../lib/fs/project-root.js";
import { loadJsonArtifact } from "../lib/artifacts/load-artifact.js";
import * as gscProvider from "../lib/metrics/providers/gsc.js";
import * as ga4Provider from "../lib/metrics/providers/ga4.js";
import * as portalProvider from "../lib/metrics/providers/portal.js";
import { runSanityChecks } from "../lib/metrics/sanity-checks.js";

function main() {
  console.log("=== Metrics Snapshot Builder ===\n");

  const runId = `metrics-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  const windowDays = 7;
  const windowEnd = now.toISOString().split("T")[0];
  const windowStart = new Date(now - windowDays * 86400000).toISOString().split("T")[0];
  const window = { days: windowDays, start: windowStart, end: windowEnd };

  console.log(`  Run ID: ${runId}`);
  console.log(`  Window: ${windowStart} to ${windowEnd} (${windowDays}d)\n`);

  // Load lane registry for total counts
  const laneSnap = loadJsonArtifact("artifacts/lane_registry_snapshot.json");
  const lanes = laneSnap?.lanes || [];
  const totalPages = lanes.length;

  console.log(`  Total lanes in registry: ${totalPages}\n`);

  // Pull from each provider
  console.log("  Loading GSC data...");
  const gsc = gscProvider.loadFromLocalSnapshotOrFetch({ window });

  console.log("  Loading GA4 data...");
  const ga4 = ga4Provider.loadFromLocalSnapshotOrFetch({ window });

  console.log("  Loading Portal data...");
  const portal = portalProvider.loadFromLocalSnapshotOrFetch({ window });

  // Compute placeholders status: true if any source is disconnected and still has data
  const anyDisconnectedWithData =
    (!gsc.connected && gsc.coverage.pages_with_data > 0) ||
    (!ga4.connected && ga4.coverage.pages_with_data > 0) ||
    (!portal.connected && portal.coverage.lanes_with_data > 0);

  // Build snapshot
  const snapshot = {
    run_id: runId,
    timestamp: now.toISOString(),
    window,
    sources: {
      gsc: {
        connected: gsc.connected,
        last_pulled_at: gsc.last_pulled_at,
        coverage: {
          pages_with_data: gsc.coverage.pages_with_data,
          pages_total: totalPages,
        },
      },
      ga4: {
        connected: ga4.connected,
        last_pulled_at: ga4.last_pulled_at,
        coverage: {
          pages_with_data: ga4.coverage.pages_with_data,
          pages_total: totalPages,
        },
      },
      portal: {
        connected: portal.connected,
        last_pulled_at: portal.last_pulled_at,
        coverage: {
          lanes_with_data: portal.coverage.lanes_with_data,
          lanes_total: totalPages,
        },
      },
      placeholders: {
        enabled: anyDisconnectedWithData,
      },
    },
    // Embed normalized metric data for dashboard consumption
    gsc_data: gsc.data,
    ga4_data: ga4.data,
    portal_data: portal.data,
  };

  // Write metrics snapshot
  fs.mkdirSync(resolveFromRoot("artifacts"), { recursive: true });
  fs.writeFileSync(
    resolveFromRoot("artifacts", "metrics_snapshot.json"),
    JSON.stringify(snapshot, null, 2)
  );
  console.log(`\n  ✓ artifacts/metrics_snapshot.json`);

  // Run sanity checks
  console.log("\n  Running sanity checks...");
  const sanityResult = runSanityChecks({
    lanes,
    metricsSnapshot: snapshot,
    window,
  });

  const sanityReport = {
    run_id: runId,
    timestamp: now.toISOString(),
    window,
    issues: sanityResult.issues,
    summary: sanityResult.summary,
  };

  fs.writeFileSync(
    resolveFromRoot("artifacts", "metrics_sanity_report.json"),
    JSON.stringify(sanityReport, null, 2)
  );
  console.log(`  ✓ artifacts/metrics_sanity_report.json`);

  // Print summary
  console.log("\n  ── Coverage ──");
  console.log(`  GSC:    ${gsc.coverage.pages_with_data}/${totalPages} pages (connected: ${gsc.connected})`);
  console.log(`  GA4:    ${ga4.coverage.pages_with_data}/${totalPages} pages (connected: ${ga4.connected})`);
  console.log(`  Portal: ${portal.coverage.lanes_with_data}/${totalPages} lanes (connected: ${portal.connected})`);

  console.log("\n  ── Sanity ──");
  console.log(`  High:   ${sanityResult.summary.high}`);
  console.log(`  Medium: ${sanityResult.summary.medium}`);
  console.log(`  Low:    ${sanityResult.summary.low}`);

  if (sanityResult.summary.high > 0) {
    console.log("\n  ⚠  High-severity issues detected. Review artifacts/metrics_sanity_report.json");
  }

  console.log("\n  Done.\n");
}

main();
