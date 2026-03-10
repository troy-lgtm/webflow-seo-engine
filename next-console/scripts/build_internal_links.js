#!/usr/bin/env node

/**
 * Build Internal Link Graph
 *
 * Reads data/lane_registry.json and data/corridors.json to build an internal
 * linking graph for SEO cross-linking between lane pages.
 *
 * For each lane, builds related lanes:
 *   - Same corridor lanes (up to 5, closest by distance)
 *   - Reverse lane if it exists (e.g., A->B links to B->A)
 *   - Same origin lanes (other destinations from same city, up to 3)
 *   - Same destination lanes (other origins to same city, up to 3)
 *
 * Output: data/internal_link_graph.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const BASE_URL = "https://www.wearewarp.com/lanes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSON(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`ERROR: File not found: ${fullPath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
}

function writeJSON(relPath, data) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Extract the city name (before the comma) from "City, ST" strings.
 */
function extractCity(cityState) {
  const idx = cityState.indexOf(",");
  if (idx === -1) return cityState.trim();
  return cityState.substring(0, idx).trim();
}

/**
 * Build a human-readable link label from origin and destination.
 */
function buildLabel(origin, destination) {
  return `${extractCity(origin)} to ${extractCity(destination)}`;
}

/**
 * Build the canonical URL for a lane slug.
 */
function buildUrl(slug) {
  return `${BASE_URL}/${slug}`;
}

/**
 * Haversine distance in miles between two lat/lon pairs.
 */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute a rough "midpoint distance" between two lanes to rank proximity
 * within a corridor. Uses the average of origin-to-origin and dest-to-dest
 * haversine distances. Returns Infinity if coordinates are missing.
 */
