/**
 * lane-authority-classifier.js — Lane-to-Authority Relationship Classifier
 *
 * Given a lane's knowledge profile (distance, archetype, corridor, mode,
 * city classifications, operational characteristics), this module produces
 * scored, evidence-based authority relationships.
 *
 * Each relationship carries:
 *   - entity_id: target authority entity
 *   - entity_family: "solution" | "concept" | "equipment"
 *   - score: 0-100 confidence score
 *   - rank: "primary" | "secondary" | "tertiary"
 *   - evidence: array of { rule, signal, weight } explaining why
 *   - blocked: boolean (true if quality gate rejects the relationship)
 *
 * Classification rules are deterministic and grounded in lane properties.
 * No random assignments. No generic catch-alls.
 *
 * @module lane-authority-classifier
 */

import { getEntity, getAllEntities } from "./authority-graph.js";

// ── Classification Rules ─────────────────────────────────────────────

/**
 * Solution classification rules.
 *
 * Each rule tests lane properties and produces evidence-based scores.
 * Rules are evaluated independently — a lane may match multiple solutions
 * with varying confidence.
 */
const SOLUTION_RULES = {
  "store-replenishment": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // Metro-to-metro short haul strongly fits store replenishment
      if (lane.archetype === "short_haul_metro") {
        score += 30;
        evidence.push({ rule: "archetype_match", signal: "short_haul_metro", weight: 30 });
      }

      // Retail distribution archetype is the fallback replenishment type
      if (lane.archetype === "retail_distribution") {
        score += 20;
        evidence.push({ rule: "archetype_match", signal: "retail_distribution", weight: 20 });
      }

      // Ecommerce corridors serve store networks
      if (lane.archetype === "ecommerce_corridor") {
        score += 20;
        evidence.push({ rule: "archetype_match", signal: "ecommerce_corridor", weight: 20 });
      }

      // LTL mode is core replenishment mode
      if (lane.mode === "LTL") {
        score += 15;
        evidence.push({ rule: "mode_fit", signal: "LTL", weight: 15 });
      }

      // Cargo Van / Box Truck for final mile replenishment
      if (lane.mode === "Cargo Van / Box Truck") {
        score += 20;
        evidence.push({ rule: "mode_fit", signal: "Cargo Van / Box Truck", weight: 20 });
      }

      // Short haul distance indicates local delivery pattern
      if (lane.distance_band === "short_haul") {
        score += 15;
        evidence.push({ rule: "distance_band", signal: "short_haul", weight: 15 });
      }

      // Metro destinations indicate store density
      if (lane.dest_class?.isMetro) {
        score += 10;
        evidence.push({ rule: "city_class", signal: "dest_is_metro", weight: 10 });
      }

      // Ecommerce hub destination (distribution center → stores)
      if (lane.dest_class?.isEcommerce) {
        score += 10;
        evidence.push({ rule: "city_class", signal: "dest_is_ecommerce", weight: 10 });
      }

      // Operational signal: "scheduled replenishment" in shipment profile
      if (lane.shipment_profile?.some(s => s.includes("replenishment"))) {
        score += 15;
        evidence.push({ rule: "operational_signal", signal: "replenishment_profile", weight: 15 });
      }

      // Operational signal: "retail" in operational characteristics
      if (lane.operational_chars?.some(s => s.includes("retail"))) {
        score += 10;
        evidence.push({ rule: "operational_signal", signal: "retail_operational", weight: 10 });
      }

      return { score: Math.min(100, score), evidence };
    },
  },

  "pool-distribution": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // Long haul or regional distances suit pool distribution
      if (lane.distance_band === "long_haul") {
        score += 25;
        evidence.push({ rule: "distance_band", signal: "long_haul", weight: 25 });
      }
      if (lane.distance_band === "regional") {
        score += 20;
        evidence.push({ rule: "distance_band", signal: "regional", weight: 20 });
      }

      // Hub-to-hub archetype strongly fits pool distribution
      if (lane.archetype === "long_haul_hub_to_hub") {
        score += 25;
        evidence.push({ rule: "archetype_match", signal: "long_haul_hub_to_hub", weight: 25 });
      }

      // Coastal-to-coastal indicates national pool distribution
      if (lane.archetype === "coastal_to_coastal") {
        score += 20;
        evidence.push({ rule: "archetype_match", signal: "coastal_to_coastal", weight: 20 });
      }

      // LTL mode with medium+ distance indicates consolidation potential
      if (lane.mode === "LTL" && lane.distance_miles > 500) {
        score += 15;
        evidence.push({ rule: "mode_distance", signal: "LTL_500+_miles", weight: 15 });
      }

      // FTL for linehaul legs
      if (lane.mode === "FTL") {
        score += 15;
        evidence.push({ rule: "mode_fit", signal: "FTL_linehaul", weight: 15 });
      }

      // Metro origin (distribution center location)
      if (lane.origin_class?.isMetro) {
        score += 10;
        evidence.push({ rule: "city_class", signal: "origin_is_metro", weight: 10 });
      }

      // Ecommerce hub origin (fulfillment center)
      if (lane.origin_class?.isEcommerce) {
        score += 10;
        evidence.push({ rule: "city_class", signal: "origin_is_ecommerce", weight: 10 });
      }

      // Cross-docks available (pool distribution uses cross-dock network)
      if (lane.cross_dock_count >= 2) {
        score += 10;
        evidence.push({ rule: "network_signal", signal: `${lane.cross_dock_count}_cross_docks`, weight: 10 });
      }

      return { score: Math.min(100, score), evidence };
    },
  },

  "vendor-consolidation": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // Port-to-inland strongly indicates vendor inbound consolidation
      if (lane.archetype === "port_to_inland") {
        score += 30;
        evidence.push({ rule: "archetype_match", signal: "port_to_inland", weight: 30 });
      }

      // Origin is port city (vendor imports)
      if (lane.origin_class?.isPort) {
        score += 20;
        evidence.push({ rule: "city_class", signal: "origin_is_port", weight: 20 });
      }

      // Midwest manufacturing (multiple vendor sources)
      if (lane.archetype === "midwest_manufacturing") {
        score += 20;
        evidence.push({ rule: "archetype_match", signal: "midwest_manufacturing", weight: 20 });
      }

      // LTL mode for multi-vendor pickup routing
      if (lane.mode === "LTL") {
        score += 10;
        evidence.push({ rule: "mode_fit", signal: "LTL", weight: 10 });
      }

      // FTL for consolidated linehaul
      if (lane.mode === "FTL") {
        score += 10;
        evidence.push({ rule: "mode_fit", signal: "FTL", weight: 10 });
      }

      // Ecommerce destination (retailer receiving consolidated vendor freight)
      if (lane.dest_class?.isEcommerce) {
        score += 15;
        evidence.push({ rule: "city_class", signal: "dest_is_ecommerce", weight: 15 });
      }

      // Medium haul distance (regional consolidation)
      if (lane.distance_band === "medium_haul" || lane.distance_band === "regional") {
        score += 10;
        evidence.push({ rule: "distance_band", signal: lane.distance_band, weight: 10 });
      }

      // Multiple cross-docks support multi-vendor coordination
      if (lane.cross_dock_count >= 3) {
        score += 10;
        evidence.push({ rule: "network_signal", signal: `${lane.cross_dock_count}_cross_docks`, weight: 10 });
      }

      return { score: Math.min(100, score), evidence };
    },
  },

  "zone-skipping": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // Long haul distance is core zone skip territory
      if (lane.distance_band === "long_haul") {
        score += 30;
        evidence.push({ rule: "distance_band", signal: "long_haul", weight: 30 });
      }
      if (lane.distance_band === "regional") {
        score += 15;
        evidence.push({ rule: "distance_band", signal: "regional", weight: 15 });
      }

      // Ecommerce corridors heavily use zone skip
      if (lane.archetype === "ecommerce_corridor") {
        score += 25;
        evidence.push({ rule: "archetype_match", signal: "ecommerce_corridor", weight: 25 });
      }

      // Coastal-to-coastal = maximum zone skip opportunity
      if (lane.archetype === "coastal_to_coastal") {
        score += 25;
        evidence.push({ rule: "archetype_match", signal: "coastal_to_coastal", weight: 25 });
      }

      // Hub-to-hub long haul
      if (lane.archetype === "long_haul_hub_to_hub") {
        score += 20;
        evidence.push({ rule: "archetype_match", signal: "long_haul_hub_to_hub", weight: 20 });
      }

      // FTL for injection linehaul legs
      if (lane.mode === "FTL") {
        score += 15;
        evidence.push({ rule: "mode_fit", signal: "FTL_injection", weight: 15 });
      }

      // LTL with 800+ miles has zone skip value
      if (lane.mode === "LTL" && lane.distance_miles > 800) {
        score += 15;
        evidence.push({ rule: "mode_distance", signal: "LTL_800+_miles", weight: 15 });
      }

      // Ecommerce origin hub
      if (lane.origin_class?.isEcommerce) {
        score += 10;
        evidence.push({ rule: "city_class", signal: "origin_is_ecommerce", weight: 10 });
      }

      return { score: Math.min(100, score), evidence };
    },
  },
};

