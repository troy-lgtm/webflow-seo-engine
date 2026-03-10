/**
 * Layer 6: URL Discipline — Canonicals, Parameters, URL Normalization
 *
 * Enforces strict URL discipline to prevent infinite duplicates.
 * One canonical URL per intent. Locked city naming. Parameter rules.
 */

import { stableHash } from "@/lib/hash";

// ── City Registry (loaded lazily) ────────────────────────────────────

let _citiesCache = null;

function loadCities() {
  if (_citiesCache) return _citiesCache;
  /* Dynamic import avoided for client compatibility; inline require-like approach */
  try {
    // eslint-disable-next-line
    _citiesCache = require("@/../data/cities.json");
  } catch {
    _citiesCache = {};
  }
  return _citiesCache;
}

// ── City Name Normalization ──────────────────────────────────────────

const CITY_ALIASES = {
  "la": "los angeles",
  "sf": "san francisco",
  "nyc": "new york",
  "ny": "new york",
  "lv": "las vegas",
  "slc": "salt lake city",
  "kc": "kansas city",
  "stl": "st. louis",
  "st louis": "st. louis",
  "saint louis": "st. louis",
  "ft worth": "fort worth",
  "ft. worth": "fort worth",
  "jax": "jacksonville",
  "philly": "philadelphia",
  "phx": "phoenix",
  "indy": "indianapolis",
  "det": "detroit",
  "atl": "atlanta",
  "mia": "miami",
  "hou": "houston",
  "dal": "dallas",
  "chi": "chicago",
  "sea": "seattle",
  "pdx": "portland",
  "den": "denver",
  "bos": "boston",
  "clt": "charlotte",
  "orl": "orlando",
  "tpa": "tampa",
  "mem": "memphis",
  "nas": "nashville",
};

/**
 * Normalize a city name to the canonical form from cities.json.
 * Returns { canonical, matched, originalInput }.
 */
export function normalizeCityName(name) {
  if (!name) return { canonical: "", matched: false, originalInput: name };

  const raw = String(name).trim();

  // Extract city and state parts
  const parts = raw.split(",");
  let city = parts[0].trim().toLowerCase()
    .replace(/[\u2013\u2014\u2010\u2011\u2012\u2015]/g, "-")
    .replace(/\b\d{5}(-\d{4})?\b/g, "")  // strip zips
    .replace(/\s+/g, " ")
    .trim();
  const state = parts[1] ? parts[1].trim().toUpperCase() : "";

  // Try alias resolution
  if (CITY_ALIASES[city]) {
    city = CITY_ALIASES[city];
  }

  const cities = loadCities();

  // Try exact match with state
  if (state) {
    const key = `${city}, ${state.toLowerCase()}`;
    if (cities[key]) {
      const [c, s] = key.split(",").map(s => s.trim());
      return {
        canonical: `${titleCase(c)}, ${s.toUpperCase()}`,
        matched: true,
        originalInput: raw,
      };
    }
  }

  // Try match by city name only
  for (const key of Object.keys(cities)) {
    const [kCity] = key.split(",").map(s => s.trim());
    if (kCity === city) {
      const [c, s] = key.split(",").map(s => s.trim());
      return {
        canonical: `${titleCase(c)}, ${s.toUpperCase()}`,
        matched: true,
        originalInput: raw,
      };
    }
  }

  // No match — return as-is, flagged
  const fallback = state ? `${titleCase(city)}, ${state}` : titleCase(city);
  return {
    canonical: fallback,
    matched: false,
    originalInput: raw,
  };
}

function titleCase(s) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

// ── Lane Slug Generation ─────────────────────────────────────────────

/**
 * Generate a canonical lane slug from origin and destination city names.
 * Always: {originSlug}-to-{destinationSlug}
 * City slug = first part before comma, lowercase, alphanumeric+hyphens.
 */
export function laneSlug({ originCity, destinationCity }) {
  const slugify = (s) =>
    String(s || "")
      .split(",")[0]
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");

  const o = slugify(originCity);
  const d = slugify(destinationCity);
  if (!o || !d) return "";
  return `${o}-to-${d}`;
}

// ── Canonical URL Generation ─────────────────────────────────────────

