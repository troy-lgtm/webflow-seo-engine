/**
 * Lane Page Schema — Validation & Canonical Page Builder
 *
 * Validates lane page data against the canonical schema defined in
 * schemas/lane-page-schema.json and builds canonical page data from
 * lane knowledge objects.
 *
 * NOTE: This file must work in raw Node.js scripts (no @/ aliases).
 *       Uses import.meta.url + fileURLToPath for path resolution.
 *
 * Exports:
 *   validateLanePageSchema(pageData)  — hand-written validation
 *   buildCanonicalLanePageData(knowledge, relatedLinks, optionalMetrics) — builds all sections
 *   CANONICAL_SECTIONS — ordered list of the required section IDs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Constants ────────────────────────────────────────────────────────

const QUOTE_URL = "https://www.wearewarp.com/quote";
const BOOK_URL = "https://www.wearewarp.com/book";

/**
 * The required canonical sections in display order.
 * Every lane page must include all of these.
 */
export const CANONICAL_SECTIONS = [
  "hero",
  "lane_overview",
  "warp_fit_for_lane",
  "operating_details",
  "pricing_and_commercial_framing",
  "best_fit_shipments",
  "lane_specific_faqs",
  "related_links",
  "why_warp",
  "final_cta",
  "lane_relevant_cta",
];

// ── Schema Loader (lazy) ─────────────────────────────────────────────

let _schema = null;

function loadSchema() {
  if (_schema) return _schema;
  const schemaPath = path.join(__dirname, "..", "schemas", "lane-page-schema.json");
  try {
    _schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
  } catch {
    _schema = null;
  }
  return _schema;
}

// ── Validation Helpers ───────────────────────────────────────────────

/**
 * @param {*} val
 * @param {string} label
 * @param {object} opts - { minLength, maxLength, pattern, enumValues }
 * @returns {string[]} error messages
 */
function checkString(val, label, opts = {}) {
  const errs = [];
  if (val === undefined || val === null) {
    errs.push(`Missing required field: ${label}`);
    return errs;
  }
  if (typeof val !== "string") {
    errs.push(`${label} must be a string, got ${typeof val}`);
    return errs;
  }
  if (val.trim() === "") {
    errs.push(`${label} must not be empty`);
    return errs;
  }
  if (opts.minLength && val.length < opts.minLength) {
    errs.push(`${label} too short (${val.length} chars, min ${opts.minLength})`);
  }
  if (opts.maxLength && val.length > opts.maxLength) {
    errs.push(`${label} too long (${val.length} chars, max ${opts.maxLength})`);
  }
  if (opts.pattern && !opts.pattern.test(val)) {
    errs.push(`${label} does not match required pattern`);
  }
  if (opts.enumValues && !opts.enumValues.includes(val)) {
    errs.push(`${label} must be one of: ${opts.enumValues.join(", ")}`);
  }
  return errs;
}

function checkObject(val, label) {
  if (val === undefined || val === null) return [`Missing required field: ${label}`];
  if (typeof val !== "object" || Array.isArray(val)) return [`${label} must be an object`];
  return [];
}

function checkArray(val, label, minItems = 0) {
  if (val === undefined || val === null) return [`Missing required field: ${label}`];
  if (!Array.isArray(val)) return [`${label} must be an array`];
  if (val.length < minItems) return [`${label} requires at least ${minItems} items, got ${val.length}`];
  return [];
}

function checkCta(val, label) {
  const errs = checkObject(val, label);
  if (errs.length) return errs;
  errs.push(...checkString(val.label, `${label}.label`));
  errs.push(...checkString(val.url, `${label}.url`));
  return errs;
}

// ── Main Validator ───────────────────────────────────────────────────

