/**
 * route-contract.js — Next.js Route Contract Builder
 *
 * Bridges the canonical lane page pipeline to Next.js App Router routes.
 * Wraps the existing CMS-neutral publish contract + neutral adapter to
 * produce a route-ready payload that `app/lanes/[slug]/page.js` consumes.
 *
 * PIPELINE:
 *   buildLaneKnowledge(lane)
 *     → buildCanonicalLanePageData(knowledge, relatedLinks)
 *       → buildPublishContract(canonicalPageData)
 *         → contractToRenderedFields(contract)   // quality gate bridge
 *         → assessPublishQuality(canonical, rendered)
 *         → toTargetFields(contract)             // neutral adapter
 *         → buildRoutePayload(neutral, contract) // this module
 *
 * RESPONSIBILITIES:
 *   - Produce a structured payload consumable by Next.js server components
 *   - Extract JSON-LD as parsed objects (not HTML script tags)
 *   - Provide generateMetadata()-ready metadata shape
 *   - Attach quality gate report
 *   - Preserve section ownership boundaries
 *   - ZERO I/O — pure function module
 *
 * MIGRATION BOUNDARY:
 *   This module depends on the existing pipeline:
 *     - publish-contract.js (buildPublishContract, contractToRenderedFields)
 *     - neutral-adapter.js (toTargetFields)
 *     - lane-page-validator.js (assessPublishQuality)
 *   It does NOT depend on renderWebflowFields() or LANE_PAGE_MODE_CSS.
 *
 * @module route-contract
 */

import {
  buildPublishContract,
  contractToRenderedFields,
} from "./publishers/publish-contract.js";

import { toTargetFields } from "./publishers/neutral-adapter.js";

import { assessPublishQuality } from "./lane-page-validator.js";

// ── Constants ────────────────────────────────────────────────────────

export const ROUTE_CONTRACT_VERSION = "1.0.0";

/**
 * Required top-level keys in a route contract payload.
 * @type {string[]}
 */
export const ROUTE_CONTRACT_KEYS = [
  "slug",
  "path",
  "route",
  "metadata",
  "hero",
  "sections",
  "kpi_panel",
  "execution_flow",
  "proof",
  "stats",
  "network",
  "comparison",
  "faqs",
  "why_warp",
  "ctas",
  "quality",
];

/**
 * Keys required inside metadata for generateMetadata() compatibility.
 * @type {string[]}
 */
export const METADATA_REQUIRED_KEYS = [
  "title",
  "description",
  "canonical",
  "robots",
  "jsonLd",
];

// ── Route Contract Builder ───────────────────────────────────────────

/**
 * Build a Next.js route contract from canonical page data.
 *
 * Runs the full pipeline:
 *   1. buildPublishContract(canonicalPageData)
 *   2. contractToRenderedFields(contract)  — bridge for quality gate
 *   3. assessPublishQuality(canonical, rendered)  — quality gate
 *   4. Attach quality report to contract
 *   5. toTargetFields(contract)  — neutral adapter
 *   6. Augment with route-specific properties
 *
 * @param {object} canonicalPageData - Output of buildCanonicalLanePageData()
 * @returns {{ payload: object, quality: object, contract: object, publishable: boolean }}
 */
export function buildRouteContract(canonicalPageData) {
  if (!canonicalPageData) {
    throw new Error("buildRouteContract: canonicalPageData is required");
  }

  // Step 1: Build CMS-neutral publish contract
  const contract = buildPublishContract(canonicalPageData);

  // Step 2: Bridge to quality gate field format
  const renderedFields = contractToRenderedFields(contract);

  // Step 3: Run quality gate
  const quality = assessPublishQuality(canonicalPageData, renderedFields);

  // Step 4: Attach quality report to contract
  contract.quality = quality;

  // Step 5: Transform via neutral adapter
  const neutral = toTargetFields(contract);

  // Step 6: Build route-specific payload
  const payload = buildRoutePayload(neutral, contract, quality);

  return {
    payload,
    quality,
    contract,
    publishable: quality.publishable,
  };
}

/**
 * Build the final route payload from neutral adapter output.
 *
 * @param {object} neutral - Output of toTargetFields()
 * @param {object} contract - Output of buildPublishContract()
 * @param {object} quality - Output of assessPublishQuality()
 * @returns {object} Route payload
 */