/**
 * Concept classification rules.
 */
const CONCEPT_RULES = {
  "cross-docking": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // LTL mode inherently uses cross-dock routing
      if (lane.mode === "LTL") {
        score += 25;
        evidence.push({ rule: "mode_fit", signal: "LTL_cross_dock_routing", weight: 25 });
      }

      // Has cross-dock facilities nearby
      if (lane.cross_dock_count >= 2) {
        score += 20;
        evidence.push({ rule: "network_signal", signal: `${lane.cross_dock_count}_cross_docks`, weight: 20 });
      }
      if (lane.cross_dock_count >= 4) {
        score += 10;
        evidence.push({ rule: "network_signal", signal: "high_cross_dock_density", weight: 10 });
      }

      // Operational signal: cross-dock routing mentioned
      if (lane.operational_chars?.some(s => s.includes("cross-dock"))) {
        score += 15;
        evidence.push({ rule: "operational_signal", signal: "cross_dock_operational", weight: 15 });
      }

      // Metro lanes have higher cross-dock density
      if (lane.origin_class?.isMetro && lane.dest_class?.isMetro) {
        score += 10;
        evidence.push({ rule: "city_class", signal: "metro_to_metro", weight: 10 });
      }

      // Short to medium haul benefits most from cross-dock
      if (lane.distance_band === "short_haul" || lane.distance_band === "medium_haul") {
        score += 10;
        evidence.push({ rule: "distance_band", signal: lane.distance_band, weight: 10 });
      }

      return { score: Math.min(100, score), evidence };
    },
  },

  "middle-mile": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // Regional and long haul inherently have middle mile segments
      if (lane.distance_band === "long_haul") {
        score += 30;
        evidence.push({ rule: "distance_band", signal: "long_haul", weight: 30 });
      }
      if (lane.distance_band === "regional") {
        score += 25;
        evidence.push({ rule: "distance_band", signal: "regional", weight: 25 });
      }

      // FTL is the primary middle-mile mode
      if (lane.mode === "FTL") {
        score += 20;
        evidence.push({ rule: "mode_fit", signal: "FTL_linehaul", weight: 20 });
      }

      // LTL with significant distance has middle-mile linehaul
      if (lane.mode === "LTL" && lane.distance_miles > 600) {
        score += 15;
        evidence.push({ rule: "mode_distance", signal: "LTL_600+_miles", weight: 15 });
      }

      // Hub-to-hub or coastal-to-coastal = strong middle mile
      if (lane.archetype === "long_haul_hub_to_hub" || lane.archetype === "coastal_to_coastal") {
        score += 20;
        evidence.push({ rule: "archetype_match", signal: lane.archetype, weight: 20 });
      }

      // Short haul is NOT middle mile
      if (lane.distance_band === "short_haul") {
        score -= 20;
        evidence.push({ rule: "distance_exclusion", signal: "short_haul_not_middle_mile", weight: -20 });
      }

      return { score: Math.max(0, Math.min(100, score)), evidence };
    },
  },

  "scan-level-visibility": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // LTL requires scan visibility for pallet-level tracking
      if (lane.mode === "LTL") {
        score += 20;
        evidence.push({ rule: "mode_fit", signal: "LTL_pallet_tracking", weight: 20 });
      }

      // Cargo Van / Box Truck for last-mile delivery POD
      if (lane.mode === "Cargo Van / Box Truck") {
        score += 25;
        evidence.push({ rule: "mode_fit", signal: "last_mile_POD", weight: 25 });
      }

      // Short haul metro = multi-stop delivery needing per-stop POD
      if (lane.archetype === "short_haul_metro") {
        score += 20;
        evidence.push({ rule: "archetype_match", signal: "short_haul_metro", weight: 20 });
      }

      // Retail distribution = store-level scan compliance
      if (lane.archetype === "retail_distribution") {
        score += 15;
        evidence.push({ rule: "archetype_match", signal: "retail_distribution", weight: 15 });
      }

      // Operational signal: tracking/visibility mentioned
      if (lane.operational_chars?.some(s => s.includes("tracking") || s.includes("visibility"))) {
        score += 15;
        evidence.push({ rule: "operational_signal", signal: "tracking_operational", weight: 15 });
      }

      // Metro destination = commercial delivery needing POD
      if (lane.dest_class?.isMetro) {
        score += 10;
        evidence.push({ rule: "city_class", signal: "dest_is_metro", weight: 10 });
      }

      return { score: Math.min(100, score), evidence };
    },
  },

  "predictable-pricing": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // All modes benefit from predictable pricing, but LTL most
      if (lane.mode === "LTL") {
        score += 15;
        evidence.push({ rule: "mode_fit", signal: "LTL_volume_pricing", weight: 15 });
      }
      if (lane.mode === "FTL") {
        score += 15;
        evidence.push({ rule: "mode_fit", signal: "FTL_committed_rates", weight: 15 });
      }

      // High-corridor lanes have more predictable pricing
      if (lane.corridor_priority === "high") {
        score += 20;
        evidence.push({ rule: "corridor_signal", signal: "high_priority_corridor", weight: 20 });
      }

      // Pricing logic explicitly mentions predictable/transparent
      if (lane.pricing_logic?.some(s => s.includes("transparent") || s.includes("predictab"))) {
        score += 15;
        evidence.push({ rule: "operational_signal", signal: "transparent_pricing", weight: 15 });
      }

      // Medium haul is sweet spot for rate stability
      if (lane.distance_band === "medium_haul" || lane.distance_band === "regional") {
        score += 10;
        evidence.push({ rule: "distance_band", signal: lane.distance_band, weight: 10 });
      }

      // Higher carrier count = more pricing competition = more stable rates
      if (lane.carrier_count >= 6) {
        score += 10;
        evidence.push({ rule: "network_signal", signal: `${lane.carrier_count}_carriers`, weight: 10 });
      }

      // Ecommerce corridors need budget predictability
      if (lane.archetype === "ecommerce_corridor") {
        score += 15;
        evidence.push({ rule: "archetype_match", signal: "ecommerce_corridor", weight: 15 });
      }

      return { score: Math.min(100, score), evidence };
    },
  },

  "flexible-routing": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // LTL mode uses flexible multi-stop routing
      if (lane.mode === "LTL") {
        score += 20;
        evidence.push({ rule: "mode_fit", signal: "LTL_multi_stop", weight: 20 });
      }

      // Cargo Van / Box Truck has most flexible routing
      if (lane.mode === "Cargo Van / Box Truck") {
        score += 25;
        evidence.push({ rule: "mode_fit", signal: "van_flexible_routing", weight: 25 });
      }

      // Short haul = flexible daily route building
      if (lane.distance_band === "short_haul") {
        score += 20;
        evidence.push({ rule: "distance_band", signal: "short_haul", weight: 20 });
      }

      // Metro density enables route optimization
      if (lane.origin_class?.isMetro || lane.dest_class?.isMetro) {
        score += 10;
        evidence.push({ rule: "city_class", signal: "metro_density", weight: 10 });
      }

      // Operational signal: flexible mentioned
      if (lane.operational_chars?.some(s => s.includes("flexible"))) {
        score += 15;
        evidence.push({ rule: "operational_signal", signal: "flexible_operational", weight: 15 });
      }

      // Short haul metro = multi-stop route optimization
      if (lane.archetype === "short_haul_metro") {
        score += 15;
        evidence.push({ rule: "archetype_match", signal: "short_haul_metro", weight: 15 });
      }

      // FTL is point-to-point, not flexible routing
      if (lane.mode === "FTL") {
        score -= 15;
        evidence.push({ rule: "mode_exclusion", signal: "FTL_point_to_point", weight: -15 });
      }

      return { score: Math.max(0, Math.min(100, score)), evidence };
    },
  },

  "right-sized-assets": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // Cargo Van / Box Truck IS the right-sized asset mode
      if (lane.mode === "Cargo Van / Box Truck") {
        score += 35;
        evidence.push({ rule: "mode_fit", signal: "right_sized_mode", weight: 35 });
      }

      // LTL with short haul often uses right-sized vehicles
      if (lane.mode === "LTL" && lane.distance_band === "short_haul") {
        score += 25;
        evidence.push({ rule: "mode_distance", signal: "LTL_short_haul", weight: 25 });
      }

      // LTL in general has right-sizing potential
      if (lane.mode === "LTL") {
        score += 10;
        evidence.push({ rule: "mode_fit", signal: "LTL_partial_load", weight: 10 });
      }

      // Operational signal: right-sized mentioned
      if (lane.operational_chars?.some(s => s.includes("right-sized")) ||
          lane.equipment_fit?.some(s => s.includes("right-sized") || s.includes("cargo van"))) {
        score += 15;
        evidence.push({ rule: "operational_signal", signal: "right_sized_fit", weight: 15 });
      }

      // Short haul metro uses varied vehicle sizes per stop
      if (lane.archetype === "short_haul_metro") {
        score += 15;
        evidence.push({ rule: "archetype_match", signal: "short_haul_metro", weight: 15 });
      }

      // FTL is NOT right-sized (full trailer always)
      if (lane.mode === "FTL") {
        score -= 20;
        evidence.push({ rule: "mode_exclusion", signal: "FTL_full_trailer", weight: -20 });
      }

      return { score: Math.max(0, Math.min(100, score)), evidence };
    },
  },
};

