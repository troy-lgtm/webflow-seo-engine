/**
 * GA4 Data Provider
 *
 * Reads Google Analytics 4 data from local snapshot or API.
 * Returns normalized metrics keyed by canonical_path.
 */

import { loadJsonArtifact } from "../../artifacts/load-artifact.js";
import { normalizePagePath } from "../join-keys.js";

/**
 * Check if GA4 API integration is connected.
 * @param {object} [env] - process.env or custom env
 * @returns {boolean}
 */
export function isConnected(env) {
  const e = env || process.env;
  return Boolean(e.GA4_PROPERTY_ID && e.GA4_SERVICE_ACCOUNT_KEY);
}

/**
 * Load GA4 data from local snapshot or (future) fetch from API.
 * @param {{ window?: { days: number } }} [opts]
 * @returns {{ source: string, connected: boolean, last_pulled_at: string|null, data: object }}
 */
export function loadFromLocalSnapshotOrFetch(opts = {}) {
  const connected = isConnected();

  if (connected) {
    console.log("[ga4] API keys present but fetch not implemented yet. Falling back to local snapshot.");
  }

  const raw = loadJsonArtifact("data/demand/ga4.json") || {};

  // Normalize: key by canonical_path
  const data = {};
  let pagesWithData = 0;

  for (const [pathOrUrl, metrics] of Object.entries(raw)) {
    if (pathOrUrl.startsWith("_")) continue;
    const canonicalPath = normalizePagePath(pathOrUrl);
    data[canonicalPath] = {
      sessions: metrics.sessions || 0,
      page_views: metrics.page_views || 0,
      avg_engagement_time: metrics.avg_engagement_time || 0,
      bounce_rate: metrics.bounce_rate || null,
      events: metrics.events || {},
      source_key: pathOrUrl,
    };
    pagesWithData++;
  }

  return {
    source: "ga4",
    connected,
    last_pulled_at: connected ? null : null,
    data,
    coverage: { pages_with_data: pagesWithData },
  };
}
