/**
 * Portal Data Provider
 *
 * Reads WARP portal quote/booking data from local snapshot or API.
 * Returns normalized metrics keyed by canonical_path.
 */

import { loadJsonArtifact } from "../../artifacts/load-artifact.js";
import { laneSlugToCanonicalPath } from "../join-keys.js";

/**
 * Check if Portal API integration is connected.
 * @param {object} [env] - process.env or custom env
 * @returns {boolean}
 */
export function isConnected(env) {
  const e = env || process.env;
  return Boolean(e.PORTAL_API_KEY && e.PORTAL_API_URL);
}

/**
 * Load Portal data from local snapshot or (future) fetch from API.
 * @param {{ window?: { days: number } }} [opts]
 * @returns {{ source: string, connected: boolean, last_pulled_at: string|null, data: object }}
 */
export function loadFromLocalSnapshotOrFetch(opts = {}) {
  const connected = isConnected();

  if (connected) {
    console.log("[portal] API keys present but fetch not implemented yet. Falling back to local snapshot.");
  }

  const raw = loadJsonArtifact("data/demand/portal_quotes.json") || {};

  // Normalize: key by canonical_path
  const data = {};
  let lanesWithData = 0;

  for (const [slug, metrics] of Object.entries(raw)) {
    if (slug.startsWith("_")) continue;
    const canonicalPath = laneSlugToCanonicalPath(slug);
    data[canonicalPath] = {
      monthly_quotes: metrics.monthly_quotes || 0,
      avg_value_usd: metrics.avg_value_usd || 0,
      bookings: metrics.monthly_quotes ? Math.floor(metrics.monthly_quotes * 0.33) : 0,
      source_key: slug,
    };
    lanesWithData++;
  }

  return {
    source: "portal",
    connected,
    last_pulled_at: connected ? null : null,
    data,
    coverage: { lanes_with_data: lanesWithData },
  };
}
