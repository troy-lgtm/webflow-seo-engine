/**
 * SEO Dashboard Data Layer
 *
 * Server-only module that reads artifact files for the SEO control panel.
 * All functions return plain objects safe for React Server Components.
 *
 * Metric values include source attribution:
 *   { value, source, connected, window, last_pulled_at, coverage }
 *
 * Uses loadJsonArtifact() for all file reads — never process.cwd().
 */

import { loadJsonArtifact } from "./artifacts/load-artifact.js";
import { laneSlugToCanonicalPath } from "./metrics/join-keys.js";

// ── Helpers ──

function loadMetricsSnapshot() {
  return loadJsonArtifact("artifacts/metrics_snapshot.json");
}

function loadSanityReport() {
  return loadJsonArtifact("artifacts/metrics_sanity_report.json");
}

/**
 * Wrap a metric value with source attribution metadata.
 */
function attributed(value, source, snapshot) {
  const srcInfo = snapshot?.sources?.[source];
  const connected = srcInfo?.connected ?? false;
  const isPlaceholder = !connected && value !== 0 && value !== null && value !== undefined;
  return {
    value: value ?? null,
    source,
    connected,
    is_placeholder: isPlaceholder,
    window: snapshot?.window || null,
    last_pulled_at: srcInfo?.last_pulled_at || null,
    coverage: srcInfo?.coverage || null,
  };
}

// ── Overview ──

export function getOverviewData() {
  const publish = loadJsonArtifact("artifacts/publish_decision.json");
  const corridorSnap = loadJsonArtifact("artifacts/corridor_snapshot.json");
  const laneSnap = loadJsonArtifact("artifacts/lane_registry_snapshot.json");
  const config = loadJsonArtifact("config/seo-engine.json");
  const metricsSnap = loadMetricsSnapshot();
  const sanityReport = loadSanityReport();

  const lanes = laneSnap?.lanes || [];
  const corridors = (corridorSnap?.corridors || []).filter(c => c.corridor_id !== "other");

  const indexed = lanes.filter(l => l.status === "indexed").length;
  const blocked = lanes.filter(l => l.status === "blocked").length;
  const noindexed = lanes.filter(l => l.status === "noindex").length;
  const withDemand = lanes.filter(l => l.demand_signal).length;

  // Aggregate from metrics snapshot (attributed) or fall back to lane sums
  const gscData = metricsSnap?.gsc_data || {};
  const portalData = metricsSnap?.portal_data || {};

  let totalImpressions = 0;
  let totalClicks = 0;
  let totalQuotes = 0;
  let totalBookings = 0;

  for (const lane of lanes) {
    const cp = laneSlugToCanonicalPath(lane.lane_slug);
    const gsc = gscData[cp];
    const portal = portalData[cp];
    totalImpressions += gsc?.impressions ?? lane.gsc_impressions ?? 0;
    totalClicks += gsc?.clicks ?? lane.gsc_clicks ?? 0;
    totalQuotes += portal?.monthly_quotes ?? lane.quote_starts ?? 0;
    totalBookings += portal?.bookings ?? lane.bookings ?? 0;
  }

  // Blocked reasons aggregation
  const reasonCounts = {};
  for (const r of (publish?.blocked_reasons || [])) {
    const id = r.rule_id || "unknown";
    if (!reasonCounts[id]) reasonCounts[id] = { rule_id: id, count: 0, examples: [] };
    reasonCounts[id].count++;
    if (reasonCounts[id].examples.length < 3) {
      reasonCounts[id].examples.push(r.page_key || "");
    }
  }
  const blockedReasons = Object.values(reasonCounts).sort((a, b) => b.count - a.count);

  // Sources metadata for the UI
  const sources = metricsSnap?.sources || {
    gsc: { connected: false, last_pulled_at: null, coverage: { pages_with_data: 0, pages_total: lanes.length } },
    ga4: { connected: false, last_pulled_at: null, coverage: { pages_with_data: 0, pages_total: lanes.length } },
    portal: { connected: false, last_pulled_at: null, coverage: { lanes_with_data: 0, lanes_total: lanes.length } },
    placeholders: { enabled: true },
  };

  return {
    timestamp: publish?.timestamp || laneSnap?.generated_at || new Date().toISOString(),
    run_id: publish?.run_id || "none",
    mode: publish?.mode || "dry",
    metrics_window: metricsSnap?.window || null,
    sources,
    sanity: sanityReport ? {
      summary: sanityReport.summary,
      has_high: (sanityReport.summary?.high || 0) > 0,
      issues_count: sanityReport.issues?.length || 0,
    } : null,
    metrics: {
      pages_attempted: publish?.pages_attempted || lanes.length,
      pages_indexed: publish?.pages_indexed || indexed,
      pages_blocked: publish?.pages_blocked || blocked,
      pages_noindexed: publish?.pages_noindexed || noindexed,
    },
    inputs: {
      corridors_active: corridors.length,
      lanes_in_scope: lanes.length,
      lanes_with_demand: withDemand,
      lanes_data_eligible: lanes.filter(l => l.quality_score >= (config?.qualityThreshold || 65)).length,
    },
    outputs: {
      pages_generated: indexed + noindexed,
      pages_indexed: indexed,
      gsc_impressions: attributed(totalImpressions, "gsc", metricsSnap),
      gsc_clicks: attributed(totalClicks, "gsc", metricsSnap),
      quote_starts: attributed(totalQuotes, "portal", metricsSnap),
      bookings: attributed(totalBookings, "portal", metricsSnap),
    },
    blockedReasons,
    quality_distribution: publish?.quality_distribution || {
      excellent: lanes.filter(l => l.quality_score >= 80).length,
      good: lanes.filter(l => l.quality_score >= 65 && l.quality_score < 80).length,
      fair: lanes.filter(l => l.quality_score >= 40 && l.quality_score < 65).length,
      poor: lanes.filter(l => l.quality_score < 40).length,
    },
  };
}

