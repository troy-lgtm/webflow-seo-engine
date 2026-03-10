/**
 * Layer 5: Corridor-First Internal Linking
 *
 * Every lane page belongs to exactly one corridor cluster.
 * Corridor assignment drives internal linking, hub pages, and crawl budget.
 */

import { stableHash } from "@/lib/hash";
import { laneSlug } from "@/lib/url-discipline";

// ── Corridor Registry ────────────────────────────────────────────────

let _corridorsCache = null;

function loadCorridorsData() {
  if (_corridorsCache) return _corridorsCache;
  try {
    // eslint-disable-next-line
    _corridorsCache = require("@/../data/corridors.json");
  } catch {
    _corridorsCache = { corridors: [] };
  }
  return _corridorsCache;
}

/**
 * Load all corridors from the registry.
 * @returns {object[]} Array of corridor objects
 */
export function loadCorridors() {
  return loadCorridorsData().corridors || [];
}

/**
 * Get a corridor by its ID.
 * @param {string} id
 * @returns {object|null}
 */
export function getCorridorById(id) {
  return loadCorridors().find(c => c.id === id) || null;
}

// ── City Matching Helpers ────────────────────────────────────────────

/**
 * Normalize a city name for cluster matching.
 * Extracts just the city name (before comma), lowercased, trimmed.
 */
function normCityForMatch(name) {
  return String(name || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Check if a city name matches any entry in a cluster.
 */
function cityInCluster(cityName, cluster) {
  const norm = normCityForMatch(cityName);
  if (!norm) return false;
  for (const clusterCity of cluster) {
    if (normCityForMatch(clusterCity) === norm) return true;
  }
  return false;
}

// ── Corridor Assignment ──────────────────────────────────────────────

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Assign a lane to a corridor.
 *
 * Rules:
 * 1. Match origin against origin_cluster AND destination against destination_cluster
 * 2. Also match reversed (origin↔destination) — corridors are bidirectional
 * 3. If multiple match: pick highest priority → smallest combined cluster size → deterministic hash
 * 4. If zero match: assign to "other" corridor
 *
 * @param {{ originCity: string, destinationCity: string, originState?: string, destinationState?: string }} lane
 * @returns {{ corridor: object, matchType: string, matchScore: number }}
 */
export function assignCorridorToLane({ originCity, destinationCity, originState, destinationState, originSlug, destSlug }) {
  const corridors = loadCorridors();
  const matches = [];

  const fullOrigin = originState ? `${originCity}, ${originState}` : originCity;
  const fullDest = destinationState ? `${destinationCity}, ${destinationState}` : destinationCity;

  for (const corridor of corridors) {
    if (corridor.id === "other") continue;

    // Forward match: origin in origin_cluster AND dest in dest_cluster
    const forwardOrigin = cityInCluster(fullOrigin, corridor.origin_cluster) || cityInCluster(originCity, corridor.origin_cluster);
    const forwardDest = cityInCluster(fullDest, corridor.destination_cluster) || cityInCluster(destinationCity, corridor.destination_cluster);

    // Reverse match: origin in dest_cluster AND dest in origin_cluster
    const reverseOrigin = cityInCluster(fullOrigin, corridor.destination_cluster) || cityInCluster(originCity, corridor.destination_cluster);
    const reverseDest = cityInCluster(fullDest, corridor.origin_cluster) || cityInCluster(destinationCity, corridor.origin_cluster);

    // Intra-corridor match: both cities in either cluster (for regional corridors like Texas Triangle)
    const originInAny = forwardOrigin || reverseOrigin;
    const destInAny = forwardDest || reverseDest;

    let matchType = null;
    if (forwardOrigin && forwardDest) matchType = "forward";
    else if (reverseOrigin && reverseDest) matchType = "reverse";
    else if (originInAny && destInAny) matchType = "intra";

    if (matchType) {
      const clusterSize = corridor.origin_cluster.length + corridor.destination_cluster.length;
      const priorityScore = PRIORITY_RANK[corridor.priority] || 0;
      matches.push({
        corridor,
        matchType,
        priorityScore,
        clusterSize,
        // Deterministic tiebreaker
        tiebreaker: stableHash(`${corridor.id}|${originCity}|${destinationCity}`),
      });
    }
  }

  if (matches.length === 0) {
    // Assign to "other"
    const other = corridors.find(c => c.id === "other") || {
      id: "other", name: "Other Freight Lanes", origin_cluster: [], destination_cluster: [], priority: "low"
    };
    return { corridor: other, matchType: "fallback", matchScore: 0 };
  }

  // Sort: highest priority → smallest cluster → deterministic tiebreaker
  matches.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    if (a.clusterSize !== b.clusterSize) return a.clusterSize - b.clusterSize;
    return a.tiebreaker - b.tiebreaker;
  });

  const best = matches[0];
  return {
    corridor: best.corridor,
    matchType: best.matchType,
    matchScore: best.priorityScore,
  };
}

