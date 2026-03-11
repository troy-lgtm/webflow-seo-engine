/**
 * Lane Factory — Shared Manufacturing & Production Functions
 *
 * Extracted from publish_next.js to serve both the existing
 * publish pipeline and the new autonomous lane page factory.
 *
 * Manufacturing: buildPackageForLane, buildBodyContent, buildWebflowFields,
 *   buildFaqSchemaEmbed, buildBreadcrumbSchemaEmbed, buildLaneFaqs
 *
 * Production: shipOneLane
 *
 * Priority: computeHubPriority, computeClusterPriority
 *
 * Utility: stableHash, seededRng, buildLaneSlug, buildCanonicalPath
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getProjectRoot } from "./fs/project-root.js";
import { stableHash, seededRng } from "./hash.js";
import { buildLaneKnowledge } from "./lane-knowledge.js";
import { buildCanonicalLanePageData } from "./lane-page-schema.js";
import {
  renderLanePageBody,
  renderLanePageHtml,
  renderFaqSchemaEmbed as renderFaqSchemaEmbedFn,
  renderBreadcrumbSchemaEmbed as renderBreadcrumbSchemaEmbedFn,
  renderWebflowFields as renderWebflowFieldsFn,
} from "./render-lane-page.js";
import { logBundleSelection } from "./bundle-logger.js";

const ROOT = getProjectRoot();

// ── Utility Functions ───────────────────────────────────────────────────
// stableHash and seededRng are imported from lib/hash.js (single source of truth)
// and re-exported below for backward compatibility with downstream consumers.
export { stableHash, seededRng };

export function buildLaneSlug(origin, destination) {
  const citySlug = (s) =>
    s.split(",")[0].trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `${citySlug(origin)}-to-${citySlug(destination)}`;
}

export function buildCanonicalPathForLane(origin, destination, mode) {
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `/${slug(mode)}-freight-${slug(origin)}-to-${slug(destination)}`;
}

// ── Hub Priority Scoring ────────────────────────────────────────────────

export const MAJOR_HUBS = new Set([
  "los angeles", "chicago", "dallas", "atlanta", "new york", "houston",
]);

export const TIER2_HUBS = new Set([
  "miami", "seattle", "san francisco", "phoenix", "denver", "las vegas",
  "portland", "indianapolis", "nashville", "charlotte", "tampa", "orlando",
  "kansas city", "salt lake city", "minneapolis", "memphis",
]);

export const CLUSTER_SECONDARY_METROS = new Set([
  "houston", "new york", "los angeles", "miami", "nashville", "charlotte",
]);

export function loadLearningStateForPriority() {
  try {
    const p = path.join(ROOT, "artifacts", "learning_state.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { /* ignore */ }
  return null;
}

/**
 * Compute a publish priority boost based on learned archetype performance.
 * Maps archetype weight [0.3, 1.5] → boost [0, 20].
 */
export function computeLearnedPriorityBoost(archetypeId, archetypeWeights) {
  if (!archetypeWeights || !archetypeId) return 0;
  const aw = archetypeWeights[archetypeId];
  if (!aw) return 0;
  const weight = aw.priority_weight || 1.0;
  return Math.max(0, Math.min(20, Math.round((weight - 0.3) / 1.2 * 20)));
}

/**
 * Compute hub priority score for a lane.
 * Higher = publish first.
 *   Major hub origin or dest:   +20 each
 *   Tier2 hub origin or dest:   +10 each
 *   Reverse of already-published lane: +15
 *   Both cities are major hubs: +10 bonus (dense cluster)
 *   Deterministic tiebreaker:   stableHash % 100
 */
