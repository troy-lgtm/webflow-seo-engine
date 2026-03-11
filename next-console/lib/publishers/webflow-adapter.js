/**
 * webflow-adapter.js — Webflow CMS Publisher Adapter
 *
 * Maps a CMS-neutral publish contract to Webflow CMS field payload.
 * This adapter produces the EXACT same output as the old renderWebflowFields()
 * + sanitizeWebflowFields() pipeline, ensuring zero regression in the
 * current Webflow publishing path.
 *
 * ADAPTER RESPONSIBILITY:
 *   - Map semantic contract fields → Webflow CMS field names (36 fields)
 *   - Sanitize for Webflow API constraints (single-line fields, allowed schema)
 *   - Provide publish/update operations via Webflow v2 API
 *
 * ADAPTER BOUNDARY:
 *   - This adapter ONLY consumes the publish contract
 *   - It does NOT call renderers directly
 *   - It does NOT build canonical data
 *   - It does NOT run quality gates (that happens upstream)
 *
 * @module publishers/webflow-adapter
 */

import { contractToRenderedFields } from "./publish-contract.js";

// ── Webflow Schema ───────────────────────────────────────────────────

/**
 * The 36 allowed Webflow CMS field names.
 * Any field not in this set will be stripped by sanitize().
 * @type {Set<string>}
 */
const WEBFLOW_SCHEMA_FIELDS = new Set([
  "name", "slug", "origin-city", "destination-city",
  "hero-headline", "subheadline",
  "hero-kpi-distance", "hero-kpi-transit", "hero-kpi-carriers",
  "hero-visual-type", "hero-map-origin", "hero-map-destination",
  "body-content",
  "seo-title", "seo-meta-description", "canonical-url", "address",
  "origin", "destination", "mode", "segment",
  "traditional-ltl", "warp-ltl",
  "proof-section",
  "cta-primary-text", "cta-primary-url", "cta-secondary-text", "cta-secondary-url",
  "lane-intelligence-panel", "execution-flow",
  "faq-schema", "breadcrumb-schema",
  "hero-video-enabled", "hero-map-enabled", "lane-mode-enabled", "index-page",
  "lane-badge",
]);

/**
 * Fields that must be single-line in Webflow (PlainText type).
 * Newlines are replaced with " | ".
 * @type {Set<string>}
 */
const SINGLE_LINE_FIELDS = new Set([
  "name", "slug", "origin-city", "destination-city",
  "hero-headline", "subheadline",
  "hero-kpi-distance", "hero-kpi-transit", "hero-kpi-carriers",
  "hero-visual-type", "hero-map-origin", "hero-map-destination",
  "seo-title", "seo-meta-description", "canonical-url", "address",
  "origin", "destination", "mode", "segment",
  "cta-primary-text", "cta-primary-url", "cta-secondary-text", "cta-secondary-url",
  "lane-badge",
]);

// ── Adapter Interface ────────────────────────────────────────────────

/**
 * Adapter metadata — identifies this adapter for logging/registry.
 */
export const ADAPTER_ID = "webflow";
export const ADAPTER_NAME = "Webflow CMS";
export const ADAPTER_VERSION = "1.0.0";

/**
 * Convert a publish contract to Webflow CMS field payload.
 *
 * This is the primary adapter function. It maps every contract field
 * to the corresponding Webflow CMS field name, producing the exact
 * same output shape that renderWebflowFields() + sanitizeWebflowFields()
 * produced in the pre-migration architecture.
 *
 * @param {object} contract - CMS-neutral publish contract from buildPublishContract()
 * @returns {object} Webflow CMS field payload (36 fields)
 */
export function toTargetFields(contract) {
  if (!contract) throw new Error("webflow-adapter: contract is required");

  // Use the contract-to-rendered-fields mapping to produce Webflow field names.
  // This guarantees structural equivalence with the old pipeline.
  const fields = contractToRenderedFields(contract);

  return fields;
}

/**
 * Sanitize Webflow fields for API submission.
 * Filters to allowed schema fields and normalizes single-line fields.
 *
 * Equivalent to the old sanitizeWebflowFields() from lane-factory.js.
 *
 * @param {object} rawFields - Output of toTargetFields()
 * @returns {object} Sanitized Webflow CMS field payload
 */