// ── Corridor Lane Candidates ─────────────────────────────────────────

/**
 * List all potential lane candidates for a corridor based on its clusters.
 * Returns an array of { origin, destination, slug } objects.
 *
 * @param {string} corridorId
 * @returns {object[]}
 */
export function listCorridorLaneCandidates(corridorId) {
  const corridor = getCorridorById(corridorId);
  if (!corridor || corridor.id === "other") return [];

  const candidates = [];
  const origins = corridor.origin_cluster;
  const destinations = corridor.destination_cluster;

  // Generate all non-self origin→destination pairs
  for (const o of origins) {
    for (const d of destinations) {
      if (normCityForMatch(o) === normCityForMatch(d)) continue;
      candidates.push({
        origin: o,
        destination: d,
        slug: laneSlug({ originCity: o, destinationCity: d }),
      });
    }
  }

  // Also generate reverse pairs (destination→origin)
  for (const d of destinations) {
    for (const o of origins) {
      if (normCityForMatch(o) === normCityForMatch(d)) continue;
      const slug = laneSlug({ originCity: d, destinationCity: o });
      if (!candidates.some(c => c.slug === slug)) {
        candidates.push({ origin: d, destination: o, slug });
      }
    }
  }

  return candidates;
}

// ── Internal Link Generation ─────────────────────────────────────────

let _configCache = null;

function loadConfig() {
  if (_configCache) return _configCache;
  try {
    // eslint-disable-next-line
    _configCache = require("@/../config/seo-engine.json");
  } catch {
    _configCache = {
      internalLinking: { minRelatedLanes: 5, maxRelatedLanes: 12 },
      toolPages: [],
    };
  }
  return _configCache;
}

/**
 * Select the best tool page for a lane based on mode and page type.
 *
 * @param {{ mode: string, pageType?: string }} params
 * @returns {{ id: string, url: string, text: string }|null}
 */
export function selectToolPage({ mode, pageType }) {
  const config = loadConfig();
  const tools = config.toolPages || [];
  const intent = pageType === "lane_data" ? "data" : "conversion";

  // Filter matching tools
  const candidates = tools.filter(t => {
    if (t.matchModes && !t.matchModes.includes(mode)) return false;
    if (t.pageTypes && !t.pageTypes.includes(pageType || "lane_service")) return false;
    return true;
  });

  // Prefer conversion intent
  const sorted = candidates.sort((a, b) => {
    if (a.intent === intent && b.intent !== intent) return -1;
    if (b.intent === intent && a.intent !== intent) return 1;
    return 0;
  });

  const selected = sorted[0];
  if (!selected) {
    // Fallback to freight quote
    return { id: "freight-quote", url: "/public/freight-quote", text: "Get Freight Quote" };
  }

  const labels = {
    "freight-quote": "Get Freight Quote",
    "ltl-class-calculator": "LTL Freight Class Calculator",
    "ltl-rfp": "LTL RFP Builder",
  };

  return {
    id: selected.id,
    url: selected.url,
    text: labels[selected.id] || selected.id,
  };
}

