// Generates content for freight reference index pages
// These pages serve as link hubs and backlink magnets

import cities from "@/data/cities.json";
import { TRANSIT_BANDS, RATE_PER_MILE, FREIGHT_CLASS_MULTIPLIER, MIN_RATE_USD, ACCESSORIAL_BUFFER_PCT } from "@/lib/estimate-config";

const cityList = Object.entries(cities).map(([key, val]) => ({
  name: key.split(",")[0]?.trim() || key,
  fullKey: key,
  ...val
})).sort((a, b) => a.name.localeCompare(b.name));

const REGIONS = [...new Set(Object.values(cities).map((c) => c.region))].sort();

// --- Freight Lanes Index ---
export function buildFreightLanesIndex() {
  const lanePairs = [];
  for (let i = 0; i < cityList.length; i++) {
    for (let j = 0; j < cityList.length; j++) {
      if (i === j) continue;
      lanePairs.push({
        origin: cityList[i].name,
        destination: cityList[j].name,
        origin_region: cityList[i].region,
        destination_region: cityList[j].region
      });
    }
  }

  const byRegion = {};
  REGIONS.forEach((r) => { byRegion[r] = []; });
  lanePairs.forEach((lp) => {
    if (byRegion[lp.origin_region]) {
      byRegion[lp.origin_region].push(lp);
    }
  });

  return {
    slug: "freight-lanes",
    title: "US Freight Lane Directory | WARP",
    h1: "Complete US Freight Lane Directory",
    description: "Browse freight lanes between major US cities. Compare LTL, FTL, and cargo van / box truck options with estimated rates and transit times.",
    total_lanes: lanePairs.length,
    total_cities: cityList.length,
    regions: REGIONS,
    cities: cityList.map((c) => ({ name: c.name, region: c.region })),
    lanes_by_region: Object.fromEntries(
      Object.entries(byRegion).map(([r, lanes]) => [r, lanes.slice(0, 20)])
    ),
    quick_answers: [
      { q: "How many freight lanes does WARP cover?", a: `WARP provides rate estimates and transit data for ${lanePairs.length}+ city-pair combinations across ${cityList.length} major US markets.` },
      { q: "What shipping modes are available?", a: "Every lane supports LTL (less-than-truckload), FTL (full truckload), and cargo van / box truck options with mode-specific pricing." },
      { q: "How are freight lane estimates calculated?", a: "Estimates use distance-based modeling with mode-specific rate-per-mile ranges, freight class adjustments, and accessorial buffers. All estimates are ranges, not guaranteed quotes." }
    ]
  };
}

// --- Freight Class Index ---
export function buildFreightClassIndex() {
  const classes = Object.entries(FREIGHT_CLASS_MULTIPLIER).map(([cls, mult]) => {
    const baseRate = RATE_PER_MILE.LTL;
    const lowRate = Math.round(baseRate.min * mult * 500); // 500 mile example
    const highRate = Math.round(baseRate.max * mult * 500);
    return {
      class: cls,
      multiplier: mult,
      density_range: classifyDensity(Number(cls)),
      example_rate_500mi: { low: Math.max(lowRate, MIN_RATE_USD.LTL), high: highRate },
      commodity_examples: getCommodityExamples(Number(cls))
    };
  });

  return {
    slug: "freight-class",
    title: "NMFC Freight Class Guide — Classes 50 to 500 | WARP",
    h1: "Freight Classification Guide: NMFC Classes 50-500",
    description: "Understand how NMFC freight classes affect LTL shipping rates. See pricing impact, density requirements, and commodity examples for every class from 50 to 500.",
    classes,
    quick_answers: [
      { q: "What is a freight class?", a: "Freight class is a standardized classification (NMFC) that categorizes commodities based on density, handling, stowability, and liability. Classes range from 50 (lowest cost) to 500 (highest cost)." },
      { q: "How does freight class affect shipping cost?", a: `Class 50 freight ships at roughly ${(FREIGHT_CLASS_MULTIPLIER["50"] * 100).toFixed(0)}% of the base rate, while Class 500 ships at ${(FREIGHT_CLASS_MULTIPLIER["500"] * 100).toFixed(0)}% — a ${((FREIGHT_CLASS_MULTIPLIER["500"] / FREIGHT_CLASS_MULTIPLIER["50"]) || 1).toFixed(1)}x pricing difference.` },
      { q: "What freight class is my shipment?", a: "Classification depends on commodity type, density (lbs per cubic foot), and special handling requirements. Use the NMFC tariff or consult your freight provider for exact classification." }
    ]
  };
}

