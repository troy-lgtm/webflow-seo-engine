/**
 * SEO Momentum — Actual early momentum tracker
 *
 * Compares real metric data from connected sources against
 * the expected SEO impact ranges from seo_impact_estimate.json.
 *
 * Status rules:
 *   "on_track"           — actual is between low and high benchmark
 *   "below_plan"         — actual is below low benchmark
 *   "ahead_of_plan"      — actual is above high benchmark
 *   "insufficient_data"  — cannot compute (disconnected sources or no data)
 *
 * Never uses process.cwd().
 */

import fs from "fs";
import { resolveFromRoot } from "./fs/project-root.js";
import { loadJsonArtifact } from "./artifacts/load-artifact.js";
import { laneSlugToCanonicalPath } from "./metrics/join-keys.js";

/**
 * Determine momentum status given an actual value and a benchmark range.
 */
function determineStatus(actual, benchmarkRange) {
  if (actual == null || benchmarkRange == null) return "insufficient_data";
  if (actual >= benchmarkRange.high) return "ahead_of_plan";
  if (actual >= benchmarkRange.low) return "on_track";
  return "below_plan";
}

/**
 * Compute week-over-week delta if previous window data is available.
 */
function computeDelta(current, previous) {
  if (current == null || previous == null || previous === 0) return null;
  return parseFloat(((current - previous) / previous).toFixed(2));
}

/**
 * Build the SEO momentum report.
 *
 * @param {{ metricsSnapshot, publishDecision, previousWindowMetrics }} opts
 * @returns {object} Momentum report
 */
export function buildSeoMomentumReport({
  metricsSnapshot,
  publishDecision,
  previousWindowMetrics,
} = {}) {
  const now = new Date();
  const metrics = metricsSnapshot || loadJsonArtifact("artifacts/metrics_snapshot.json");
  const decision = publishDecision || loadJsonArtifact("artifacts/publish_decision.json");
  const impactEstimate = loadJsonArtifact("artifacts/seo_impact_estimate.json");
  const laneSnap = loadJsonArtifact("artifacts/lane_registry_snapshot.json");
  const prev = previousWindowMetrics || null;

  // Check if we have enough data to compute momentum
  const gscConnected = metrics?.sources?.gsc?.connected ?? false;
  const portalConnected = metrics?.sources?.portal?.connected ?? false;

  const gscData = metrics?.gsc_data || {};
  const portalData = metrics?.portal_data || {};
  const lanes = laneSnap?.lanes || [];

  // Compute actuals across all lanes
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalQuoteStarts = 0;
  let totalBookings = 0;
  let pagesWithImpressions = 0;
  let indexedPagesKnown = 0;

  for (const lane of lanes) {
    const cp = laneSlugToCanonicalPath(lane.lane_slug);
    const gsc = gscData[cp];
    const portal = portalData[cp];

    const imp = gsc?.impressions ?? 0;
    const clicks = gsc?.clicks ?? 0;
    const quotes = portal?.monthly_quotes ?? 0;
    const bookings = portal?.bookings ?? 0;

    totalImpressions += imp;
    totalClicks += clicks;
    totalQuoteStarts += quotes;
    totalBookings += bookings;

    if (imp > 0) pagesWithImpressions++;
    if (lane.status === "indexed" && imp > 0) indexedPagesKnown++;
  }

  // If no metrics data and no sources connected, insufficient_data
  const hasAnyData = totalImpressions > 0 || totalClicks > 0 || totalQuoteStarts > 0;
  const anySourceConnected = gscConnected || portalConnected;

  // Week-over-week deltas
  const wow = {
    impressions_delta: computeDelta(totalImpressions, prev?.impressions),
    clicks_delta: computeDelta(totalClicks, prev?.clicks),
    pages_with_nonzero_impressions_delta: computeDelta(pagesWithImpressions, prev?.pages_with_nonzero_impressions),
  };

  // Compare to impact estimate benchmarks
  let status = "insufficient_data";
  const notes = [];

  if (!anySourceConnected && !hasAnyData) {
    status = "insufficient_data";
    notes.push("No metric sources connected — cannot compute momentum");
  } else if (!hasAnyData) {
    status = "insufficient_data";
    notes.push("Sources connected but no metric data received yet");
  } else if (impactEstimate?.expected?.week_4) {
    // Compare actual impressions to week_4 benchmark (most relevant for early momentum)
    const w4 = impactEstimate.expected.week_4;
    status = determineStatus(totalImpressions, w4.impressions);

    if (status === "ahead_of_plan") {
      notes.push("Actual impressions exceed high-case benchmark — strong early momentum");
    } else if (status === "on_track") {
      notes.push("Early momentum is within benchmark range");
    } else if (status === "below_plan") {
      notes.push("Early momentum is below benchmark low case — indexing may need more time");
    }

    // Additional context
    if (pagesWithImpressions > 0 && indexedPagesKnown > 0) {
      const indexRatio = indexedPagesKnown / (lanes.filter(l => l.status === "indexed").length || 1);
      notes.push(`${(indexRatio * 100).toFixed(0)}% of indexed pages have nonzero impressions`);
    }
  } else {
    // No impact estimate to compare against — just report status based on presence
    status = hasAnyData ? "on_track" : "insufficient_data";
    notes.push("No impact estimate available for comparison — showing raw actuals only");
  }

  const report = {
    run_id: decision?.run_id || metrics?.run_id || "none",
    timestamp: now.toISOString(),
    sources_connected: {
      gsc: gscConnected,
      portal: portalConnected,
      ga4: metrics?.sources?.ga4?.connected ?? false,
    },
    actual: {
      indexed_pages_known: indexedPagesKnown,
      pages_with_nonzero_impressions: pagesWithImpressions,
      impressions: totalImpressions,
      clicks: totalClicks,
      quote_starts: totalQuoteStarts,
      bookings: totalBookings,
    },
    week_over_week: wow,
    status,
    notes,
  };

  // Write artifact
  const p = resolveFromRoot("artifacts", "seo_momentum_report.json");
  fs.mkdirSync(resolveFromRoot("artifacts"), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(report, null, 2));

  return report;
}
