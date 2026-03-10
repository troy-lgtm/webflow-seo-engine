# Estimates First: Modeling Approach

Ship lane pages now with modeled estimates. Progressively upgrade to real data as quote and shipment history arrives.

## Why Estimates First

Lane pages need data to be useful — distance, transit time, rate ranges. Waiting for real shipment data on every lane means nothing ships. The estimate model lets you publish immediately with defensible ranges, then tighten them as real quotes come in.

Every estimate is:
- **Deterministic** — same lane always produces the same numbers
- **Labeled as an estimate** — never claims to be a quote or guaranteed price
- **Range-based** — never a single number
- **Confidence-scored** — low/medium/high so readers know the data quality

## The Modeling Approach

### Distance

Haversine formula between city lat/lon coordinates from `data/cities.json` (36 US cities), multiplied by 1.18 road factor. If a city isn't in the database, falls back to 800 miles.

### Transit Time

Distance bands determine base transit range per mode:

| Mode | <300mi | 300-600mi | 600-1000mi | 1000-1500mi | 1500+mi |
|------|--------|-----------|------------|-------------|---------|
| LTL | 1-2 days | 2-3 days | 3-4 days | 4-5 days | 5-7 days |
| FTL | 1 day | 1-2 days | 2-3 days | 3-4 days | 4-6 days |
| Shared | 1-2 days | 2-3 days | 3-4 days | 4-5 days | 5-7 days |

A seeded PRNG adds 0-1 day jitter per lane so lanes in the same distance band aren't identical.

### Rate Range

Rate = distance x rate-per-mile x freight-class-multiplier x pallet-discount + accessorial buffer

| Mode | Rate/Mile Range | Accessorial Buffer | Minimum Rate |
|------|-----------------|-------------------|--------------|
| LTL | $2.60-$5.20 | 20% | $250 |
| FTL | $1.90-$3.60 | 12% | $600 |
| Shared | $1.70-$3.40 | 15% | $350 |

The seeded PRNG picks a specific rate-per-mile within the range for each lane, ensuring lane-to-lane variation.

**LTL adjustments:**
- Freight class multiplier (class 50 = 0.80x, class 100 = 1.35x, class 500 = 3.80x)
- Pallet discount (3% per additional pallet, capped at 25%)

### Confidence Levels

| Level | Transit | Rate |
|-------|---------|------|
| **Low** | Unknown city pair (fallback distance) | Unknown city pair, no quote history |
| **Medium** | Known city pair | Known city pair, no quote history |
| **High** | — | Known city pair + quote history |

## Configuration

All coefficients live in `lib/estimate-config.js`. You can tune:
- `ROAD_MULTIPLIER` — straight-line to road distance factor
- `TRANSIT_BANDS` — distance breakpoints and day ranges per mode
- `RATE_PER_MILE` — min/max rate per mile per mode
- `ACCESSORIAL_BUFFER_PCT` — percentage buffer added to rate range
- `MIN_RATE_USD` — floor rate per mode
- `FREIGHT_CLASS_MULTIPLIER` — pricing impact by NMFC class
- `PALLET_DISCOUNT_PER_UNIT` — per-pallet volume discount

## What the Disclaimers Mean

Every lane page includes:

1. "These are modeled estimates, not guaranteed quotes." — Tells the reader this isn't a binding price.
2. "Actual rates depend on freight details, accessorials, and market conditions." — Explains why real quotes differ.
3. "Get an instant quote for real-time pricing on this lane." — Drives them to the quote tool.

These disclaimers are **required** for publish readiness. The publish checks will fail without them.

## How to Import Quote Feedback

1. Open Builder, click "Show Advanced"
2. Find the "Quote Feedback" panel in the left sidebar
3. Paste a CSV with columns: `origin, destination, mode, quote_amount`
4. Click "Import Quotes"
5. The system aggregates per-lane stats: count, min, max, median
6. Re-generate pages — rate ranges will tighten toward observed values

Example CSV:
```
origin,destination,mode,quote_amount
Los Angeles,Chicago,LTL,$1500
Los Angeles,Chicago,LTL,$1650
Los Angeles,Chicago,LTL,$1420
Dallas,Atlanta,FTL,$2800
Dallas,Atlanta,FTL,$3100
```

### What changes with quote history

- Rate range narrows toward observed min/max (25% blend factor)
- Rate confidence upgrades to "high"
- Badge changes from "Modeled estimate" to "Data-backed estimate" (at 5+ quotes)

## How to Swap to Real Shipment Stats Later

When you have actual shipment data (from TMS, quote tool, or carrier APIs):

1. **Update `estimate-config.js`** — Replace modeled coefficients with observed averages
2. **Add a data layer** — Create `data/lane_actuals.json` mapping lane keys to real stats
3. **Update `estimate-model.js`** — Check for actuals first, fall back to model
4. **Update confidence** — Real data gets "high" confidence automatically
5. **Update disclaimers** — Change from "modeled estimate" to "based on recent shipments"

The architecture is designed for this progression. The `buildEstimate()` function already accepts `quoteHistory` — you're just feeding it better data over time.

## Estimate Inputs Panel

Users can optionally provide:
- **Pallet count** — adjusts LTL pricing (volume discount)
- **Weight (lbs)** — noted in assumptions
- **Freight class** — adjusts LTL pricing (class multiplier)
- **Pickup/delivery windows** — stored for reference

If not provided, sensible defaults are used (class 70, 1 pallet).

## Architecture

```
lib/hash.js              ← Stable hash + seeded PRNG
lib/estimate-config.js   ← All tunable coefficients
lib/estimate-model.js    ← Core: buildEstimate(params) → estimate object
lib/lane-intelligence.js ← Calls estimate-model, adds network proof
lib/lane-engine.js       ← Integrates into page generation + export
lib/seo-feedback.js      ← Quote CSV parsing + aggregation
```

## Testing

22 Playwright e2e tests cover:
- Estimate transparency section (distance, transit, rate, confidence badges)
- How-it-works accordion toggle
- Disclaimer block visibility
- Estimate inputs panel
- Quote feedback importer
- Upgrade readiness badge
- All existing features preserved