/**
 * Validate a page data object against the canonical lane page schema.
 * Hand-written validation — no JSON schema library required.
 *
 * @param {object} pageData - The lane page data object to validate
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateLanePageSchema(pageData) {
  const errors = [];
  const warnings = [];

  if (!pageData || typeof pageData !== "object") {
    return { valid: false, errors: ["pageData is null or not an object"], warnings };
  }

  // ── Top-level required strings ────────────────────────────────
  errors.push(...checkString(pageData.page_title, "page_title", { minLength: 30, maxLength: 70 }));
  errors.push(...checkString(pageData.meta_description, "meta_description", { minLength: 80, maxLength: 170 }));
  errors.push(...checkString(pageData.lane_slug, "lane_slug", { pattern: /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ }));
  errors.push(...checkString(pageData.canonical_path, "canonical_path", { pattern: /^\/lanes\// }));
  errors.push(...checkString(pageData.mode, "mode", { enumValues: ["LTL", "FTL", "Cargo Van / Box Truck"] }));
  errors.push(...checkString(pageData.segment, "segment"));
  errors.push(...checkString(pageData.origin, "origin"));
  errors.push(...checkString(pageData.destination, "destination"));

  // ── lane_stats ────────────────────────────────────────────────
  const lsErrs = checkObject(pageData.lane_stats, "lane_stats");
  errors.push(...lsErrs);
  if (!lsErrs.length && pageData.lane_stats) {
    const ls = pageData.lane_stats;
    if (typeof ls.estimated_distance_miles !== "number" || ls.estimated_distance_miles < 1) {
      errors.push("lane_stats.estimated_distance_miles must be a number >= 1");
    }
    const trErrs = checkObject(ls.estimated_transit_days_range, "lane_stats.estimated_transit_days_range");
    errors.push(...trErrs);
    if (!trErrs.length) {
      if (typeof ls.estimated_transit_days_range.min !== "number" || ls.estimated_transit_days_range.min < 1) {
        errors.push("lane_stats.estimated_transit_days_range.min must be an integer >= 1");
      }
      if (typeof ls.estimated_transit_days_range.max !== "number" || ls.estimated_transit_days_range.max < 1) {
        errors.push("lane_stats.estimated_transit_days_range.max must be an integer >= 1");
      }
    }
    const rrErrs = checkObject(ls.estimated_rate_range_usd, "lane_stats.estimated_rate_range_usd");
    errors.push(...rrErrs);
    if (!rrErrs.length) {
      if (typeof ls.estimated_rate_range_usd.low !== "number") errors.push("lane_stats.estimated_rate_range_usd.low must be a number");
      if (typeof ls.estimated_rate_range_usd.high !== "number") errors.push("lane_stats.estimated_rate_range_usd.high must be a number");
    }
    errors.push(...checkArray(ls.common_equipment, "lane_stats.common_equipment", 1));
    errors.push(...checkString(ls.seasonality_notes, "lane_stats.seasonality_notes"));
  }

  // ── network_proof ─────────────────────────────────────────────
  const npErrs = checkObject(pageData.network_proof, "network_proof");
  errors.push(...npErrs);
  if (!npErrs.length && pageData.network_proof) {
    const np = pageData.network_proof;
    if (typeof np.estimated_carrier_count !== "number" || np.estimated_carrier_count < 1) {
      errors.push("network_proof.estimated_carrier_count must be an integer >= 1");
    }
    errors.push(...checkArray(np.nearest_cross_docks, "network_proof.nearest_cross_docks"));
    errors.push(...checkArray(np.service_notes, "network_proof.service_notes"));
    errors.push(...checkString(np.origin_region, "network_proof.origin_region"));
    errors.push(...checkString(np.destination_region, "network_proof.destination_region"));
  }

  // ── Section 1: hero ───────────────────────────────────────────
  const heroErrs = checkObject(pageData.hero, "hero");
  errors.push(...heroErrs);
  if (!heroErrs.length && pageData.hero) {
    errors.push(...checkString(pageData.hero.headline, "hero.headline", { minLength: 20 }));
    errors.push(...checkString(pageData.hero.subhead, "hero.subhead", { minLength: 30 }));
    errors.push(...checkCta(pageData.hero.primary_cta, "hero.primary_cta"));
    errors.push(...checkCta(pageData.hero.secondary_cta, "hero.secondary_cta"));
  }

  // ── Section 2: lane_overview ──────────────────────────────────
  const loErrs = checkObject(pageData.lane_overview, "lane_overview");
  errors.push(...loErrs);
  if (!loErrs.length && pageData.lane_overview) {
    if (!pageData.lane_overview.heading || pageData.lane_overview.heading.trim().length < 5) {
      errors.push("lane_overview.heading must be a non-empty string (at least 5 chars)");
    }
    errors.push(...checkString(pageData.lane_overview.body, "lane_overview.body", { minLength: 100 }));
  }

  // ── Section 3: warp_fit_for_lane ──────────────────────────────
  const wfErrs = checkObject(pageData.warp_fit_for_lane, "warp_fit_for_lane");
  errors.push(...wfErrs);
  if (!wfErrs.length && pageData.warp_fit_for_lane) {
    errors.push(...checkString(pageData.warp_fit_for_lane.heading, "warp_fit_for_lane.heading"));
    errors.push(...checkString(pageData.warp_fit_for_lane.body, "warp_fit_for_lane.body", { minLength: 100 }));
  }

  // ── Section 4: operating_details ──────────────────────────────
  const odErrs = checkObject(pageData.operating_details, "operating_details");
  errors.push(...odErrs);
  if (!odErrs.length && pageData.operating_details) {
    errors.push(...checkString(pageData.operating_details.heading, "operating_details.heading"));
    errors.push(...checkArray(pageData.operating_details.items, "operating_details.items", 4));
    if (Array.isArray(pageData.operating_details.items)) {
      pageData.operating_details.items.forEach((item, i) => {
        if (typeof item !== "string" || item.trim() === "") {
          errors.push(`operating_details.items[${i}] must be a non-empty string`);
        }
      });
    }
  }

  // ── Section 5: pricing_and_commercial_framing ─────────────────
  const pcErrs = checkObject(pageData.pricing_and_commercial_framing, "pricing_and_commercial_framing");
  errors.push(...pcErrs);
  if (!pcErrs.length && pageData.pricing_and_commercial_framing) {
    errors.push(...checkString(pageData.pricing_and_commercial_framing.heading, "pricing_and_commercial_framing.heading"));
    errors.push(...checkString(pageData.pricing_and_commercial_framing.body, "pricing_and_commercial_framing.body", { minLength: 100 }));
  }

  // ── Section 5b: best_fit_shipments (optional for backward compat) ──
  if (pageData.best_fit_shipments) {
    const bfErrs = checkObject(pageData.best_fit_shipments, "best_fit_shipments");
    errors.push(...bfErrs);
    if (!bfErrs.length) {
      errors.push(...checkString(pageData.best_fit_shipments.heading, "best_fit_shipments.heading"));
      errors.push(...checkString(pageData.best_fit_shipments.intro, "best_fit_shipments.intro"));
      errors.push(...checkArray(pageData.best_fit_shipments.items, "best_fit_shipments.items", 3));
    }
  }

  // ── Section 6: lane_specific_faqs ─────────────────────────────
  const faqErrs = checkArray(pageData.lane_specific_faqs, "lane_specific_faqs", 4);
  errors.push(...faqErrs);
  if (!faqErrs.length && Array.isArray(pageData.lane_specific_faqs)) {
    pageData.lane_specific_faqs.forEach((faq, i) => {
      errors.push(...checkString(faq.question, `lane_specific_faqs[${i}].question`, { minLength: 10 }));
      errors.push(...checkString(faq.answer, `lane_specific_faqs[${i}].answer`, { minLength: 20 }));
    });
  }

  // ── Section 7: related_links ──────────────────────────────────
  const rlErrs = checkObject(pageData.related_links, "related_links");
  errors.push(...rlErrs);
  if (!rlErrs.length && pageData.related_links) {
    errors.push(...checkString(pageData.related_links.corridor_hub, "related_links.corridor_hub"));
    errors.push(...checkArray(pageData.related_links.related_lanes, "related_links.related_lanes"));
    errors.push(...checkString(pageData.related_links.tool_link, "related_links.tool_link"));
    // data_link is nullable — only warn if present but empty
    if (pageData.related_links.data_link !== null && pageData.related_links.data_link !== undefined) {
      if (typeof pageData.related_links.data_link === "string" && pageData.related_links.data_link.trim() === "") {
        warnings.push("related_links.data_link is empty string — use null instead");
      }
    }
  }

  // ── Section 8: lane_relevant_cta ──────────────────────────────
  const ctaErrs = checkObject(pageData.lane_relevant_cta, "lane_relevant_cta");
  errors.push(...ctaErrs);
  if (!ctaErrs.length && pageData.lane_relevant_cta) {
    errors.push(...checkString(pageData.lane_relevant_cta.headline, "lane_relevant_cta.headline"));
    errors.push(...checkString(pageData.lane_relevant_cta.body, "lane_relevant_cta.body"));
    errors.push(...checkCta(pageData.lane_relevant_cta.primary_cta, "lane_relevant_cta.primary_cta"));
  }

  // ── Section 9: why_warp (optional for backward compat) ────────
  if (pageData.why_warp) {
    const wwErrs = checkObject(pageData.why_warp, "why_warp");
    errors.push(...wwErrs);
    if (!wwErrs.length) {
      errors.push(...checkString(pageData.why_warp.heading, "why_warp.heading"));
      if (!Array.isArray(pageData.why_warp.reasons) || pageData.why_warp.reasons.length < 3) {
        errors.push("why_warp.reasons must have at least 3 items");
      } else {
        pageData.why_warp.reasons.forEach((r, i) => {
          errors.push(...checkString(r.heading, `why_warp.reasons[${i}].heading`));
          errors.push(...checkString(r.body, `why_warp.reasons[${i}].body`, { minLength: 30 }));
        });
      }
    }
  }

  // ── Section 10: final_cta (optional for backward compat) ─────
  if (pageData.final_cta) {
    const fcErrs = checkObject(pageData.final_cta, "final_cta");
    errors.push(...fcErrs);
    if (!fcErrs.length) {
      errors.push(...checkString(pageData.final_cta.headline, "final_cta.headline"));
      errors.push(...checkString(pageData.final_cta.body, "final_cta.body", { minLength: 30 }));
      errors.push(...checkCta(pageData.final_cta.primary_cta, "final_cta.primary_cta"));
    }
  }

  // ── ai_answer_summary (optional for backward compat) ─────────
  if (pageData.ai_answer_summary) {
    errors.push(...checkString(pageData.ai_answer_summary, "ai_answer_summary", { minLength: 100 }));
  }

  // ── Cross-field warnings ──────────────────────────────────────
  if (pageData.page_title && pageData.origin && pageData.destination) {
    const titleLower = pageData.page_title.toLowerCase();
    const originCity = pageData.origin.split(",")[0].trim().toLowerCase();
    const destCity = pageData.destination.split(",")[0].trim().toLowerCase();
    if (!titleLower.includes(originCity)) warnings.push(`page_title should contain origin city: ${originCity}`);
    if (!titleLower.includes(destCity)) warnings.push(`page_title should contain destination city: ${destCity}`);
  }
  if (pageData.hero?.headline && pageData.mode) {
    if (!pageData.hero.headline.toLowerCase().includes(pageData.mode.toLowerCase())) {
      warnings.push(`hero.headline should contain mode: ${pageData.mode}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Copy Helpers ─────────────────────────────────────────────────────

function originCity(knowledge) {
  return knowledge.origin_city || (knowledge.origin || "").split(",")[0].trim();
}

function destCity(knowledge) {
  return knowledge.destination_city || (knowledge.destination || "").split(",")[0].trim();
}

function originState(knowledge) {
  return knowledge.origin_state || (knowledge.origin || "").split(",")[1]?.trim() || "";
}

function destState(knowledge) {
  return knowledge.destination_state || (knowledge.destination || "").split(",")[1]?.trim() || "";
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : String(n ?? "N/A");
}

// ── Canonical Page Builder ───────────────────────────────────────────

/**
 * Build a canonical lane page data object from a lane knowledge object.
 * Produces all required sections with operator-grade, SEO-optimized,
 * AI-search-friendly copy.
 *
 * Copy tone rules:
 *   - Operator-grade, specific, freight-aware, direct, useful, restrained
 *   - NOT theatrical, cheesy, homepage-poetic, startup-fluffy
 *   - Include real lane data (distance, transit, rates, equipment, cross-docks)
 *   - Include WARP-specific operating details (visibility, scheduling, exception handling)
 *   - Directly answer common freight queries for AI search retrieval
 *   - Clean headings, no filler, no awkward pasted bullets
 *
 * @param {object} knowledge - Full lane knowledge object with lane_stats, network_proof, lane data
 * @param {{ corridor_hub: string, related_lanes: Array<{label: string, path: string}>, tool_link: string, data_link: string|null, metro_links?: Array<{label: string, url: string}>, guide_link?: string }} relatedLinks
 * @param {{ impressions?: number, clicks?: number, quotes?: number }} [optionalMetrics] - Optional performance metrics for proof copy
 * @returns {object} Canonical page data matching the schema
 */
