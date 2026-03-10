import { rngFromKey } from "@/lib/hash";
import { normCity, lookupCity, haversine } from "@/lib/geo";
import {
  ROAD_MULTIPLIER,
  TRANSIT_BANDS,
  RATE_PER_MILE,
  ACCESSORIAL_BUFFER_PCT,
  MIN_RATE_USD,
  FREIGHT_CLASS_MULTIPLIER,
  DEFAULT_FREIGHT_CLASS,
  PALLET_DISCOUNT_PER_UNIT,
  MAX_PALLET_DISCOUNT,
  QUOTE_HISTORY_MIN_COUNT,
  QUOTE_TIGHTEN_FACTOR
} from "@/lib/estimate-config";

// --- Estimate core ---

// Build a stable lane key for deterministic outputs.
export function laneKey(origin, destination, mode) {
  return `${normCity(origin)}|${normCity(destination)}|${normCity(mode)}`;
}

/**
 * Produce modeled estimates for a lane.
 *
 * @param {object} params
 * @param {string} params.origin
 * @param {string} params.destination
 * @param {string} params.mode — "LTL" | "FTL" | "Cargo Van / Box Truck"
 * @param {string} [params.segment]
 * @param {number} [params.pallet_count]
 * @param {number} [params.weight_lbs]
 * @param {number} [params.freight_class]
 * @param {object} [params.quoteHistory] — { quote_count, min_quote, max_quote, median_quote }
 * @returns {object} estimate
 */
export function buildEstimate(params) {
  const { origin, destination, mode } = params;
  const key = laneKey(origin, destination, mode);
  const rng = rngFromKey(key);

  // --- Distance ---
  const oCity = lookupCity(origin);
  const dCity = lookupCity(destination);
  const knownCities = Boolean(oCity && dCity);
  const distance = knownCities
    ? Math.round(haversine(oCity.lat, oCity.lon, dCity.lat, dCity.lon) * ROAD_MULTIPLIER)
    : 800; // fallback for unknown city pairs

  // --- Transit ---
  const modeKey = mode === "Cargo Van / Box Truck" ? "Cargo Van / Box Truck" : mode === "FTL" ? "FTL" : "LTL";
  const bands = TRANSIT_BANDS[modeKey] || TRANSIT_BANDS.LTL;
  let baseMin = 3;
  let baseMax = 5;
  for (const [maxDist, bMin, bMax] of bands) {
    if (distance <= maxDist) {
      baseMin = bMin;
      baseMax = bMax;
      break;
    }
  }
  // Add lane-specific jitter (0 or 1 day) so not every lane in same band looks identical.
  const jitter = Math.floor(rng() * 2);
  const transitMin = baseMin + (jitter > 0 && baseMin > 1 ? 0 : jitter);
  const transitMax = baseMax + jitter;

  // --- Rate ---
  const [ratePerMileMin, ratePerMileMax] = RATE_PER_MILE[modeKey] || RATE_PER_MILE.LTL;
  const laneRate = ratePerMileMin + rng() * (ratePerMileMax - ratePerMileMin);

  // Freight class adjustment (LTL only)
  const freightClass = params.freight_class || DEFAULT_FREIGHT_CLASS;
  const classMultiplier = modeKey === "LTL" ? (FREIGHT_CLASS_MULTIPLIER[freightClass] || 1.0) : 1.0;

  // Pallet count discount (reduces per-unit cost for multi-pallet shipments)
  const pallets = Math.max(1, params.pallet_count || 1);
  const palletDiscount = Math.min(MAX_PALLET_DISCOUNT, (pallets - 1) * PALLET_DISCOUNT_PER_UNIT);

  // Base rate
  const baseRate = distance * laneRate * classMultiplier * (1 - palletDiscount);
  const buffer = ACCESSORIAL_BUFFER_PCT[modeKey] || 0.15;
  const floor = MIN_RATE_USD[modeKey] || 250;

  let rateLow = Math.max(floor, Math.round(baseRate * (0.85 + rng() * 0.05)));
  let rateHigh = Math.max(rateLow + 50, Math.round(baseRate * (1.0 + buffer) * (1.0 + rng() * 0.1)));

  // --- Quote history blending ---
  const qh = params.quoteHistory;
  const hasHistory = qh && qh.quote_count >= QUOTE_HISTORY_MIN_COUNT;
  if (hasHistory) {
    const blend = QUOTE_TIGHTEN_FACTOR;
    rateLow = Math.round(rateLow * (1 - blend) + qh.min_quote * blend);
    rateHigh = Math.round(rateHigh * (1 - blend) + qh.max_quote * blend);
    if (rateHigh <= rateLow) rateHigh = rateLow + 50;
  }

  // --- Confidence ---
  const transitConfidence = knownCities ? "medium" : "low";
  const rateConfidence = hasHistory ? "high" : knownCities ? "medium" : "low";

  // --- Assumptions ---
  const assumptions = [];
  assumptions.push(`Distance estimated at ~${distance.toLocaleString()} road miles${knownCities ? "" : " (city pair not in database — using fallback)"}`);
  if (modeKey === "LTL") {
    assumptions.push(`Freight class ${freightClass} assumed${params.freight_class ? "" : " (default — provide actual class for better estimate)"}`);
    if (pallets > 1) assumptions.push(`${pallets}-pallet shipment — volume discount applied`);
  }
  if (params.weight_lbs) assumptions.push(`Weight: ${params.weight_lbs.toLocaleString()} lbs provided`);
  if (hasHistory) assumptions.push(`Rate range tightened using ${qh.quote_count} historical quotes (median $${qh.median_quote?.toLocaleString()})`);
  else assumptions.push("Rate range based on distance-band modeling — no historical quotes yet");
  assumptions.push(`Transit based on ${modeKey} distance bands with lane-specific variation`);

  // --- Disclaimers ---
  const disclaimers = [
    "These are modeled estimates, not guaranteed quotes.",
    "Actual rates depend on freight details, accessorials, and current market conditions.",
    "Get an instant quote for real-time pricing on this lane."
  ];

  return {
    estimated_distance_miles: distance,
    estimated_transit_days_range: { min: transitMin, max: transitMax },
    estimated_rate_range_usd: { low: rateLow, high: rateHigh },
    confidence: { transit: transitConfidence, rate: rateConfidence },
    assumptions,
    disclaimers,
    transit_time_estimate_label: "Estimated transit time",
    rate_estimate_label: "Estimated rate range",
    _inputs: {
      freight_class: freightClass,
      pallet_count: pallets,
      weight_lbs: params.weight_lbs || null,
      has_quote_history: hasHistory
    }
  };
}
