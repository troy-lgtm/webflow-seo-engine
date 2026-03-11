/**
 * Lane-Authority Expansion System Tests
 *
 * Proves that:
 *   1.  Classifier produces evidence-based scored relationships
 *   2.  Short haul lanes get correct authority profile (not long-haul entities)
 *   3.  Long haul lanes get correct authority profile (not short-haul entities)
 *   4.  Port lanes get vendor consolidation affinity
 *   5.  Weak relationships are blocked (score < threshold)
 *   6.  Over-assignment gate limits primaries per family
 *   7.  Bidirectional graph updates work correctly
 *   8.  Graph health validation catches orphans and breaks
 *   9.  Clusters form correctly from lane expansion
 *  10.  Quality gates reject incoherent relationships
 *  11.  Deterministic output (same input = same result)
 *  12.  Every relationship has evidence trail
 *  13.  Lane-authority links are renderable
 *  14.  Entity-to-lane back-references are correct
 *  15.  Graph serialization round-trips correctly
 *
 * Run: node tests/lane-authority-expansion.test.js
 */

import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import {
  buildClassificationProfile,
  classifyLaneAuthority,
  _MIN_RELATIONSHIP_SCORE,
  _RANK_THRESHOLDS,
} from "../lib/lane-authority-classifier.js";
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
  importGraph,
} from "../lib/lane-authority-graph.js";
import {
  validateRelationship,
  validateLaneRelationships,
  validateExpansionGraphHealth,
} from "../lib/lane-authority-validator.js";

// ── Test Infrastructure ─────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function assertGte(actual, min, message) {
  assert(actual >= min, `${message} (expected >= ${min}, got ${actual})`);
}

