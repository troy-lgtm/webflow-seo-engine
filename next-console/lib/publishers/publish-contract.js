/**
 * publish-contract.js — CMS-Neutral Publishing Contract
 *
 * Defines the canonical publishing payload that all publisher adapters consume.
 * This is the migration boundary: everything upstream of this contract is
 * CMS-neutral (lane knowledge, canonical data model, section renderers).
 * Everything downstream is adapter-specific (Webflow fields, Next.js pages, etc.).
 *
 * The contract separates concerns into semantic groups:
 *   - identity:    slug, name, origin/destination, mode
 *   - seo:         title, meta description, canonical URL
 *   - hero:        headline, subhead, KPIs, CTAs, map data
 *   - content:     body text, primary content embed, proof section
 *   - sections:    KPI panel, execution flow (dedicated rendered sections)
 *   - comparison:  traditional vs WARP comparison data
 *   - schema:      JSON-LD structured data (breadcrumb, FAQ, service, org)
 *   - flags:       template/display flags
 *   - quality:     quality gate report (from assessPublishQuality)
 *   - canonical:   reference to the upstream canonical page data
 *
 * MIGRATION BOUNDARY: This contract must NEVER reference Webflow field names.
 * Webflow field names (e.g., "faq-schema", "lane-intelligence-panel") are
 * adapter concerns handled exclusively by the Webflow adapter.
 *
 * @module publishers/publish-contract
 */

import {
  renderLanePageBody,
  renderLaneIntelligencePanel,
  renderExecutionFlow,
  renderFaqSchemaEmbed,
  renderBreadcrumbSchemaEmbed,
  renderValidation,
  buildTraditionalLtl,
  buildWarpLtl,
} from "../render-lane-page.js";

// ── Constants ────────────────────────────────────────────────────────

const SITE_BASE = "https://www.wearewarp.com";
const QUOTE_URL = `${SITE_BASE}/quote`;
const BOOK_URL = `${SITE_BASE}/book`;

/**
 * All semantic field groups in the publish contract.
 * Used for structural validation.
 * @type {string[]}
 */
export const CONTRACT_GROUPS = [
  "identity",
  "seo",
  "hero",
  "content",
  "sections",
  "comparison",
  "schema",
  "flags",
  "quality",
  "canonical",
];

/**
 * Required fields within each contract group.
 * Used by validatePublishContract() to ensure completeness.
 */
const REQUIRED_CONTRACT_FIELDS = {
  identity: ["slug", "name", "origin_city", "destination_city", "origin", "destination", "mode", "segment"],
  seo: ["title", "meta_description", "canonical_url"],
  hero: ["headline", "subhead"],
  content: ["body_text", "primary_content_html", "proof_html"],
  sections: ["kpi_panel_html", "execution_flow_html"],
  comparison: ["traditional_text", "warp_text"],
  schema: ["structured_data_html"],
  flags: [],
};

// ── Helpers ──────────────────────────────────────────────────────────

function cityFrom(fullOrigin) {
  return (fullOrigin || "").split(",")[0].trim();
}

function stateFrom(fullOrigin) {
  const parts = (fullOrigin || "").split(",");
  return parts.length > 1 ? parts[1].trim().toUpperCase() : "";
}