// --- Accessorials Index ---
export function buildAccessorialsIndex() {
  const accessorials = [
    { code: "LIFTGATE_PU", name: "Liftgate Pickup", description: "Hydraulic liftgate at origin for freight without dock access.", typical_cost: "$50-$150", applies_to: ["LTL", "Cargo Van / Box Truck"] },
    { code: "LIFTGATE_DEL", name: "Liftgate Delivery", description: "Hydraulic liftgate at destination for locations without loading docks.", typical_cost: "$50-$150", applies_to: ["LTL", "Cargo Van / Box Truck"] },
    { code: "RESIDENTIAL_PU", name: "Residential Pickup", description: "Pickup from a residential address. May require smaller equipment.", typical_cost: "$75-$200", applies_to: ["LTL", "FTL", "Cargo Van / Box Truck"] },
    { code: "RESIDENTIAL_DEL", name: "Residential Delivery", description: "Delivery to a residential address with limited access.", typical_cost: "$75-$200", applies_to: ["LTL", "FTL", "Cargo Van / Box Truck"] },
    { code: "INSIDE_PU", name: "Inside Pickup", description: "Carrier enters the facility to retrieve freight beyond the dock.", typical_cost: "$75-$175", applies_to: ["LTL"] },
    { code: "INSIDE_DEL", name: "Inside Delivery", description: "Carrier places freight inside the facility past the receiving dock.", typical_cost: "$75-$175", applies_to: ["LTL"] },
    { code: "LIMITED_ACCESS", name: "Limited Access", description: "Locations with restricted vehicle access (construction sites, schools, etc.).", typical_cost: "$50-$150", applies_to: ["LTL", "FTL", "Cargo Van / Box Truck"] },
    { code: "APPOINTMENT", name: "Appointment Delivery", description: "Guaranteed delivery within a specific time window.", typical_cost: "$25-$75", applies_to: ["LTL", "FTL", "Cargo Van / Box Truck"] },
    { code: "SORT_SEG", name: "Sort and Segregate", description: "Carrier sorts and separates freight by PO or SKU at delivery.", typical_cost: "$25-$50 per unit", applies_to: ["LTL"] },
    { code: "PROTECT_FROM_FREEZE", name: "Protect from Freeze", description: "Temperature-controlled transit to prevent freezing.", typical_cost: "$100-$300", applies_to: ["LTL", "FTL"] },
    { code: "HAZMAT", name: "Hazardous Materials", description: "Special handling for hazmat shipments per DOT regulations.", typical_cost: "$50-$200", applies_to: ["LTL", "FTL"] },
    { code: "OVERLENGTH", name: "Overlength", description: "Freight exceeding standard pallet dimensions (typically >8ft).", typical_cost: "$50-$150 per unit", applies_to: ["LTL"] },
    { code: "NOTIFY", name: "Notify Before Delivery", description: "Carrier calls consignee before attempting delivery.", typical_cost: "$10-$25", applies_to: ["LTL", "Cargo Van / Box Truck"] },
    { code: "REDELIVERY", name: "Redelivery", description: "Second delivery attempt after failed first attempt.", typical_cost: "$75-$200", applies_to: ["LTL", "FTL", "Cargo Van / Box Truck"] }
  ];

  const bufferNote = `Base rate estimates include a ${Math.round(ACCESSORIAL_BUFFER_PCT.LTL * 100)}% accessorial buffer for LTL, ${Math.round(ACCESSORIAL_BUFFER_PCT.FTL * 100)}% for FTL, and ${Math.round(ACCESSORIAL_BUFFER_PCT["Cargo Van / Box Truck"] * 100)}% for cargo van / box truck.`;

  return {
    slug: "accessorials",
    title: "Freight Accessorial Charges Guide | WARP",
    h1: "Freight Accessorial Charges: Complete Reference",
    description: "Understand common freight accessorial charges, typical costs, and which shipping modes they apply to. Plan your shipment costs accurately.",
    accessorials,
    buffer_note: bufferNote,
    total_accessorials: accessorials.length,
    quick_answers: [
      { q: "What are freight accessorials?", a: "Accessorials are additional services beyond standard pickup and delivery. They include liftgate service, residential delivery, inside delivery, appointment scheduling, and hazmat handling." },
      { q: "How much do accessorials typically cost?", a: "Most accessorials range from $25-$200 each. Liftgate and residential charges are the most common, typically $50-$200. These charges are in addition to the base freight rate." },
      { q: "Are accessorials included in freight quotes?", a: `WARP rate estimates include a ${Math.round(ACCESSORIAL_BUFFER_PCT.LTL * 100)}% accessorial buffer in the rate range. For exact accessorial pricing, request a detailed quote with your specific requirements.` }
    ]
  };
}