export function computeHubPriority(lane, publishedSlugs, learningState) {
  let score = 0;
  const oCity = (lane.origin || "").split(",")[0].trim().toLowerCase();
  const dCity = (lane.destination || "").split(",")[0].trim().toLowerCase();

  if (MAJOR_HUBS.has(oCity)) score += 20;
  if (MAJOR_HUBS.has(dCity)) score += 20;
  if (TIER2_HUBS.has(oCity)) score += 10;
  if (TIER2_HUBS.has(dCity)) score += 10;

  // Dense cluster bonus: both cities are major hubs
  if (MAJOR_HUBS.has(oCity) && MAJOR_HUBS.has(dCity)) score += 10;

  // Reverse lane bonus: if the reverse is already published, this strengthens internal linking
  const reverseSlug = `${dCity.replace(/\s+/g, "-")}-to-${oCity.replace(/\s+/g, "-")}`;
  if (publishedSlugs.has(reverseSlug)) score += 15;

  // Learning boost: archetype performance (0-20 points from learned weights)
  if (learningState?.archetype_weights && lane.archetype_id) {
    score += computeLearnedPriorityBoost(lane.archetype_id, learningState.archetype_weights);
  }

  // Deterministic tiebreaker
  score += stableHash(lane.slug || `${oCity}-to-${dCity}`) % 100 / 100;

  return score;
}

/**
 * Parse --cluster flag value into a Set of city names.
 * e.g. "chicago-dallas-atlanta" → Set(["chicago", "dallas", "atlanta"])
 */
export function parseClusterCities(flagValue) {
  if (!flagValue) return null;
  return new Set(flagValue.split("-").map(c => c.trim().toLowerCase()).filter(Boolean));
}

/**
 * Compute cluster priority score for a lane.
 * Tier A: Both cities in cluster  → 1000 base
 * Tier B: One in cluster, other in secondary metros → 500 base
 * Tier C: One in cluster, other anywhere → 250 base
 * Tier D: Everything else → 0
 * Within each tier: deterministic tiebreaker via stableHash.
 */
export function computeClusterPriority(lane, clusterCities, publishedSlugs) {
  let score = 0;
  const oCity = (lane.origin || "").split(",")[0].trim().toLowerCase();
  const dCity = (lane.destination || "").split(",")[0].trim().toLowerCase();
  const oInCluster = clusterCities.has(oCity);
  const dInCluster = clusterCities.has(dCity);
  const oIsSecondary = CLUSTER_SECONDARY_METROS.has(oCity);
  const dIsSecondary = CLUSTER_SECONDARY_METROS.has(dCity);

  if (oInCluster && dInCluster) {
    score = 1000;
  } else if ((oInCluster && dIsSecondary) || (dInCluster && oIsSecondary)) {
    score = 500;
  } else if (oInCluster || dInCluster) {
    score = 250;
  }

  // Reverse lane bonus
  const reverseSlug = `${dCity.replace(/\s+/g, "-")}-to-${oCity.replace(/\s+/g, "-")}`;
  if (publishedSlugs.has(reverseSlug)) score += 15;

  // Deterministic tiebreaker
  score += stableHash(lane.slug || `${oCity}-to-${dCity}`) % 100 / 100;

  return score;
}

// ── Lane Intelligence ───────────────────────────────────────────────────

export function enrichLaneInline(page) {
  if (!page?.lane) return;
  const knowledge = buildLaneKnowledge(page.lane);
  page.lane_stats = knowledge.lane_stats;
  page.network_proof = knowledge.network_proof;
}

// ── Lane-Specific FAQ Generation ────────────────────────────────────────

