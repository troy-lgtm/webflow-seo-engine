/**
 * GSC Data Provider
 *
 * Reads Google Search Console data from local snapshot or API.
 * Returns normalized metrics keyed by canonical_path.
 */

import { loadJsonArtifact } from "../../artifacts/load-artifact.js";
import { laneSlugToCanonicalPath } from "../join-keys.js";

/**
 * Check if GSC API integration is connected.
 * @param {object} [env] - process.env or custom env
 * @returns {boolean}
 */
export function isConnected(env) {
  const e = env || process.env;
  return Boolean(e.GSC_PROPERTY_URL && e.GSC_SERVICE_ACCOUNT_KEY);
}

/**
 * Load GSC data from local snapshot or (future) fetch from API.
 * @param {{ window?: { days: number } }} [opts]
 * @returns {{ source: string, connected: boolean, last_pulled_at: string|null, data: object }}
 */
export function loadFromLocalSnapshotOrFetch(opts = {}) {
  const connected = isConnected();

  if (connected) {
    // Future: fetch from GSC API
    console.log("[gsc] API keys present but fetch not implemented yet. Falling back to local snapshot.");
  }

  const raw = loadJsonArtifact("data/demand/gsc.json") || {};

  // Normalize: key by canonical_path, skip comment fields
  const data = {};
  let pagesWithData = 0;

  for (const [slug, metrics] of Object.entries(raw)) {
    if (slug.startsWith("_")) continue;
    const canonicalPath = laneSlugToCanonicalPath(slug);
    data[canonicalPath] = {
      impressions: metrics.impressions || 0,
      clicks: metrics.clicks || 0,
      position: metrics.position || null,
      source_key: slug,
    };
    pagesWithData++;
  }

  return {
    source: "gsc",
    connected,
    last_pulled_at: connected ? null : null, // local file has no pull timestamp
    data,
    coverage: { pages_with_data: pagesWithData },
  };
}
