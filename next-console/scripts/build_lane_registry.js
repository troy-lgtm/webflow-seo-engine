#!/usr/bin/env node

/**
 * Build Lane Registry
 *
 * Reads canonical lanes, city coordinates, corridor definitions, and lane inventory
 * to produce an enriched lane registry with geographic, corridor, and mode data.
 *
 * Inputs:
 *   data/lanes_canonical.json   — 1,220 unique origin→destination pairs
 *   data/lane_inventory.json    — 6,000 mode-expanded entries (LTL/FTL/Cargo Van / Box Truck)
 *   data/cities.json            — city coordinates and regions
 *   data/corridors.json         — 13 corridor definitions
 *   data/lane_sets.json         — tier definitions
 *
 * Outputs:
 *   data/lane_registry.json                — enriched lane registry array
 *   artifacts/lane_registry_build_report.json — build report with counts and diagnostics
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

const ROAD_MULTIPLIER = 1.2;

/**
 * Extract the city name (first word/words before the comma) from a
 * "City, ST" string. Returns the city portion trimmed.
 */
function extractCity(cityState) {
  const idx = cityState.indexOf(",");
  if (idx === -1) return cityState.trim();
  return cityState.substring(0, idx).trim();
}

// ---------------------------------------------------------------------------
// 1. Load source data
// ---------------------------------------------------------------------------

console.log("[build_lane_registry] Loading source data…");

const lanesCanonical = readJSON("data/lanes_canonical.json");
const laneInventory = readJSON("data/lane_inventory.json");
const cities = readJSON("data/cities.json");
const corridorsData = readJSON("data/corridors.json");
const laneSets = readJSON("data/lane_sets.json");

const corridors = corridorsData.corridors;

console.log(`  lanes_canonical : ${lanesCanonical.length} lanes`);
console.log(`  lane_inventory  : ${laneInventory.length} entries`);
console.log(`  cities          : ${Object.keys(cities).length} cities`);
console.log(`  corridors       : ${corridors.length} corridors`);
console.log(`  lane_sets       : ${Object.keys(laneSets).length} tiers`);

// ---------------------------------------------------------------------------
// 2. Build lookup maps
// ---------------------------------------------------------------------------

// Mode lookup: "origin|destination" → Set of modes
const modeMap = new Map();
for (const entry of laneInventory) {
  const key = `${entry.origin}|${entry.destination}`;
  if (!modeMap.has(key)) {
    modeMap.set(key, new Set());
  }
  modeMap.get(key).add(entry.mode);
}

// Corridor matching: build a lookup from city name (lowercase) to corridor(s)
// We match origin city against origin_cluster AND destination city against
// destination_cluster, so we need separate maps.
function buildClusterMap(corridors, clusterKey) {
  const map = new Map(); // lowercase city name → corridor object
  for (const corridor of corridors) {
    for (const city of corridor[clusterKey]) {
      const key = city.toLowerCase();
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(corridor);
    }
  }
  return map;
}

const originClusterMap = buildClusterMap(corridors, "origin_cluster");
const destClusterMap = buildClusterMap(corridors, "destination_cluster");

/**
 * Find the corridor for a given origin/destination pair.
 * Matches the city name (before comma) against the corridor cluster lists.
 * Both origin must match an origin_cluster AND destination must match the
 * same corridor's destination_cluster.
 */
