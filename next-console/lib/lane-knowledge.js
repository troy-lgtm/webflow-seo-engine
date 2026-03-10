/**
 * Lane Knowledge Layer — WARP SEO Engine
 *
 * Consolidates all lane intelligence logic previously inlined across publish
 * scripts into a single reusable module. Builds full lane knowledge objects
 * for any origin/destination/mode combination.
 *
 * Works with both Next.js (@/ alias) AND raw Node.js scripts (relative imports)
 * by resolving data file paths via import.meta.url + fileURLToPath.
 *
 * @module lane-knowledge
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, "..", "data");

// ── Lazy-loaded data files ──────────────────────────────────────────
let _cities = null;
let _hubs = null;
function loadCities() {
  if (!_cities) _cities = JSON.parse(readFileSync(join(DATA_DIR, "cities.json"), "utf-8"));
  return _cities;
}
function loadHubs() {
  if (!_hubs) _hubs = JSON.parse(readFileSync(join(DATA_DIR, "hubs.json"), "utf-8"));
  return _hubs;
}

// ── Freight Intelligence Constants ──────────────────────────────────
const ROAD_MULTIPLIER = 1.18; // straight-line -> road-miles multiplier

/** Transit bands by mode: [maxDistance, minDays, maxDays]. First match wins. */
const TRANSIT_BANDS = {
  LTL:    [[300,1,2],[600,2,3],[1000,3,4],[1500,4,5],[Infinity,5,7]],
  FTL:    [[400,1,1],[800,1,2],[1500,2,3],[2500,3,4],[Infinity,4,6]],
  "Cargo Van / Box Truck": [[300,1,2],[700,2,3],[1200,3,4],[2000,4,5],[Infinity,5,7]],
};
const RATE_PER_MILE = { LTL: [2.60, 5.20], FTL: [1.90, 3.60], "Cargo Van / Box Truck": [1.70, 3.40] }; // [low, high] USD/mi
const MIN_RATE = { LTL: 250, FTL: 600, "Cargo Van / Box Truck": 350 }; // floor USD
const ACCESSORIAL_PCT = { LTL: 0.20, FTL: 0.12, "Cargo Van / Box Truck": 0.15 }; // buffer %
const CARRIER_COUNT = { LTL: [4, 8], FTL: [10, 25], "Cargo Van / Box Truck": [3, 5] }; // [base, range]
const EQUIPMENT_TYPES = {
  LTL: ["Dry Van", "Reefer (temp-controlled)"],
  FTL: ["Dry Van 53'", "Flatbed 48'", "Reefer 53'"],
  "Cargo Van / Box Truck": ["Cargo Van", "Box Truck 26'"],
};
/** Seasonal freight notes by geographic region. */
const SEASONALITY = {
  "West Coast":        "Peak volumes Aug-Oct (produce season). Rate pressure Dec-Jan.",
  "Pacific Northwest": "Steady volumes with produce season lift Jun-Sep. Winter weather delays possible.",
  "Southwest":         "Consistent year-round. Slight peak during holiday retail season Oct-Dec.",
  "South Central":     "Hurricane season Jun-Nov can disrupt Gulf lanes. Peak retail Oct-Dec.",
  "Midwest":           "Winter weather impacts Dec-Feb. Agricultural peaks Jul-Oct.",
  "Southeast":         "Hurricane risk Jun-Nov. Consistent retail demand year-round.",
  "Northeast":         "Congestion peaks around holidays. Winter weather Dec-Mar.",
  "Mountain":          "Winter weather impacts mountain passes Dec-Mar. Steady otherwise.",
};
/** Shipment profile fit, equipment fit, operational, and pricing descriptors by mode. */
const SHIPMENT_PROFILES = {
  LTL:    ["palletized freight", "scheduled replenishment", "appointment-driven freight"],
  FTL:    ["full truckload shipments", "high-volume dedicated capacity", "dedicated fleet freight"],
  "Cargo Van / Box Truck": ["right-sized smaller loads", "last-mile delivery freight", "expedited local shipments"],
};
const EQUIPMENT_FIT = {
  LTL:    ["palletized LTL", "cargo van or box truck for local pickup and delivery"],
  FTL:    ["full truckload 53' trailers", "flatbed for oversized", "reefer for temp-controlled"],
  "Cargo Van / Box Truck": ["cargo vans for small freight", "box trucks 16'-26' for mid-size loads"],
};
const OPERATIONAL_CHARS = {
  LTL:    ["cross-dock routing", "flexible local fleet", "retail and store replenishment fit", "scheduled pickup coordination", "visibility and live tracking"],
  FTL:    ["dedicated point-to-point routing", "no terminal handling delays", "GPS-equipped trailer tracking"],
  "Cargo Van / Box Truck": ["right-sized vehicle selection", "direct delivery without terminal stops", "flexible pickup and delivery windows"],
};
const PRICING_LOGIC = {
  LTL:    ["per pallet economics", "volume consistency improves planning", "transparent quoting"],
  FTL:    ["flat per-truck pricing", "lane commitment discounts", "market-rate visibility"],
  "Cargo Van / Box Truck": ["right-sized pricing for smaller freight", "no wasted trailer space", "predictable per-shipment cost"],
};

