/**
 * Lane Content Engine
 * Central generator for page content. Wraps lane-engine.js and enriches
 * output with quick_answer, cost_drivers, lane_insight, AI optimization,
 * and learning-weighted template selection.
 */

import { makeLanePage, generatePages } from "./lane-engine.js";
import { enrichLane } from "./lane-intelligence.js";
import { assignArchetype } from "./lane-archetypes.js";
import { attachLinks } from "./link-graph.js";
import { generateSchemaBlocks, scoreAiExtractability } from "./ai-search-optimizer.js";
import { validatePageQuality } from "./page-quality-contract.js";
import { auditPageLayout } from "./page-layout-audit.js";
import { rngFromKey } from "./hash.js";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd());

// ── Learning State Reader ──────────────────────────────────────────

function loadLearningState() {
  try {
    const p = path.join(ROOT, "artifacts", "learning_state.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { /* ignore */ }
  return null;
}

function weightedSelect(pool, weights, rng) {
  if (!pool || pool.length === 0) return null;
  if (!weights || Object.keys(weights).length === 0) {
    // Uniform selection
    return pool[Math.floor(rng() * pool.length)];
  }

  // Build weighted index
  let total = 0;
  const entries = pool.map((item, i) => {
    const w = weights[item.id || item.pattern_id || `item_${i}`] || 1.0;
    total += w;
    return { item, cumulative: total };
  });

  const r = rng() * total;
  for (const e of entries) {
    if (r <= e.cumulative) return e.item;
  }
  return entries[entries.length - 1].item;
}

// ── Cost Drivers Generator ─────────────────────────────────────────

function generateCostDrivers(page) {
  const o = page.origin_city || page.origin || "Origin";
  const d = page.destination_city || page.destination || "Destination";
  const m = (page.mode || "LTL").toUpperCase();
  const ls = page.lane_stats || {};
  const dist = ls.distance_miles || 0;

  const drivers = [];
  drivers.push(`Distance: At approximately ${dist} miles, the ${o} to ${d} lane's per-mile rate is the largest cost component.`);

  if (m === "LTL") {
    drivers.push(`Freight class: NMFC classification directly impacts LTL pricing — higher density freight typically receives more favorable rates.`);
    drivers.push(`Weight and dimensions: Shipment weight relative to the space used determines whether actual or dimensional weight applies.`);
  } else if (m === "FTL") {
    drivers.push(`Equipment type: Dry van, flatbed, and reefer rates differ based on availability and demand in this corridor.`);
  }

  drivers.push(`Seasonal demand: Carrier capacity on the ${o}–${d} corridor fluctuates with retail cycles, produce seasons, and weather.`);
  drivers.push(`Fuel surcharges: Diesel price movements affect the total cost, typically passed through as a line-item surcharge.`);
  drivers.push(`Accessorials: Liftgate, inside delivery, residential pickup, and limited-access fees add to the base linehaul rate.`);

  return drivers.join(" ");
}

// ── Lane Insight Generator ─────────────────────────────────────────

function generateLaneInsight(page) {
  const o = page.origin_city || page.origin || "Origin";
  const d = page.destination_city || page.destination || "Destination";
  const m = (page.mode || "LTL").toUpperCase();
  const archetype = page.archetype_id || "general";
  const ls = page.lane_stats || {};
  const np = page.network_proof || {};

  const insights = [];

  // Archetype-specific opening
  const archetypeInsights = {
    short_haul_metro: `The ${o} to ${d} lane operates as a short-haul metro corridor where same-day and next-day service windows are common.`,
    port_to_inland: `The ${o} to ${d} lane connects port operations with inland distribution, requiring coordination of drayage and linehaul segments.`,
    cross_regional_corridor: `The ${o} to ${d} lane is a major cross-regional corridor with consistent carrier capacity and competitive rates.`,
    hub_to_spoke: `The ${o} to ${d} lane functions as a hub-to-spoke route where consolidation economics drive pricing efficiency.`,
    high_velocity: `The ${o} to ${d} lane sees high freight velocity, with multiple daily departures and strong carrier competition.`,
    weak_demand: `The ${o} to ${d} lane has lower freight density, which can limit carrier options but also create opportunities for favorable return-haul rates.`,
    mega_freight_corridor: `The ${o} to ${d} corridor is one of the highest-volume freight lanes in the network, with deep carrier capacity.`,
    regional_distribution: `The ${o} to ${d} lane serves regional distribution patterns, balancing cost efficiency with delivery speed.`,
    manufacturing_belt: `The ${o} to ${d} lane traverses manufacturing corridors where industrial shipments drive consistent demand.`,
    port_inland: `The ${o} to ${d} lane connects port operations with inland markets, requiring intermodal coordination.`,
    retail_store_replenishment: `The ${o} to ${d} lane supports retail store replenishment with predictable, recurring volume patterns.`,
    ecom_corridor: `The ${o} to ${d} lane serves e-commerce fulfillment flows where speed and reliability are primary shipper priorities.`,
    coastal_long_haul: `The ${o} to ${d} lane is a coast-spanning route where transit time and fuel costs are the dominant considerations.`,
    sunbelt_growth_lane: `The ${o} to ${d} lane is in a high-growth Sunbelt corridor with expanding warehouse and distribution infrastructure.`,
    midwest_south_lane: `The ${o} to ${d} lane connects Midwest manufacturing with Southern distribution markets.`,
    recovery_urgent_lane: `The ${o} to ${d} lane is frequently used for urgent and recovery shipments where speed outweighs cost.`,
  };

  insights.push(archetypeInsights[archetype] || `The ${o} to ${d} ${m} lane presents distinct shipping characteristics based on the corridor geography and freight profile.`);

  if (np.carrier_count) {
    insights.push(`WARP's network includes approximately ${np.carrier_count} active carriers covering this lane.`);
  }

  if (ls.seasonality_note) {
    insights.push(ls.seasonality_note);
  }

  if (np.nearest_cross_docks && np.nearest_cross_docks.length > 0) {
    const docks = np.nearest_cross_docks.slice(0, 2).map((d) => d.name || d).join(" and ");
    insights.push(`Nearby cross-dock facilities at ${docks} support consolidation and transit optimization.`);
  }

  return insights.join(" ");
}

// ── Quick Answer Generator ─────────────────────────────────────────

function generateQuickAnswer(page) {
  const o = page.origin_city || page.origin || "Origin";
  const oS = page.origin_state || "";
  const d = page.destination_city || page.destination || "Destination";
  const dS = page.destination_state || "";
  const m = (page.mode || "LTL").toUpperCase();
  const ls = page.lane_stats || {};

  const parts = [];
  parts.push(`${m} freight from ${o}${oS ? `, ${oS}` : ""} to ${d}${dS ? `, ${dS}` : ""} covers approximately ${ls.distance_miles || "N/A"} miles.`);

  if (ls.transit_days_range) {
    parts.push(`Typical transit times are ${ls.transit_days_range} business days.`);
  }
  if (ls.rate_range_usd) {
    parts.push(`Estimated rates range from ${ls.rate_range_usd}, depending on weight, freight class, and seasonal demand.`);
  }
  parts.push(`These are modeled estimates — get an exact quote by entering your shipment details.`);

  return parts.join(" ");
}

// ── Main: Build Lane Page ──────────────────────────────────────────

/**
 * Build a complete lane page with all required fields.
 *
 * @param {object} opts
 * @param {string} opts.origin        - Origin city (e.g., "Chicago, IL")
 * @param {string} opts.destination   - Destination city (e.g., "Dallas, TX")
 * @param {string} [opts.mode]        - LTL|FTL|Cargo Van / Box Truck (default LTL)
 * @param {string} [opts.segment]     - smb|midmarket|enterprise (default smb)
 * @param {object} [opts.combo]       - Pre-built combo from lane-engine buildCombos
 * @param {object} [opts.design]      - Design config
 * @param {object} [opts.estimateInputs] - Estimate model inputs
 * @param {object} [opts.quoteHistory]   - Quote history for calibration
 * @param {object[]} [opts.allPages]     - All pages for link graph
 * @returns {object} Complete page object
 */
export function buildLanePage(opts = {}) {
  const learningState = loadLearningState();

  // Extract FAQ weights from learning state (active dimension)
  const faqWeights = learningState?.faq_weights || null;

  // Use existing makeLanePage if combo is provided
  let page;
  if (opts.combo) {
    page = makeLanePage(opts.combo, opts.design || {}, opts.estimateInputs, opts.quoteHistory, faqWeights);
  } else {
    // Build minimal page from inputs
    const originParts = (opts.origin || "").split(",").map((s) => s.trim());
    const destParts = (opts.destination || "").split(",").map((s) => s.trim());
    const oCity = originParts[0] || "Origin";
    const oState = originParts[1] || "";
    const dCity = destParts[0] || "Destination";
    const dState = destParts[1] || "";
    const mode = opts.mode || "LTL";
    const segment = opts.segment || "smb";
    const slug = `${oCity.toLowerCase().replace(/\s+/g, "-")}-to-${dCity.toLowerCase().replace(/\s+/g, "-")}`;

    page = {
      slug,
      canonical_path: `/lanes/${slug}`,
      seo_title: `${oCity} to ${dCity} ${mode} Freight Quotes | WARP`,
      meta_description: `Compare ${mode} freight rates from ${oCity} to ${dCity}. Get instant quotes, estimated transit times, and book freight in minutes with WARP.`,
      h1: `${oCity} to ${dCity} ${mode} Freight Quotes`,
      origin: oState ? `${oCity}, ${oState}` : oCity,
      origin_city: oCity,
      origin_state: oState,
      destination: dState ? `${dCity}, ${dState}` : dCity,
      destination_city: dCity,
      destination_state: dState,
      mode,
      segment,
      lane_stats: {},
      network_proof: {},
      faq: [],
      cta_label: `Get ${mode} Freight Quotes — ${oCity} to ${dCity}`,
      cta_url: "https://app.wearewarp.com/quote",
      related_lanes: [],
      related_guides: [],
      schema_jsonld: [],
      visual_cards: [],
    };
  }

  // Ensure all required fields are populated
  if (!page.quick_answer) page.quick_answer = generateQuickAnswer(page);
  if (!page.cost_drivers) page.cost_drivers = generateCostDrivers(page);
  if (!page.lane_insight) page.lane_insight = generateLaneInsight(page);
  if (!page.canonical_path) page.canonical_path = `/lanes/${page.slug}`;

  // Enrich lane intelligence
  if (opts.estimateInputs) {
    try {
      enrichLane(page, opts.estimateInputs, opts.quoteHistory);
    } catch { /* non-fatal */ }
  }

  // Assign archetype if not set
  if (!page.archetype_id) {
    try {
      const arch = assignArchetype(page);
      if (arch) {
        page.archetype_id = arch.id;
        page.archetype_label = arch.label;
      }
    } catch { /* non-fatal */ }
  }

  // Generate schema blocks
  if (!page.schema_jsonld || page.schema_jsonld.length === 0) {
    page.schema_jsonld = generateSchemaBlocks(page);
  }

  // AI extractability score
  const aiScore = scoreAiExtractability(page);
  page.ai_extractability_score = aiScore.total_score;
  page.ai_extractability_grade = aiScore.grade;

  // Learning snapshot tracking — records what learning state was active at generation time
  if (learningState) {
    page.learning_snapshot_version = learningState.content_version || "unknown";
    // Track archetype weight (used by publish_next.js for priority ordering)
    if (learningState.archetype_weights?.[page.archetype_id]) {
      page.selected_archetype_weight = learningState.archetype_weights[page.archetype_id].priority_weight || 1.0;
    }
    // Track whether FAQ weights were active (used by getArchetypeFaq for selection)
    page.faq_weights_active = faqWeights && Object.keys(faqWeights).length > 0;
  }

  // Content version
  if (!page.content_version) page.content_version = "v2";

  return page;
}

/**
 * Build multiple lane pages with link graph attachment.
 * @param {object[]} combos - Lane combos from buildCombos
 * @param {object} design - Design config
 * @param {number} topN - How many to generate
 * @param {object} estimateInputs - Estimate model inputs
 * @param {object} quoteHistoryMap - Quote history map
 * @returns {object[]} Array of complete page objects
 */
export function buildLanePages(combos, design, topN, estimateInputs, quoteHistoryMap) {
  const pages = [];
  const subset = combos.slice(0, topN || combos.length);

  for (const combo of subset) {
    const page = buildLanePage({
      combo,
      design,
      estimateInputs,
      quoteHistory: quoteHistoryMap?.[combo.slug],
    });
    pages.push(page);
  }

  // Attach link graph across all pages
  for (const page of pages) {
    try {
      attachLinks(page, pages);
    } catch { /* non-fatal */ }
  }

  return pages;
}

/**
 * Validate a page before publish — runs quality contract + layout audit.
 * @param {object} page
 * @returns {{ ready, quality, layout, ai_score }}
 */
export function validateBeforePublish(page) {
  const quality = validatePageQuality(page);
  const layout = auditPageLayout(page);
  const ai = scoreAiExtractability(page);

  return {
    ready: quality.passed && layout.passed,
    quality,
    layout,
    ai_score: ai.total_score,
    ai_grade: ai.grade,
  };
}

// Re-export core engine functions for convenience
export { makeLanePage, generatePages } from "./lane-engine.js";
export { buildCombos } from "./lane-engine.js";