export function buildCanonicalLanePageData(knowledge, relatedLinks, optionalMetrics) {
  const k = knowledge;
  const mode = k.mode || "LTL";
  const segment = k.segment || "smb";
  const oCity = originCity(k);
  const dCity = destCity(k);
  const oState = originState(k);
  const dState = destState(k);
  const ls = k.lane_stats || {};
  const np = k.network_proof || {};

  const dist = ls.estimated_distance_miles || 0;
  const transitMin = ls.estimated_transit_days_range?.min || 0;
  const transitMax = ls.estimated_transit_days_range?.max || 0;
  const rateLow = ls.estimated_rate_range_usd?.low || 0;
  const rateHigh = ls.estimated_rate_range_usd?.high || 0;
  const equipment = (ls.common_equipment || []).join(", ") || mode;
  const carrierCount = np.estimated_carrier_count || 0;
  const crossDocks = np.nearest_cross_docks || [];
  const serviceNotes = np.service_notes || [];
  const oRegion = np.origin_region || "Unknown";
  const dRegion = np.destination_region || "Unknown";
  const seasonality = ls.seasonality_notes || "";

  const laneSlug = k.lane_slug || slugify(`${oCity}-${oState}-to-${dCity}-${dState}-${mode}`);
  const canonicalPath = k.canonical_path || `/lanes/${laneSlug}`;

  // ── Page-level fields ─────────────────────────────────────────
  const pageTitle = `${oCity}, ${oState} to ${dCity}, ${dState} ${mode} Freight | WARP`;
  const metaDesc = `Ship ${mode} freight from ${oCity} to ${dCity}: ${fmt(dist)}-mile lane, ${transitMin}\u2013${transitMax} day transit, ${carrierCount} carriers. Get instant rates and real-time tracking through WARP.`;

  // ── Section 1: Hero ───────────────────────────────────────────

  // Distance-band classification for context-aware copy
  let distBand = "regional";
  if (dist > 1200) distBand = "long-haul";
  else if (dist > 800) distBand = "interstate";
  else if (dist < 300) distBand = "metro";

  // Mode + distance-band specific subheadline — not a generic sentence swap
  let subhead;
  if (mode === "LTL") {
    if (distBand === "metro") {
      subhead = `Short-haul LTL with ${transitMin}\u2013${transitMax} day transit across ${fmt(dist)} miles. ${carrierCount} vetted carriers, pallet-level tracking, and managed appointment scheduling on every shipment.`;
    } else if (distBand === "long-haul") {
      subhead = `Long-haul LTL across ${fmt(dist)} miles with ${transitMin}\u2013${transitMax} day transit. ${carrierCount} vetted carriers, optimized linehaul routing, and real-time exception alerts from pickup to delivery.`;
    } else {
      subhead = `${fmt(dist)}-mile LTL corridor with ${transitMin}\u2013${transitMax} day transit. ${carrierCount} vetted carriers providing ${equipment} capacity, real-time tracking, and managed operations.`;
    }
  } else if (mode === "FTL") {
    subhead = `Dedicated capacity on a ${fmt(dist)}-mile corridor. GPS-equipped ${equipment}, ${transitMin}\u2013${transitMax} day transit, and live ETA from pickup to delivery. No terminal handoffs.`;
  } else {
    subhead = `Right-sized ${equipment} service for ${fmt(dist)}-mile loads that do not need a full trailer. Direct routing, ${transitMin}\u2013${transitMax} day transit, and real-time tracking on every shipment.`;
  }

  const hero = {
    headline: `${oCity}, ${oState} to ${dCity}, ${dState} ${mode} Freight`,
    subhead,
    primary_cta: { label: "Get Instant Quote", url: QUOTE_URL },
    secondary_cta: { label: "Book a Fit Call", url: BOOK_URL },
  };

  // ── Section 2: Lane Overview ──────────────────────────────────
  const crossDockStr = crossDocks.length > 0
    ? ` Cross-dock facilities at ${crossDocks.slice(0, 3).join(", ")} support consolidation and transit optimization for this corridor.`
    : "";

  // Distance-band context — adds corridor intelligence beyond city names
  let corridorContext = "";
  if (distBand === "metro") {
    corridorContext = ` At ${fmt(dist)} miles, this is a short-haul corridor where transit is predictable and terminal consolidation is minimal.`;
  } else if (distBand === "long-haul") {
    corridorContext = ` At ${fmt(dist)} miles, this long-haul corridor typically routes through multiple terminals, making carrier selection and transit planning critical.`;
  } else if (distBand === "interstate") {
    corridorContext = ` This ${fmt(dist)}-mile interstate lane connects two distinct freight markets, with transit driven by linehaul routing and terminal schedules.`;
  } else {
    corridorContext = ` This ${fmt(dist)}-mile regional lane benefits from fewer terminal transfers and tighter transit windows.`;
  }

  const overviewBody = `The ${oCity} to ${dCity} ${mode} lane is a freight corridor connecting the ${oRegion} and ${dRegion} regions.${corridorContext} Standard ${mode} transit runs ${transitMin}\u2013${transitMax} business days. WARP operates this lane with ${carrierCount} vetted carriers and common equipment including ${equipment}.${crossDockStr} ${seasonality}`;

  const laneOverview = {
    heading: "Why This Corridor Matters",
    body: overviewBody.trim(),
  };

  // ── Section 3: WARP Fit for Lane ──────────────────────────────
  const warpFitBody = buildWarpFitCopy(oCity, dCity, mode, carrierCount, serviceNotes, crossDocks);
  const warpFitForLane = {
    heading: `How WARP Operates the ${oCity} to ${dCity} Lane`,
    body: warpFitBody,
  };

  // ── Section 4: Operating Details ──────────────────────────────
  const operatingItems = buildOperatingItems(oCity, dCity, mode, ls, np);
  const operatingDetails = {
    heading: `Transit and Operating Details`,
    items: operatingItems,
  };

  // ── Section 5: Pricing & Commercial Framing ───────────────────
  const pricingBody = buildPricingCopy(oCity, dCity, mode, ls, optionalMetrics);
  const pricingAndCommercialFraming = {
    heading: `${mode} Pricing Factors: ${oCity} to ${dCity}`,
    body: pricingBody,
  };

  // ── Section 5b: Best-Fit Shipments ────────────────────────────
  const bestFitShipments = buildBestFitShipments(oCity, dCity, mode, ls, np);

  // ── Section 6: Lane-Specific FAQs ─────────────────────────────
  const laneSpecificFaqs = buildFaqs(oCity, dCity, oState, dState, mode, ls, np);

  // ── Section 7: Related Links ──────────────────────────────────
  const related = {
    corridor_hub: relatedLinks?.corridor_hub || `/corridors/${slugify(oRegion + "-to-" + dRegion)}`,
    related_lanes: relatedLinks?.related_lanes || [],
    tool_link: relatedLinks?.tool_link || QUOTE_URL,
    data_link: relatedLinks?.data_link ?? null,
    metro_links: relatedLinks?.metro_links || [],
    guide_link: relatedLinks?.guide_link || null,
  };

  // ── Section 8: Lane-Relevant CTA ──────────────────────────────
  const laneRelevantCta = {
    headline: `Ship ${mode} Freight: ${oCity} to ${dCity}`,
    body: `Enter your shipment details to get a real-time ${mode} rate for the ${oCity} to ${dCity} lane. No commitment required.`,
    primary_cta: { label: "Get Your Quote", url: QUOTE_URL },
  };

  // ── Section 9: Why Shippers Choose WARP (NEW) ─────────────────
  const whyWarp = buildWhyWarpSection(oCity, dCity, mode, carrierCount, dist, crossDocks);

  // ── Section 10: Final Conversion CTA (NEW) ────────────────────
  const finalCta = buildFinalCtaSection(oCity, dCity, mode, dist, transitMin, transitMax);

  // ── AI Answer Summary ──────────────────────────────────────────
  const aiAnswerSummary = buildAiAnswerSummary(oCity, dCity, oState, dState, mode, ls, np);

  // ── Assemble canonical page data ──────────────────────────────
  return {
    page_title: pageTitle,
    meta_description: metaDesc,
    lane_slug: laneSlug,
    canonical_path: canonicalPath,
    mode,
    segment,
    origin: k.origin || `${oCity}, ${oState}`,
    destination: k.destination || `${dCity}, ${dState}`,
    ai_answer_summary: aiAnswerSummary,
    lane_stats: {
      estimated_distance_miles: ls.estimated_distance_miles,
      estimated_transit_days_range: ls.estimated_transit_days_range,
      estimated_rate_range_usd: ls.estimated_rate_range_usd,
      common_freight_class_range: ls.common_freight_class_range ?? null,
      common_equipment: ls.common_equipment || [],
      seasonality_notes: ls.seasonality_notes || "",
      transit_time_estimate_label: ls.transit_time_estimate_label,
      rate_estimate_label: ls.rate_estimate_label,
      confidence: ls.confidence,
      assumptions: ls.assumptions,
      disclaimers: ls.disclaimers,
    },
    network_proof: {
      estimated_carrier_count: np.estimated_carrier_count,
      nearest_cross_docks: np.nearest_cross_docks || [],
      service_notes: np.service_notes || [],
      origin_region: oRegion,
      destination_region: dRegion,
    },
    hero,
    lane_overview: laneOverview,
    warp_fit_for_lane: warpFitForLane,
    operating_details: operatingDetails,
    pricing_and_commercial_framing: pricingAndCommercialFraming,
    best_fit_shipments: bestFitShipments,
    lane_specific_faqs: laneSpecificFaqs,
    related_links: related,
    why_warp: whyWarp,
    final_cta: finalCta,
    lane_relevant_cta: laneRelevantCta,
  };
}