// ── Corridors ──

export function getCorridorsData() {
  const snap = loadJsonArtifact("artifacts/corridor_snapshot.json");
  const metricsSnap = loadMetricsSnapshot();

  return (snap?.corridors || []).map(c => ({
    ...c,
    indexing_rate: c.lanes_total > 0 ? Math.round((c.lanes_indexed / c.lanes_total) * 100) : 0,
    health: c.lanes_total === 0 ? "healthy"
      : (c.lanes_indexed / c.lanes_total) >= 0.7 ? "healthy"
      : (c.lanes_indexed / c.lanes_total) >= 0.4 ? "at-risk"
      : "broken",
    sources: metricsSnap?.sources || null,
  }));
}

export function getCorridorDetail(corridorId) {
  const corridors = getCorridorsData();
  const corridor = corridors.find(c => c.corridor_id === corridorId);
  if (!corridor) return null;

  const laneSnap = loadJsonArtifact("artifacts/lane_registry_snapshot.json");
  const metricsSnap = loadMetricsSnapshot();
  const lanes = (laneSnap?.lanes || []).filter(l => l.corridor === corridorId);

  return {
    corridor,
    lanes,
    sources: metricsSnap?.sources || null,
    metrics_window: metricsSnap?.window || null,
  };
}

// ── Lanes ──

export function getLanesData({ corridor, status, search, limit = 200 } = {}) {
  const snap = loadJsonArtifact("artifacts/lane_registry_snapshot.json");
  const metricsSnap = loadMetricsSnapshot();
  let lanes = snap?.lanes || [];

  if (corridor) lanes = lanes.filter(l => l.corridor === corridor);
  if (status) lanes = lanes.filter(l => l.status === status);
  if (search) {
    const q = search.toLowerCase();
    lanes = lanes.filter(l => l.lane_slug.includes(q));
  }

  return {
    total: lanes.length,
    lanes: lanes.slice(0, limit),
    sources: metricsSnap?.sources || null,
  };
}

export function getLaneDetail(slug) {
  const snap = loadJsonArtifact("artifacts/lane_registry_snapshot.json");
  const lane = (snap?.lanes || []).find(l => l.lane_slug === slug);
  if (!lane) return null;

  const metricsSnap = loadMetricsSnapshot();
  const gscData = metricsSnap?.gsc_data || {};
  const ga4Data = metricsSnap?.ga4_data || {};
  const portalData = metricsSnap?.portal_data || {};
  const canonicalPath = laneSlugToCanonicalPath(slug);

  // Get corridor info
  const corridorSnap = loadJsonArtifact("artifacts/corridor_snapshot.json");
  const corridor = (corridorSnap?.corridors || []).find(c => c.corridor_id === lane.corridor);

  // Get publish decision reasons for this lane
  const publish = loadJsonArtifact("artifacts/publish_decision.json");
  const reasons = (publish?.blocked_reasons || []).filter(r => r.page_key === slug);

  // Get demand signals from raw data (for keyword detail)
  const keywords = loadJsonArtifact("data/demand/keywords.json") || {};

  // Parse slug for cities
  const parts = slug.split("-to-");
  const originCity = parts[0] ? parts[0].replace(/-/g, " ") : "";
  const destCity = parts[1] ? parts[1].replace(/-/g, " ") : "";

  // Attributed metrics for this specific lane
  const gsc = gscData[canonicalPath];
  const ga4 = ga4Data[canonicalPath];
  const portal = portalData[canonicalPath];

  return {
    lane,
    corridor: corridor || null,
    reasons,
    canonical_path: canonicalPath,
    demand: {
      gsc: gsc ? {
        impressions: attributed(gsc.impressions, "gsc", metricsSnap),
        clicks: attributed(gsc.clicks, "gsc", metricsSnap),
        position: attributed(gsc.position, "gsc", metricsSnap),
      } : null,
      ga4: ga4 ? {
        sessions: attributed(ga4.sessions, "ga4", metricsSnap),
        page_views: attributed(ga4.page_views, "ga4", metricsSnap),
      } : null,
      portal: portal ? {
        monthly_quotes: attributed(portal.monthly_quotes, "portal", metricsSnap),
        bookings: attributed(portal.bookings, "portal", metricsSnap),
        avg_value_usd: attributed(portal.avg_value_usd, "portal", metricsSnap),
      } : null,
      keywords: keywords[slug] || null,
    },
    sources: metricsSnap?.sources || null,
    metrics_window: metricsSnap?.window || null,
    cities: { origin: originCity, destination: destCity },
  };
}