const FAQ_TEMPLATES = {
  transit: (o, d, mode, stats) => ({
    q: `How long does ${mode} freight take from ${o} to ${d}?`,
    a: `Estimated transit for ${mode} freight on this ${stats.estimated_distance_miles}-mile lane is ${stats.estimated_transit_days_range.min}\u2013${stats.estimated_transit_days_range.max} business days. Actual transit depends on pickup schedule, carrier routing, and weather conditions.`,
  }),
  cost: (o, d, mode, stats) => ({
    q: `How much does ${mode} shipping from ${o} to ${d} cost?`,
    a: `Estimated ${mode} rates on this lane range from $${stats.estimated_rate_range_usd.low.toLocaleString()} to $${stats.estimated_rate_range_usd.high.toLocaleString()} depending on weight, freight class, pallet count, and seasonal demand. These are modeled estimates \u2014 get an exact quote by entering your shipment details.`,
  }),
  pilot: (o, d, mode) => ({
    q: `How fast can we launch a ${mode} pilot from ${o} to ${d}?`,
    a: `Most shipping teams can scope a single-lane pilot and begin quoting within days. Start with this corridor, measure quote speed and transit reliability, then expand based on results.`,
  }),
  tracking: (o, d, mode) => ({
    q: `How does WARP handle tracking on the ${o} to ${d} lane?`,
    a: `WARP provides real-time visibility with scan events at pickup, in-transit checkpoints, and delivery confirmation. Exception alerts fire within 30 minutes of any status change so you can resolve issues before they impact customers.`,
  }),
  equipment: (o, d, mode, stats) => ({
    q: `What equipment is available for ${mode} freight from ${o} to ${d}?`,
    a: `Common equipment on this lane includes ${stats.common_equipment.join(", ")}. Equipment availability varies by season and demand \u2014 WARP's carrier network provides multiple options for your freight profile.`,
  }),
  single_lane: (o, d) => ({
    q: `Can we start with just the ${o} to ${d} lane before expanding?`,
    a: `Yes. A single-lane rollout lets you validate WARP's performance on this specific corridor before committing to additional lanes. Most teams expand within weeks after seeing results.`,
  }),
  exceptions: (o, d, mode) => ({
    q: `How are shipping exceptions handled on this ${mode} lane?`,
    a: `WARP's platform detects exceptions automatically and escalates within minutes. You get proactive alerts for delays, appointment changes, and delivery issues \u2014 no more chasing carriers for updates.`,
  }),
  metrics: (o, d, mode) => ({
    q: `What metrics should we track on this ${mode} lane?`,
    a: `Focus on quote response time, on-time delivery rate, transit time consistency, exception frequency, and cost-per-shipment trends. These give you a clear go/no-go signal for scaling to more lanes.`,
  }),
};

export function buildLaneFaqs(origin, destination, mode, laneStats) {
  const o = origin.split(",")[0].trim();
  const d = destination.split(",")[0].trim();
  const keys = ["transit", "cost", "pilot", "tracking", "equipment", "single_lane", "exceptions", "metrics"];
  const hash = stableHash(`${o}|${d}|${mode}`);
  const start = hash % keys.length;
  const selected = [];
  for (let i = 0; i < 5; i++) {
    selected.push(keys[(start + i) % keys.length]);
  }
  return selected.map((k) => FAQ_TEMPLATES[k](o, d, mode, laneStats));
}

// ── Manufacturing: Page Spec Builder ────────────────────────────────────

/**
 * Build a complete lane page package for Webflow publishing.
 *
 * @param {string} origin - "City, ST" format
 * @param {string} destination - "City, ST" format
 * @param {string} mode - LTL, FTL, or "Cargo Van / Box Truck"
 * @param {string} segment - smb, midmarket, enterprise
 * @returns {object} Complete page package
 */