/**
 * Equipment classification rules.
 */
const EQUIPMENT_RULES = {
  "cargo-van": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // Cargo Van / Box Truck mode directly uses cargo vans
      if (lane.mode === "Cargo Van / Box Truck") {
        score += 35;
        evidence.push({ rule: "mode_fit", signal: "van_mode", weight: 35 });
      }

      // Short haul metro suits cargo van delivery
      if (lane.archetype === "short_haul_metro" && lane.mode !== "FTL") {
        score += 20;
        evidence.push({ rule: "archetype_match", signal: "short_haul_metro", weight: 20 });
      }

      // Short haul distance
      if (lane.distance_band === "short_haul") {
        score += 15;
        evidence.push({ rule: "distance_band", signal: "short_haul", weight: 15 });
      }

      // Equipment fit mentions cargo van
      if (lane.equipment_fit?.some(s => s.toLowerCase().includes("cargo van"))) {
        score += 15;
        evidence.push({ rule: "equipment_signal", signal: "cargo_van_fit", weight: 15 });
      }

      // Metro destination (urban delivery)
      if (lane.dest_class?.isMetro) {
        score += 10;
        evidence.push({ rule: "city_class", signal: "dest_is_metro", weight: 10 });
      }

      // FTL never uses cargo vans
      if (lane.mode === "FTL") {
        score -= 30;
        evidence.push({ rule: "mode_exclusion", signal: "FTL_no_vans", weight: -30 });
      }

      // Long haul not suitable for vans
      if (lane.distance_band === "long_haul") {
        score -= 20;
        evidence.push({ rule: "distance_exclusion", signal: "long_haul_no_vans", weight: -20 });
      }

      return { score: Math.max(0, Math.min(100, score)), evidence };
    },
  },

  "box-truck": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // Cargo Van / Box Truck mode uses box trucks
      if (lane.mode === "Cargo Van / Box Truck") {
        score += 30;
        evidence.push({ rule: "mode_fit", signal: "box_truck_mode", weight: 30 });
      }

      // LTL with short/medium haul often uses box trucks for local P&D
      if (lane.mode === "LTL" && (lane.distance_band === "short_haul" || lane.distance_band === "medium_haul")) {
        score += 20;
        evidence.push({ rule: "mode_distance", signal: "LTL_local_delivery", weight: 20 });
      }

      // LTL in general uses box trucks for pickup/delivery
      if (lane.mode === "LTL") {
        score += 10;
        evidence.push({ rule: "mode_fit", signal: "LTL_PD_trucks", weight: 10 });
      }

      // Short haul metro = multi-stop box truck routes
      if (lane.archetype === "short_haul_metro") {
        score += 15;
        evidence.push({ rule: "archetype_match", signal: "short_haul_metro", weight: 15 });
      }

      // Retail distribution uses box trucks at stores without docks
      if (lane.archetype === "retail_distribution") {
        score += 15;
        evidence.push({ rule: "archetype_match", signal: "retail_distribution", weight: 15 });
      }

      // Equipment fit mentions box truck
      if (lane.equipment_fit?.some(s => s.toLowerCase().includes("box truck"))) {
        score += 10;
        evidence.push({ rule: "equipment_signal", signal: "box_truck_fit", weight: 10 });
      }

      return { score: Math.min(100, score), evidence };
    },
  },

  "53-foot-trailer": {
    evaluate(lane) {
      const evidence = [];
      let score = 0;

      // FTL mode is the 53-foot trailer mode
      if (lane.mode === "FTL") {
        score += 35;
        evidence.push({ rule: "mode_fit", signal: "FTL_trailer", weight: 35 });
      }

      // LTL linehaul uses 53-foot trailers for hub-to-hub
      if (lane.mode === "LTL" && lane.distance_miles > 300) {
        score += 15;
        evidence.push({ rule: "mode_distance", signal: "LTL_linehaul_trailer", weight: 15 });
      }

      // Long haul or regional = trailer territory
      if (lane.distance_band === "long_haul") {
        score += 20;
        evidence.push({ rule: "distance_band", signal: "long_haul", weight: 20 });
      }
      if (lane.distance_band === "regional") {
        score += 15;
        evidence.push({ rule: "distance_band", signal: "regional", weight: 15 });
      }

      // Hub-to-hub archetype uses dedicated trailers
      if (lane.archetype === "long_haul_hub_to_hub") {
        score += 20;
        evidence.push({ rule: "archetype_match", signal: "long_haul_hub_to_hub", weight: 20 });
      }

      // Coastal-to-coastal
      if (lane.archetype === "coastal_to_coastal") {
        score += 15;
        evidence.push({ rule: "archetype_match", signal: "coastal_to_coastal", weight: 15 });
      }

      // Equipment explicitly mentions 53' or dry van
      if (lane.common_equipment?.some(e => e.includes("53") || e.includes("Dry Van"))) {
        score += 10;
        evidence.push({ rule: "equipment_signal", signal: "trailer_equipment", weight: 10 });
      }

      // Cargo Van / Box Truck mode never uses 53-foot trailers
      if (lane.mode === "Cargo Van / Box Truck") {
        score -= 30;
        evidence.push({ rule: "mode_exclusion", signal: "van_mode_no_trailers", weight: -30 });
      }

      return { score: Math.max(0, Math.min(100, score)), evidence };
    },
  },
};

