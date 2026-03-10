/**
 * SEO Impact Estimator — Conservative expected SEO boost ranges
 *
 * Outputs directional ranges, never single-point predictions.
 * Uses configurable benchmarks from config/seo-impact-benchmarks.json.
 *
 * Never pretends to predict rankings. Estimates likely discovery,
 * indexing, and early impression ranges based on:
 *   - indexable page count
 *   - corridor priority distribution
 *   - internal linking density
 *   - historical benchmarks
 *
 * Never uses process.cwd().
 */

import fs from "fs";
import { resolveFromRoot } from "./fs/project-root.js";
import { loadJsonArtifact } from "./artifacts/load-artifact.js";

/**
 * Load SEO impact benchmarks config.
 */
function loadBenchmarks() {
  return loadJsonArtifact("config/seo-impact-benchmarks.json") || {
    discovery: {
      week_1_indexed_ratio: { low: 0.05, mid: 0.12, high: 0.20 },
      week_4_indexed_ratio: { low: 0.30, mid: 0.50, high: 0.70 },
      month_2_indexed_ratio: { low: 0.50, mid: 0.70, high: 0.85 },
    },
    impressions_per_indexed_page_per_month: { low: 5, mid: 25, high: 80 },
    ctr_lane_pages: { low: 0.005, mid: 0.012, high: 0.02 },
    click_to_quote_start: { low: 0.01, mid: 0.03, high: 0.05 },
    quote_start_to_booking: { low: 0.05, mid: 0.10, high: 0.20 },
  };
}

/**
 * Compute corridor priority share from lane data.
 * Priority corridors = those with priority "high" or "medium".
 */
function computePriorityCorridorShare(lanes, corridorSnapshot) {
  if (!corridorSnapshot?.corridors || lanes.length === 0) return 0;

  const priorityCorridorIds = new Set(
    corridorSnapshot.corridors
      .filter(c => c.priority === "high" || c.priority === "medium")
      .map(c => c.corridor_id)
  );

  const indexable = lanes.filter(l => l.status === "indexed" || l.indexable);
  if (indexable.length === 0) return 0;

  const inPriority = indexable.filter(l => priorityCorridorIds.has(l.corridor));
  return inPriority.length / indexable.length;
}

/**
 * Round to nearest integer.
 */
function r(n) {
  return Math.round(n);
}

/**
 * Estimate SEO impact for a publish run.
 *
 * @param {{ publishDecision, publishedPages, historicalRuns, lanes, corridorSnapshot }} opts
 * @returns {object} Impact estimate with ranges
 */