// ── Lane Quality ──

export function getLaneQualityData() {
  const audit = loadJsonArtifact("artifacts/existing_lane_page_audit.json");
  const validationReport = loadJsonArtifact("artifacts/lane_page_validation_report.json");
  const publishedPages = loadJsonArtifact("data/published_pages.json");
  const bannedConfig = loadJsonArtifact("config/lane-page-banned-content.json");

  const pages = publishedPages || {};
  const pageCount = Object.keys(pages).length;

  // Classification counts from audit
  const classifications = audit?.results || [];
  const classificationCounts = {
    valid_lane_page: 0,
    generic_template_page: 0,
    fallback_content_page: 0,
    thin_lane_page: 0,
    banned_content_page: 0,
    unaudited: 0,
  };

  for (const r of classifications) {
    const cls = r.classification || "unaudited";
    if (classificationCounts[cls] !== undefined) {
      classificationCounts[cls]++;
    } else {
      classificationCounts.unaudited++;
    }
  }

  // Validation gate summary from report
  const validationResults = validationReport?.results || [];
  const gateSummary = {
    total_validated: validationResults.length,
    passed: validationResults.filter(r => r.valid).length,
    failed: validationResults.filter(r => !r.valid).length,
    gate_failures: {},
  };

  for (const r of validationResults) {
    if (!r.valid && r.failures) {
      for (const f of r.failures) {
        const ruleId = f.rule_id || "UNKNOWN";
        gateSummary.gate_failures[ruleId] = (gateSummary.gate_failures[ruleId] || 0) + 1;
      }
    }
  }

  // Quality score distribution from validation
  const scoreDistribution = { excellent: 0, good: 0, fair: 0, poor: 0 };
  for (const r of validationResults) {
    const s = r.quality_score ?? 0;
    if (s >= 80) scoreDistribution.excellent++;
    else if (s >= 65) scoreDistribution.good++;
    else if (s >= 40) scoreDistribution.fair++;
    else scoreDistribution.poor++;
  }

  // Per-page details
  const pageDetails = validationResults.map(r => ({
    slug: r.slug,
    valid: r.valid,
    quality_score: r.quality_score ?? 0,
    classification: r.classification || "unknown",
    failures: r.failures || [],
    banned_content_found: r.banned_content_found || [],
    missing_sections: r.missing_sections || [],
  }));

  return {
    timestamp: audit?.timestamp || validationReport?.timestamp || new Date().toISOString(),
    published_page_count: pageCount,
    audit_summary: {
      total_audited: classifications.length,
      classifications: classificationCounts,
    },
    validation_summary: gateSummary,
    quality_distribution: scoreDistribution,
    gate_rule_ids: bannedConfig?.gate_rule_ids || {},
    pages: pageDetails,
  };
}

// ── Experiments ──

