/**
 * Canonical Join Key Standard
 *
 * Every metric system (GSC, GA4, Portal) must normalize to the same
 * canonical_path for joins to work. This module defines that standard.
 *
 * canonical_path = "/lanes/{originSlug}-to-{destSlug}"
 */

/**
 * Slugify a city name: lowercase, first part before comma, hyphens for spaces.
 */
function slugifyCity(city) {
  return String(city || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Convert a lane_slug (e.g. "chicago-to-dallas") to canonical path.
 * @param {string} laneSlug
 * @returns {string} e.g. "/lanes/chicago-to-dallas"
 */
export function laneSlugToCanonicalPath(laneSlug) {
  const clean = String(laneSlug || "")
    .toLowerCase()
    .trim()
    .replace(/^\/lanes\//, "");
  return `/lanes/${clean}`;
}

/**
 * Normalize any URL or path to a clean canonical path.
 * Strips domain, query params, hash, trailing slashes.
 * @param {string} inputUrlOrPath
 * @returns {string}
 */
export function normalizePagePath(inputUrlOrPath) {
  let p = String(inputUrlOrPath || "").trim();

  // Strip protocol + domain
  p = p.replace(/^https?:\/\/[^/]+/, "");

  // Strip query string and hash
  p = p.split("?")[0].split("#")[0];

  // Strip trailing slash (but keep leading)
  p = p.replace(/\/+$/, "") || "/";

  // Ensure leading slash
  if (!p.startsWith("/")) p = "/" + p;

  return p.toLowerCase();
}

/**
 * Build canonical path from origin and destination slugs.
 * @param {{ originSlug: string, destSlug: string }} opts
 * @returns {string}
 */
export function buildCanonicalPathFromLane({ originSlug, destSlug }) {
  const o = slugifyCity(originSlug);
  const d = slugifyCity(destSlug);
  return `/lanes/${o}-to-${d}`;
}

/**
 * Get the canonical join key for a lane object from the snapshot.
 * @param {{ lane_slug: string }} lane
 * @returns {string}
 */
export function getJoinKeyForLane(lane) {
  return laneSlugToCanonicalPath(lane?.lane_slug || "");
}

/**
 * Check if a GSC page path matches a canonical lane path.
 * @param {string} gscPath - path from GSC data
 * @param {string} canonicalPath - our canonical path
 * @returns {boolean}
 */
export function pathsMatch(gscPath, canonicalPath) {
  return normalizePagePath(gscPath) === normalizePagePath(canonicalPath);
}