function fmt(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? String(v) : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Compute distance band label from miles.
 * Matches the computeVariation logic in render-lane-page.js exactly.
 */
function computeBadge(distanceMiles) {
  if (!distanceMiles || distanceMiles <= 0) return "regional";
  if (distanceMiles < 300) return "metro";
  if (distanceMiles <= 800) return "regional";
  if (distanceMiles <= 1200) return "interstate";
  return "long-haul";
}

// ── Contract Builder ─────────────────────────────────────────────────

/**
 * Build a CMS-neutral publish contract from canonical page data.
 *
 * This function calls the shared section renderers (exported from
 * render-lane-page.js) to produce HTML content, then packages everything
 * into semantic groups that any adapter can consume.
 *
 * The renderers called here are the SAME functions used by
 * renderWebflowFields(), ensuring bit-for-bit content equivalence.
 *
 * @param {object} canonicalPageData - Output of buildCanonicalLanePageData()
 * @param {object} [qualityReport]   - Output of assessPublishQuality() (optional, attached after validation)
 * @returns {object} CMS-neutral publish contract
 */
export function buildPublishContract(canonicalPageData, qualityReport) {
  const pd = canonicalPageData;
  if (!pd) throw new Error("buildPublishContract: canonicalPageData is required");

  const hero = pd.hero || {};
  const cta = pd.lane_relevant_cta || {};
  const oCity = cityFrom(pd.origin);
  const dCity = cityFrom(pd.destination);
  const oState = stateFrom(pd.origin);
  const dState = stateFrom(pd.destination);
  const ls = pd.lane_stats || {};
  const transitRange = ls.estimated_transit_days_range || {};
  const carrierCount = pd.network_proof?.estimated_carrier_count || "";
  const dist = ls.estimated_distance_miles || "";
  const canonicalUrl = `${SITE_BASE}${pd.canonical_path || ""}`;

  return {
    // ── Contract version (for future-proofing) ────────────────────
    _contract_version: "1.0.0",

    // ── Identity ──────────────────────────────────────────────────
    identity: {
      slug: pd.lane_slug || "",
      name: `${oCity} to ${dCity} ${pd.mode || "LTL"}`,
      origin_city: oCity,
      destination_city: dCity,
      origin: pd.origin || "",
      destination: pd.destination || "",
      mode: pd.mode || "LTL",
      segment: pd.segment || "smb",
    },

    // ── SEO ───────────────────────────────────────────────────────
    seo: {
      title: pd.page_title || "",
      meta_description: pd.meta_description || "",
      canonical_url: canonicalUrl,
      canonical_path: pd.canonical_path || "",
    },

    // ── Hero ──────────────────────────────────────────────────────
    hero: {
      headline: hero.headline || "",
      subhead: hero.subhead || "",
      kpi_distance: dist ? `${fmt(dist)} mi` : "",
      kpi_transit: (transitRange.min && transitRange.max)
        ? `${transitRange.min}\u2013${transitRange.max} days` : "",
      kpi_carriers: carrierCount ? `${carrierCount} active` : "",
      visual_type: "lane-map",
      map_origin: `${oCity}, ${oState}`,
      map_destination: `${dCity}, ${dState}`,
      primary_cta: {
        label: hero.primary_cta?.label || cta.primary_cta?.label || "Get Instant Quote",
        url: hero.primary_cta?.url || cta.primary_cta?.url || QUOTE_URL,
      },
      secondary_cta: {
        label: hero.secondary_cta?.label || "Book a Fit Call",
        url: hero.secondary_cta?.url || BOOK_URL,
      },
    },

    // ── Content (rendered HTML/text) ──────────────────────────────
    // Uses the SAME renderer functions as renderWebflowFields()
    content: {
      body_text: renderLanePageBody(pd),
      primary_content_html: renderFaqSchemaEmbed(pd),
      proof_html: renderValidation(pd),
    },

    // ── Dedicated Sections (rendered HTML) ────────────────────────
    sections: {
      kpi_panel_html: renderLaneIntelligencePanel(pd),
      execution_flow_html: renderExecutionFlow(pd),
    },

    // ── Comparison ────────────────────────────────────────────────
    // Uses the SAME buildTraditionalLtl/buildWarpLtl from render-lane-page.js
    comparison: {
      traditional_text: buildTraditionalLtl(pd.mode),
      warp_text: buildWarpLtl(pd.mode),
    },

    // ── Structured Data (JSON-LD) ─────────────────────────────────
    schema: {
      structured_data_html: renderBreadcrumbSchemaEmbed(pd),
    },

    // ── Template/Display Flags ────────────────────────────────────
    flags: {
      video_enabled: false,
      map_enabled: true,
      lane_mode_enabled: true,
      indexable: true,
      badge: computeBadge(dist),
    },

    // ── Quality Report (attached after validation) ────────────────
    quality: qualityReport || null,

    // ── Canonical Reference (for adapters that need raw data) ─────
    // MIGRATION NOTE: Adapters should prefer contract fields over
    // reaching into canonical data. This reference exists for edge
    // cases during migration where an adapter needs data not yet
    // surfaced in the contract.
    canonical: pd,
  };
}

// ── Contract Validation ──────────────────────────────────────────────

/**
 * Validate that a publish contract has all required fields populated.
 * This is a structural check, NOT a quality check.
 *
 * @param {object} contract - Output of buildPublishContract()
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validatePublishContract(contract) {
  const errors = [];
  const warnings = [];

  if (!contract) {
    return { valid: false, errors: ["Contract is null"], warnings };
  }

  if (!contract._contract_version) {
    errors.push("Missing _contract_version");
  }

  // Check required groups exist
  for (const group of CONTRACT_GROUPS) {
    if (!contract[group] && group !== "quality") {
      errors.push(`Missing contract group: ${group}`);
    }
  }

  // Check required fields within groups
  for (const [group, fields] of Object.entries(REQUIRED_CONTRACT_FIELDS)) {
    if (!contract[group]) continue;
    for (const field of fields) {
      const val = contract[group][field];
      if (val === undefined || val === null || (typeof val === "string" && val.trim() === "")) {
        errors.push(`Empty required field: ${group}.${field}`);
      }
    }
  }

  // Quality should be attached before publish
  if (!contract.quality) {
    warnings.push("Quality report not yet attached (call assessPublishQuality first)");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Map a publish contract's content fields to the field names used by
 * assessPublishQuality(). This allows the quality gate to evaluate
 * a contract without knowing about Webflow field names.
 *
 * MIGRATION BOUNDARY: This mapping exists so the quality gate can
 * work with both the old Webflow field format and the new contract format.
 * When the Webflow-specific quality gate references are eventually removed,
 * this function can be simplified.
 *
 * @param {object} contract - Output of buildPublishContract()
 * @returns {object} Field map compatible with assessPublishQuality() second argument
 */
export function contractToRenderedFields(contract) {
  if (!contract) return {};

  return {
    "hero-headline": contract.hero?.headline || "",
    "subheadline": contract.hero?.subhead || "",
    "body-content": contract.content?.body_text || "",
    "faq-schema": contract.content?.primary_content_html || "",
    "breadcrumb-schema": contract.schema?.structured_data_html || "",
    "proof-section": contract.content?.proof_html || "",
    "lane-intelligence-panel": contract.sections?.kpi_panel_html || "",
    "execution-flow": contract.sections?.execution_flow_html || "",
    "traditional-ltl": contract.comparison?.traditional_text || "",
    "warp-ltl": contract.comparison?.warp_text || "",
    "seo-title": contract.seo?.title || "",
    "seo-meta-description": contract.seo?.meta_description || "",
    "canonical-url": contract.seo?.canonical_url || "",
    "name": contract.identity?.name || "",
    "slug": contract.identity?.slug || "",
    "origin-city": contract.identity?.origin_city || "",
    "destination-city": contract.identity?.destination_city || "",
    "origin": contract.identity?.origin || "",
    "destination": contract.identity?.destination || "",
    "mode": contract.identity?.mode || "",
    "segment": contract.identity?.segment || "",
    "hero-kpi-distance": contract.hero?.kpi_distance || "",
    "hero-kpi-transit": contract.hero?.kpi_transit || "",
    "hero-kpi-carriers": contract.hero?.kpi_carriers || "",
    "hero-visual-type": contract.hero?.visual_type || "",
    "hero-map-origin": contract.hero?.map_origin || "",
    "hero-map-destination": contract.hero?.map_destination || "",
    "cta-primary-text": contract.hero?.primary_cta?.label || "",
    "cta-primary-url": contract.hero?.primary_cta?.url || "",
    "cta-secondary-text": contract.hero?.secondary_cta?.label || "",
    "cta-secondary-url": contract.hero?.secondary_cta?.url || "",
    "hero-video-enabled": contract.flags?.video_enabled ?? false,
    "hero-map-enabled": contract.flags?.map_enabled ?? true,
    "lane-mode-enabled": contract.flags?.lane_mode_enabled ?? true,
    "index-page": contract.flags?.indexable ?? true,
    "lane-badge": contract.flags?.badge || "",
    "address": contract.seo?.canonical_url || "",
  };
}