function findCorridor(origin, destination) {
  const originCity = extractCity(origin).toLowerCase();
  const destCity = extractCity(destination).toLowerCase();

  const originCorridors = originClusterMap.get(originCity) || [];
  for (const corridor of originCorridors) {
    const destCities = corridor.destination_cluster.map((c) => c.toLowerCase());
    if (destCities.includes(destCity)) {
      return corridor;
    }
  }

  // Check reverse direction as well (destination in origin_cluster,
  // origin in destination_cluster) — corridors can be bidirectional
  const destCorridors = originClusterMap.get(destCity) || [];
  for (const corridor of destCorridors) {
    const destCities = corridor.destination_cluster.map((c) => c.toLowerCase());
    if (destCities.includes(originCity)) {
      return corridor;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 3. Enrich each canonical lane
// ---------------------------------------------------------------------------

console.log("[build_lane_registry] Enriching lanes…");

const missingCityLookups = new Set();
const registry = [];

for (const lane of lanesCanonical) {
  const originKey = lane.origin.toLowerCase();
  const destKey = lane.destination.toLowerCase();

  const originCity = cities[originKey] || null;
  const destCity = cities[destKey] || null;

  if (!originCity) missingCityLookups.add(lane.origin);
  if (!destCity) missingCityLookups.add(lane.destination);

  const lat_origin = originCity?.lat ?? null;
  const lon_origin = originCity?.lon ?? null;
  const lat_destination = destCity?.lat ?? null;
  const lon_destination = destCity?.lon ?? null;

  const region_origin = originCity?.region ?? "Unknown";
  const region_destination = destCity?.region ?? "Unknown";

  // Corridor matching
  const corridor = findCorridor(lane.origin, lane.destination);
  const corridor_id = corridor?.id ?? "other";
  const corridor_name = corridor?.name ?? "Other Freight Lanes";
  const corridor_priority = corridor?.priority ?? "low";

  // Distance
  let distance_miles = null;
  if (lat_origin != null && lon_origin != null && lat_destination != null && lon_destination != null) {
    distance_miles = Math.round(haversine(lat_origin, lon_origin, lat_destination, lon_destination) * ROAD_MULTIPLIER * 10) / 10;
  }

  // Modes from inventory
  const modeKey = `${lane.origin}|${lane.destination}`;
  const modes = modeMap.has(modeKey)
    ? Array.from(modeMap.get(modeKey)).sort()
    : [];

  // Extract city/state components for spec-required fields
  const [oc, os] = lane.origin.split(", ");
  const [dc, ds] = lane.destination.split(", ");

  registry.push({
    origin: lane.origin,
    destination: lane.destination,
    slug: lane.slug,
    lane_slug: lane.slug,
    origin_city: oc || "",
    origin_state: os || "",
    destination_city: dc || "",
    destination_state: ds || "",
    canonical_path: `/lanes/${lane.slug}`,
    lane_set: lane.lane_set,
    order: lane.order,
    lat_origin,
    lon_origin,
    lat_destination,
    lon_destination,
    region_origin,
    region_destination,
    corridor_id,
    corridor_name,
    corridor_priority,
    distance_miles,
    modes,
  });
}

// ---------------------------------------------------------------------------
// 4. Write lane_registry.json
// ---------------------------------------------------------------------------

writeJSON("data/lane_registry.json", registry);
console.log(`[build_lane_registry] Wrote data/lane_registry.json (${registry.length} lanes)`);

// ---------------------------------------------------------------------------
// 5. Build and write build report
// ---------------------------------------------------------------------------

// by_lane_set
const byLaneSet = {};
for (const lane of registry) {
  byLaneSet[lane.lane_set] = (byLaneSet[lane.lane_set] || 0) + 1;
}

// by_corridor
const byCorridor = {};
for (const lane of registry) {
  byCorridor[lane.corridor_id] = (byCorridor[lane.corridor_id] || 0) + 1;
}

// by_region_origin
const byRegionOrigin = {};
for (const lane of registry) {
  byRegionOrigin[lane.region_origin] = (byRegionOrigin[lane.region_origin] || 0) + 1;
}

// by_region_destination
const byRegionDestination = {};
for (const lane of registry) {
  byRegionDestination[lane.region_destination] = (byRegionDestination[lane.region_destination] || 0) + 1;
}

// avg_distance_miles
const distances = registry.filter((l) => l.distance_miles != null).map((l) => l.distance_miles);
const avgDistance = distances.length > 0
  ? Math.round((distances.reduce((a, b) => a + b, 0) / distances.length) * 10) / 10
  : 0;

const buildReport = {
  timestamp: new Date().toISOString(),
  total_lanes: registry.length,
  by_lane_set: byLaneSet,
  by_corridor: byCorridor,
  by_region_origin: byRegionOrigin,
  by_region_destination: byRegionDestination,
  missing_city_lookups: Array.from(missingCityLookups).sort(),
  avg_distance_miles: avgDistance,
};

writeJSON("artifacts/lane_registry_build_report.json", buildReport);
console.log(`[build_lane_registry] Wrote artifacts/lane_registry_build_report.json`);

// ---------------------------------------------------------------------------
// 6. Console summary
// ---------------------------------------------------------------------------

console.log("\n===== Lane Registry Build Report =====");
console.log(`Timestamp       : ${buildReport.timestamp}`);
console.log(`Total lanes     : ${buildReport.total_lanes}`);
console.log(`Avg distance    : ${buildReport.avg_distance_miles} miles`);
console.log(`Missing cities  : ${buildReport.missing_city_lookups.length}`);
if (buildReport.missing_city_lookups.length > 0) {
  console.log(`  → ${buildReport.missing_city_lookups.join(", ")}`);
}
console.log("\nBy lane set:");
for (const [set, count] of Object.entries(buildReport.by_lane_set)) {
  console.log(`  ${set}: ${count}`);
}
console.log("\nBy corridor:");
for (const [corr, count] of Object.entries(buildReport.by_corridor).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${corr}: ${count}`);
}
console.log("\nBy region (origin):");
for (const [region, count] of Object.entries(buildReport.by_region_origin).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${region}: ${count}`);
}
console.log("\nBy region (destination):");
for (const [region, count] of Object.entries(buildReport.by_region_destination).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${region}: ${count}`);
}
console.log("\n===== Build complete =====");
