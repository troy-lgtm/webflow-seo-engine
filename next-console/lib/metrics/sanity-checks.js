/**
 * Metrics Sanity Checks
 *
 * Detects impossible funnels, data mismatches, and integrity issues.
 * Every check produces a typed issue with severity.
 */

import { getJoinKeyForLane } from "./join-keys.js";

/**
 * Run all sanity checks against lane metrics and source status.
 *
 * @param {{
 *   lanes: Array<object>,
 *   metricsSnapshot: object,
 *   window: { days: number, start: string, end: string }
 * }} opts
 * @returns {{ issues: Array<object>, summary: { high: number, medium: number, low: number } }}
 */
export function runSanityChecks({ lanes = [], metricsSnapshot = {}, window = {} } = {}) {
  const issues = [];
  const sources = metricsSnapshot.sources || {};
  const gscData = metricsSnapshot.gsc_data || {};
  const portalData = metricsSnapshot.portal_data || {};

  for (const lane of lanes) {
    const cp = getJoinKeyForLane(lane);

    const gsc = gscData[cp];
    const portal = portalData[cp];

    const clicks = gsc?.clicks ?? lane.gsc_clicks ?? 0;
    const impressions = gsc?.impressions ?? lane.gsc_impressions ?? 0;
    const quoteStarts = portal?.monthly_quotes ?? lane.quote_starts ?? 0;
    const bookings = portal?.bookings ?? lane.bookings ?? 0;

    // Rule 1: Quote starts > clicks (impossible funnel unless attribution gap)
    if (quoteStarts > 0 && clicks > 0 && quoteStarts > clicks) {
      issues.push({
        severity: "high",
        type: "funnel_inversion_quotes_gt_clicks",
        canonical_path: cp,
        details: {
          clicks,
          quote_starts: quoteStarts,
          ratio: (quoteStarts / clicks).toFixed(2),
          explanation: "Quote starts exceed clicks for same lane. Possible attribution gap or cross-session conversion. Requires manual review.",
        },
      });
    }

    // Rule 2: Bookings > quote starts
    if (bookings > 0 && quoteStarts > 0 && bookings > quoteStarts) {
      issues.push({
        severity: "high",
        type: "funnel_inversion_bookings_gt_quotes",
        canonical_path: cp,
        details: {
          quote_starts: quoteStarts,
          bookings,
          explanation: "Bookings exceed quote starts. Data integrity issue.",
        },
      });
    }

    // Rule 3: Negative deltas
    if (impressions < 0 || clicks < 0 || quoteStarts < 0 || bookings < 0) {
      issues.push({
        severity: "high",
        type: "negative_metric",
        canonical_path: cp,
        details: { impressions, clicks, quote_starts: quoteStarts, bookings },
      });
    }

    // Rule 4: Metric present but source disconnected
    if (gsc && (gsc.impressions > 0 || gsc.clicks > 0) && sources.gsc?.connected === false) {
      issues.push({
        severity: "medium",
        type: "metric_without_connected_source",
        canonical_path: cp,
        details: {
          source: "gsc",
          explanation: "GSC metrics present but source not connected. Values are from local stub data.",
        },
      });
    }

    if (portal && (portal.monthly_quotes > 0) && sources.portal?.connected === false) {
      issues.push({
        severity: "medium",
        type: "metric_without_connected_source",
        canonical_path: cp,
        details: {
          source: "portal",
          explanation: "Portal metrics present but source not connected. Values are from local stub data.",
        },
      });
    }

    // Rule 5: Clicks > Impressions (impossible)
    if (clicks > impressions && impressions > 0) {
      issues.push({
        severity: "high",
        type: "clicks_exceed_impressions",
        canonical_path: cp,
        details: { impressions, clicks },
      });
    }
  }

  // Deduplicate medium severity "metric_without_connected_source" to one per source
  const dedupedIssues = [];
  const seenSourceWarnings = new Set();
  for (const issue of issues) {
    if (issue.type === "metric_without_connected_source") {
      const key = `${issue.type}:${issue.details.source}`;
      if (seenSourceWarnings.has(key)) continue;
      seenSourceWarnings.add(key);
      // Make it aggregate
      issue.details.note = "Applies to all lanes with this source's data.";
      delete issue.canonical_path;
    }
    dedupedIssues.push(issue);
  }

  const summary = {
    high: dedupedIssues.filter(i => i.severity === "high").length,
    medium: dedupedIssues.filter(i => i.severity === "medium").length,
    low: dedupedIssues.filter(i => i.severity === "low").length,
  };

  return { issues: dedupedIssues, summary };
}