export function buildPackageForLane(origin, destination, mode, segment) {
  const slug = buildLaneSlug(origin, destination);
  const canonicalPath = `/${slug}`;
  const oCity = origin.split(",")[0].trim();
  const dCity = destination.split(",")[0].trim();
  const seoTitle = `${origin} to ${destination} ${mode} Freight Quotes | WARP`;
  const h1 = `${origin} to ${destination} ${mode} freight quotes`;
  const metaDescription = `Compare ${mode} freight rates from ${oCity} to ${dCity}. Get instant quotes, estimated transit times, and book freight in minutes with WARP.`;

  const modeProblems = {
    LTL: `LTL shippers on the ${oCity} to ${dCity} corridor struggle with inconsistent transit times, opaque pricing from legacy brokers, and fragmented visibility across multiple carriers. Most teams spend hours chasing quotes and tracking updates manually.`,
    FTL: `FTL shippers on the ${oCity} to ${dCity} lane face capacity volatility, rate uncertainty, and limited visibility into carrier performance. Securing reliable truck capacity requires multiple broker calls with no guarantee of service quality.`,
    "Cargo Van / Box Truck": `Mid-sized shippers moving freight from ${oCity} to ${dCity} fall between LTL and FTL \u2014 paying too much for either without a right-sized vehicle option. Cargo van and box truck service fills this gap but finding providers is difficult.`,
  };
  const modeSolutions = {
    LTL: `WARP provides instant ${mode} quotes on the ${oCity} to ${dCity} lane with real-time carrier comparison, one-click booking, and proactive exception management \u2014 replacing days of manual work with minutes of operational efficiency.`,
    FTL: `WARP delivers lane-level capacity intelligence, transparent rate comparison, and performance scoring for ${mode} operations from ${oCity} to ${dCity} \u2014 giving your team predictable access to quality carriers.`,
    "Cargo Van / Box Truck": `WARP's cargo van and box truck service provides right-sized vehicle options for the ${oCity} to ${dCity} corridor, delivering direct service with the right capacity at competitive pricing, with full visibility from pickup to delivery.`,
  };

  const page = {
    slug,
    canonical_path: canonicalPath,
    seo_title: seoTitle,
    h1,
    meta_description: metaDescription,
    target_segment: segment,
    lane: { origin, destination, mode },
    lane_stats: {},
    network_proof: {},
    problem_section: modeProblems[mode] || modeProblems.LTL,
    solution_section: modeSolutions[mode] || modeSolutions.LTL,
    cta_primary: "Book 15-min Fit Call",
    cta_secondary: "Get Instant Quote",
    cta_primary_url: "https://www.wearewarp.com/book",
    cta_secondary_url: "https://www.wearewarp.com/quote",
    contrast: {
      headline: `Why ${mode} shippers switch from brokers to WARP`,
      points: [
        { metric: "Quote speed", legacy: "2\u201324 hours via phone/email", warp: "Under 2 minutes, self-serve" },
        { metric: "Carrier comparison", legacy: "Manual spreadsheets", warp: "Side-by-side dashboard with performance data" },
        { metric: "Booking", legacy: "Email chains, 30\u201360 min", warp: "One-click from quote to BOL" },
        { metric: "Tracking", legacy: "Call carrier for updates", warp: "Real-time dashboard with exception alerts" },
        { metric: "Exception handling", legacy: "Reactive, hours to discover", warp: "Proactive alerts within 30 minutes" },
      ],
      bottom_line: `Shipping ${mode} from ${oCity} to ${dCity} with WARP eliminates the manual back-and-forth that costs logistics teams hours per shipment.`,
    },
  };

  // Enrich with lane intelligence (distance, rates, transit, network proof)
  enrichLaneInline(page);

  const stats = page.lane_stats;

  // Build intro with lane-specific operational data
  page.intro = `${mode} freight from ${origin} to ${destination} covers approximately ${stats.estimated_distance_miles.toLocaleString()} miles with estimated transit of ${stats.estimated_transit_days_range.min}\u2013${stats.estimated_transit_days_range.max} business days. WARP's carrier network on this corridor includes ${page.network_proof.estimated_carrier_count}+ providers with cross-dock facilities at ${page.network_proof.nearest_cross_docks.slice(0, 3).join(", ")}. Get instant lane-specific quotes, compare carriers, and book in minutes.`;

  // Proof section with lane data
  page.proof_section = `Validate this lane with a controlled pilot: ${origin} to ${destination}. Track quote response time, transit predictability, and exception rate across ${page.network_proof.estimated_carrier_count} active carriers on this ${stats.estimated_distance_miles}-mile corridor. ${mode === "LTL" ? "Equipment includes " + stats.common_equipment.join(" and ") + "." : ""} Start with this single lane, measure results, and expand based on data.`;

  // Lane-specific FAQs (not generic)
  page.faq = buildLaneFaqs(origin, destination, mode, stats);

  // Quick answers for AI search
  const quickAnswers = [
    {
      question: `How much does ${mode} freight from ${oCity} to ${dCity} cost?`,
      answer: `Estimated ${mode} rates on the ${oCity} to ${dCity} lane range from $${stats.estimated_rate_range_usd.low.toLocaleString()} to $${stats.estimated_rate_range_usd.high.toLocaleString()} depending on weight, freight class, pallet count, and seasonal demand. These are modeled estimates \u2014 get an exact quote with WARP.`,
    },
    {
      question: `How long does ${mode} transit take from ${oCity} to ${dCity}?`,
      answer: `Estimated transit time for ${mode} freight on this ${stats.estimated_distance_miles}-mile lane is ${stats.estimated_transit_days_range.min}\u2013${stats.estimated_transit_days_range.max} business days under standard conditions.`,
    },
  ];

  // Schemas
  page.schema_breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "WARP", item: "https://www.wearewarp.com" },
      { "@type": "ListItem", position: 2, name: `${mode} Freight`, item: `https://www.wearewarp.com/guides/${mode.toLowerCase()}` },
      { "@type": "ListItem", position: 3, name: `${oCity} to ${dCity}` },
    ],
  };
  page.schema_service = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `${mode} Freight Service \u2014 ${oCity} to ${dCity}`,
    provider: { "@type": "Organization", name: "WARP", url: "https://www.wearewarp.com" },
    areaServed: [origin, destination],
    description: `${mode} freight shipping from ${origin} to ${destination} with instant quoting, carrier comparison, and real-time tracking.`,
  };
  page.schema_organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "WARP",
    url: "https://www.wearewarp.com",
    description: "Technology-driven freight logistics platform",
  };

  const fp = String(stableHash([canonicalPath, seoTitle, h1, page.intro.slice(0, 200)].join("|")));

  return {
    page,
    canonicalPath,
    quickAnswers,
    contentFingerprint: fp,
    origin,
    destination,
    mode,
    segment,
  };
}