function buildRoutePayload(neutral, contract, quality) {
  return {
    _route_contract_version: ROUTE_CONTRACT_VERSION,
    _generated_at: new Date().toISOString(),

    slug: neutral.slug,
    path: neutral.path,
    route: neutral.route,

    metadata: {
      title: neutral.metadata.title,
      description: neutral.metadata.description,
      canonical: neutral.metadata.canonical,
      robots: neutral.metadata.robots,
      jsonLd: neutral.metadata.jsonLd,
      openGraph: {
        title: neutral.metadata.title,
        description: neutral.metadata.description,
        url: neutral.metadata.canonical,
        siteName: "WARP",
        type: "website",
      },
    },

    ai_answer_summary: neutral.ai_answer_summary || "",
    hero: neutral.hero,
    sections: neutral.sections,
    kpi_panel: neutral.kpi_panel,
    execution_flow: neutral.execution_flow,
    proof: neutral.proof,
    stats: neutral.stats,
    network: neutral.network,
    comparison: neutral.comparison,
    faqs: neutral.faqs,
    why_warp: neutral.why_warp,
    ctas: neutral.ctas,

    authority_links: {
      html: contract.sections?.authority_links_html || "",
    },

    quality: {
      publishable: quality.publishable,
      grade: quality.grade,
      score: quality.score,
      gates_passed: quality.gates_passed || 0,
      gates_total: quality.gate_count || 0,
      dimensions: quality.dimensions || {},
    },
  };
}

// ── Route Contract Validation ────────────────────────────────────────

/**
 * Validate that a route contract payload has all required keys
 * and metadata fields populated.
 *
 * @param {object} payload - Output of buildRouteContract().payload
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateRouteContract(payload) {
  const errors = [];
  const warnings = [];

  if (!payload) {
    return { valid: false, errors: ["Route contract payload is null"], warnings };
  }

  for (const key of ROUTE_CONTRACT_KEYS) {
    if (payload[key] === undefined || payload[key] === null) {
      errors.push(`Missing required key: ${key}`);
    }
  }

  if (payload.metadata) {
    for (const key of METADATA_REQUIRED_KEYS) {
      const val = payload.metadata[key];
      if (val === undefined || val === null) {
        errors.push(`Missing metadata field: ${key}`);
      }
      if (typeof val === "string" && val.trim() === "") {
        errors.push(`Empty metadata field: ${key}`);
      }
    }

    if (!Array.isArray(payload.metadata.jsonLd) || payload.metadata.jsonLd.length < 3) {
      warnings.push(`Expected ≥3 JSON-LD objects (breadcrumb, service, org), got ${payload.metadata?.jsonLd?.length || 0}`);
    }
  }

  if (payload.hero) {
    if (!payload.hero.headline) errors.push("Missing hero.headline");
    if (!payload.hero.subhead) errors.push("Missing hero.subhead");
  }

  if (payload.quality && !payload.quality.publishable) {
    warnings.push("Route contract quality gate: NOT publishable");
  }

  if (!payload.slug || payload.slug.trim() === "") {
    errors.push("Missing or empty slug");
  }

  if (Array.isArray(payload.sections) && payload.sections.length === 0) {
    warnings.push("No content sections extracted");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Extract generateMetadata()-compatible object from a route contract payload.
 *
 * @param {object} payload - Output of buildRouteContract().payload
 * @returns {object} Next.js metadata object
 */
export function extractNextMetadata(payload) {
  if (!payload?.metadata) return {};

  const m = payload.metadata;
  return {
    title: m.title,
    description: m.description,
    alternates: { canonical: m.canonical },
    robots: m.robots,
    openGraph: m.openGraph || {
      title: m.title,
      description: m.description,
      url: m.canonical,
      siteName: "WARP",
      type: "website",
    },
  };
}

/**
 * Extract JSON-LD objects from a route contract payload.
 *
 * @param {object} payload - Output of buildRouteContract().payload
 * @returns {object[]} Array of JSON-LD objects
 */
export function extractJsonLdObjects(payload) {
  return payload?.metadata?.jsonLd || [];
}