// ── Section Copy Builders ────────────────────────────────────────────

/**
 * Build WARP Fit section copy. Operator-grade, not fluffy.
 */
function buildWarpFitCopy(oCity, dCity, mode, carrierCount, serviceNotes, crossDocks) {
  const parts = [];
  parts.push(`WARP covers the ${oCity} to ${dCity} corridor with a vetted network of ${carrierCount} carriers providing ${mode} capacity.`);

  if (serviceNotes.length > 0) {
    parts.push(`Service capabilities on this lane include: ${serviceNotes.slice(0, 3).join("; ")}.`);
  }

  if (mode === "LTL") {
    parts.push("Every LTL shipment on this lane receives pallet-level tracking from pickup through delivery. Appointment scheduling and delivery confirmation are managed directly by WARP's operations team. Carrier selection is optimized per-shipment based on transit performance history and equipment fit for this corridor.");
  } else if (mode === "FTL") {
    parts.push("Dedicated trailers on this lane are GPS-equipped with live ETA updates and geofenced arrival/departure alerts. You get full visibility without calling the carrier. Dispatch, driver coordination, and detention tracking are managed by WARP's operations team.");
  } else {
    parts.push("Cargo van and box truck shipments on this lane are right-sized for smaller freight — direct service without paying for unused trailer space. Vehicle matching is based on your load dimensions and weight, so you get the right capacity for the shipment.");
  }

  if (crossDocks.length > 0) {
    parts.push(`Cross-dock operations at ${crossDocks.slice(0, 2).join(" and ")} enable consolidation and re-routing when exceptions occur on this corridor.`);
  }

  parts.push("Exception alerts fire within 30 minutes of any status change. WARP's operations team handles carrier coordination, rescheduling, and resolution without requiring shipper follow-up.");

  return parts.join(" ");
}