function lanePairDistance(a, b) {
  if (
    a.lat_origin == null || a.lon_origin == null ||
    a.lat_destination == null || a.lon_destination == null ||
    b.lat_origin == null || b.lon_origin == null ||
    b.lat_destination == null || b.lon_destination == null
  ) {
    return Infinity;
  }
  const originDist = haversine(a.lat_origin, a.lon_origin, b.lat_origin, b.lon_origin);
  const destDist = haversine(a.lat_destination, a.lon_destination, b.lat_destination, b.lon_destination);
  return (originDist + destDist) / 2;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("[build_internal_links] Loading data...");

  const registry = readJSON("data/lane_registry.json");
  const corridorsData = readJSON("data/corridors.json");
  const corridors = corridorsData.corridors;

  console.log(`  lane_registry : ${registry.length} lanes`);
  console.log(`  corridors     : ${corridors.length} corridors`);

  // -------------------------------------------------------------------------
  // Build lookup indexes
  // -------------------------------------------------------------------------

  // slug -> lane entry
  const slugMap = new Map();
  for (const lane of registry) {
    slugMap.set(lane.slug, lane);
  }

  // corridor_id -> [lanes]
  const corridorLanes = new Map();
  for (const lane of registry) {
    const cid = lane.corridor_id || "other";
    if (!corridorLanes.has(cid)) corridorLanes.set(cid, []);
    corridorLanes.get(cid).push(lane);
  }

  // origin city (lowercase) -> [lanes]
  const originIndex = new Map();
  for (const lane of registry) {
    const city = extractCity(lane.origin).toLowerCase();
    if (!originIndex.has(city)) originIndex.set(city, []);
    originIndex.get(city).push(lane);
  }

  // destination city (lowercase) -> [lanes]
  const destIndex = new Map();
  for (const lane of registry) {
    const city = extractCity(lane.destination).toLowerCase();
    if (!destIndex.has(city)) destIndex.set(city, []);
    destIndex.get(city).push(lane);
  }

  // reverse lane lookup: "origin|destination" -> slug
  const reverseMap = new Map();
  for (const lane of registry) {
    const reverseKey = `${lane.destination.toLowerCase()}|${lane.origin.toLowerCase()}`;
    reverseMap.set(reverseKey, lane);
  }

  // -------------------------------------------------------------------------
  // Build the internal link graph
  // -------------------------------------------------------------------------

  console.log("[build_internal_links] Building link graph...");

  const graph = {};
  let totalLinks = 0;
  let orphanCount = 0;

  for (const lane of registry) {
    const entry = {
      corridor_links: [],
      reverse_lane: null,
      same_origin: [],
      same_destination: [],
      total_links: 0,
    };

    // --- 1. Same corridor lanes (up to 5, closest by distance) ---
    const cid = lane.corridor_id || "other";
    if (cid !== "other") {
      const siblings = (corridorLanes.get(cid) || []).filter((l) => l.slug !== lane.slug);
      const ranked = siblings
        .map((s) => ({ lane: s, dist: lanePairDistance(lane, s) }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5);

      for (const { lane: sibling } of ranked) {
        entry.corridor_links.push({
          label: buildLabel(sibling.origin, sibling.destination),
          url: buildUrl(sibling.slug),
        });
      }
    }

    // --- 2. Reverse lane ---
    const reverseKey = `${lane.destination.toLowerCase()}|${lane.origin.toLowerCase()}`;
    const reverseLane = reverseMap.get(reverseKey);
    if (reverseLane && reverseLane.slug !== lane.slug) {
      entry.reverse_lane = {
        label: buildLabel(reverseLane.origin, reverseLane.destination),
        url: buildUrl(reverseLane.slug),
      };
    }

    // --- 3. Same origin lanes (other destinations from same city, up to 3) ---
    const originCity = extractCity(lane.origin).toLowerCase();
    const sameOriginLanes = (originIndex.get(originCity) || [])
      .filter((l) => l.slug !== lane.slug)
      .slice(0, 3);
    for (const sibling of sameOriginLanes) {
      entry.same_origin.push({
        label: buildLabel(sibling.origin, sibling.destination),
        url: buildUrl(sibling.slug),
      });
    }

    // --- 4. Same destination lanes (other origins to same city, up to 3) ---
    const destCity = extractCity(lane.destination).toLowerCase();
    const sameDestLanes = (destIndex.get(destCity) || [])
      .filter((l) => l.slug !== lane.slug)
      .slice(0, 3);
    for (const sibling of sameDestLanes) {
      entry.same_destination.push({
        label: buildLabel(sibling.origin, sibling.destination),
        url: buildUrl(sibling.slug),
      });
    }

    // --- Total links for this lane ---
    entry.total_links =
      entry.corridor_links.length +
      (entry.reverse_lane ? 1 : 0) +
      entry.same_origin.length +
      entry.same_destination.length;

    totalLinks += entry.total_links;
    if (entry.total_links === 0) orphanCount++;

    graph[lane.slug] = entry;
  }

  // -------------------------------------------------------------------------
  // Build output
  // -------------------------------------------------------------------------

  const totalLanes = registry.length;
  const avgLinksPerLane =
    totalLanes > 0 ? Math.round((totalLinks / totalLanes) * 10) / 10 : 0;

  const output = {
    timestamp: new Date().toISOString(),
    total_lanes: totalLanes,
    total_links: totalLinks,
    avg_links_per_lane: avgLinksPerLane,
    orphan_lanes: orphanCount,
    graph,
  };

  const outPath = "data/internal_link_graph.json";
  writeJSON(outPath, output);

  // -------------------------------------------------------------------------
  // Console summary
  // -------------------------------------------------------------------------

  console.log("");
  console.log("===== Internal Link Graph =====");
  console.log(`  Timestamp:          ${output.timestamp}`);
  console.log(`  Total lanes:        ${output.total_lanes}`);
  console.log(`  Total links:        ${output.total_links}`);
  console.log(`  Avg links/lane:     ${output.avg_links_per_lane}`);
  console.log(`  Orphan lanes:       ${output.orphan_lanes}`);
  console.log("");

  // Distribution of link counts
  const linkCounts = Object.values(graph).map((e) => e.total_links);
  const maxLinks = Math.max(...linkCounts, 0);
  const minLinks = Math.min(...linkCounts, 0);
  const withReverse = Object.values(graph).filter((e) => e.reverse_lane !== null).length;
  const withCorridor = Object.values(graph).filter((e) => e.corridor_links.length > 0).length;
  const withSameOrigin = Object.values(graph).filter((e) => e.same_origin.length > 0).length;
  const withSameDest = Object.values(graph).filter((e) => e.same_destination.length > 0).length;

  console.log("  Link type coverage:");
  console.log(`    Corridor links:     ${withCorridor}/${totalLanes} lanes`);
  console.log(`    Reverse lane:       ${withReverse}/${totalLanes} lanes`);
  console.log(`    Same origin:        ${withSameOrigin}/${totalLanes} lanes`);
  console.log(`    Same destination:   ${withSameDest}/${totalLanes} lanes`);
  console.log("");
  console.log(`  Link count range:     ${minLinks} - ${maxLinks}`);

  // Show orphan lanes if any
  if (orphanCount > 0) {
    const orphans = Object.entries(graph)
      .filter(([, e]) => e.total_links === 0)
      .map(([slug]) => slug);
    console.log("");
    console.log(`  Orphan lanes (${orphanCount}):`);
    for (const slug of orphans.slice(0, 20)) {
      console.log(`    - ${slug}`);
    }
    if (orphans.length > 20) {
      console.log(`    ... and ${orphans.length - 20} more`);
    }
  }

  console.log("");
  console.log(`  Output: ${path.join(ROOT, outPath)}`);
  console.log("===== Done =====");
}

main();
