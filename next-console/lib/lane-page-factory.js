/**
 * lane-page-factory.js — Lane Page Factory for Next.js Route Contract
 *
 * Produces route-ready lane pages through the canonical pipeline.
 * Input: origin + destination (+ optional mode)
 * Output: route contract payload with quality gate validation
 *
 * PIPELINE:
 *   buildLaneKnowledge({ origin, destination, mode })
 *     → buildCanonicalLanePageData(knowledge, {})
 *       → buildRouteContract(canonical)
 *         → { payload, quality, contract, publishable }
 *
 * This module provides:
 *   - produceLanePage()    — single lane production with full validation
 *   - produceLanePages()   — batch production with summary report
 *   - validateFactoryOutput() — structural validation of factory output
 *
 * DOES NOT:
 *   - Touch Webflow CMS
 *   - Depend on renderWebflowFields()
 *   - Require manual page coding
 *   - Hard-code any lane data
 *
 * @module lane-page-factory
 */

import { buildLaneKnowledge } from "./lane-knowledge.js";
import { buildCanonicalLanePageData } from "./lane-page-schema.js";
import {
  buildRouteContract,
  validateRouteContract,
  extractNextMetadata,
  extractJsonLdObjects,
  ROUTE_CONTRACT_VERSION,
} from "./route-contract.js";

// ── Single Lane Production ──────────────────────────────────────────

/**
 * Produce a route-ready lane page from origin + destination.
 *
 * @param {object} input
 * @param {string} input.origin — Origin city name (e.g. "Atlanta")
 * @param {string} input.destination — Destination city name (e.g. "Orlando")
 * @param {string} [input.mode="LTL"] — Freight mode
 * @param {object} [opts={}]
 * @param {number} [opts.minScore=70] — Minimum quality score to be publishable
 * @param {boolean} [opts.strict=false] — If true, throw on validation failure
 * @returns {object} Factory result
 */
export function produceLanePage(input, opts = {}) {
  const { origin, destination, mode = "LTL" } = input;
  const { minScore = 70, strict = false } = opts;

  if (!origin || !destination) {
    throw new Error("produceLanePage requires origin and destination");
  }

  // ── Step 1: Build lane intelligence ──────────────────────────────
  const knowledge = buildLaneKnowledge({ origin, destination, mode });

  // ── Step 2: Build canonical page data ────────────────────────────
  const canonical = buildCanonicalLanePageData(knowledge, {});

  // ── Step 3: Build route contract (includes quality gate) ─────────
  const { payload, quality, contract, publishable } = buildRouteContract(canonical);

  // ── Step 4: Validate route contract structure ────────────────────
  const validation = validateRouteContract(payload);

  // ── Step 5: Extract metadata and schema ──────────────────────────
  const metadata = extractNextMetadata(payload);
  const jsonLdObjects = extractJsonLdObjects(payload);

  // ── Step 6: Assess factory-level result ──────────────────────────
  const factoryResult = {
    // Identity
    slug: payload.slug,
    path: payload.path,

    // Route contract payload (consumed by page.js)
    payload,

    // Quality assessment
    quality: {
      score: quality.score,
      grade: quality.grade,
      gates_passed: quality.gates_passed,
      gates_total: quality.gate_count,
      publishable,
      meetsMinScore: quality.score >= minScore,
    },

    // Validation
    validation: {
      valid: validation.valid,
      errors: validation.errors || [],
    },

    // Metadata (for generateMetadata)
    metadata,

    // Structured data (for JSON-LD injection)
    jsonLd: {
      count: jsonLdObjects.length,
      types: jsonLdObjects.map((s) => s["@type"]),
      objects: jsonLdObjects,
    },

    // Content summary
    content: {
      headline: payload.hero?.headline,
      sections: payload.sections?.length || 0,
      faqs: payload.faqs?.length || 0,
      whyWarp: payload.why_warp?.length || 0,
      comparison: payload.comparison?.length || 0,
    },

    // Pipeline metadata
    _factory: {
      version: ROUTE_CONTRACT_VERSION,
      timestamp: new Date().toISOString(),
      input: { origin, destination, mode },
    },
  };

  if (strict && !factoryResult.quality.publishable) {
    throw new Error(
      `Lane ${origin}→${destination} failed quality gate: ` +
        `score=${quality.score}%, grade=${quality.grade}, ` +
        `gates=${quality.gates_passed}/${quality.gate_count}`
    );
  }

  if (strict && !factoryResult.validation.valid) {
    throw new Error(
      `Lane ${origin}→${destination} failed validation: ` +
        factoryResult.validation.errors.join(", ")
    );
  }

  return factoryResult;
}