// ── Lane Profile Builder ─────────────────────────────────────────────

/**
 * Build a classification profile from lane knowledge data.
 * Normalizes the lane knowledge into the shape expected by classification rules.
 *
 * @param {object} knowledge - Output of buildLaneKnowledge()
 * @param {object} [extra] - Additional context
 * @param {string} [extra.archetypeId] - Pre-assigned archetype ID
 * @param {string} [extra.corridorId] - Pre-assigned corridor ID
 * @param {string} [extra.corridorPriority] - "high"|"medium"|"low"
 * @param {object} [extra.originClass] - City classification { isMetro, isPort, ... }
 * @param {object} [extra.destClass] - City classification
 * @returns {object} Classification profile
 */
export function buildClassificationProfile(knowledge, extra = {}) {
  const k = knowledge;
  const ls = k.lane_stats || {};
  const np = k.network_proof || {};

  return {
    // Identity
    slug: k.lane_slug || "",
    mode: k.mode || "LTL",
    origin: k.origin_city || "",
    destination: k.destination_city || "",
    origin_state: k.origin_state || "",
    destination_state: k.destination_state || "",

    // Geography
    distance_miles: ls.estimated_distance_miles || 0,
    distance_band: k.distance_band || "medium_haul",
    origin_region: np.origin_region || k.region_profile?.origin || "",
    dest_region: np.destination_region || k.region_profile?.destination || "",

    // Classification
    archetype: extra.archetypeId || null,
    corridor_id: extra.corridorId || k.corridor_id || null,
    corridor_priority: extra.corridorPriority || null,

    // City classification
    origin_class: extra.originClass || null,
    dest_class: extra.destClass || null,

    // Operational signals
    shipment_profile: k.shipment_profile_fit || [],
    equipment_fit: k.equipment_fit || [],
    operational_chars: k.operational_characteristics || [],
    pricing_logic: k.pricing_logic || [],
    common_equipment: ls.common_equipment || [],

    // Network
    carrier_count: np.estimated_carrier_count || 0,
    cross_dock_count: (np.nearest_cross_docks || []).length,
    cross_docks: np.nearest_cross_docks || [],
  };
}