/**
 * Generate the internal links block for a lane page.
 *
 * Returns:
 * {
 *   corridorHub: { href, text },
 *   relatedLanes: [{ href, text, reason }],
 *   toolLink: { href, text },
 *   dataPageLink: { href, text } | null,
 *   corridorExplainer: { href, text }
 * }
 *
 * @param {{ lane: object, corridor: object, allPages?: object[], demandSignals?: object, hasLaneData?: boolean }} params
 */
export function generateCorridorLinks({ lane, corridor, allPages, demandSignals, hasLaneData }) {
  const config = loadConfig();
  const minRelated = config.internalLinking?.minRelatedLanes || 5;
  const maxRelated = config.internalLinking?.maxRelatedLanes || 12;
  const mode = lane.mode || "LTL";

  // 1. Corridor hub link
  const corridorHub = {
    href: `/corridors/${corridor.id}`,
    text: corridor.name,
  };

  // 2. Corridor explainer
  const corridorExplainer = {
    href: `/corridors/${corridor.id}/how-warp-runs-this-corridor`,
    text: `How Warp Runs the ${corridor.name}`,
  };

  // 3. Related lanes within this corridor
  const relatedLanes = selectRelatedLanes({
    lane, corridor, allPages: allPages || [], demandSignals, minRelated, maxRelated,
  });

  // 4. Tool page
  const toolLink = selectToolPage({ mode, pageType: "lane_service" });

  // 5. Data page (only if eligible)
  let dataPageLink = null;
  if (hasLaneData) {
    const slug = laneSlug({
      originCity: lane.origin || lane.originCity,
      destinationCity: lane.destination || lane.destinationCity,
    });
    if (slug) {
      dataPageLink = {
        href: `/data/${slug}`,
        text: `${(lane.origin || lane.originCity || "").split(",")[0]} to ${(lane.destination || lane.destinationCity || "").split(",")[0]} Lane Data`,
      };
    }
  }

  return {
    corridorHub,
    corridorExplainer,
    relatedLanes,
    toolLink,
    dataPageLink,
  };
}

/**
 * Select related lanes within the same corridor.
 * Priority: demand signals → shared origin → shared destination → deterministic fill.
 */
function selectRelatedLanes({ lane, corridor, allPages, demandSignals, minRelated, maxRelated }) {
  const thisSlug = laneSlug({
    originCity: lane.origin || lane.originCity,
    destinationCity: lane.destination || lane.destinationCity,
  });

  // Get all corridor lane candidates
  const candidates = listCorridorLaneCandidates(corridor.id)
    .filter(c => c.slug !== thisSlug);

  if (candidates.length === 0) return [];

  // Score each candidate
  const originCity = normCityForMatch(lane.origin || lane.originCity);
  const destCity = normCityForMatch(lane.destination || lane.destinationCity);

  const scored = candidates.map(c => {
    let score = 0;
    const cOrigin = normCityForMatch(c.origin);
    const cDest = normCityForMatch(c.destination);

    // Demand signal boost
    const demand = demandSignals || {};
    if (demand.gsc?.[c.slug]) score += 30;
    if (demand.keywords?.[c.slug]) score += 20;
    if (demand.portal?.[c.slug]) score += 25;

    // Shared city boost
    if (cOrigin === originCity) score += 15;
    if (cDest === destCity) score += 15;
    if (cOrigin === destCity || cDest === originCity) score += 10; // reverse partial

    // Deterministic tiebreaker
    score += (stableHash(`${thisSlug}|${c.slug}`) % 10);

    return { ...c, score };
  });

  // Sort by score descending, take between min and max
  scored.sort((a, b) => b.score - a.score);
  const count = Math.min(Math.max(minRelated, Math.min(scored.length, maxRelated)), scored.length);

  return scored.slice(0, count).map(c => ({
    href: `/lanes/${c.slug}`,
    text: `${c.origin} to ${c.destination} Freight`,
    reason: c.score >= 30 ? "high_demand" : c.score >= 15 ? "shared_cluster" : "corridor_member",
  }));
}
