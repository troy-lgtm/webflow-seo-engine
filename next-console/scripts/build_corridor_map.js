#!/usr/bin/env node

/**
 * Build Corridor Map & Validation Report
 *
 * Reads the lane registry and corridor definitions to produce:
 *   1. data/corridor_map.json           — corridor-to-lanes lookup with metro sets
 *   2. artifacts/corridor_page_validation_report.json — per-corridor health scores
 *
 * Inputs:
 *   data/lane_registry.json   — enriched lane entries with corridor_id
 *   data/corridors.json       — corridor definitions (id, name, clusters, priority)
 *
 * Usage:
 *   node scripts/build_corridor_map.js
 */

import fs from "fs";
import path from "path";
import { getProjectRoot } from "../lib/fs/project-root.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = getProjectRoot();

function readJSON(relPath) {
  const fullPath = path.join(ROOT, relPath);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
}

function writeJSON(relPath, data) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

const lanes = readJSON("data/lane_registry.json");
const { corridors: corridorDefs } = readJSON("data/corridors.json");

// ---------------------------------------------------------------------------
// 1. Build corridor map
// ---------------------------------------------------------------------------

// Group lanes by corridor_id
const lanesByCorridor = new Map();
for (const lane of lanes) {
  const cid = lane.corridor_id;
  if (!lanesByCorridor.has(cid)) {
    lanesByCorridor.set(cid, []);
  }
  lanesByCorridor.get(cid).push(lane);
}

// Build the corridor map entries from corridor definitions
const corridorMapEntries = corridorDefs.map((corr) => {
  const corridorLanes = lanesByCorridor.get(corr.id) || [];

  // Collect unique origin and destination metros as "City, ST"
  const originMetros = [
    ...new Set(
      corridorLanes.map((l) => `${l.origin_city}, ${l.origin_state}`)
    ),
  ].sort();

  const destinationMetros = [
    ...new Set(
      corridorLanes.map((l) => `${l.destination_city}, ${l.destination_state}`)
    ),
  ].sort();

  // Collect unique lane slugs
  const laneSlugs = [...new Set(corridorLanes.map((l) => l.slug))].sort();

  return {
    corridor_id: corr.id,
    corridor_name: corr.name,
    priority: corr.priority,
    lane_slugs: laneSlugs,
    lane_count: laneSlugs.length,
    origin_metros: originMetros,
    destination_metros: destinationMetros,
    canonical_path: `/corridors/${corr.id}`,
  };
});

const corridorMap = {
  timestamp: new Date().toISOString(),
  corridors: corridorMapEntries,
};

writeJSON("data/corridor_map.json", corridorMap);

// ---------------------------------------------------------------------------
// 2. Build corridor page validation report
// ---------------------------------------------------------------------------

// Check whether the dynamic route exists (single [corridorId] route serves all)
const dynamicRoutePath = path.join(
  ROOT,
  "app",
  "corridors",
  "[corridorId]",
  "page.js"
);
const dynamicRouteExists = fs.existsSync(dynamicRoutePath);

// Exclude "other" from validation
const validatable = corridorMapEntries.filter((c) => c.corridor_id !== "other");

const results = validatable.map((c) => {
  const issues = [];
  let score = 0;

  // 20 pts: has lanes
  if (c.lane_count > 0) {
    score += 20;
  } else {
    issues.push("No lanes assigned to this corridor");
  }

  // 20 pts: has name
  if (c.corridor_name && c.corridor_name.trim().length > 0) {
    score += 20;
  } else {
    issues.push("Missing corridor name");
  }

  // 20 pts: has origin metros
  if (c.origin_metros.length > 0) {
    score += 20;
  } else {
    issues.push("No origin metros");
  }

  // 20 pts: has destination metros
  if (c.destination_metros.length > 0) {
    score += 20;
  } else {
    issues.push("No destination metros");
  }

  // 20 pts: page route exists (dynamic route covers all corridors)
  if (dynamicRouteExists) {
    score += 20;
  } else {
    issues.push("No page route at app/corridors/[corridorId]/page.js");
  }

  return {
    corridor_id: c.corridor_id,
    score,
    passed: score === 100,
    lane_count: c.lane_count,
    issues,
  };
});

const passing = results.filter((r) => r.passed).length;
const failing = results.filter((r) => !r.passed).length;
const avgScore =
  results.length > 0
    ? Math.round(
        (results.reduce((sum, r) => sum + r.score, 0) / results.length) * 100
      ) / 100
    : 0;

const validationReport = {
  timestamp: new Date().toISOString(),
  total_corridors: results.length,
  corridors_passing: passing,
  corridors_failing: failing,
  avg_score: avgScore,
  results,
};

writeJSON("artifacts/corridor_page_validation_report.json", validationReport);

// ---------------------------------------------------------------------------
// 3. Summary
// ---------------------------------------------------------------------------

console.log("=== Corridor Map Build ===");
console.log(`  Corridors defined:  ${corridorDefs.length}`);
console.log(`  Corridors mapped:   ${corridorMapEntries.length}`);
console.log(
  `  Total lanes:        ${corridorMapEntries.reduce((s, c) => s + c.lane_count, 0)}`
);
console.log("");

console.log("=== Validation Report (excl. 'other') ===");
console.log(`  Total corridors:    ${results.length}`);
console.log(`  Passing (100/100):  ${passing}`);
console.log(`  Failing:            ${failing}`);
console.log(`  Avg score:          ${avgScore}`);
console.log("");

// Print per-corridor summary
for (const r of results) {
  const status = r.passed ? "PASS" : "FAIL";
  const issueStr = r.issues.length > 0 ? ` — ${r.issues.join("; ")}` : "";
  console.log(
    `  [${status}] ${r.corridor_id} — score: ${r.score}, lanes: ${r.lane_count}${issueStr}`
  );
}

console.log("");
console.log("Wrote: data/corridor_map.json");
console.log("Wrote: artifacts/corridor_page_validation_report.json");
