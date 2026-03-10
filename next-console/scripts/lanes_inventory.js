#!/usr/bin/env node

/**
 * Lane Page Factory — Inventory
 *
 * Survey of all lane pages: what exists, what's missing, what's ready to manufacture.
 * Reads all data sources and produces a complete status breakdown.
 *
 * Flags:
 *   --json          Output machine-readable JSON only
 *   --filter-mode X Filter to LTL, FTL, etc. (default: all modes)
 *
 * Outputs:
 *   artifacts/lane_inventory_report.json — full inventory report
 *
 * Exit codes:
 *   0 — success
 */

import fs from "fs";
import path from "path";
import { getProjectRoot } from "../lib/fs/project-root.js";
import { computeFactoryInventory } from "../lib/approval-gate.js";

const ROOT = getProjectRoot();

// --- CLI flags ---
const args = process.argv.slice(2);
const JSON_OUTPUT = args.includes("--json");
function getFlag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}
const FILTER_MODE = getFlag("filter-mode", null);

// --- Main ---

const inventory = computeFactoryInventory({ filterMode: FILTER_MODE });

// Build report
const report = {
  generated_at: new Date().toISOString(),
  filter_mode: FILTER_MODE || "all",
  totals: inventory.totals,
  by_corridor: inventory.by_corridor,
  // Per-status slug lists (for machine consumption)
  slugs: {
    already_live: inventory.already_live.map(l => l.slug),
    already_published: inventory.already_published.map(l => l.slug),
    ready_to_manufacture: inventory.ready_to_manufacture.map(l => l.slug),
    manufactured: inventory.manufactured.map(l => l.slug),
    approved: inventory.approved.map(l => l.slug),
    blocked: inventory.blocked.map(l => l.slug),
    produced_pending_verify: inventory.produced_pending_verify.map(l => l.slug),
    verified_live: inventory.verified_live.map(l => l.slug),
    failed: inventory.failed.map(l => l.slug),
  },
};

// Write report artifact
const artifactsDir = path.join(ROOT, "artifacts");
fs.mkdirSync(artifactsDir, { recursive: true });
fs.writeFileSync(
  path.join(artifactsDir, "lane_inventory_report.json"),
  JSON.stringify(report, null, 2) + "\n"
);

if (JSON_OUTPUT) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// --- Formatted output ---

const t = inventory.totals;

console.log("");
console.log("╔══════════════════════════════════════════════════╗");
console.log("║  LANE PAGE FACTORY — INVENTORY                   ║");
console.log("╚══════════════════════════════════════════════════╝");
if (FILTER_MODE) {
  console.log(`  Filter: ${FILTER_MODE} only`);
}
console.log("");

console.log("── Registry ────────────────────────────────────────");
console.log(`  Total lanes:              ${t.registry.toLocaleString()}`);
console.log(`  Webflow existing:         ${t.webflow_existing.toLocaleString()}`);
console.log(`  Overlap (already live):   ${t.overlap.toLocaleString()}`);
console.log("");

console.log("── Status Breakdown ────────────────────────────────");
console.log(`  already_live:             ${t.overlap.toLocaleString()}`);
console.log(`  already_published:        ${t.already_published.toLocaleString()}`);
console.log(`  ready_to_manufacture:     ${t.ready_to_manufacture.toLocaleString()}`);
console.log(`  manufactured:             ${t.manufactured.toLocaleString()}`);
console.log(`  approved:                 ${t.approved.toLocaleString()}`);
console.log(`  blocked:                  ${t.blocked.toLocaleString()}`);
console.log(`  produced_pending_verify:  ${t.produced_pending_verify.toLocaleString()}`);
console.log(`  verified_live:            ${t.verified_live.toLocaleString()}`);
console.log(`  failed:                   ${t.failed.toLocaleString()}`);
console.log("");

// Top corridors (missing lanes)
const corridorEntries = Object.entries(inventory.by_corridor);
if (corridorEntries.length > 0) {
  console.log("── Top Corridors (ready to manufacture) ────────────");
  for (const [corridor, count] of corridorEntries.slice(0, 10)) {
    const paddedCorridor = corridor.padEnd(24);
    console.log(`  ${paddedCorridor} ${count}`);
  }
  if (corridorEntries.length > 10) {
    console.log(`  ... and ${corridorEntries.length - 10} more corridors`);
  }
  console.log("");
}

// Blocked details
if (inventory.blocked.length > 0) {
  console.log("── Blocked Lanes ───────────────────────────────────");
  for (const lane of inventory.blocked.slice(0, 10)) {
    console.log(`  ${lane.slug}: ${lane.excluded_reason || "unknown reason"}`);
  }
  if (inventory.blocked.length > 10) {
    console.log(`  ... and ${inventory.blocked.length - 10} more blocked`);
  }
  console.log("");
}

// Failed details
if (inventory.failed.length > 0) {
  console.log("── Failed Lanes ────────────────────────────────────");
  for (const lane of inventory.failed.slice(0, 10)) {
    console.log(`  ${lane.slug}: ${lane.excluded_reason || "unknown error"}`);
  }
  if (inventory.failed.length > 10) {
    console.log(`  ... and ${inventory.failed.length - 10} more failed`);
  }
  console.log("");
}

console.log(`  Report: artifacts/lane_inventory_report.json`);
console.log("");
console.log("═══════════════════════════════════════════════════");
