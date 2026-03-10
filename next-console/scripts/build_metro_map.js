#!/usr/bin/env node

/**
 * Build Metro Map
 *
 * Reads data/lane_registry.json and aggregates all unique city+state
 * combinations (from both origin and destination sides) into metro hub entries.
 *
 * Each metro tracks outbound lanes, inbound lanes, corridor linkages, and
 * receives a validation score.
 *
 * Outputs:
 *   data/metro_map.json                          — metro hub registry
 *   artifacts/metro_page_validation_report.json   — per-metro validation scores
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

function writeJSON(relPath, data) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Convert a city name to a slug fragment.
 * "Los Angeles" -> "los-angeles", "New York" -> "new-york"
 */
function citySlug(city) {
  return city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("=== Build Metro Map ===\n");

  const lanes = readJSON("data/lane_registry.json");
  console.log(`  Loaded ${lanes.length} lanes from lane_registry.json`);

  // Map keyed by "city|state" -> metro accumulator
  const metroAccum = new Map();

  function ensureMetro(city, state) {
    const key = `${city}|${state}`;
    if (!metroAccum.has(key)) {
      metroAccum.set(key, {
        metro_id: `${citySlug(city)}-freight`,
        city,
        state,
        canonical_path: `/metros/${citySlug(city)}-freight`,
        outbound_lane_slugs: new Set(),
        inbound_lane_slugs: new Set(),
        corridor_ids: new Set(),
      });
    }
    return metroAccum.get(key);
  }

  for (const lane of lanes) {
    const slug = lane.slug || lane.lane_slug;
    const corridorId = lane.corridor_id;

    // Origin side — this lane is outbound from the origin metro
    if (lane.origin_city && lane.origin_state) {
      const metro = ensureMetro(lane.origin_city, lane.origin_state);
      metro.outbound_lane_slugs.add(slug);
      if (corridorId && corridorId !== "other") {
        metro.corridor_ids.add(corridorId);
      }
    }

    // Destination side — this lane is inbound to the destination metro
    if (lane.destination_city && lane.destination_state) {
      const metro = ensureMetro(lane.destination_city, lane.destination_state);
      metro.inbound_lane_slugs.add(slug);
      if (corridorId && corridorId !== "other") {
        metro.corridor_ids.add(corridorId);
      }
    }
  }

  // Convert Sets to sorted arrays and compute total_lanes
  const metros = [];
  for (const entry of metroAccum.values()) {
    const outbound = [...entry.outbound_lane_slugs].sort();
    const inbound = [...entry.inbound_lane_slugs].sort();
    const corridors = [...entry.corridor_ids].sort();

    // Deduplicate lane slugs across both directions for total count
    const allSlugs = new Set([...outbound, ...inbound]);

    metros.push({
      metro_id: entry.metro_id,
      city: entry.city,
      state: entry.state,
      canonical_path: entry.canonical_path,
      outbound_lane_slugs: outbound,
      inbound_lane_slugs: inbound,
      corridor_ids: corridors,
      total_lanes: allSlugs.size,
    });
  }

  // Sort by total_lanes descending
  metros.sort((a, b) => b.total_lanes - a.total_lanes);

  const metroMap = {
    timestamp: new Date().toISOString(),
    total_metros: metros.length,
    metros,
  };

  writeJSON("data/metro_map.json", metroMap);
  console.log(`  Built ${metros.length} metro entries -> data/metro_map.json`);

  // ---------------------------------------------------------------------------
  // Validation Report
  // ---------------------------------------------------------------------------

  const results = [];
  for (const metro of metros) {
    let score = 0;
    const issues = [];

    // 25 pts: has outbound lanes
    if (metro.outbound_lane_slugs.length > 0) {
      score += 25;
    } else {
      issues.push("no outbound lanes");
    }

    // 25 pts: has inbound lanes
    if (metro.inbound_lane_slugs.length > 0) {
      score += 25;
    } else {
      issues.push("no inbound lanes");
    }

    // 25 pts: total_lanes >= 3
    if (metro.total_lanes >= 3) {
      score += 25;
    } else {
      issues.push(`total_lanes=${metro.total_lanes} (need >= 3)`);
    }

    // 25 pts: has corridor linkage
    if (metro.corridor_ids.length > 0) {
      score += 25;
    } else {
      issues.push("no corridor linkage");
    }

    results.push({
      metro_id: metro.metro_id,
      score,
      passed: score >= 75,
      total_lanes: metro.total_lanes,
      issues,
    });
  }

  const passing = results.filter(r => r.passed).length;
  const failing = results.filter(r => !r.passed).length;
  const avgScore =
    results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length)
      : 0;

  const report = {
    timestamp: new Date().toISOString(),
    total_metros: results.length,
    metros_passing: passing,
    metros_failing: failing,
    avg_score: avgScore,
    results,
  };

  writeJSON("artifacts/metro_page_validation_report.json", report);

  // Console summary
  console.log(`\n=== Metro Page Validation Report ===`);
  console.log(`  Total metros:    ${report.total_metros}`);
  console.log(`  Passing (>=75):  ${report.metros_passing}`);
  console.log(`  Failing (<75):   ${report.metros_failing}`);
  console.log(`  Avg score:       ${report.avg_score}`);
  console.log(`\n  Report: artifacts/metro_page_validation_report.json`);
  console.log(`  Metro map: data/metro_map.json\n`);
}

main();