/**
 * Build Operating Details bullet items. Minimum 4, typically 6-8.
 */
function buildOperatingItems(oCity, dCity, mode, laneStats, networkProof) {
  const items = [];
  const dist = laneStats.estimated_distance_miles;
  const transitMin = laneStats.estimated_transit_days_range?.min;
  const transitMax = laneStats.estimated_transit_days_range?.max;
  const equipment = laneStats.common_equipment || [];
  const crossDocks = networkProof.nearest_cross_docks || [];
  const carrierCount = networkProof.estimated_carrier_count;

  if (dist) items.push(`Lane distance: ${fmt(dist)} miles (${oCity} to ${dCity})`);
  if (transitMin && transitMax) items.push(`Standard transit: ${transitMin}\u2013${transitMax} business days for ${mode} service`);
  if (equipment.length > 0) items.push(`Available equipment: ${equipment.join(", ")}`);
  if (carrierCount) items.push(`Active carriers: ${carrierCount} vetted providers on this corridor`);
  if (crossDocks.length > 0) items.push(`Nearest cross-dock facilities: ${crossDocks.join(", ")}`);

  // WARP-specific operating details
  items.push("Real-time scan events at pickup, in-transit checkpoints, and delivery milestones");
  items.push("Exception alerts within 30 minutes of status changes with automated escalation");
  items.push("Delivery appointment scheduling and confirmation managed by WARP operations");

  return items;
}