// ── Batch Production ────────────────────────────────────────────────

/**
 * Produce multiple route-ready lane pages in batch.
 *
 * @param {Array<object>} lanes — Array of { origin, destination, mode? }
 * @param {object} [opts={}]
 * @param {number} [opts.minScore=70] — Minimum quality score
 * @param {boolean} [opts.strict=false] — Throw on first failure
 * @returns {object} Batch result with individual results + summary
 */
export function produceLanePages(lanes, opts = {}) {
  const results = [];
  const errors = [];

  for (const lane of lanes) {
    try {
      const result = produceLanePage(lane, opts);
      results.push(result);
    } catch (err) {
      errors.push({
        input: lane,
        error: err.message,
      });
      if (opts.strict) throw err;
    }
  }

  const passed = results.filter((r) => r.quality.publishable);
  const failed = results.filter((r) => !r.quality.publishable);

  return {
    results,
    errors,
    summary: {
      total: lanes.length,
      produced: results.length,
      publishable: passed.length,
      blocked: failed.length,
      errored: errors.length,
      avgScore: results.length > 0
        ? Math.round(results.reduce((s, r) => s + r.quality.score, 0) / results.length)
        : 0,
      grades: results.reduce((acc, r) => {
        acc[r.quality.grade] = (acc[r.quality.grade] || 0) + 1;
        return acc;
      }, {}),
      slugs: results.map((r) => r.slug),
    },
  };
}

// ── Factory Output Validation ───────────────────────────────────────

/**
 * Validate a factory result has all required fields.
 * Used by tests to ensure factory output is structurally complete.
 *
 * @param {object} result — Output from produceLanePage()
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateFactoryOutput(result) {
  const errors = [];

  // Identity
  if (!result.slug) errors.push("Missing slug");
  if (!result.path) errors.push("Missing path");
  if (!result.path?.startsWith("/lanes/")) errors.push("Path must start with /lanes/");

  // Payload
  if (!result.payload) errors.push("Missing payload");
  if (!result.payload?.hero) errors.push("Missing payload.hero");
  if (!result.payload?.sections?.length) errors.push("Missing payload.sections");
  if (!result.payload?.metadata) errors.push("Missing payload.metadata");

  // Quality
  if (!result.quality) errors.push("Missing quality");
  if (typeof result.quality?.score !== "number") errors.push("Missing quality.score");
  if (typeof result.quality?.publishable !== "boolean") errors.push("Missing quality.publishable");

  // Validation
  if (!result.validation) errors.push("Missing validation");

  // Metadata
  if (!result.metadata) errors.push("Missing metadata");
  if (!result.metadata?.title) errors.push("Missing metadata.title");
  if (!result.metadata?.description) errors.push("Missing metadata.description");

  // JSON-LD
  if (!result.jsonLd) errors.push("Missing jsonLd");
  if (!result.jsonLd?.count) errors.push("Missing jsonLd.count");
  if (!result.jsonLd?.types?.length) errors.push("Missing jsonLd.types");

  // Content summary
  if (!result.content) errors.push("Missing content");
  if (!result.content?.headline) errors.push("Missing content.headline");

  // Factory metadata
  if (!result._factory) errors.push("Missing _factory metadata");
  if (!result._factory?.version) errors.push("Missing _factory.version");

  return { valid: errors.length === 0, errors };
}
