#!/usr/bin/env node

/**
 * Build Publish Plan
 *
 * Builds a staged 4-week publish plan for lane pages based on tier,
 * corridor priority, and validation results.
 *
 * Inputs:
 *   data/lane_registry.json                      — enriched lane registry
 *   data/lane_sets.json                           — tier definitions
 *   artifacts/lane_page_validation_report.json    — validation results (optional)
 *
 * Output:
 *   artifacts/lane_publish_plan.json — 4-wave publish plan with blocked lanes
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = getProjectRoot();

function readJSON(relPath) {
  const fullPath = path.join(ROOT, relPath);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
}

function readJSONSafe(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
  } catch {
    return null;
  }
}

function writeJSON(relPath, data) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// 1. Load source data
// ---------------------------------------------------------------------------

console.log("[build_publish_plan] Loading source data...");

const registry = readJSON("data/lane_registry.json");
const laneSets = readJSON("data/lane_sets.json");
const validationReport = readJSONSafe("artifacts/lane_page_validation_report.json");

console.log(`  lane_registry       : ${registry.length} lanes`);
console.log(`  lane_sets           : ${Object.keys(laneSets).length} tiers`);
console.log(
  `  validation_report   : ${
    validationReport
      ? `${validationReport.total_validated} validated (${validationReport.passed} passed, ${validationReport.failed} failed)`
      : "not found (all lanes assumed publishable)"
  }`
);

// ---------------------------------------------------------------------------
// 2. Build validation lookup
// ---------------------------------------------------------------------------

// Map slug -> { passed, score }
// Support both field naming conventions from different validation report formats
const validationMap = new Map();
if (validationReport && validationReport.results) {
  for (const result of validationReport.results) {
    validationMap.set(result.slug, {
      passed: result.passed ?? (result.validation_result === "passed"),
      score: result.score ?? result.quality_score ?? 0,
    });
  }
}

// ---------------------------------------------------------------------------
// 3. Classify lanes as publishable or blocked
// ---------------------------------------------------------------------------

const publishable = [];
const blocked = [];

for (const lane of registry) {
  const validation = validationMap.get(lane.slug);

  // If we have a validation report and this lane failed, block it
  if (validation && !validation.passed) {
    blocked.push({
      slug: lane.slug,
      reason: `validation_failed (score: ${validation.score})`,
    });
    continue;
  }

  publishable.push({
    slug: lane.slug,
    origin: lane.origin,
    destination: lane.destination,
    corridor_id: lane.corridor_id,
    lane_set: lane.lane_set,
    corridor_priority: lane.corridor_priority,
    order: lane.order,
    priority: lane.corridor_priority,
    validation_score: validation ? validation.score : null,
  });
}

console.log(`  Publishable: ${publishable.length}`);
console.log(`  Blocked:     ${blocked.length}`);

// ---------------------------------------------------------------------------
// 4. Sort publishable lanes by order (preserves original registry ordering)
// ---------------------------------------------------------------------------

publishable.sort((a, b) => a.order - b.order);

// ---------------------------------------------------------------------------
// 5. Assign lanes to waves
// ---------------------------------------------------------------------------

const week1 = [];
const week2 = [];

// Track which lanes have been assigned
const assigned = new Set();

// Week 1 target: 500-700 pages. Prioritize tier1_core + high-priority corridors first.
const WEEK1_TARGET = 700;

// --- Week 1: tier1_core high priority first, then tier1_core medium, then fill to target ---
for (const lane of publishable) {
  if (assigned.has(lane.slug)) continue;
  if (week1.length >= WEEK1_TARGET) break;
  if (lane.lane_set === "tier1_core" && lane.corridor_priority === "high") {
    week1.push(lane);
    assigned.add(lane.slug);
  }
}
for (const lane of publishable) {
  if (assigned.has(lane.slug)) continue;
  if (week1.length >= WEEK1_TARGET) break;
  if (lane.lane_set === "tier1_core") {
    week1.push(lane);
    assigned.add(lane.slug);
  }
}
for (const lane of publishable) {
  if (assigned.has(lane.slug)) continue;
  if (week1.length >= WEEK1_TARGET) break;
  week1.push(lane);
  assigned.add(lane.slug);
}

// --- Week 2: Everything remaining ---
for (const lane of publishable) {
  if (assigned.has(lane.slug)) continue;
  week2.push(lane);
  assigned.add(lane.slug);
}

// ---------------------------------------------------------------------------
// 6. Build wave entry format (strip internal fields)
// ---------------------------------------------------------------------------

function formatWaveLane(lane) {
  return {
    slug: lane.slug,
    origin: lane.origin,
    destination: lane.destination,
    corridor_id: lane.corridor_id,
    lane_set: lane.lane_set,
    priority: lane.priority,
    validation_score: lane.validation_score,
  };
}

const plan = {
  timestamp: new Date().toISOString(),
  total_lanes: registry.length,
  total_publishable: publishable.length,
  total_blocked: blocked.length,
  waves: {
    week_1: {
      label: "Initial Launch — Core + High-Priority Lanes",
      count: week1.length,
      lanes: week1.map(formatWaveLane),
    },
    week_2: {
      label: "Full Coverage — Remaining Lanes",
      count: week2.length,
      lanes: week2.map(formatWaveLane),
    },
  },
  blocked_lanes: blocked,
};

// ---------------------------------------------------------------------------
// 7. Write output
// ---------------------------------------------------------------------------

writeJSON("artifacts/lane_publish_plan.json", plan);
console.log("\n  Wrote artifacts/lane_publish_plan.json");

// ---------------------------------------------------------------------------
// 8. Console summary
// ---------------------------------------------------------------------------

console.log("\n===== Lane Publish Plan =====");
console.log(`Timestamp          : ${plan.timestamp}`);
console.log(`Total lanes        : ${plan.total_lanes}`);
console.log(`Total publishable  : ${plan.total_publishable}`);
console.log(`Total blocked      : ${plan.total_blocked}`);
console.log("");

for (const [weekKey, wave] of Object.entries(plan.waves)) {
  const weekNum = weekKey.replace("week_", "Week ");
  console.log(`  ${weekNum} — ${wave.label}: ${wave.count} lanes`);

  // Show corridor breakdown within wave
  const corridorCounts = {};
  for (const lane of wave.lanes) {
    corridorCounts[lane.corridor_id] = (corridorCounts[lane.corridor_id] || 0) + 1;
  }
  const sortedCorridors = Object.entries(corridorCounts).sort(
    (a, b) => b[1] - a[1]
  );
  for (const [corridor, count] of sortedCorridors.slice(0, 5)) {
    console.log(`    ${corridor}: ${count}`);
  }
  if (sortedCorridors.length > 5) {
    console.log(`    ... and ${sortedCorridors.length - 5} more corridors`);
  }
  console.log("");
}

if (blocked.length > 0) {
  console.log(`Blocked lanes (${blocked.length}):`);
  for (const b of blocked.slice(0, 10)) {
    console.log(`  ${b.slug}: ${b.reason}`);
  }
  if (blocked.length > 10) {
    console.log(`  ... and ${blocked.length - 10} more`);
  }
  console.log("");
}

console.log("===== Plan complete =====");