export function estimateSeoImpact({
  publishDecision,
  publishedPages,
  historicalRuns,
  lanes,
  corridorSnapshot,
} = {}) {
  const benchmarks = loadBenchmarks();
  const now = new Date();

  // Determine indexable page count
  const decision = publishDecision || loadJsonArtifact("artifacts/publish_decision.json");
  const laneSnap = lanes || loadJsonArtifact("artifacts/lane_registry_snapshot.json")?.lanes || [];
  const corrSnap = corridorSnapshot || loadJsonArtifact("artifacts/corridor_snapshot.json");

  const indexablePages = decision?.pages_indexable ||
    laneSnap.filter(l => l.status === "indexed").length ||
    0;

  const priorityCorridorShare = computePriorityCorridorShare(laneSnap, corrSnap);

  // Priority boost multiplier: higher share of priority corridors → better indexing speed
  // Ranges from 1.0 (no priority corridors) to 1.3 (all priority corridors)
  const priorityBoost = 1.0 + (priorityCorridorShare * 0.3);

  // Internal linking bonus: if pages > 50, assume decent internal linking
  const linkingBonus = indexablePages > 50 ? 1.1 : 1.0;

  const disc = benchmarks.discovery;
  const impPerPage = benchmarks.impressions_per_indexed_page_per_month;
  const ctr = benchmarks.ctr_lane_pages;
  const c2q = benchmarks.click_to_quote_start;
  const q2b = benchmarks.quote_start_to_booking;

  // Week 1 estimates
  const w1Indexed = {
    low: r(indexablePages * disc.week_1_indexed_ratio.low),
    mid: r(indexablePages * disc.week_1_indexed_ratio.mid * priorityBoost),
    high: r(indexablePages * disc.week_1_indexed_ratio.high * priorityBoost * linkingBonus),
  };
  // Week 1: impressions are fraction of monthly (1/4)
  const w1Impressions = {
    low: r(w1Indexed.low * impPerPage.low * 0.25),
    mid: r(w1Indexed.mid * impPerPage.mid * 0.25),
    high: r(w1Indexed.high * impPerPage.high * 0.25),
  };
  const w1Clicks = {
    low: r(w1Impressions.low * ctr.low),
    mid: r(w1Impressions.mid * ctr.mid),
    high: r(w1Impressions.high * ctr.high),
  };

  // Week 4 estimates
  const w4Indexed = {
    low: r(indexablePages * disc.week_4_indexed_ratio.low),
    mid: r(indexablePages * disc.week_4_indexed_ratio.mid * priorityBoost),
    high: r(indexablePages * disc.week_4_indexed_ratio.high * priorityBoost * linkingBonus),
  };
  const w4Impressions = {
    low: r(w4Indexed.low * impPerPage.low),
    mid: r(w4Indexed.mid * impPerPage.mid),
    high: r(w4Indexed.high * impPerPage.high),
  };
  const w4Clicks = {
    low: r(w4Impressions.low * ctr.low),
    mid: r(w4Impressions.mid * ctr.mid),
    high: r(w4Impressions.high * ctr.high),
  };

  // Month 2 estimates (full funnel)
  const m2Indexed = {
    low: r(indexablePages * disc.month_2_indexed_ratio.low),
    mid: r(indexablePages * disc.month_2_indexed_ratio.mid * priorityBoost),
    high: r(indexablePages * disc.month_2_indexed_ratio.high * priorityBoost * linkingBonus),
  };
  const m2Impressions = {
    low: r(m2Indexed.low * impPerPage.low),
    mid: r(m2Indexed.mid * impPerPage.mid),
    high: r(m2Indexed.high * impPerPage.high),
  };
  const m2Clicks = {
    low: r(m2Impressions.low * ctr.low),
    mid: r(m2Impressions.mid * ctr.mid),
    high: r(m2Impressions.high * ctr.high),
  };
  const m2QuoteStarts = {
    low: r(m2Clicks.low * c2q.low),
    mid: r(m2Clicks.mid * c2q.mid),
    high: r(m2Clicks.high * c2q.high),
  };
  const m2Bookings = {
    low: r(m2QuoteStarts.low * q2b.low),
    mid: r(m2QuoteStarts.mid * q2b.mid),
    high: r(m2QuoteStarts.high * q2b.high),
  };

  const estimate = {
    run_id: decision?.run_id || "none",
    timestamp: now.toISOString(),
    assumptions: {
      indexable_pages: indexablePages,
      priority_corridor_share: parseFloat(priorityCorridorShare.toFixed(2)),
      priority_boost: parseFloat(priorityBoost.toFixed(2)),
      linking_bonus: linkingBonus,
    },
    expected: {
      week_1: {
        indexed_pages: w1Indexed,
        impressions: w1Impressions,
        clicks: w1Clicks,
      },
      week_4: {
        indexed_pages: w4Indexed,
        impressions: w4Impressions,
        clicks: w4Clicks,
      },
      month_2: {
        indexed_pages: m2Indexed,
        impressions: m2Impressions,
        clicks: m2Clicks,
        quote_starts: m2QuoteStarts,
        bookings: m2Bookings,
      },
    },
    notes: [
      "These are benchmark-based directional ranges, not rank guarantees",
      "Actual results depend on content quality, competition, and Google's crawl schedule",
      `Priority corridor share: ${(priorityCorridorShare * 100).toFixed(0)}% — ${priorityCorridorShare > 0.5 ? "strong" : "moderate"} corridor focus`,
    ],
  };

  // Write artifact
  const p = resolveFromRoot("artifacts", "seo_impact_estimate.json");
  fs.mkdirSync(resolveFromRoot("artifacts"), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(estimate, null, 2));

  return estimate;
}