// ── Utility Functions ───────────────────────────────────────────────
/** Stable djb2 string hash. Same input always produces the same integer. */
function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
/** Seeded PRNG (linear congruential). Deterministic sequence from a seed. */
function seededRng(seed) {
  let s = (seed | 0) || 1;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
/** Haversine distance in statute miles between two lat/lon points. */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
/**
 * Look up a city in cities.json. Supports "Miami, FL" and "Miami" forms.
 * @param {string} name
 * @param {object} [citiesOverride] — optional cities dataset (for enrichLaneKnowledge)
 * @returns {{ lat: number, lon: number, region: string } | null}
 */
function lookupCity(name, citiesOverride) {
  const cities = citiesOverride || loadCities();
  const key = String(name || "").toLowerCase().trim();
  if (cities[key]) return cities[key];
  const noState = key.replace(/,\s*[a-z]{2}$/, "").trim();
  for (const [k, v] of Object.entries(cities)) { if (k.startsWith(noState)) return v; }
  return null;
}
/** Find nearest hub/cross-dock facilities to a lat/lon by mode. */
function nearestHubs(lat, lon, mode, count = 5, hubsOverride) {
  const hubs = hubsOverride || loadHubs();
  return hubs
    .filter((h) => h.modes.includes(mode))
    .map((h) => ({ ...h, dist: haversine(lat, lon, h.lat, h.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map((h) => h.name);
}
/** Classify road distance into a named band. */
function classifyDistanceBand(miles) {
  if (miles < 300) return "short_haul";
  if (miles <= 800) return "medium_haul";
  if (miles <= 1200) return "regional";
  return "long_haul";
}
// ── Slug / city helpers ─────────────────────────────────────────────
function citySlug(city) {
  return String(city || "").split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function extractState(city) {
  const m = String(city || "").match(/,\s*([A-Za-z]{2})\s*$/);
  return m ? m[1].toUpperCase() : null;
}
function displayCity(city) { return String(city || "").split(",")[0].trim(); }

/** Core computation used by buildLaneKnowledge and enrichLaneKnowledge. */
function computeLaneStats(origin, destination, modeKey, oCity, dCity, hubsOverride) {
  const oRegion = oCity?.region || "Unknown";
  const dRegion = dCity?.region || "Unknown";
  const straightLine = oCity && dCity ? haversine(oCity.lat, oCity.lon, dCity.lat, dCity.lon) : 600;
  const roadMiles = Math.round(straightLine * ROAD_MULTIPLIER);
  const rng = seededRng(stableHash(`${origin}|${destination}|${modeKey}`));

  // Transit
  const bands = TRANSIT_BANDS[modeKey] || TRANSIT_BANDS.LTL;
  let tMin = 3, tMax = 5;
  for (const [maxDist, bMin, bMax] of bands) { if (roadMiles <= maxDist) { tMin = bMin; tMax = bMax; break; } }

  // Rate
  const [rpmLow, rpmHigh] = RATE_PER_MILE[modeKey] || RATE_PER_MILE.LTL;
  const rateBase = rpmLow + rng() * (rpmHigh - rpmLow);
  const buf = ACCESSORIAL_PCT[modeKey] || 0.15;
  let rateLow = Math.round(rateBase * roadMiles * (1 - buf / 2));
  let rateHigh = Math.round(rateBase * roadMiles * (1 + buf));
  const floor = MIN_RATE[modeKey] || 250;
  rateLow = Math.max(floor, rateLow); rateHigh = Math.max(rateLow + 50, rateHigh);

  // Carriers & cross-docks
  const [cBase, cRange] = CARRIER_COUNT[modeKey] || [4, 8];
  const carrierCount = cBase + Math.floor(rng() * cRange);
  const oHubs = oCity ? nearestHubs(oCity.lat, oCity.lon, modeKey, 3, hubsOverride) : [];
  const dHubs = dCity ? nearestHubs(dCity.lat, dCity.lon, modeKey, 2, hubsOverride) : [];
  const crossDocks = [...new Set([...oHubs, ...dHubs])].slice(0, 5);

  const equipment = EQUIPMENT_TYPES[modeKey] || EQUIPMENT_TYPES.LTL;
  const seasonality = SEASONALITY[oRegion] || SEASONALITY[dRegion] || "Contact for seasonal lane guidance.";
  const serviceNotes = [
    "Real-time scan events at pickup, in-transit, and delivery",
    `Estimated ${tMin}-${tMax} business day transit window`,
    modeKey === "LTL" ? "Pallet-level tracking with delivery appointment scheduling" : "GPS-equipped trailers with live ETA updates",
    "Exception alerts within 30 minutes of status change",
  ];

  return { roadMiles, tMin, tMax, rateLow, rateHigh, carrierCount, crossDocks, equipment, seasonality, serviceNotes, oRegion, dRegion };
}

/**
 * Build a complete lane knowledge object from an origin/destination/mode triple.
 * Primary entry point. Returns all intelligence needed for page generation,
 * publishing, and validation.
 *
 * @param {{ origin: string, destination: string, mode: string }} lane
 * @returns {object} full lane knowledge object
 */
export function buildLaneKnowledge(lane) {
  const { origin, destination, mode } = lane;
  const modeKey = mode === "Cargo Van / Box Truck" ? "Cargo Van / Box Truck" : mode === "FTL" ? "FTL" : "LTL";
  const oCity = lookupCity(origin);
  const dCity = lookupCity(destination);
  const s = computeLaneStats(origin, destination, modeKey, oCity, dCity);
  const slug = `${citySlug(origin)}-to-${citySlug(destination)}`;
  const oName = displayCity(origin), dName = displayCity(destination);

  return {
    lane_slug: slug,
    origin_city: oName, origin_state: extractState(origin),
    destination_city: dName, destination_state: extractState(destination),
    canonical_path: `/lanes/${slug}`, corridor_id: null, mode: modeKey,
    region_profile: { origin: s.oRegion, destination: s.dRegion },
    distance_band: classifyDistanceBand(s.roadMiles),
    lane_stats: {
      estimated_distance_miles: s.roadMiles,
      estimated_transit_days_range: { min: s.tMin, max: s.tMax },
      estimated_rate_range_usd: { low: s.rateLow, high: s.rateHigh },
      common_equipment: s.equipment, seasonality_notes: s.seasonality,
      confidence: { transit: "modeled", rate: "modeled" },
      disclaimers: [
        "These are modeled estimates, not guaranteed quotes.",
        "Actual rates depend on freight details, accessorials, and current market conditions.",
      ],
    },
    network_proof: {
      estimated_carrier_count: s.carrierCount, nearest_cross_docks: s.crossDocks,
      service_notes: s.serviceNotes, origin_region: s.oRegion, destination_region: s.dRegion,
    },
    shipment_profile_fit: SHIPMENT_PROFILES[modeKey] || SHIPMENT_PROFILES.LTL,
    equipment_fit: EQUIPMENT_FIT[modeKey] || EQUIPMENT_FIT.LTL,
    operational_characteristics: OPERATIONAL_CHARS[modeKey] || OPERATIONAL_CHARS.LTL,
    pricing_logic: PRICING_LOGIC[modeKey] || PRICING_LOGIC.LTL,
    faq_seeds: [
      { q: `How long does ${modeKey} freight take from ${oName} to ${dName}?`,
        a: `Estimated transit is ${s.tMin}-${s.tMax} business days on this ~${s.roadMiles.toLocaleString()}-mile lane. Actual times depend on carrier routing and weather.` },
      { q: `How much does ${modeKey} shipping from ${oName} to ${dName} cost?`,
        a: `Modeled ${modeKey} rates range from $${s.rateLow.toLocaleString()} to $${s.rateHigh.toLocaleString()} depending on freight details. Get an instant quote for real-time pricing.` },
      { q: `What equipment is available on the ${oName} to ${dName} lane?`,
        a: `Common equipment includes ${s.equipment.join(", ")}. Availability varies by season and demand.` },
      { q: `Can we start with just this lane before expanding?`,
        a: `Yes. A single-lane pilot lets you validate performance before committing to additional corridors.` },
      { q: `How does WARP handle exceptions on this ${modeKey} lane?`,
        a: `WARP detects exceptions automatically with alerts within 30 minutes of any status change.` },
    ],
    related_corridor_logic: {
      corridor_hub: null, related_lane_count_target: 8,
      tool_link: "/public/freight-quote", data_link: null,
    },
  };
}

/**
 * Enrich a lane knowledge object using externally-provided city and hub datasets
 * instead of reading from disk. Recomputes distance, transit, rates, carriers,
 * and cross-docks against the supplied data.
 *
 * @param {{ origin: string, destination: string, mode: string }} lane
 * @param {object} cityData — cities keyed by normalized name
 * @param {object[]} hubsData — array of hub objects
 * @returns {object} enriched lane knowledge object
 */
export function enrichLaneKnowledge(lane, cityData, hubsData) {
  const { origin, destination, mode } = lane;
  const modeKey = mode === "Cargo Van / Box Truck" ? "Cargo Van / Box Truck" : mode === "FTL" ? "FTL" : "LTL";
  const oCity = lookupCity(origin, cityData);
  const dCity = lookupCity(destination, cityData);
  const knowledge = buildLaneKnowledge(lane);
  const s = computeLaneStats(origin, destination, modeKey, oCity, dCity, hubsData);

  knowledge.region_profile = { origin: s.oRegion, destination: s.dRegion };
  knowledge.distance_band = classifyDistanceBand(s.roadMiles);
  knowledge.lane_stats.estimated_distance_miles = s.roadMiles;
  knowledge.lane_stats.estimated_transit_days_range = { min: s.tMin, max: s.tMax };
  knowledge.lane_stats.estimated_rate_range_usd = { low: s.rateLow, high: s.rateHigh };
  knowledge.lane_stats.seasonality_notes = s.seasonality;
  knowledge.network_proof = {
    estimated_carrier_count: s.carrierCount, nearest_cross_docks: s.crossDocks,
    service_notes: s.serviceNotes, origin_region: s.oRegion, destination_region: s.dRegion,
  };
  return knowledge;
}

/**
 * Convenience: parse a lane slug (e.g. "miami-to-atlanta") and build knowledge.
 * @param {string} laneSlug
 * @param {string} [mode="LTL"]
 * @returns {object} lane knowledge object
 */
export function getLaneKnowledgeForSlug(laneSlug, mode = "LTL") {
  const parts = String(laneSlug || "").split("-to-");
  if (parts.length < 2) return buildLaneKnowledge({ origin: laneSlug, destination: laneSlug, mode });
  const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  const originRaw = parts[0].replace(/-/g, " ").trim();
  const destRaw = parts.slice(1).join("-to-").replace(/-/g, " ").trim();
  return buildLaneKnowledge({ origin: cap(originRaw), destination: cap(destRaw), mode });
}

/**
 * Validate that a lane knowledge object has all required fields with correct types.
 * @param {object} knowledge
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateLaneKnowledge(knowledge) {
  const errors = [];
  if (!knowledge) return { valid: false, errors: ["Knowledge object is null or undefined."] };

  // Required strings
  for (const f of ["lane_slug", "origin_city", "destination_city", "canonical_path", "mode"]) {
    if (!knowledge[f] || typeof knowledge[f] !== "string" || !knowledge[f].trim()) errors.push(`Missing or empty: ${f}`);
  }
  // Enums
  if (!["short_haul", "medium_haul", "regional", "long_haul"].includes(knowledge.distance_band))
    errors.push(`Invalid distance_band: "${knowledge.distance_band}"`);
  if (!["LTL", "FTL", "Cargo Van / Box Truck"].includes(knowledge.mode))
    errors.push(`Invalid mode: "${knowledge.mode}"`);

  // Lane stats
  const st = knowledge.lane_stats;
  if (!st) { errors.push("Missing lane_stats."); }
  else {
    if (typeof st.estimated_distance_miles !== "number" || st.estimated_distance_miles <= 0)
      errors.push("lane_stats.estimated_distance_miles must be a positive number.");
    if (!st.estimated_transit_days_range?.min || !st.estimated_transit_days_range?.max)
      errors.push("lane_stats.estimated_transit_days_range must have min and max.");
    if (!st.estimated_rate_range_usd?.low || !st.estimated_rate_range_usd?.high)
      errors.push("lane_stats.estimated_rate_range_usd must have low and high.");
    else if (st.estimated_rate_range_usd.low >= st.estimated_rate_range_usd.high)
      errors.push("lane_stats rate low must be less than high.");
    if (!Array.isArray(st.common_equipment) || !st.common_equipment.length)
      errors.push("lane_stats.common_equipment must be a non-empty array.");
    if (!st.seasonality_notes) errors.push("lane_stats.seasonality_notes is missing.");
    if (!st.confidence?.transit || !st.confidence?.rate) errors.push("lane_stats.confidence must include transit and rate.");
    if (!Array.isArray(st.disclaimers) || !st.disclaimers.length) errors.push("lane_stats.disclaimers must be non-empty.");
  }
  // Network proof
  const np = knowledge.network_proof;
  if (!np) { errors.push("Missing network_proof."); }
  else {
    if (typeof np.estimated_carrier_count !== "number" || np.estimated_carrier_count < 1) errors.push("network_proof.estimated_carrier_count must be >= 1.");
    if (!Array.isArray(np.nearest_cross_docks)) errors.push("network_proof.nearest_cross_docks must be an array.");
    if (!Array.isArray(np.service_notes) || !np.service_notes.length) errors.push("network_proof.service_notes must be non-empty.");
  }
  // Region profile
  if (!knowledge.region_profile?.origin || !knowledge.region_profile?.destination)
    errors.push("region_profile must include origin and destination.");
  // Required non-empty arrays
  for (const f of ["shipment_profile_fit", "equipment_fit", "operational_characteristics", "pricing_logic", "faq_seeds"]) {
    if (!Array.isArray(knowledge[f]) || !knowledge[f].length) errors.push(`${f} must be a non-empty array.`);
  }
  if (!knowledge.related_corridor_logic) errors.push("Missing related_corridor_logic.");

  return { valid: errors.length === 0, errors };
}