// ── Main Classifier ──────────────────────────────────────────────────

/**
 * Minimum score to consider a relationship valid.
 * Below this, the relationship is blocked.
 * Set to 30 to prevent weak, mode-only relationships from passing.
 */
const MIN_RELATIONSHIP_SCORE = 30;

/**
 * Maximum number of primary relationships per entity family.
 * Prevents over-assignment. Set to 2 to force specificity.
 */
const MAX_PRIMARY_PER_FAMILY = 2;

/**
 * Score thresholds for relationship ranking.
 */
const RANK_THRESHOLDS = {
  primary: 55,
  secondary: 40,
  tertiary: 30,
};

/**
 * Classify a lane's authority relationships.
 *
 * @param {object} profile - Output of buildClassificationProfile()
 * @returns {object} Classification result
 *   {
 *     lane_slug: string,
 *     relationships: Array<{
 *       entity_id: string,
 *       entity_family: string,
 *       score: number,
 *       rank: "primary"|"secondary"|"tertiary",
 *       evidence: Array<{ rule, signal, weight }>,
 *       blocked: boolean,
 *       block_reason: string|null,
 *     }>,
 *     summary: { total, primary, secondary, tertiary, blocked },
 *   }
 */
export function classifyLaneAuthority(profile) {
  const relationships = [];

  // Evaluate solution rules
  for (const [entityId, rule] of Object.entries(SOLUTION_RULES)) {
    const result = rule.evaluate(profile);
    relationships.push({
      entity_id: entityId,
      entity_family: "solution",
      score: result.score,
      rank: scoreToRank(result.score),
      evidence: result.evidence,
      blocked: result.score < MIN_RELATIONSHIP_SCORE,
      block_reason: result.score < MIN_RELATIONSHIP_SCORE
        ? `Score ${result.score} below minimum ${MIN_RELATIONSHIP_SCORE}`
        : null,
    });
  }

  // Evaluate concept rules
  for (const [entityId, rule] of Object.entries(CONCEPT_RULES)) {
    const result = rule.evaluate(profile);
    relationships.push({
      entity_id: entityId,
      entity_family: "concept",
      score: result.score,
      rank: scoreToRank(result.score),
      evidence: result.evidence,
      blocked: result.score < MIN_RELATIONSHIP_SCORE,
      block_reason: result.score < MIN_RELATIONSHIP_SCORE
        ? `Score ${result.score} below minimum ${MIN_RELATIONSHIP_SCORE}`
        : null,
    });
  }

  // Evaluate equipment rules
  for (const [entityId, rule] of Object.entries(EQUIPMENT_RULES)) {
    const result = rule.evaluate(profile);
    relationships.push({
      entity_id: entityId,
      entity_family: "equipment",
      score: result.score,
      rank: scoreToRank(result.score),
      evidence: result.evidence,
      blocked: result.score < MIN_RELATIONSHIP_SCORE,
      block_reason: result.score < MIN_RELATIONSHIP_SCORE
        ? `Score ${result.score} below minimum ${MIN_RELATIONSHIP_SCORE}`
        : null,
    });
  }

  // Apply over-assignment gate per family
  applyOverAssignmentGate(relationships);

  // Sort by score descending
  relationships.sort((a, b) => b.score - a.score);

  // Compute summary
  const active = relationships.filter(r => !r.blocked);
  const summary = {
    total: relationships.length,
    active: active.length,
    blocked: relationships.filter(r => r.blocked).length,
    primary: active.filter(r => r.rank === "primary").length,
    secondary: active.filter(r => r.rank === "secondary").length,
    tertiary: active.filter(r => r.rank === "tertiary").length,
  };

  return {
    lane_slug: profile.slug,
    mode: profile.mode,
    distance_band: profile.distance_band,
    archetype: profile.archetype,
    corridor_id: profile.corridor_id,
    relationships,
    summary,
  };
}