/**
 * Build Pricing section copy. Lane-specific, not generic.
 */
function buildPricingCopy(oCity, dCity, mode, laneStats, metrics) {
  const rateLow = laneStats.estimated_rate_range_usd?.low;
  const rateHigh = laneStats.estimated_rate_range_usd?.high;
  const dist = laneStats.estimated_distance_miles;
  const disclaimer = laneStats.estimated_rate_range_usd?.disclaimer || "";

  const parts = [];
  if (rateLow && rateHigh) {
    parts.push(`${mode} rates on the ${oCity} to ${dCity} lane typically range from $${fmt(rateLow)} to $${fmt(rateHigh)}, depending on freight class, weight, pallet count, and seasonal demand.`);
  } else {
    parts.push(`${mode} rates on the ${oCity} to ${dCity} lane vary based on freight class, weight, pallet count, and current carrier availability.`);
  }

  if (mode === "LTL") {
    parts.push("Key cost drivers include NMFC freight classification, shipment density, and accessorials such as liftgate, inside delivery, or limited-access pickup.");
  } else if (mode === "FTL") {
    parts.push("Primary cost factors are lane distance, equipment type (dry van, flatbed, or reefer), and current spot-market capacity on this corridor.");
  } else {
    parts.push("Pricing is driven by vehicle type, lane distance, and right-sized capacity matching for your freight.");
  }

  if (dist) {
    const perMile = rateLow && rateHigh ? ` (approximately $${(((rateLow + rateHigh) / 2) / dist).toFixed(2)}/mile)` : "";
    parts.push(`At ${fmt(dist)} miles, the linehaul distance is the largest cost component${perMile}. Fuel surcharges are applied as a separate line item based on current diesel prices.`);
  }

  if (metrics?.quotes) {
    parts.push(`WARP has processed ${fmt(metrics.quotes)} quotes on this lane, providing a data-informed rate range.`);
  }

  if (disclaimer) {
    parts.push(disclaimer);
  } else {
    parts.push("These are modeled estimates. Enter your shipment details to get a real-time, all-in rate.");
  }

  return parts.join(" ");
}

/**
 * Build Best-Fit Shipments section. Answers "when is WARP a good fit"
 * for AI search retrieval. Lane- and mode-specific.
 */