// ── Content Rendering Delegates ─────────────────────────────────────────

/**
 * Build canonical data from a page's lane knowledge.
 * Shared by all content rendering functions.
 * Caches result on the page object (_canonicalData) to avoid rebuilding
 * buildLaneKnowledge 4× per page (body, faq, breadcrumb, webflowFields).
 */
function buildCanonicalDataFromPage(page) {
  if (page._canonicalData) return page._canonicalData;
  const knowledge = buildLaneKnowledge(page.lane);
  knowledge.origin = page.lane.origin;
  knowledge.destination = page.lane.destination;
  knowledge.segment = page.target_segment || "smb";
  const data = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null,
    related_lanes: [],
    tool_link: "https://www.wearewarp.com/quote",
    data_link: null,
  });
  page._canonicalData = data;

  // Log bundle selection for experiment tracking (non-blocking)
  try {
    const faqs = data.lane_specific_faqs || [];
    const faqIds = faqs.map((f, i) => {
      // Use FAQ roster ID if present, otherwise generate a stable hash
      if (f.id) return f.id;
      const qHash = stableHash(f.question || `faq_${i}`);
      return `faq_${qHash}`;
    });
    logBundleSelection({
      slug: page.slug || data.lane_slug,
      archetype_id: page.archetype_id || page.lane?.archetype_id || null,
      faq_ids: faqIds,
      intro_template_id: "canonical_v2",
      title_pattern_id: "default",
      meta_pattern_id: "default",
      cta_variant_id: "default",
      quality_score: null, // Computed separately by page-quality-scorer
      mode: data.mode || page.lane?.mode || "LTL",
      segment: data.segment || page.target_segment || "smb",
    });
  } catch {
    // Bundle logging is non-fatal — never block page generation
  }

  return data;
}

/**
 * Build the full HTML body content (9 sections) for validation and preview.
 * This is the rich HTML version used by runFullValidation() and static export.
 * NOT used for the Webflow body-content CMS field (which is PlainText).
 *
 * For the Webflow CMS field value, see renderWebflowFields() → "body-content",
 * which calls renderLanePageBody() (plain text version).
 */
export function buildBodyContent(page) {
  const canonicalData = buildCanonicalDataFromPage(page);
  return renderLanePageHtml(canonicalData);
}

/**
 * Build FAQ schema embed (JSON-LD + HTML).
 */