export function getExperimentsData() {
  const data = loadJsonArtifact("artifacts/experiments.json");
  if (data?.experiments) return data.experiments;

  return [
    {
      id: "exp-001",
      name: "Archetype-based intro templates",
      status: "active",
      scope: "All lane pages",
      start_date: "2026-02-15",
      affected_lanes: 200,
      metrics: { indexing_lift: "+12%", traffic_lift: "Pending", conversion_lift: "Pending" },
      description: "Testing 10 archetype-specific intro templates to reduce content similarity and improve uniqueness scores across lane pages.",
    },
    {
      id: "exp-002",
      name: "Corridor-first related lane selection",
      status: "active",
      scope: "Corridor lanes only",
      start_date: "2026-03-01",
      affected_lanes: 150,
      metrics: { indexing_lift: "Pending", traffic_lift: "Pending", conversion_lift: "Pending" },
      description: "Scoring related lanes by demand signals instead of random selection. Testing whether demand-weighted linking improves crawl efficiency.",
    },
    {
      id: "exp-003",
      name: "Quality threshold adjustment",
      status: "planned",
      scope: "Low-quality pages",
      start_date: "2026-03-10",
      affected_lanes: 80,
      metrics: { indexing_lift: "N/A", traffic_lift: "N/A", conversion_lift: "N/A" },
      description: "Raising quality hard floor from 40 to 50 and threshold from 65 to 70 to evaluate whether fewer, higher-quality pages produce better aggregate traffic.",
    },
    {
      id: "exp-004",
      name: "FAQ pool variant rotation",
      status: "completed",
      scope: "Pages with >3% FAQ overlap",
      start_date: "2026-02-01",
      affected_lanes: 120,
      metrics: { indexing_lift: "+8%", traffic_lift: "+5%", conversion_lift: "+2%" },
      description: "Rotating FAQ questions to variant pool when primary pool exceeds 3% reuse cap. Reduced FAQ duplication from 12% to 2.8%.",
    },
  ];
}

// ── Benchmarks ──

export function getBenchmarksData() {
  const benchmarks = loadJsonArtifact("config/benchmarks.json") || {};
  const laneSnap = loadJsonArtifact("artifacts/lane_registry_snapshot.json");
  const corridorSnap = loadJsonArtifact("artifacts/corridor_snapshot.json");
  const metricsSnap = loadMetricsSnapshot();
  const publish = loadJsonArtifact("artifacts/publish_decision.json");

  const lanes = laneSnap?.lanes || [];
  const corridors = (corridorSnap?.corridors || []).filter(c => c.corridor_id !== "other");
  const gscData = metricsSnap?.gsc_data || {};
  const portalData = metricsSnap?.portal_data || {};

  const indexed = lanes.filter(l => l.status === "indexed").length;
  const blocked = lanes.filter(l => l.status === "blocked").length;
  const eligible = lanes.length;

  // System health current values
  const canonicalConflicts = (publish?.canonical_conflicts || []).length;
  const brokenLinks = (publish?.broken_links || []).length;
  const orphanedPages = lanes.filter(l => !l.demand_signal && l.corridor === "other" && l.status === "indexed").length;
  const indexingRate = eligible > 0 ? Math.round((indexed / eligible) * 100) : 0;
  const blockedRate = eligible > 0 ? Math.round((blocked / eligible) * 100) : 0;

  // Performance current values
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalQuotes = 0;
  let totalBookings = 0;
  let pagesWithImpressions = 0;

  for (const lane of lanes) {
    const cp = laneSlugToCanonicalPath(lane.lane_slug);
    const gsc = gscData[cp];
    const portal = portalData[cp];
    const imp = gsc?.impressions ?? lane.gsc_impressions ?? 0;
    const cl = gsc?.clicks ?? lane.gsc_clicks ?? 0;
    const q = portal?.monthly_quotes ?? lane.quote_starts ?? 0;
    const b = portal?.bookings ?? lane.bookings ?? 0;
    totalImpressions += imp;
    totalClicks += cl;
    totalQuotes += q;
    totalBookings += b;
    if (imp > 0) pagesWithImpressions++;
  }

  const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100) : 0;
  const clickToQuote = totalClicks > 0 ? ((totalQuotes / totalClicks) * 100) : 0;
  const quoteToBooking = totalQuotes > 0 ? ((totalBookings / totalQuotes) * 100) : 0;
  const avgPagesWithImprPerCorridor = corridors.length > 0
    ? Math.round(pagesWithImpressions / corridors.length)
    : 0;

  return {
    config: benchmarks,
    system_health: {
      canonical_conflicts: { current: canonicalConflicts, target: 0 },
      broken_internal_links: { current: brokenLinks, target: 0 },
      orphaned_pages: { current: orphanedPages, target: 0 },
      eligible_indexing_rate_pct: { current: indexingRate, target: 70 },
      blocked_rate_pct: { current: blockedRate, target_max: 10 },
    },
    performance: {
      pages_with_impressions_per_corridor: { current: avgPagesWithImprPerCorridor, target: 25 },
      lane_page_ctr_pct: { current: parseFloat(ctr.toFixed(2)), min: 0.5, max: 2.0 },
      click_to_quote_pct: { current: parseFloat(clickToQuote.toFixed(2)), min: 1, max: 5 },
      quote_to_booking_pct: { current: parseFloat(quoteToBooking.toFixed(2)), min: 5, max: 20 },
    },
    sources: metricsSnap?.sources || null,
  };
}

// ── Sanity Report ──

export function getSanityReport() {
  return loadSanityReport();
}

// ── Metrics Snapshot (for health endpoint) ──

export function getMetricsSnapshot() {
  return loadMetricsSnapshot();
}