function buildBestFitShipments(oCity, dCity, mode, laneStats, networkProof) {
  const dist = laneStats.estimated_distance_miles;
  const crossDocks = networkProof.nearest_cross_docks || [];

  let intro;
  const items = [];

  if (mode === "LTL") {
    intro = `WARP is a strong fit for LTL shipments on the ${oCity} to ${dCity} lane when you need predictable transit, real-time visibility, and operational support without managing carrier relationships directly.`;
    items.push(
      "1\u20136 pallet shipments with standard or appointment-based delivery requirements",
      "Recurring retail or distribution replenishment freight on this corridor",
      "Shipments requiring real-time tracking and proactive exception management",
      "Freight that needs transparent, all-in pricing without manual quote follow-up",
      "Shippers consolidating carrier relationships to reduce vendor complexity",
    );
    if (crossDocks.length > 0) {
      items.push(`Freight benefiting from cross-dock consolidation at ${crossDocks.slice(0, 2).join(" or ")}`);
    }
  } else if (mode === "FTL") {
    intro = `WARP is a strong fit for FTL shipments on the ${oCity} to ${dCity} lane when you need dedicated capacity, GPS-equipped trailers, and managed operations.`;
    items.push(
      "Full truckload shipments requiring dedicated, non-stop transit on this corridor",
      "Time-sensitive freight needing GPS tracking and live ETA updates",
      "Shipments requiring specialized equipment (flatbed, reefer, or dry van)",
      "Shippers who need capacity without maintaining individual carrier contracts",
      "Freight operations that require automated exception detection and escalation",
    );
  } else {
    intro = `WARP is a strong fit for cargo van and box truck shipments on the ${oCity} to ${dCity} lane when you need right-sized capacity without overpaying for unused trailer space.`;
    items.push(
      "Smaller freight loads that do not require a full 53-foot trailer",
      "Last-mile or final-mile delivery freight on this corridor",
      "Time-sensitive shipments benefiting from direct, terminal-free routing",
      "Shippers looking for predictable per-shipment pricing on smaller loads",
      "Freight requiring flexible pickup and delivery windows",
    );
  }

  return {
    heading: `Best-Fit Shipments: ${oCity} to ${dCity} ${mode}`,
    intro,
    items,
    cta_text: `Get an instant quote to see if WARP is the right fit for your ${oCity} to ${dCity} freight.`,
  };
}

/**
 * Build lane-specific FAQs. 7 FAQs covering the key questions
 * AI search and humans ask about freight lanes.
 */
function buildFaqs(oCity, dCity, oState, dState, mode, laneStats, networkProof) {
  const dist = laneStats.estimated_distance_miles;
  const transitMin = laneStats.estimated_transit_days_range?.min;
  const transitMax = laneStats.estimated_transit_days_range?.max;
  const rateLow = laneStats.estimated_rate_range_usd?.low;
  const rateHigh = laneStats.estimated_rate_range_usd?.high;
  const carrierCount = networkProof.estimated_carrier_count;

  return [
    {
      question: `How much does ${mode} freight from ${oCity}, ${oState} to ${dCity}, ${dState} cost?`,
      answer: rateLow && rateHigh
        ? `Estimated ${mode} rates on this lane range from $${fmt(rateLow)} to $${fmt(rateHigh)}, based on freight class, weight, pallet count, and current market conditions. Enter your shipment details on WARP for an instant, all-in rate.`
        : `${mode} rates on this lane depend on freight class, weight, pallet count, and current carrier availability. Enter your shipment details on WARP for an instant rate.`,
    },
    {
      question: `What is the transit time for ${mode} shipments from ${oCity} to ${dCity}?`,
      answer: transitMin && transitMax
        ? `Standard ${mode} transit on the ${oCity} to ${dCity} lane is ${transitMin}\u2013${transitMax} business days. This ${dist ? fmt(dist) + "-mile" : ""} corridor's actual transit depends on carrier routing, terminal schedules, and pickup timing.`
        : `Transit time varies based on carrier routing and scheduling. Contact WARP for lane-specific transit estimates.`,
    },
    {
      question: `What carriers does WARP use on the ${oCity} to ${dCity} lane?`,
      answer: carrierCount
        ? `WARP operates this lane with approximately ${carrierCount} vetted carriers. Carrier selection is optimized for each shipment based on equipment requirements, transit targets, and on-time performance history.`
        : `WARP selects from a vetted carrier network based on equipment requirements, transit targets, and on-time performance history for this lane.`,
    },
    {
      question: `Can I track my ${mode} shipment from ${oCity} to ${dCity} in real time?`,
      answer: `Yes. Every WARP shipment includes real-time tracking with scan events at pickup, in-transit checkpoints, and delivery. Exception alerts fire within 30 minutes of any status change, and WARP's operations team manages resolution directly without requiring shipper follow-up.`,
    },
    {
      question: `What equipment is available for ${mode} freight on this lane?`,
      answer: laneStats.common_equipment?.length
        ? `Common equipment on the ${oCity} to ${dCity} corridor includes ${laneStats.common_equipment.join(", ")}. Equipment availability varies by season and demand. Specify your requirements when requesting a quote.`
        : `Equipment availability depends on mode and shipment requirements. Specify your needs when requesting a quote for this lane.`,
    },
    {
      question: `What affects ${mode} freight rates from ${oCity} to ${dCity}?`,
      answer: `Key rate factors on this lane include freight class (NMFC classification), shipment weight and density, pallet count, accessorial services (liftgate, inside delivery, limited access), seasonal demand, and current carrier capacity. Fuel surcharges are applied separately based on current diesel prices.`,
    },
    {
      question: `What makes WARP different from traditional ${mode} freight brokers?`,
      answer: `WARP provides self-serve instant quoting (under 2 minutes vs. hours with traditional brokers), a side-by-side carrier comparison dashboard, one-click booking with digital BOL, real-time tracking with proactive exception alerts, and managed operations where WARP handles carrier coordination and resolution directly.`,
    },
  ];
}