// --- Transit Times Index ---
export function buildTransitTimesIndex() {
  const modes = ["LTL", "FTL", "Cargo Van / Box Truck"];
  const bands = Object.entries(TRANSIT_BANDS).map(([mode, ranges]) => ({
    mode,
    bands: ranges.map((r) => ({
      distance_label: r.maxMiles === Infinity ? `${r.minMiles}+ mi` : `${r.minMiles}-${r.maxMiles} mi`,
      min_miles: r.minMiles,
      max_miles: r.maxMiles,
      transit_min: r.minDays,
      transit_max: r.maxDays
    }))
  }));

  // Sample corridors with distances for reference
  const sampleCorridors = [
    { origin: "Los Angeles", destination: "Chicago", approx_miles: 2015 },
    { origin: "Dallas", destination: "Atlanta", approx_miles: 780 },
    { origin: "New York", destination: "Miami", approx_miles: 1280 },
    { origin: "Seattle", destination: "Denver", approx_miles: 1320 },
    { origin: "Houston", destination: "Phoenix", approx_miles: 1175 },
    { origin: "Chicago", destination: "Nashville", approx_miles: 470 }
  ];

  return {
    slug: "transit-times",
    title: "Freight Transit Time Estimates by Mode and Distance | WARP",
    h1: "Freight Transit Time Guide: LTL, FTL & Cargo Van / Box Truck",
    description: "Estimated freight transit times by distance and shipping mode. Compare LTL, FTL, and cargo van / box truck transit windows for US lanes.",
    transit_bands: bands,
    sample_corridors: sampleCorridors,
    modes,
    quick_answers: [
      { q: "How long does LTL freight take?", a: `LTL transit times range from ${TRANSIT_BANDS.LTL[0].minDays}-${TRANSIT_BANDS.LTL[0].maxDays} days for short hauls under ${TRANSIT_BANDS.LTL[0].maxMiles} miles, up to ${TRANSIT_BANDS.LTL[TRANSIT_BANDS.LTL.length - 1].minDays}-${TRANSIT_BANDS.LTL[TRANSIT_BANDS.LTL.length - 1].maxDays} days for lanes over ${TRANSIT_BANDS.LTL[TRANSIT_BANDS.LTL.length - 1].minMiles} miles.` },
      { q: "Is FTL faster than LTL?", a: "Generally yes. FTL shipments move direct without terminal transfers, typically 1-2 days faster than LTL on the same lane. However, cargo van / box truck offers similar speed with better pricing for mid-size shipments." },
      { q: "What affects freight transit time?", a: "Key factors include distance, shipping mode, terminal network density (LTL), seasonal demand, weather, and pickup/delivery appointment scheduling." }
    ]
  };
}

// --- Helpers ---

function classifyDensity(cls) {
  if (cls <= 55) return "30+ lbs/cu ft (very dense)";
  if (cls <= 70) return "15-30 lbs/cu ft (dense)";
  if (cls <= 100) return "8-15 lbs/cu ft (medium)";
  if (cls <= 150) return "5-8 lbs/cu ft (light)";
  if (cls <= 250) return "2-5 lbs/cu ft (very light)";
  return "<2 lbs/cu ft (extremely light)";
}

function getCommodityExamples(cls) {
  const examples = {
    50: ["Fits-in-envelope items", "Nuts, bolts, screws", "Steel sheets"],
    55: ["Bricks", "Cement", "Hardwood flooring"],
    60: ["Car parts", "Car accessories", "Bottled beverages"],
    65: ["Car parts/accessories", "Bottled beverages", "Books in boxes"],
    70: ["Automobile engines", "Food items", "Unassembled furniture"],
    77.5: ["Tires", "Bathroom fixtures", "Assembled tables"],
    85: ["Crated machinery", "Cast iron stoves", "Transmissions"],
    92.5: ["Computers", "Monitors", "Refrigerators"],
    100: ["Boat covers", "Car covers", "Canvas"],
    110: ["Cabinets", "Framed artwork", "Table-saw"],
    125: ["Small household appliances", "Vending machines"],
    150: ["Auto sheet metal parts", "Bookcases", "Assembled couches"],
    175: ["Clothing", "Couches", "Stuffed furniture"],
    200: ["Auto sheet metal parts", "Aircraft parts", "Aluminum tables"],
    250: ["Bamboo furniture", "Mattresses", "Plasma TVs"],
    300: ["Wood cabinets", "Tables/chairs", "Model boats"],
    400: ["Deer antlers", "Large stuffed animals"],
    500: ["Bags of gold dust", "Ping pong balls", "Low-density freight"]
  };
  return examples[cls] || ["Varies by commodity"];
}

// Get all index slugs for link graph
export function getIndexSlugs() {
  return ["freight-lanes", "freight-class", "accessorials", "transit-times"];
}

// Get all index links for internal linking
export function getIndexLinks() {
  return [
    { href: "/indexes/freight-lanes", text: "US Freight Lane Directory", reason: "index link" },
    { href: "/indexes/freight-class", text: "Freight Classification Guide", reason: "index link" },
    { href: "/indexes/accessorials", text: "Accessorial Charges Reference", reason: "index link" },
    { href: "/indexes/transit-times", text: "Transit Time Estimates", reason: "index link" }
  ];
}
