/**
 * Canonical Page URL Model
 *
 * SINGLE SOURCE OF TRUTH for deriving page URLs across the entire pipeline.
 * Every module that needs a page URL MUST import from here.
 *
 * Definitions:
 *   slug           — route identifier only (e.g. "chicago-to-dallas")
 *   canonicalPath  — /lanes/<slug> (site-relative path)
 *   expectedUrl    — full production URL, deterministically derived
 *   verifiedLiveUrl — expectedUrl ONLY after live verification passes
 *   webflowItemId  — CMS record ID, never a public page URL
 *
 * Rules:
 *   1. canonicalPath is always /lanes/<slug>
 *   2. expectedUrl is always SITE_BASE + canonicalPath
 *   3. verifiedLiveUrl is null until verification confirms HTTP 200 + identity
 *   4. Clickable links in emails must use verifiedLiveUrl only (never expectedUrl)
 *   5. Manifests store expectedUrl (what we intend to publish)
 *   6. Receipts store both expectedUrl and verifiedLiveUrl
 */

// ── Constants ──────────────────────────────────────────────────────────

export const SITE_BASE = "https://www.wearewarp.com";
export const LANES_PREFIX = "/lanes";

// ── Derivation ─────────────────────────────────────────────────────────

/**
 * Derive the canonical path for a lane page.
 * @param {string} slug
 * @returns {string} e.g. "/lanes/chicago-to-dallas"
 */
export function canonicalPathForSlug(slug) {
  if (!slug) throw new Error("page-url: slug is required to derive canonicalPath");
  return `${LANES_PREFIX}/${slug}`;
}

/**
 * Derive the expected production URL for a lane page.
 * This is the URL we expect the page to be live at after publishing.
 * @param {string} slug
 * @returns {string} e.g. "https://www.wearewarp.com/lanes/chicago-to-dallas"
 */
export function expectedUrlForSlug(slug) {
  if (!slug) throw new Error("page-url: slug is required to derive expectedUrl");
  return `${SITE_BASE}${canonicalPathForSlug(slug)}`;
}

// ── Page URL Record ────────────────────────────────────────────────────

/**
 * Build a canonical page URL record.
 *
 * @param {object} opts
 * @param {string} opts.slug              — route identifier
 * @param {string} [opts.webflowItemId]   — CMS record ID (not a URL)
 * @param {boolean} [opts.verified]       — true if live verification passed
 * @returns {{
 *   slug: string,
 *   canonicalPath: string,
 *   expectedUrl: string,
 *   verifiedLiveUrl: string|null,
 *   webflowItemId: string|null,
 * }}
 */
export function buildPageUrl({ slug, webflowItemId = null, verified = false }) {
  if (!slug) throw new Error("page-url: slug is required");
  const expectedUrl = expectedUrlForSlug(slug);
  return {
    slug,
    canonicalPath: canonicalPathForSlug(slug),
    expectedUrl,
    verifiedLiveUrl: verified ? expectedUrl : null,
    webflowItemId: webflowItemId || null,
  };
}

// ── Validation ─────────────────────────────────────────────────────────

/**
 * Validate that a page URL record is complete for a given context.
 *
 * @param {object} pageUrl — from buildPageUrl()
 * @param {"manifest" | "receipt" | "email" | "verification"} context
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePageUrl(pageUrl, context) {
  const errors = [];

  if (!pageUrl?.slug) errors.push("slug is required");
  if (!pageUrl?.expectedUrl) errors.push("expectedUrl is required");
  if (!pageUrl?.canonicalPath) errors.push("canonicalPath is required");

  if (context === "email" && !pageUrl?.verifiedLiveUrl) {
    errors.push("verifiedLiveUrl is required for email links — page must be verified before linking");
  }

  return { valid: errors.length === 0, errors };
}
