#!/usr/bin/env node

/**
 * build-site-fix-queue.js — Site Fix Queue Builder
 *
 * Reads the crawl audit artifact, converts issues into a prioritized
 * fix queue, and writes the result to artifacts/site-fix-queue.json.
 *
 * Usage:
 *   node scripts/build-site-fix-queue.js
 *   node scripts/build-site-fix-queue.js --audit artifacts/site-crawl-audit.json
 *
 * Input:
 *   artifacts/site-crawl-audit.json — Structured crawl audit report
 *
 * Output:
 *   artifacts/site-fix-queue.json — Prioritized fix queue
 *
 * @module scripts/build-site-fix-queue
 */

import fs from "fs";
import { resolveFromRoot } from "../lib/fs/project-root.js";
import { buildFixQueue } from "../lib/site-fix-queue.js";

// ── Config ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const auditArgIdx = args.indexOf("--audit");
const auditPath = auditArgIdx >= 0 && args[auditArgIdx + 1]
  ? resolveFromRoot(args[auditArgIdx + 1])
  : resolveFromRoot("artifacts", "site-crawl-audit.json");

const outputPath = resolveFromRoot("artifacts", "site-fix-queue.json");

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  console.log("=== Site Fix Queue Builder ===\n");

  const startTime = Date.now();

  // ── Step 1: Read audit artifact ─────────────────────────────────
  console.log(`  Reading audit: ${auditPath}`);

  if (!fs.existsSync(auditPath)) {
    console.error(`  ERROR: Audit artifact not found at ${auditPath}`);
    console.error("  Run the crawl audit first: node scripts/site-crawl-audit.js --dry-run");
    process.exit(1);
  }

  let auditReport;
  try {
    auditReport = JSON.parse(fs.readFileSync(auditPath, "utf-8"));
  } catch (err) {
    console.error(`  ERROR: Failed to parse audit artifact: ${err.message}`);
    process.exit(1);
  }

  console.log(`  Audit timestamp: ${auditReport.crawl?.timestamp || "unknown"}`);
  console.log(`  Pages audited: ${auditReport.inventory?.total || 0}`);
  console.log(`  Total issues: ${auditReport.summary?.total_issues || 0}`);
  console.log(`  Health: ${auditReport.summary?.health || "unknown"}\n`);

  // ── Step 2: Build fix queue ─────────────────────────────────────
  console.log("  Building fix queue...");

  const fixQueue = buildFixQueue(auditReport);

  console.log(`  Queue items: ${fixQueue.summary.total_queue_items}`);
  console.log(`  By severity:`);
  for (const [sev, count] of Object.entries(fixQueue.summary.by_severity)) {
    if (count > 0) console.log(`    ${sev}: ${count}`);
  }
  console.log(`  By type:`);
  for (const [type, count] of Object.entries(fixQueue.summary.by_type)) {
    console.log(`    ${type}: ${count}`);
  }

  // ── Step 3: Show top items ──────────────────────────────────────
  if (fixQueue.queue.length > 0) {
    console.log("\n  Top 5 priority items:");
    for (const item of fixQueue.queue.slice(0, 5)) {
      console.log(`    #${item.priority_rank} [${item.severity}] ${item.issue_type}: ${item.target_urls[0]}`);
    }
  }

  // ── Step 4: Write artifact ──────────────────────────────────────
  const durationMs = Date.now() - startTime;

  // Add generation timestamp to output
  const output = {
    ...fixQueue,
    metadata: {
      ...fixQueue.metadata,
      generated_at: new Date().toISOString(),
      generation_duration_ms: durationMs,
    },
  };

  fs.mkdirSync(resolveFromRoot("artifacts"), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n  Written: artifacts/site-fix-queue.json`);
  console.log(`  Duration: ${durationMs}ms`);
  console.log("\n=== Fix Queue Complete ===\n");
}

main();