export function buildFaqSchemaEmbed(page) {
  const canonicalData = buildCanonicalDataFromPage(page);
  return renderFaqSchemaEmbedFn(canonicalData);
}

/**
 * Build breadcrumb + service + organization schema embed.
 */
export function buildBreadcrumbSchemaEmbed(page) {
  const canonicalData = buildCanonicalDataFromPage(page);
  return renderBreadcrumbSchemaEmbedFn(canonicalData);
}

/**
 * Build the full Webflow CMS field payload (25 fields).
 */
export function buildWebflowFields(page) {
  const canonicalData = buildCanonicalDataFromPage(page);
  return renderWebflowFieldsFn(canonicalData);
}

// ── Production: Webflow CMS Integration ─────────────────────────────────

/**
 * Webflow CMS collection fields accepted by the API.
 *
 * IMPORTANT: This whitelist MUST match the actual Webflow "Lanes" collection
 * schema. As of 2026-03-07, the collection has 36 fields total:
 *   - 14 original fields (including 3 Image fields we don't set)
 *   - 22 fields created via API (PlainText, RichText, Switch)
 *
 * Fields NOT in this set are stripped by sanitizeWebflowFields().
 * If you add fields to the Webflow collection, add them here too.
 */
const WEBFLOW_SCHEMA_FIELDS = new Set([
  // Identity
  "name", "slug", "origin-city", "destination-city",
  // Hero text
  "hero-headline", "subheadline",
  // Hero KPIs (PlainText)
  "hero-kpi-distance", "hero-kpi-transit", "hero-kpi-carriers",
  // Hero map (PlainText)
  "hero-visual-type", "hero-map-origin", "hero-map-destination",
  // Body (PlainText — no HTML, plain text only)
  "body-content",
  // SEO
  "seo-title", "seo-meta-description", "canonical-url", "address",
  // Lane metadata
  "origin", "destination", "mode", "segment",
  // Comparison
  "traditional-ltl", "warp-ltl",
  // Proof / Pilot (RichText — HTML allowed)
  "proof-section",
  // CTAs
  "cta-primary-text", "cta-primary-url",
  "cta-secondary-text", "cta-secondary-url",
  // Dedicated content sections (RichText — premium template elements)
  "lane-intelligence-panel", "execution-flow", "authority-links",
  // Structured data (RichText — contains hide CSS + schemas + FAQ HTML)
  "faq-schema", "breadcrumb-schema",
  // Template flags (Switch)
  "hero-video-enabled", "hero-map-enabled", "lane-mode-enabled", "index-page",
  // Lane variation metadata (PlainText)
  "lane-badge",
]);

/** Webflow PlainText fields that must be single-line (no newlines) */
const SINGLE_LINE_FIELDS = new Set([
  "name", "slug", "hero-headline", "subheadline", "seo-title",
  "seo-meta-description", "address", "canonical-url",
  "origin", "destination", "origin-city", "destination-city",
  "mode", "segment",
  "hero-kpi-distance", "hero-kpi-transit", "hero-kpi-carriers",
  "hero-visual-type", "hero-map-origin", "hero-map-destination",
  "cta-primary-text", "cta-primary-url",
  "cta-secondary-text", "cta-secondary-url",
  "traditional-ltl", "warp-ltl",
  "lane-badge",
]);

/**
 * Filter and sanitize Webflow fields for API submission.
 */
export function sanitizeWebflowFields(rawFields) {
  const fields = {};
  for (const [key, val] of Object.entries(rawFields)) {
    let fieldKey = key;
    let fieldVal = val;

    // Map render-engine field names to Webflow schema field names
    if (key === "seo-description") {
      fieldKey = "seo-meta-description";
    }

    if (!WEBFLOW_SCHEMA_FIELDS.has(fieldKey)) continue;

    // Sanitize single-line PlainText fields: replace newlines with " | "
    if (SINGLE_LINE_FIELDS.has(fieldKey) && typeof fieldVal === "string") {
      fieldVal = fieldVal.replace(/\n/g, " | ");
    }

    fields[fieldKey] = fieldVal;
  }
  return fields;
}