// ── NEW: Why Shippers Choose WARP Section Builder ─────────────────────

/**
 * Build the "Why Shippers Choose WARP" section with lane-specific proof points.
 * This replaces the generic marketing section from the Webflow template with
 * operator-grade, route-specific content.
 */
function buildWhyWarpSection(oCity, dCity, mode, carrierCount, dist, crossDocks) {
  const isLongHaul = dist > 1000;
  const hasXDock = crossDocks && crossDocks.length > 0;

  const reasons = [];

  // Reason 1: Self-serve quoting (always)
  reasons.push({
    heading: "Self-Serve Instant Quoting",
    body: `Get ${mode} rates for the ${oCity} to ${dCity} lane in under 2 minutes. No phone calls, no email chains, no waiting for a broker to call back. Enter your freight details and compare carrier options side-by-side.`,
  });

  // Reason 2: Visibility (always)
  reasons.push({
    heading: "Real-Time Shipment Visibility",
    body: `Every ${mode} shipment on this ${fmt(dist)}-mile corridor includes milestone tracking from pickup through delivery. Exception alerts fire within 30 minutes of any status change — you see issues before they become problems.`,
  });

  // Reason 3: Managed operations (always)
  reasons.push({
    heading: "Managed Operations",
    body: `WARP's operations team handles carrier coordination, appointment scheduling, and exception resolution on the ${oCity} to ${dCity} lane. You move freight without managing carrier relationships.`,
  });

  // Reason 4: Network depth (lane-specific)
  if (carrierCount > 0) {
    reasons.push({
      heading: "Vetted Carrier Network",
      body: `${carrierCount} vetted carriers operate this corridor, providing consistent ${mode} capacity${isLongHaul ? " across this long-haul route" : ""}. Carrier selection is optimized per-shipment based on performance history and equipment fit.`,
    });
  }

  // Reason 5: Cross-dock advantage (if available)
  if (hasXDock) {
    reasons.push({
      heading: "Cross-Dock Infrastructure",
      body: `Cross-dock facilities at ${crossDocks.slice(0, 2).join(" and ")} support consolidation and re-routing when exceptions occur on this corridor. This infrastructure enables better transit reliability on the ${oCity} to ${dCity} lane.`,
    });
  }

  // Reason 6: Pricing transparency (always)
  reasons.push({
    heading: "Transparent Pricing",
    body: `All-in ${mode} rates with no hidden fees. Fuel surcharges, accessorials, and linehaul are broken out clearly. See exactly what you're paying before you book.`,
  });

  return {
    heading: `Why Shippers Use WARP for ${oCity} to ${dCity} Freight`,
    reasons,
  };
}

// ── NEW: Final Conversion CTA Section Builder ─────────────────────────

/**
 * Build the final conversion CTA section. Lane-specific, action-oriented,
 * positioned after all content sections to capture high-intent readers.
 */
function buildFinalCtaSection(oCity, dCity, mode, dist, transitMin, transitMax) {
  const distLabel = dist ? `${fmt(dist)}-mile` : "";
  const transitLabel = (transitMin && transitMax) ? `${transitMin}\u2013${transitMax} day transit` : "standard transit";

  return {
    headline: `Ready to Ship ${mode} Freight from ${oCity} to ${dCity}?`,
    body: `Get an instant ${mode} rate for this ${distLabel} corridor. ${transitLabel}, real-time tracking, and managed operations included. No commitment required — enter your shipment details and compare options.`,
    primary_cta: { label: "Get Instant Quote", url: QUOTE_URL },
    secondary_cta: { label: "Talk to an Expert", url: BOOK_URL },
    trust_signals: [
      "Instant rate in under 2 minutes",
      "No commitment to book",
      "Real-time tracking included",
      "Managed exception handling",
    ],
  };
}

// ── NEW: AI Answer Summary Builder ────────────────────────────────────

/**
 * Build a concise AI answer summary optimized for AI search retrieval.
 * This is a single paragraph that directly answers the most common query
 * about shipping freight on this lane. Designed for AI systems to extract
 * and present as a direct answer.
 */
function buildAiAnswerSummary(oCity, dCity, oState, dState, mode, laneStats, networkProof) {
  const dist = laneStats.estimated_distance_miles || 0;
  const transitMin = laneStats.estimated_transit_days_range?.min || 0;
  const transitMax = laneStats.estimated_transit_days_range?.max || 0;
  const rateLow = laneStats.estimated_rate_range_usd?.low || 0;
  const rateHigh = laneStats.estimated_rate_range_usd?.high || 0;
  const carrierCount = networkProof.estimated_carrier_count || 0;
  const equipment = (laneStats.common_equipment || []).join(", ") || mode;

  const ratePart = (rateLow && rateHigh)
    ? ` Estimated ${mode} rates range from $${fmt(rateLow)} to $${fmt(rateHigh)} depending on freight class, weight, and accessorials.`
    : "";

  return `${mode} freight from ${oCity}, ${oState} to ${dCity}, ${dState} covers approximately ${fmt(dist)} miles with ${transitMin}\u2013${transitMax} business day transit.${ratePart} WARP operates this lane with ${carrierCount} vetted carriers providing ${equipment} capacity. Shippers get instant self-serve quoting, real-time tracking with exception alerts, and managed operations without direct carrier coordination. Get a rate at wearewarp.com/quote.`;
}
