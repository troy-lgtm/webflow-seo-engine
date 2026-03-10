// All tunable coefficients for the estimate model live here.
// Update these values to refine estimates as you gather real data.

export const ROAD_MULTIPLIER = 1.18; // straight-line → road-distance factor

// Transit bands: [maxDistance, baseDaysMin, baseDaysMax]
// Evaluated in order — first match wins.
export const TRANSIT_BANDS = {
  LTL: [
    [300, 1, 2],
    [600, 2, 3],
    [1000, 3, 4],
    [1500, 4, 5],
    [Infinity, 5, 7]
  ],
  FTL: [
    [400, 1, 1],
    [800, 1, 2],
    [1500, 2, 3],
    [2500, 3, 4],
    [Infinity, 4, 6]
  ],
  "Cargo Van / Box Truck": [
    [300, 1, 2],
    [700, 2, 3],
    [1200, 3, 4],
    [2000, 4, 5],
    [Infinity, 5, 7]
  ]
};

// Rate-per-mile ranges: [baseMin, baseMax] — RNG picks within this range.
export const RATE_PER_MILE = {
  LTL: [2.60, 5.20],
  FTL: [1.90, 3.60],
  "Cargo Van / Box Truck": [1.70, 3.40]
};

// Accessorial buffer percentage: added on top of base rate to widen the range.
export const ACCESSORIAL_BUFFER_PCT = {
  LTL: 0.20,   // 20% buffer for LTL accessorials (liftgate, inside delivery, etc.)
  FTL: 0.12,   // 12% for FTL
  "Cargo Van / Box Truck": 0.15  // 15% for Cargo Van / Box Truck
};

// Minimum rate floor (USD) — no estimate goes below this.
export const MIN_RATE_USD = {
  LTL: 250,
  FTL: 600,
  "Cargo Van / Box Truck": 350
};

// Freight class impacts on LTL pricing (multiplier relative to class 70).
// Higher class = lower density = higher cost.
export const FREIGHT_CLASS_MULTIPLIER = {
  50: 0.80,
  55: 0.85,
  60: 0.88,
  65: 0.92,
  70: 1.00,
  77.5: 1.08,
  85: 1.15,
  92.5: 1.25,
  100: 1.35,
  110: 1.48,
  125: 1.60,
  150: 1.80,
  175: 2.00,
  200: 2.20,
  250: 2.50,
  300: 2.80,
  400: 3.20,
  500: 3.80
};

// Default freight class when not provided.
export const DEFAULT_FREIGHT_CLASS = 70;

// Pallet count impact: each pallet above 1 reduces per-unit cost slightly.
export const PALLET_DISCOUNT_PER_UNIT = 0.03; // 3% per additional pallet
export const MAX_PALLET_DISCOUNT = 0.25;       // cap at 25% discount

// Carrier count ranges by mode: [base, variationRange].
export const CARRIER_COUNT = {
  LTL: [4, 8],
  FTL: [10, 25],
  "Cargo Van / Box Truck": [3, 5]
};

// Quote history thresholds
export const QUOTE_HISTORY_MIN_COUNT = 3;  // minimum quotes to tighten range
export const DATA_BACKED_THRESHOLD = 5;    // quotes needed for "data-backed" badge
export const QUOTE_TIGHTEN_FACTOR = 0.25;  // blend 25% toward observed range when history exists