/**
 * Ship a single lane page to Webflow CMS.
 *
 * In dry-run mode: writes artifacts only, returns mock itemId.
 * In live mode: creates Webflow item via API + publishes it.
 *
 * @param {object} packageData - from buildPackageForLane()
 * @param {{ dryRun: boolean, publishStaging?: boolean, artifactsDir?: string }} opts
 * @returns {Promise<object>} { success, dryRun, slug, approvalId, itemId, collectionId?, siteId? }
 */
export async function shipOneLane(packageData, { dryRun, publishStaging, artifactsDir }) {
  const { page, origin, destination, mode } = packageData;
  const approvalId = crypto.randomUUID();
  const baseDir = artifactsDir || path.join(ROOT, "artifacts");
  const laneDir = path.join(baseDir, "publish_next", page.slug);
  fs.mkdirSync(laneDir, { recursive: true });

  // Write package JSON
  fs.writeFileSync(
    path.join(laneDir, "package.json"),
    JSON.stringify(packageData, null, 2)
  );

  if (dryRun) {
    const fields = buildWebflowFields(page);
    fs.writeFileSync(
      path.join(laneDir, "webflow_payload.json"),
      JSON.stringify({
        fields,
        dry_run: true,
        slug: page.slug,
        quality_score: page.quality_score || null,
        validation_result: page.rendered_html_validation_result || null,
        generated_at: new Date().toISOString()
      }, null, 2)
    );
    return {
      success: true,
      dryRun: true,
      slug: page.slug,
      approvalId,
      itemId: `dry-run-${crypto.randomUUID().slice(0, 8)}`,
    };
  }

  // Live: create Webflow draft via API
  const {
    WEBFLOW_API_TOKEN,
    WEBFLOW_SITE_ID,
    WEBFLOW_LANE_COLLECTION_ID,
  } = process.env;

  const missingEnv = [];
  if (!WEBFLOW_API_TOKEN) missingEnv.push("WEBFLOW_API_TOKEN");
  if (!WEBFLOW_SITE_ID) missingEnv.push("WEBFLOW_SITE_ID");
  if (!WEBFLOW_LANE_COLLECTION_ID) missingEnv.push("WEBFLOW_LANE_COLLECTION_ID");
  if (missingEnv.length > 0) {
    throw new Error(`Missing env vars: ${missingEnv.join(", ")}. Add to .env.local.`);
  }

  const rawFields = buildWebflowFields(page);
  const fields = sanitizeWebflowFields(rawFields);

  const collectionId = WEBFLOW_LANE_COLLECTION_ID;

  // 1. Create draft item
  const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items`;
  const createRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ isArchived: false, isDraft: false, fieldData: fields })
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`Webflow create error ${createRes.status}: ${text}`);
  }
  const createData = await createRes.json();
  const itemId = createData.id;

  // 2. Publish item (make it visible in staging)
  const pubEndpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/publish`;
  const pubRes = await fetch(pubEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ itemIds: [itemId] })
  });
  if (!pubRes.ok) {
    const text = await pubRes.text();
    throw new Error(`Webflow item publish error ${pubRes.status}: ${text}`);
  }

  return {
    success: true,
    dryRun: false,
    slug: page.slug,
    approvalId,
    itemId,
    collectionId,
    siteId: WEBFLOW_SITE_ID,
  };
}

/**
 * Publish site to production custom domains (batch).
 * Called once after all items are published.
 *
 * @param {string} siteId - Webflow site ID
 * @param {string} apiToken - Webflow API token
 * @returns {Promise<object>} Publish result
 */
export async function publishSiteToProduction(siteId, apiToken) {
  const CUSTOM_DOMAIN_IDS = [
    "689442045dc003d002d08285", // www.wearewarp.com
    "689442045dc003d002d08271", // wearewarp.com
  ];
  const pubRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ customDomains: CUSTOM_DOMAIN_IDS }),
  });
  if (!pubRes.ok) {
    const text = await pubRes.text();
    throw new Error(`Site publish error ${pubRes.status}: ${text}`);
  }
  return pubRes.json();
}
