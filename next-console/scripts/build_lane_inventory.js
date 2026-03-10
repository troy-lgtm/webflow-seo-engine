#!/usr/bin/env node

/**
 * Build Lane Inventory
 *
 * Reads data/warp_top_2000_lanes_seed.csv and generates data/lane_inventory.json
 * with deterministic ordering, self-lane exclusion, and mode expansion.
 *
 * Output schema:
 * [
 *   {
 *     "origin": "Los Angeles, CA",
 *     "destination": "Dallas, TX",
 *     "mode": "LTL",
 *     "slug": "los-angeles-to-dallas",
 *     "lane_set": "tier1_core",
 *     "order": 0
 *   },
 *   ...
 * ]
 *
 * Ordering: seed CSV row order → LTL first, then FTL, then Cargo Van / Box Truck per lane.
 * Self-lanes (origin_city == destination_city && origin_state == destination_state) are excluded.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();
const CSV_PATH = path.join(ROOT, "data", "warp_top_2000_lanes_seed.csv");
const OUTPUT_PATH = path.join(ROOT, "data", "lane_inventory.json");

const MODES = ["LTL", "FTL", "Cargo Van / Box Truck"];

function buildLaneSlug(origin, destination) {
  const citySlug = (s) =>
    s.split(",")[0].trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `${citySlug(origin)}-to-${citySlug(destination)}`;
}

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`ERROR: Seed CSV not found at ${CSV_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Parse header
  const header = lines[0].split(",").map(h => h.trim().toLowerCase());
  const colIdx = {
    origin_city: header.indexOf("origin_city"),
    origin_state: header.indexOf("origin_state"),
    destination_city: header.indexOf("destination_city"),
    destination_state: header.indexOf("destination_state"),
    lane_set: header.indexOf("lane_set"),
  };

  const inventory = [];
  const seenSlugs = new Set();
  let order = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim());
    const oc = cols[colIdx.origin_city];
    const os = cols[colIdx.origin_state];
    const dc = cols[colIdx.destination_city];
    const ds = cols[colIdx.destination_state];
    const laneSet = cols[colIdx.lane_set] || "tier1_core";

    if (!oc || !dc) continue;

    // Skip self-lanes
    if (oc.toLowerCase() === dc.toLowerCase() && os.toLowerCase() === ds.toLowerCase()) continue;

    const origin = `${oc}, ${os}`;
    const destination = `${dc}, ${ds}`;
    const baseSlug = buildLaneSlug(origin, destination);

    // Deduplicate by base slug (same city pair only appears once)
    if (seenSlugs.has(baseSlug)) continue;
    seenSlugs.add(baseSlug);

    // Expand modes: LTL → FTL → Cargo Van / Box Truck per lane
    for (const mode of MODES) {
      inventory.push({
        origin,
        destination,
        mode,
        slug: baseSlug,
        lane_set: laneSet,
        order: order++,
      });
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(inventory, null, 2));

  console.log(`=== Lane Inventory Built ===`);
  console.log(`  Seed lanes:      ${seenSlugs.size} unique city pairs`);
  console.log(`  Mode expansion:  ${MODES.length}x (${MODES.join(", ")})`);
  console.log(`  Total inventory: ${inventory.length} lane+mode combos`);
  console.log(`  Self-lanes:      excluded`);
  console.log(`  Output:          ${OUTPUT_PATH}`);
}

main();