function assertLte(actual, max, message) {
  assert(actual <= max, `${message} (expected <= ${max}, got ${actual})`);
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ── Helper: Build lane profile for testing ──────────────────────────

function buildTestProfile(origin, destination, mode, overrides = {}) {
  const knowledge = buildLaneKnowledge({ origin, destination, mode });
  const oCity = (knowledge.origin_city || "").toLowerCase();
  const dCity = (knowledge.destination_city || "").toLowerCase();

  // Inline city classification (mirrors expand_authority_graph.js)
  const METRO = new Set(["los angeles", "chicago", "dallas", "atlanta", "new york", "miami", "phoenix", "houston", "seattle", "denver", "san francisco", "las vegas", "portland", "salt lake city", "nashville", "charlotte", "orlando", "tampa", "indianapolis", "kansas city"]);
  const PORT = new Set(["los angeles", "houston", "miami", "seattle", "new york", "san francisco"]);
  const ECOM = new Set(["los angeles", "chicago", "dallas", "atlanta", "new york", "indianapolis"]);
  const ENERGY = new Set(["houston", "dallas", "denver", "salt lake city"]);
  const AGRI = new Set(["kansas city", "indianapolis", "dallas", "denver"]);

  function classCity(name) {
    const key = (name || "").split(",")[0].trim().toLowerCase();
    return { isMetro: METRO.has(key), isPort: PORT.has(key), isEcommerce: ECOM.has(key), isEnergy: ENERGY.has(key), isAgriculture: AGRI.has(key) };
  }

  // Infer archetype
  const dist = knowledge.lane_stats?.estimated_distance_miles || 0;
  const oClass = classCity(oCity);
  const dClass = classCity(dCity);
  const oRegion = knowledge.region_profile?.origin || "";
  const dRegion = knowledge.region_profile?.destination || "";

  let archetype = "retail_distribution";
  if (dist < 300 && oClass.isMetro && dClass.isMetro) archetype = "short_haul_metro";
  else if ((oClass.isPort && !dClass.isPort) || (!oClass.isPort && dClass.isPort)) archetype = "port_to_inland";
  else if (oClass.isEnergy || dClass.isEnergy) archetype = "energy_corridor";
  else if (oClass.isEcommerce && dClass.isEcommerce) archetype = "ecommerce_corridor";
  else if (dist > 1000) archetype = "long_haul_hub_to_hub";

  return buildClassificationProfile(knowledge, {
    archetypeId: overrides.archetype || archetype,
    originClass: oClass,
    destClass: dClass,
    ...overrides,
  });
}

// ══════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════

// ── 1. Classifier Structure ─────────────────────────────────────────

section("1. Classifier Structure");

{
  const profile = buildTestProfile("Dallas, TX", "Houston, TX", "LTL");
  const result = classifyLaneAuthority(profile);

  assert(result.lane_slug, "Classification has lane_slug");
  assert(result.relationships.length > 0, "Classification has relationships");
  assert(result.summary, "Classification has summary");
  assertGte(result.summary.total, 13, "All 13 entities evaluated");

  // Every relationship has required fields
  for (const rel of result.relationships) {
    assert(rel.entity_id, "Relationship has entity_id");
    assert(rel.entity_family, "Relationship has entity_family");
    assert(typeof rel.score === "number", "Relationship has numeric score");
    assert(rel.rank, "Relationship has rank");
    assert(Array.isArray(rel.evidence), "Relationship has evidence array");
    assert(typeof rel.blocked === "boolean", "Relationship has blocked flag");
  }
}

// ── 2. Short Haul Metro Profile ─────────────────────────────────────

section("2. Short Haul Metro Classification");

{
  const profile = buildTestProfile("Dallas, TX", "Houston, TX", "LTL");
  const result = classifyLaneAuthority(profile);
  const active = result.relationships.filter(r => !r.blocked);
  const activeIds = active.map(r => r.entity_id);

  // Should include short haul authority entities
  assert(activeIds.includes("store-replenishment"), "Short haul: store-replenishment active");
  assert(activeIds.includes("cross-docking"), "Short haul: cross-docking active");
  assert(activeIds.includes("flexible-routing"), "Short haul: flexible-routing active");
  assert(activeIds.includes("scan-level-visibility"), "Short haul: scan-level-visibility active");
  assert(activeIds.includes("cargo-van"), "Short haul: cargo-van active");
  assert(activeIds.includes("box-truck"), "Short haul: box-truck active");

  // Should NOT include long haul authority entities
  const blockedIds = result.relationships.filter(r => r.blocked).map(r => r.entity_id);
  assert(blockedIds.includes("middle-mile"), "Short haul: middle-mile blocked");
  assert(blockedIds.includes("zone-skipping"), "Short haul: zone-skipping blocked");
  assert(blockedIds.includes("53-foot-trailer"), "Short haul: 53-foot-trailer blocked");

  // Store replenishment should be primary for short haul metro
  const storeRep = result.relationships.find(r => r.entity_id === "store-replenishment");
  assertEqual(storeRep.rank, "primary", "Short haul: store-replenishment is primary");
  assertGte(storeRep.score, 70, "Short haul: store-replenishment score >= 70");
}

// ── 3. Long Haul Profile ────────────────────────────────────────────

section("3. Long Haul Classification");

{
  const profile = buildTestProfile("New York, NY", "Miami, FL", "LTL");
  const result = classifyLaneAuthority(profile);
  const active = result.relationships.filter(r => !r.blocked);
  const activeIds = active.map(r => r.entity_id);

  // Should include long haul authority entities
  assert(activeIds.includes("pool-distribution"), "Long haul: pool-distribution active");
  assert(activeIds.includes("middle-mile"), "Long haul: middle-mile active");
  assert(activeIds.includes("zone-skipping"), "Long haul: zone-skipping active");
  assert(activeIds.includes("53-foot-trailer"), "Long haul: 53-foot-trailer active");

  // Middle-mile should score well for long haul
  const middleMile = result.relationships.find(r => r.entity_id === "middle-mile");
  assertGte(middleMile.score, 40, "Long haul: middle-mile score >= 40");

  // Cargo van should be blocked for long haul
  const cargoVan = result.relationships.find(r => r.entity_id === "cargo-van");
  assert(cargoVan.blocked || cargoVan.score < 40, "Long haul: cargo-van weak or blocked");
}

// ── 4. Port Lane Profile ────────────────────────────────────────────

section("4. Port-to-Inland Classification");

{
  const profile = buildTestProfile("Los Angeles, CA", "Phoenix, AZ", "LTL", { archetype: "port_to_inland" });
  const result = classifyLaneAuthority(profile);
  const active = result.relationships.filter(r => !r.blocked);

  // Vendor consolidation should be strong for port lanes
  const vendorCon = result.relationships.find(r => r.entity_id === "vendor-consolidation");
  assertGte(vendorCon.score, 50, "Port lane: vendor-consolidation score >= 50");
  assert(!vendorCon.blocked, "Port lane: vendor-consolidation not blocked");

  // Evidence should include port city signal
  const portEvidence = vendorCon.evidence.find(e => e.signal === "origin_is_port");
  assert(portEvidence, "Port lane: vendor-consolidation has port evidence");
}

// ── 5. Weak Relationship Blocking ───────────────────────────────────

section("5. Weak Relationship Blocking");

{
  const profile = buildTestProfile("Dallas, TX", "Houston, TX", "LTL");
  const result = classifyLaneAuthority(profile);

  // All blocked relationships must be below threshold
  const blocked = result.relationships.filter(r => r.blocked);
  for (const rel of blocked) {
    assert(rel.score < _MIN_RELATIONSHIP_SCORE,
      `Blocked ${rel.entity_id}: score ${rel.score} < threshold ${_MIN_RELATIONSHIP_SCORE}`);
    assert(rel.block_reason, `Blocked ${rel.entity_id}: has block_reason`);
  }

  // Active relationships must be at or above threshold
  const active = result.relationships.filter(r => !r.blocked);
  for (const rel of active) {
    assertGte(rel.score, _MIN_RELATIONSHIP_SCORE,
      `Active ${rel.entity_id}: score ${rel.score} >= threshold`);
  }
}

// ── 6. Over-Assignment Gate ─────────────────────────────────────────

section("6. Over-Assignment Gate");

{
  const profile = buildTestProfile("Chicago, IL", "Indianapolis, IN", "LTL");
  const result = classifyLaneAuthority(profile);
  const active = result.relationships.filter(r => !r.blocked);

  // Check primaries per family don't exceed max
  const families = ["solution", "concept", "equipment"];
  for (const family of families) {
    const primaries = active.filter(r => r.entity_family === family && r.rank === "primary");
    assertLte(primaries.length, 2, `${family}: max 2 primaries (got ${primaries.length})`);
  }
}

// ── 7. Bidirectional Graph ──────────────────────────────────────────

section("7. Bidirectional Graph");

{
  resetGraph();

  // Expand two lanes
  const k1 = buildLaneKnowledge({ origin: "Atlanta, GA", destination: "Orlando, FL", mode: "LTL" });
  expandWithLane(k1, { archetypeId: "sunbelt_growth" });

  const k2 = buildLaneKnowledge({ origin: "Dallas, TX", destination: "Houston, TX", mode: "LTL" });
  expandWithLane(k2, { archetypeId: "short_haul_metro" });

  // Forward: lane → authority
  const atlAuth = getLaneAuthority("atlanta-to-orlando");
  assertGte(atlAuth.length, 3, "Atlanta lane has >= 3 authority connections");

  const dalAuth = getLaneAuthority("dallas-to-houston");
  assertGte(dalAuth.length, 3, "Dallas lane has >= 3 authority connections");

  // Reverse: authority → lane
  const crossDockLanes = getAuthorityLanes("cross-docking");
  assert(crossDockLanes.some(l => l.lane_slug === "atlanta-to-orlando"), "Cross-docking references Atlanta lane");
  assert(crossDockLanes.some(l => l.lane_slug === "dallas-to-houston"), "Cross-docking references Dallas lane");

  // Bidirectional consistency
  const validation = validateExpansionGraph();
  assertEqual(validation.valid, true, "Graph passes bidirectional validation");
  assertEqual(validation.errors.length, 0, "No bidirectional errors");
}

// ── 8. Graph Health Validation ──────────────────────────────────────

section("8. Graph Health Validation");

{
  // Use the graph from test 7 (still in memory)
  const graphExport = exportGraph();
  const health = validateExpansionGraphHealth(graphExport);

  assertEqual(health.valid, true, "Graph health is valid");
  assertEqual(health.gates["LAG-BIDIR-01"], true, "Bidirectional gate passes");
  assertEqual(health.gates["LAG-GRAPH-01"], true, "Graph health gate passes");
  assertGte(health.stats.lane_count, 2, "At least 2 lanes in graph");
  assertGte(health.stats.entity_count, 3, "At least 3 entities touched");
}

// ── 9. Cluster Formation ────────────────────────────────────────────

section("9. Cluster Formation");

{
  // Still using graph from test 7
  const clusters = getAllClusters();
  assertGte(clusters.length, 3, "At least 3 clusters formed");

  for (const cluster of clusters) {
    assert(cluster.entity_id, "Cluster has entity_id");
    assert(cluster.label, "Cluster has label");
    assertGte(cluster.lane_count, 1, `Cluster ${cluster.entity_id}: has >= 1 lane`);
    assertGte(cluster.avg_score, 1, `Cluster ${cluster.entity_id}: avg_score > 0`);
    assert(cluster.peer_entities.length >= 0, `Cluster ${cluster.entity_id}: has peer_entities array`);
  }

  // Cross-docking cluster should have both test lanes
  const cdCluster = getCluster("cross-docking");
  assert(cdCluster, "Cross-docking cluster exists");
  assertGte(cdCluster.lane_count, 2, "Cross-docking cluster has >= 2 lanes");
}

// ── 10. Quality Gate Rejection ──────────────────────────────────────

section("10. Quality Gate Validation");

{
  // Build a short haul profile and validate relationships
  const profile = buildTestProfile("Dallas, TX", "Houston, TX", "LTL");
  const classification = classifyLaneAuthority(profile);

  // Validate the classification
  const validation = validateLaneRelationships(classification, profile);

  // Active relationships should pass individual gates
  const active = classification.relationships.filter(r => !r.blocked);
  for (const rel of active) {
    const relValidation = validateRelationship(rel, profile);
    // Distance coherence should pass for active relationships
    assertEqual(relValidation.gate_results["LAG-DIST-01"], true,
      `${rel.entity_id}: distance coherence passes`);
  }

  // Test distance incoherence detection
  const fakeRel = {
    entity_id: "cargo-van",
    entity_family: "equipment",
    score: 50,
    rank: "primary",
    evidence: [{ rule: "mode_fit", signal: "test", weight: 50 }],
    blocked: false,
  };
  const longHaulProfile = { ...profile, distance_band: "long_haul" };
  const incoherentResult = validateRelationship(fakeRel, longHaulProfile);
  assertEqual(incoherentResult.gate_results["LAG-DIST-01"], false,
    "Cargo van on long haul detected as incoherent");
}

// ── 11. Deterministic Output ────────────────────────────────────────

section("11. Deterministic Output");

{
  const profile = buildTestProfile("Atlanta, GA", "Orlando, FL", "LTL");

  const r1 = classifyLaneAuthority(profile);
  const r2 = classifyLaneAuthority(profile);

  assertEqual(r1.relationships.length, r2.relationships.length, "Same relationship count");

  for (let i = 0; i < r1.relationships.length; i++) {
    assertEqual(r1.relationships[i].entity_id, r2.relationships[i].entity_id, `Rel ${i}: same entity`);
    assertEqual(r1.relationships[i].score, r2.relationships[i].score, `Rel ${i}: same score`);
    assertEqual(r1.relationships[i].rank, r2.relationships[i].rank, `Rel ${i}: same rank`);
    assertEqual(r1.relationships[i].blocked, r2.relationships[i].blocked, `Rel ${i}: same blocked`);
  }
}

// ── 12. Evidence Trail Completeness ─────────────────────────────────

section("12. Evidence Trail");

{
  const lanes = [
    { origin: "Dallas, TX", destination: "Houston, TX", mode: "LTL" },
    { origin: "Los Angeles, CA", destination: "Chicago, IL", mode: "LTL" },
    { origin: "New York, NY", destination: "Miami, FL", mode: "LTL" },
  ];

  for (const lane of lanes) {
    const profile = buildTestProfile(lane.origin, lane.destination, lane.mode);
    const result = classifyLaneAuthority(profile);
    const active = result.relationships.filter(r => !r.blocked);

    for (const rel of active) {
      assertGte(rel.evidence.length, 1, `${result.lane_slug}→${rel.entity_id}: has evidence`);

      // Evidence items have required structure
      for (const ev of rel.evidence) {
        assert(ev.rule, `${rel.entity_id} evidence: has rule`);
        assert(ev.signal, `${rel.entity_id} evidence: has signal`);
        assert(typeof ev.weight === "number", `${rel.entity_id} evidence: has numeric weight`);
      }

      // At least one positive evidence item
      const positiveEvidence = rel.evidence.filter(e => e.weight > 0);
      assertGte(positiveEvidence.length, 1, `${result.lane_slug}→${rel.entity_id}: has positive evidence`);
    }
  }
}

// ── 13. Lane-Authority Link Rendering ───────────────────────────────

section("13. Link Rendering");

{
  resetGraph();

  const k = buildLaneKnowledge({ origin: "Atlanta, GA", destination: "Orlando, FL", mode: "LTL" });
  expandWithLane(k, { archetypeId: "sunbelt_growth" });

  const links = getLaneAuthorityLinks("atlanta-to-orlando");
  assertGte(links.length, 3, "Lane has >= 3 renderable links");

  for (const link of links) {
    assert(link.href, "Link has href");
    assert(link.text, "Link has text");
    assert(link.family, "Link has family");
    assert(link.href.startsWith("/"), "Link href starts with /");
    assertGte(link.score, _MIN_RELATIONSHIP_SCORE, "Link score above threshold");
  }
}

// ── 14. Entity-to-Lane Back-References ──────────────────────────────

section("14. Entity Back-References");

{
  // Still using graph from test 13
  const entityLinks = getAuthorityLaneLinks("cross-docking");
  assertGte(entityLinks.length, 1, "Cross-docking has >= 1 lane link");

  for (const link of entityLinks) {
    assert(link.href.startsWith("/lanes/"), "Entity link href points to lane");
    assert(link.text, "Entity link has text");
    assert(link.mode, "Entity link has mode");
  }
}

// ── 15. Graph Serialization Round-Trip ──────────────────────────────

section("15. Graph Serialization");

{
  resetGraph();

  // Expand a few lanes
  for (const pair of [
    { origin: "Atlanta, GA", dest: "Orlando, FL" },
    { origin: "Dallas, TX", dest: "Houston, TX" },
    { origin: "Los Angeles, CA", dest: "Chicago, IL" },
  ]) {
    const k = buildLaneKnowledge({ origin: pair.origin, destination: pair.dest, mode: "LTL" });
    expandWithLane(k, {});
  }

  // Export
  const exported = exportGraph();
  assert(exported._version, "Export has version");
  assert(exported.lane_to_authority, "Export has lane_to_authority");
  assert(exported.authority_to_lanes, "Export has authority_to_lanes");
  assert(exported.clusters, "Export has clusters");

  const laneCount = Object.keys(exported.lane_to_authority).length;
  assertEqual(laneCount, 3, "Export has 3 lanes");

  // Import into fresh graph
  resetGraph();
  importGraph(exported);

  // Verify state restored
  const atl = getLaneAuthority("atlanta-to-orlando");
  assertGte(atl.length, 3, "Round-trip: Atlanta lane relationships restored");

  const dal = getLaneAuthority("dallas-to-houston");
  assertGte(dal.length, 3, "Round-trip: Dallas lane relationships restored");

  const la = getLaneAuthority("los-angeles-to-chicago");
  assertGte(la.length, 3, "Round-trip: LA lane relationships restored");

  // Validate restored graph
  const graphHealth = validateExpansionGraph();
  assertEqual(graphHealth.valid, true, "Round-trip: graph validation passes");
}

// ── 16. FTL Mode Classification ─────────────────────────────────────

section("16. FTL Mode Classification");

{
  const profile = buildTestProfile("Los Angeles, CA", "Chicago, IL", "FTL", { archetype: "long_haul_hub_to_hub" });
  const result = classifyLaneAuthority(profile);
  const active = result.relationships.filter(r => !r.blocked);
  const activeIds = active.map(r => r.entity_id);

  // FTL should strongly associate with 53-foot trailer
  const trailer = result.relationships.find(r => r.entity_id === "53-foot-trailer");
  assertGte(trailer.score, 55, "FTL: 53-foot-trailer score >= 55");
  assert(!trailer.blocked, "FTL: 53-foot-trailer not blocked");

  // FTL should associate with middle-mile
  const middleMile = result.relationships.find(r => r.entity_id === "middle-mile");
  assertGte(middleMile.score, 40, "FTL: middle-mile score >= 40");

  // Flexible routing should be penalized for FTL
  const flexRoute = result.relationships.find(r => r.entity_id === "flexible-routing");
  assertLte(flexRoute.score, 30, "FTL: flexible-routing penalized");

  // Right-sized assets should be penalized for FTL
  const rightSized = result.relationships.find(r => r.entity_id === "right-sized-assets");
  assert(rightSized.blocked || rightSized.score <= 20, "FTL: right-sized-assets weak or blocked");
}

// ── 17. Cargo Van Mode Classification ───────────────────────────────

section("17. Cargo Van Mode Classification");

{
  const profile = buildTestProfile("Dallas, TX", "Houston, TX", "Cargo Van / Box Truck", { archetype: "short_haul_metro" });
  const result = classifyLaneAuthority(profile);
  const active = result.relationships.filter(r => !r.blocked);
  const activeIds = active.map(r => r.entity_id);

  // Cargo van should be strongly associated
  assert(activeIds.includes("cargo-van"), "Van mode: cargo-van active");
  const cargoVan = result.relationships.find(r => r.entity_id === "cargo-van");
  assertGte(cargoVan.score, 60, "Van mode: cargo-van score >= 60");

  // Box truck should also be strong
  assert(activeIds.includes("box-truck"), "Van mode: box-truck active");

  // Right-sized assets should be strong
  assert(activeIds.includes("right-sized-assets"), "Van mode: right-sized-assets active");
  const rightSized = result.relationships.find(r => r.entity_id === "right-sized-assets");
  assertGte(rightSized.score, 50, "Van mode: right-sized-assets score >= 50");

  // 53-foot trailer should be blocked
  const trailer = result.relationships.find(r => r.entity_id === "53-foot-trailer");
  assert(trailer.blocked, "Van mode: 53-foot-trailer blocked");
}

// ══════════════════════════════════════════════════════════════════════
// RESULTS
// ══════════════════════════════════════════════════════════════════════

console.log("\n══════════════════════════════════════════════════════════");
console.log(`  LANE-AUTHORITY EXPANSION TESTS: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════════════════════");

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  ✗ ${f}`);
  }
}

console.log(`\n  Total assertions: ${passed + failed}`);
console.log(`  Pass rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

process.exit(failed > 0 ? 1 : 0);
