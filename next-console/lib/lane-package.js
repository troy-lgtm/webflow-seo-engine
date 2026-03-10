import { makeLanePage } from "@/lib/lane-engine";
import { buildCanonicalPath, contentFingerprint } from "@/lib/published-registry";

/**
 * Build a complete lane package for Webflow publishing.
 * Returns all data needed for page spec, copy, schemas, and preview.
 */
export function buildLanePackage({ origin, destination, mode, segment }) {
  const combo = {
    origin,
    destination,
    mode,
    segment: segment || "smb",
    audience: "Logistics teams",
    metrics: { weekly_shipments: 18, avg_quote_value: 2200, win_rate: 0.22, strategic_priority: 8 },
    priority: { score: 80, expected_monthly_revenue: 18 * 4 * 2200 * 0.22 },
    rank: 1
  };

  const design = {
    accent: "#FF6B35",
    surface1: "#0a0a0a",
    surface2: "#111",
    border: "#222",
    radius: 8
  };

  const page = makeLanePage(combo, design);
  const canonicalPath = buildCanonicalPath(origin, destination, mode);

  // Quick answer block
  const quickAnswer = {
    question: `How much does ${mode} freight from ${origin} to ${destination} cost?`,
    answer: `Estimated ${mode} rates from ${origin} to ${destination} range from approximately $${page.lane_stats?.estimated_rate_range_usd?.low?.toLocaleString() || "N/A"} to $${page.lane_stats?.estimated_rate_range_usd?.high?.toLocaleString() || "N/A"} depending on freight class, pallet count, and shipment weight. These are modeled estimates. Get an instant quote for real-time pricing.`
  };

  const quickAnswerTransit = {
    question: `How long does ${mode} transit take from ${origin} to ${destination}?`,
    answer: `Estimated transit time is ${page.lane_stats?.estimated_transit_days_range?.min || "N/A"}-${page.lane_stats?.estimated_transit_days_range?.max || "N/A"} business days for standard ${mode} service on this ~${page.lane_stats?.estimated_distance_miles?.toLocaleString() || "N/A"}-mile corridor. Actual transit depends on carrier routing and terminal schedules.`
  };

  const fp = contentFingerprint({
    canonical_path: canonicalPath,
    seo_title: page.seo_title,
    h1: page.h1,
    intro: page.intro
  });

  return {
    page,
    canonicalPath,
    quickAnswers: [quickAnswer, quickAnswerTransit],
    contentFingerprint: fp,
    publishDate: "2026-03-04T04:30:00-08:00",
    origin,
    destination,
    mode,
    segment: segment || "smb"
  };
}