function scoreToRank(score) {
  if (score >= RANK_THRESHOLDS.primary) return "primary";
  if (score >= RANK_THRESHOLDS.secondary) return "secondary";
  if (score >= RANK_THRESHOLDS.tertiary) return "tertiary";
  return "tertiary";
}

/**
 * Apply over-assignment gate: if too many primaries in one family,
 * downgrade the weakest to secondary.
 */
function applyOverAssignmentGate(relationships) {
  const families = ["solution", "concept", "equipment"];
  for (const family of families) {
    const familyRels = relationships
      .filter(r => r.entity_family === family && !r.blocked && r.rank === "primary")
      .sort((a, b) => b.score - a.score);

    if (familyRels.length > MAX_PRIMARY_PER_FAMILY) {
      for (let i = MAX_PRIMARY_PER_FAMILY; i < familyRels.length; i++) {
        familyRels[i].rank = "secondary";
        familyRels[i].evidence.push({
          rule: "over_assignment_gate",
          signal: `demoted_from_primary_excess_${family}`,
          weight: 0,
        });
      }
    }
  }
}

// ── Exports for testing ──────────────────────────────────────────────

export const _SOLUTION_RULES = SOLUTION_RULES;
export const _CONCEPT_RULES = CONCEPT_RULES;
export const _EQUIPMENT_RULES = EQUIPMENT_RULES;
export const _MIN_RELATIONSHIP_SCORE = MIN_RELATIONSHIP_SCORE;
export const _RANK_THRESHOLDS = RANK_THRESHOLDS;
