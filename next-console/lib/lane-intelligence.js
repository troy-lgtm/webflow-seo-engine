import hubs from "@/data/hubs.json";
import { rngFromKey } from "@/lib/hash";
import { lookupCity, haversine } from "@/lib/geo";
import { buildEstimate, laneKey } from "@/lib/estimate-model";
import { CARRIER_COUNT } from "@/lib/estimate-config";

function nearestHubs(lat, lon, mode, count = 5) {
  return hubs
    .filter((h) => h.modes.includes(mode))
    .map((h) => ({ ...h, dist: haversine(lat, lon, h.lat, h.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map((h) => h.name);
}

const equipment = {
  LTL: ["Dry Van", "Reefer (temp-controlled)"],
  FTL: ["Dry Van 53'", "Flatbed 48'", "Reefer 53'"],
  "Cargo Van / Box Truck": ["Cargo Van", "Box Truck 26'"]
};

const seasonalityByRegion = {
  "West Coast": "Peak volumes Aug-Oct (produce season). Rate pressure Dec-Jan.",
  "Pacific Northwest": "Steady volumes with produce season lift Jun-Sep. Winter weather delays possible.",
  "Southwest": "Consistent year-round. Slight peak during holiday retail season Oct-Dec.",
  "South Central": "Hurricane season Jun-Nov can disrupt Gulf lanes. Peak retail Oct-Dec.",
  "Midwest": "Winter weather impacts Dec-Feb. Agricultural peaks Jul-Oct.",
  "Southeast": "Hurricane risk Jun-Nov. Consistent retail demand year-round.",
  "Northeast": "Congestion peaks around holidays. Winter weather Dec-Mar.",
  "Mountain": "Winter weather impacts mountain passes Dec-Mar. Steady otherwise."
};

// Enriches a page object with lane_stats and network_proof using the estimate model.
// Accepts optional estimateInputs and quoteHistory to improve estimates.
export function enrichLane(page, estimateInputs, quoteHistory) {
  if (!page?.lane) return page;
  const { origin, destination, mode } = page.lane;
  const key = laneKey(origin, destination, mode);
  const rng = rngFromKey(key);

  const oCity = lookupCity(origin);
  const dCity = lookupCity(destination);
  const oRegion = oCity?.region || "Unknown";
  const dRegion = dCity?.region || "Unknown";

  // Build estimate using the model
  const estimate = buildEstimate({
    origin,
    destination,
    mode,
    segment: page.target_segment,
    pallet_count: estimateInputs?.pallet_count,
    weight_lbs: estimateInputs?.weight_lbs,
    freight_class: estimateInputs?.freight_class,
    quoteHistory: quoteHistory || null
  });

  // Freight class range (LTL only) for display
  const classOptions = [55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125];
  const classIdx = Math.floor(rng() * 4) + 2;
  const freightClassRange = mode === "LTL" ? { low: classOptions[classIdx - 1], high: classOptions[classIdx + 1] } : null;

  // Carrier count with mode-based ranges
  const [carrierBase, carrierRange] = CARRIER_COUNT[mode] || CARRIER_COUNT.LTL;
  const carrierCount = carrierBase + Math.floor(rng() * carrierRange);

  // Nearest cross-docks
  const oHubs = oCity ? nearestHubs(oCity.lat, oCity.lon, mode, 3) : [];
  const dHubs = dCity ? nearestHubs(dCity.lat, dCity.lon, mode, 2) : [];
  const crossDocks = [...new Set([...oHubs, ...dHubs])].slice(0, 5);

  const seasonality = seasonalityByRegion[oRegion] || seasonalityByRegion[dRegion] || "Contact for seasonal lane guidance.";

  const serviceNotes = [
    "Real-time scan events at pickup, in-transit, and delivery",
    `Estimated ${estimate.estimated_transit_days_range.min}-${estimate.estimated_transit_days_range.max} business day transit window`,
    mode === "LTL" ? "Pallet-level tracking with delivery appointment scheduling" : "GPS-equipped trailers with live ETA updates",
    "Exception alerts within 30 minutes of status change"
  ];

  page.lane_stats = {
    estimated_distance_miles: estimate.estimated_distance_miles,
    estimated_transit_days_range: estimate.estimated_transit_days_range,
    estimated_rate_range_usd: {
      low: estimate.estimated_rate_range_usd.low,
      high: estimate.estimated_rate_range_usd.high,
      disclaimer: estimate.disclaimers[0]
    },
    common_freight_class_range: freightClassRange,
    common_equipment: equipment[mode] || equipment.LTL,
    seasonality_notes: seasonality,
    // New fields from estimate model
    transit_time_estimate_label: estimate.transit_time_estimate_label,
    rate_estimate_label: estimate.rate_estimate_label,
    confidence: estimate.confidence,
    assumptions: estimate.assumptions,
    disclaimers: estimate.disclaimers
  };

  page.network_proof = {
    estimated_carrier_count: carrierCount,
    nearest_cross_docks: crossDocks,
    service_notes: serviceNotes,
    origin_region: oRegion,
    destination_region: dRegion
  };

  return page;
}
