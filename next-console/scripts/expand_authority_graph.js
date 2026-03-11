#!/usr/bin/env node
/**
 * expand_authority_graph.js — Lane-Authority Graph Expansion Script
 *
 * Takes lane candidates, classifies their authority relationships,
 * expands the bidirectional graph, validates health, and writes
 * inspectable artifacts.
 *
 * Usage:
 *   node scripts/expand_authority_graph.js [options]
 *
 * Options:
 *   --lanes origin1-to-dest1,origin2-to-dest2   Specific lanes to expand
 *   --mode LTL|FTL|"Cargo Van / Box Truck"      Filter by mode (default: LTL)
 *   --limit N                                     Max lanes to process
 *   --validate-only                               Only validate, don't generate
 *   --benchmark                                   Run benchmark set of diverse lanes
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildClassificationProfile, classifyLaneAuthority } from "../lib/lane-authority-classifier.js";
import {
  resetGraph,
  expandWithLane,
  getLaneAuthority,
  getAuthorityLanes,
  getCluster,
  getAllClusters,
  getLaneAuthorityLinks,
  getAuthorityLaneLinks,
  validateExpansionGraph,
  exportGraph,
} from "../lib/lane-authority-graph.js";
import { validateLaneRelationships, validateExpansionGraphHealth } from "../lib/lane-authority-validator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts", "authority");

// ── City Classification (imported inline to avoid circular deps) ─────

// Mirrors lane-archetypes.js classification sets
const METRO_CITIES = new Set(["los angeles", "chicago", "dallas", "atlanta", "new york", "miami", "phoenix", "houston", "seattle", "denver", "san francisco", "las vegas", "portland", "salt lake city", "nashville", "charlotte", "orlando", "tampa", "indianapolis", "kansas city"]);
const PORT_CITIES = new Set(["los angeles", "houston", "miami", "seattle", "new york", "san francisco"]);
const AGRICULTURE_CITIES = new Set(["kansas city", "indianapolis", "dallas", "denver"]);
const ENERGY_CITIES = new Set(["houston", "dallas", "denver", "salt lake city"]);
const ECOMMERCE_HUBS = new Set(["los angeles", "chicago", "dallas", "atlanta", "new york", "indianapolis"]);

function classifyCity(name) {
  const key = (name || "").split(",")[0].trim().toLowerCase();
  return {
    isMetro: METRO_CITIES.has(key),
    isPort: PORT_CITIES.has(key),
    isAgriculture: AGRICULTURE_CITIES.has(key),
    isEnergy: ENERGY_CITIES.has(key),
    isEcommerce: ECOMMERCE_HUBS.has(key),
  };
}

// ── Archetype inference from lane properties ─────────────────────────

const SUNBELT_REGIONS = new Set(["Southeast", "South Central", "Southwest"]);
const WEST_PACIFIC = new Set(["West Coast", "Pacific Northwest"]);
const EAST_COAST = new Set(["Northeast", "Southeast"]);

function inferArchetype(knowledge) {
  const dist = knowledge.lane_stats?.estimated_distance_miles || 0;
  const oCity = (knowledge.origin_city || "").toLowerCase();
  const dCity = (knowledge.destination_city || "").toLowerCase();
  const oClass = classifyCity(oCity);
  const dClass = classifyCity(dCity);
  const oRegion = knowledge.region_profile?.origin || knowledge.network_proof?.origin_region || "";
  const dRegion = knowledge.region_profile?.destination || knowledge.network_proof?.destination_region || "";

  // Priority ladder (mirrors lane-archetypes.js)
  if (dist < 300 && oClass.isMetro && dClass.isMetro) return "short_haul_metro";
  if ((oClass.isPort && !dClass.isPort) || (!oClass.isPort && dClass.isPort)) return "port_to_inland";
  if (oClass.isEnergy || dClass.isEnergy) return "energy_corridor";
  if (oClass.isAgriculture || dClass.isAgriculture) return "agriculture_lane";
  if (oClass.isEcommerce && dClass.isEcommerce) return "ecommerce_corridor";
  if ((WEST_PACIFIC.has(oRegion) && EAST_COAST.has(dRegion)) ||
      (EAST_COAST.has(oRegion) && WEST_PACIFIC.has(dRegion))) return "coastal_to_coastal";
  if (dist > 1000) return "long_haul_hub_to_hub";
  if (oRegion === "Midwest" || dRegion === "Midwest") return "midwest_manufacturing";
  if (SUNBELT_REGIONS.has(oRegion) && SUNBELT_REGIONS.has(dRegion)) return "sunbelt_growth";
  return "retail_distribution";
}

// ── Parse CLI ────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const lanesIdx = args.indexOf("--lanes");
const targetLanes = lanesIdx >= 0 ? args[lanesIdx + 1].split(",") : null;
const modeIdx = args.indexOf("--mode");
const targetMode = modeIdx >= 0 ? args[modeIdx + 1] : "LTL";
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 20;
const validateOnly = args.includes("--validate-only");
const benchmark = args.includes("--benchmark");

// ── Benchmark Lane Set ───────────────────────────────────────────────

const BENCHMARK_LANES = [
  // Short haul metro
  { origin: "Atlanta, GA", destination: "Orlando, FL" },
  { origin: "Dallas, TX", destination: "Houston, TX" },
  { origin: "Los Angeles, CA", destination: "Las Vegas, NV" },
  // Port to inland
  { origin: "Los Angeles, CA", destination: "Phoenix, AZ" },
  { origin: "Houston, TX", destination: "Dallas, TX" },
  { origin: "Miami, FL", destination: "Atlanta, GA" },
  // Long haul / coastal
  { origin: "Los Angeles, CA", destination: "Chicago, IL" },
  { origin: "New York, NY", destination: "Miami, FL" },
  { origin: "Seattle, WA", destination: "Phoenix, AZ" },
  // Ecommerce corridors
  { origin: "Chicago, IL", destination: "Indianapolis, IN" },
  { origin: "Atlanta, GA", destination: "Dallas, TX" },
  // Midwest manufacturing
  { origin: "Chicago, IL", destination: "Nashville, TN" },
  { origin: "Indianapolis, IN", destination: "Kansas City, MO" },
  // Regional / medium haul
  { origin: "Denver, CO", destination: "Salt Lake City, UT" },
  { origin: "Charlotte, NC", destination: "Tampa, FL" },
];

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  LANE-AUTHORITY GRAPH EXPANSION                             ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Reset graph for this run
  resetGraph();

  // Determine lane set
  let lanePairs;
  if (benchmark) {
    lanePairs = BENCHMARK_LANES;
    console.log(`Mode: BENCHMARK (${lanePairs.length} diverse lanes)`);
  } else if (targetLanes) {
    lanePairs = targetLanes.map(slug => {
      const toIdx = slug.indexOf("-to-");
      if (toIdx < 0) return null;
      const origin = slug.substring(0, toIdx).replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      const dest = slug.substring(toIdx + 4).replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      return { origin, destination: dest };
    }).filter(Boolean);
    console.log(`Mode: TARGETED (${lanePairs.length} lanes)`);
  } else {
    lanePairs = BENCHMARK_LANES.slice(0, limit);
    console.log(`Mode: DEFAULT (${lanePairs.length} lanes, limit ${limit})`);
  }

  console.log(`Shipping mode: ${targetMode}\n`);

  // ── Step 1: Build lane knowledge and expand graph ─────────────
  console.log("Step 1: Classifying lanes and expanding graph...\n");

  const results = [];
  let expandedCount = 0;
  let blockedCount = 0;

  for (const pair of lanePairs) {
    const knowledge = buildLaneKnowledge({
      origin: pair.origin,
      destination: pair.destination,
      mode: targetMode,
    });

    const archetypeId = inferArchetype(knowledge);
    const oCity = (knowledge.origin_city || "").split(",")[0].trim();
    const dCity = (knowledge.destination_city || "").split(",")[0].trim();

    const expansion = expandWithLane(knowledge, {
      archetypeId,
      originClass: classifyCity(oCity),
      destClass: classifyCity(dCity),
    });

    const active = expansion.relationships.filter(r => !r.blocked);
    const blocked = expansion.relationships.filter(r => r.blocked);

    console.log(`  ${expansion.lane_slug}`);
    console.log(`    Archetype: ${archetypeId} | Distance: ${knowledge.lane_stats.estimated_distance_miles} mi (${expansion.distance_band})`);
    console.log(`    Active: ${active.length} | Blocked: ${blocked.length}`);
    console.log(`    Primary: ${active.filter(r => r.rank === "primary").map(r => r.entity_id).join(", ") || "none"}`);
    console.log(`    Secondary: ${active.filter(r => r.rank === "secondary").map(r => r.entity_id).join(", ") || "none"}`);

    // Validate relationships
    const profile = {
      slug: expansion.lane_slug,
      mode: targetMode,
      distance_band: expansion.distance_band,
    };
    const validation = validateLaneRelationships(expansion, profile);
    if (validation.errors.length > 0) {
      console.log(`    ⚠ Validation issues: ${validation.errors.join("; ")}`);
    }

    results.push({
      slug: expansion.lane_slug,
      origin: pair.origin,
      destination: pair.destination,
      mode: targetMode,
      archetype: archetypeId,
      distance_band: expansion.distance_band,
      distance_miles: knowledge.lane_stats.estimated_distance_miles,
      active_count: active.length,
      blocked_count: blocked.length,
      relationships: expansion.relationships,
      validation,
    });

    expandedCount++;
  }

  // ── Step 2: Validate graph health ─────────────────────────────
  console.log("\nStep 2: Validating graph health...");

  const graphValidation = validateExpansionGraph();
  console.log(`  Graph valid: ${graphValidation.valid}`);
  console.log(`  Lanes: ${graphValidation.stats.lane_count}`);
  console.log(`  Entities touched: ${graphValidation.stats.entity_count}`);
  console.log(`  Total relationships: ${graphValidation.stats.relationship_count}`);
  console.log(`  Avg per lane: ${graphValidation.stats.avg_per_lane}`);
  console.log(`  Clusters: ${graphValidation.stats.cluster_count}`);

  if (graphValidation.errors.length > 0) {
    console.log("  Errors:");
    for (const err of graphValidation.errors) {
      console.log(`    ✗ ${err}`);
    }
  }
  if (graphValidation.warnings.length > 0) {
    console.log("  Warnings:");
    for (const w of graphValidation.warnings) {
      console.log(`    ⚠ ${w}`);
    }
  }

  // ── Step 3: Full graph-level health check ─────────────────────
  console.log("\nStep 3: Running expansion graph quality gates...");

  const graphExport = exportGraph();
  const healthCheck = validateExpansionGraphHealth(graphExport);
  console.log(`  Health valid: ${healthCheck.valid}`);
  console.log(`  Gates: ${JSON.stringify(healthCheck.gates)}`);
  if (healthCheck.errors.length > 0) {
    for (const err of healthCheck.errors) {
      console.log(`    ✗ ${err}`);
    }
  }
  console.log(`  Family distribution: ${JSON.stringify(healthCheck.stats.family_distribution)}`);

  // ── Step 4: Show cluster summary ──────────────────────────────
  console.log("\nStep 4: Authority clusters...");
  const clusters = getAllClusters();
  for (const cluster of clusters) {
    console.log(`  ${cluster.label} (${cluster.entity_family}): ${cluster.lane_count} lanes, avg score ${cluster.avg_score}`);
    console.log(`    Peer entities: ${cluster.peer_entities.map(p => p.label).join(", ")}`);
    console.log(`    Top lanes: ${cluster.lanes.slice(0, 3).map(l => `${l.slug}(${l.score})`).join(", ")}`);
  }

  // ── Step 5: Write artifacts ───────────────────────────────────
  console.log("\nStep 5: Writing artifacts...");
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  // Full graph export
  const graphPath = path.join(ARTIFACTS_DIR, "lane_authority_graph.json");
  fs.writeFileSync(graphPath, JSON.stringify(graphExport, null, 2));
  console.log(`  Graph: ${graphPath}`);

  // Per-lane artifacts
  const laneArtifactsDir = path.join(ARTIFACTS_DIR, "lane_expansions");
  fs.mkdirSync(laneArtifactsDir, { recursive: true });

  for (const result of results) {
    const laneArtifact = {
      _generated_at: new Date().toISOString(),
      lane: {
        slug: result.slug,
        origin: result.origin,
        destination: result.destination,
        mode: result.mode,
        archetype: result.archetype,
        distance_band: result.distance_band,
        distance_miles: result.distance_miles,
      },
      authority_links: getLaneAuthorityLinks(result.slug),
      relationships: result.relationships.map(r => ({
        entity_id: r.entity_id,
        entity_family: r.entity_family,
        score: r.score,
        rank: r.rank,
        blocked: r.blocked,
        block_reason: r.block_reason || null,
        evidence: r.evidence,
      })),
      summary: {
        active: result.active_count,
        blocked: result.blocked_count,
        primary: result.relationships.filter(r => !r.blocked && r.rank === "primary").length,
        secondary: result.relationships.filter(r => !r.blocked && r.rank === "secondary").length,
      },
    };
    const lanePath = path.join(laneArtifactsDir, `${result.slug}.json`);
    fs.writeFileSync(lanePath, JSON.stringify(laneArtifact, null, 2));
  }
  console.log(`  Lane artifacts: ${laneArtifactsDir}/ (${results.length} files)`);

  // Per-entity lane lists
  const entityArtifactsDir = path.join(ARTIFACTS_DIR, "entity_lanes");
  fs.mkdirSync(entityArtifactsDir, { recursive: true });

  for (const [entityId, lanes] of Object.entries(graphExport.authority_to_lanes)) {
    const entityArtifact = {
      entity_id: entityId,
      lane_count: lanes.length,
      lanes: lanes.map(l => ({
        lane_slug: l.lane_slug,
        origin: l.origin,
        destination: l.destination,
        mode: l.mode,
        score: l.score,
        rank: l.rank,
        distance_band: l.distance_band,
        archetype: l.archetype,
      })),
      links: getAuthorityLaneLinks(entityId),
    };
    const entityPath = path.join(entityArtifactsDir, `${entityId}.json`);
    fs.writeFileSync(entityPath, JSON.stringify(entityArtifact, null, 2));
  }
  console.log(`  Entity artifacts: ${entityArtifactsDir}/ (${Object.keys(graphExport.authority_to_lanes).length} files)`);

  // Cluster summary
  const clusterPath = path.join(ARTIFACTS_DIR, "clusters.json");
  fs.writeFileSync(clusterPath, JSON.stringify(clusters, null, 2));
  console.log(`  Clusters: ${clusterPath}`);

  // ── Summary ───────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  EXPANSION SUMMARY");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Lanes processed:    ${results.length}`);
  console.log(`  Graph valid:        ${graphValidation.valid}`);
  console.log(`  Health valid:       ${healthCheck.valid}`);
  console.log(`  Total relationships: ${healthCheck.stats.total_relationships}`);
  console.log(`  Avg per lane:       ${healthCheck.stats.avg_per_lane}`);
  console.log(`  Clusters formed:    ${clusters.length}`);
  console.log(`  Entities touched:   ${healthCheck.stats.entity_count}/13`);
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