export function sanitize(rawFields) {
  const sanitized = {};

  for (const [key, value] of Object.entries(rawFields)) {
    // Alias handling: seo-description → seo-meta-description
    const normalizedKey = key === "seo-description" ? "seo-meta-description" : key;

    if (!WEBFLOW_SCHEMA_FIELDS.has(normalizedKey)) continue;

    if (typeof value === "string" && SINGLE_LINE_FIELDS.has(normalizedKey)) {
      sanitized[normalizedKey] = value.replace(/\n/g, " | ");
    } else {
      sanitized[normalizedKey] = value;
    }
  }

  return sanitized;
}

/**
 * Full adapter pipeline: contract → Webflow fields → sanitized.
 *
 * @param {object} contract - CMS-neutral publish contract
 * @param {object} [opts] - Options
 * @param {boolean} [opts.preserveSlug] - If true, keep slug in output (for new items)
 * @param {boolean} [opts.preserveName] - If true, keep name in output (for new items)
 * @returns {object} Ready-to-submit Webflow CMS field payload
 */
export function adaptForPublish(contract, opts = {}) {
  const fields = toTargetFields(contract);
  const sanitized = sanitize(fields);

  // For updates to existing items, remove slug and name to avoid overwriting
  if (!opts.preserveSlug) delete sanitized.slug;
  if (!opts.preserveName) delete sanitized.name;

  // Template flags are already mapped by contractToRenderedFields() and survive
  // sanitize(). No need to re-apply them here.

  return sanitized;
}

/**
 * Push fields to Webflow CMS via v2 API.
 *
 * @param {object} params
 * @param {string} params.itemId       - Webflow CMS item ID to update
 * @param {object} params.fields       - Output of adaptForPublish()
 * @param {string} params.collectionId - Webflow collection ID
 * @param {string} params.apiToken     - Webflow API bearer token
 * @param {boolean} [params.dryRun]    - If true, return payload without calling API
 * @returns {Promise<object>} Webflow API response or dry-run payload
 */
export async function publish(params) {
  const { itemId, fields, collectionId, apiToken, dryRun } = params;

  if (!itemId) throw new Error("webflow-adapter publish: itemId required");
  if (!fields) throw new Error("webflow-adapter publish: fields required");
  if (!collectionId) throw new Error("webflow-adapter publish: collectionId required");

  if (dryRun) {
    return {
      adapter: ADAPTER_ID,
      dryRun: true,
      itemId,
      fieldCount: Object.keys(fields).length,
      fields,
    };
  }

  if (!apiToken) throw new Error("webflow-adapter publish: apiToken required for live mode");

  const res = await fetch(
    `https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fieldData: fields }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Webflow adapter update failed for ${itemId}: ${res.status} ${errText}`);
  }

  return {
    adapter: ADAPTER_ID,
    dryRun: false,
    itemId,
    response: await res.json(),
  };
}

/**
 * Publish a Webflow site to production (custom domains).
 *
 * @param {object} params
 * @param {string} params.siteId    - Webflow site ID
 * @param {string} params.apiToken  - Webflow API bearer token
 * @param {string[]} [params.domainIds] - Custom domain IDs
 * @param {boolean} [params.dryRun] - If true, skip API call
 * @returns {Promise<object>} API response or dry-run result
 */
export async function publishSite(params) {
  const { siteId, apiToken, domainIds, dryRun } = params;

  if (dryRun) {
    return { adapter: ADAPTER_ID, dryRun: true, action: "publish_site", siteId };
  }

  if (!siteId || !apiToken) {
    throw new Error("webflow-adapter publishSite: siteId and apiToken required");
  }

  const body = { publishToWebflowSubdomain: false };
  if (domainIds?.length > 0) {
    body.customDomains = domainIds;
  }

  const res = await fetch(
    `https://api.webflow.com/v2/sites/${siteId}/publish`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Webflow adapter site publish failed: ${res.status} ${errText}`);
  }

  return {
    adapter: ADAPTER_ID,
    dryRun: false,
    action: "publish_site",
    response: await res.json(),
  };
}