/**
 * Generate the canonical URL for a given page intent.
 * Enforces one canonical per intent — no variations.
 *
 * @param {{ pageType: string, lane?: object, corridor?: object }} params
 * @returns {string} canonical URL path
 */
export function canonicalForIntent({ pageType, lane, corridor }) {
  switch (pageType) {
    case "lane_service":
    case "lane": {
      if (!lane) return "/";
      const slug = laneSlug({
        originCity: lane.origin || lane.originCity,
        destinationCity: lane.destination || lane.destinationCity,
      });
      return slug ? `/lanes/${slug}` : "/";
    }

    case "lane_data": {
      if (!lane) return "/";
      const slug = laneSlug({
        originCity: lane.origin || lane.originCity,
        destinationCity: lane.destination || lane.destinationCity,
      });
      return slug ? `/data/${slug}` : "/";
    }

    case "corridor_hub": {
      if (!corridor) return "/corridors";
      return `/corridors/${corridor.id}`;
    }

    case "corridor_explainer": {
      if (!corridor) return "/corridors";
      return `/corridors/${corridor.id}/how-warp-runs-this-corridor`;
    }

    case "tool": {
      return lane?.toolUrl || "/public/freight-quote";
    }

    default:
      return "/";
  }
}

// ── Parameter & URL Validation ───────────────────────────────────────

const NOINDEX_PARAM_PATTERNS = [
  "utm_", "origin=", "dest=", "destination=", "ref=",
  "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid",
  "prefill", "source=", "campaign=",
];

/**
 * Check if a parametrized URL should be indexable.
 * Any URL with query parameters matching noindex patterns → not indexable.
 * Clean URLs (no params) → indexable by default.
 */
export function isParametrizedUrlIndexable(url) {
  if (!url) return false;
  const qIdx = url.indexOf("?");
  if (qIdx === -1) return true; // no params = indexable

  const queryString = url.slice(qIdx + 1).toLowerCase();
  for (const pattern of NOINDEX_PARAM_PATTERNS) {
    if (queryString.includes(pattern)) return false;
  }
  return false; // any query param = noindex by default for lane pages
}

/**
 * Extract canonical URL from a parametrized URL.
 * Strips all query parameters and hash fragments.
 */
export function canonicalFromUrl(url) {
  if (!url) return "/";
  const qIdx = url.indexOf("?");
  const hIdx = url.indexOf("#");
  let clean = url;
  if (qIdx >= 0) clean = clean.slice(0, qIdx);
  if (hIdx >= 0) clean = clean.slice(0, hIdx);
  // Normalize trailing slashes
  clean = clean.replace(/\/+$/, "") || "/";
  // Lowercase the path
  return clean.toLowerCase();
}

// ── Canonical Conflict Detection ─────────────────────────────────────

/**
 * Build a canonical index from an array of pages and detect conflicts.
 * Returns { index: Map<canonical, pageKey[]>, conflicts: [] }.
 */
export function buildCanonicalIndex(pages) {
  const index = new Map();
  const conflicts = [];

  for (const page of pages) {
    const canonical = page.canonical_path || page.canonicalPath || "";
    const pageKey = page.slug || page.canonical_path || "";

    if (!canonical) continue;

    const normalized = canonicalFromUrl(canonical);
    if (!index.has(normalized)) {
      index.set(normalized, []);
    }
    index.get(normalized).push(pageKey);
  }

  // Detect conflicts: multiple pages mapping to same canonical
  for (const [canonical, keys] of index) {
    if (keys.length > 1) {
      conflicts.push({
        canonical,
        pages: keys,
        rule_id: "URL-CANONICAL-CONFLICT",
        details: `${keys.length} pages map to canonical ${canonical}: ${keys.join(", ")}`,
      });
    }
  }

  return { index, conflicts };
}

/**
 * Check if a lane slug variation would create a duplicate.
 * "ltl shipping chicago to dallas" vs "chicago to dallas ltl shipping"
 * must resolve to the same canonical.
 */
export function isVariantSlug(slug1, slug2) {
  if (!slug1 || !slug2) return false;
  // Both must resolve to same normalized form
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Extract city-to-city core
  const extract = (s) => {
    const m = s.match(/([a-z-]+)-to-([a-z-]+)/);
    return m ? `${m[1]}-to-${m[2]}` : norm(s);
  };
  return extract(slug1) === extract(slug2);
}
