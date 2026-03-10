/**
 * /api/seo — Unified SEO dashboard data endpoint
 *
 * Query params:
 *   ?view=publish    → publish_decision.json
 *   ?view=corridors  → corridor_snapshot.json
 *   ?view=lanes      → lane_registry_snapshot.json
 *   ?view=experiments → experiments.json
 *   ?view=lane-quality → lane page quality audit + validation data
 *   ?view=overview   → combined overview metrics
 *
 * Auth: INTERNAL_DASHBOARD_KEY header or query param
 *
 * Uses loadJsonArtifact() for all file reads — never process.cwd().
 */

import { NextResponse } from "next/server";
import { loadJsonArtifact } from "@/lib/artifacts/load-artifact.js";

function checkAuth(request) {
  const key = process.env.INTERNAL_DASHBOARD_KEY;
  if (!key) return true; // no key = no auth required (dev)
  const headerKey = request.headers.get("x-dashboard-key");
  const { searchParams } = new URL(request.url);
  const paramKey = searchParams.get("key");
  return headerKey === key || paramKey === key;
}

export async function GET(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "overview";
  const corridorFilter = searchParams.get("corridor");
  const search = searchParams.get("search");
  const status = searchParams.get("status");

  switch (view) {
    case "publish": {
      const data = loadJsonArtifact("artifacts/publish_decision.json");
      return NextResponse.json(data || { error: "No publish decision found" });
    }

    case "corridors": {
      const data = loadJsonArtifact("artifacts/corridor_snapshot.json");
      if (!data) return NextResponse.json({ corridors: [] });
      let corridors = data.corridors || [];
      if (corridorFilter) {
        corridors = corridors.filter(c => c.corridor_id === corridorFilter);
      }
      return NextResponse.json({ ...data, corridors });
    }

    case "lanes": {
      const data = loadJsonArtifact("artifacts/lane_registry_snapshot.json");
      if (!data) return NextResponse.json({ lanes: [] });
      let lanes = data.lanes || [];
      if (corridorFilter) lanes = lanes.filter(l => l.corridor === corridorFilter);
      if (status) lanes = lanes.filter(l => l.status === status);
      if (search) {
        const q = search.toLowerCase();
        lanes = lanes.filter(l => l.lane_slug.includes(q));
      }
      return NextResponse.json({ ...data, lanes, total_filtered: lanes.length });
    }

    case "experiments": {
      const data = loadJsonArtifact("artifacts/experiments.json");
      return NextResponse.json(data || { experiments: [] });
    }

    case "lane-quality": {
      const audit = loadJsonArtifact("artifacts/existing_lane_page_audit.json");
      const validationReport = loadJsonArtifact("artifacts/lane_page_validation_report.json");
      const bannedConfig = loadJsonArtifact("config/lane-page-banned-content.json");
      return NextResponse.json({
        audit: audit || { results: [] },
        validation: validationReport || { results: [] },
        gate_rule_ids: bannedConfig?.gate_rule_ids || {},
      });
    }

    case "overview":
    default: {
      const publish = loadJsonArtifact("artifacts/publish_decision.json");
      const corridorSnap = loadJsonArtifact("artifacts/corridor_snapshot.json");
      const laneSnap = loadJsonArtifact("artifacts/lane_registry_snapshot.json");
      const config = loadJsonArtifact("config/seo-engine.json");

      const lanes = laneSnap?.lanes || [];
      const corridors = (corridorSnap?.corridors || []).filter(c => c.corridor_id !== "other");

      const indexed = lanes.filter(l => l.status === "indexed").length;
      const blocked = lanes.filter(l => l.status === "blocked").length;
      const noindexed = lanes.filter(l => l.status === "noindex").length;
      const withDemand = lanes.filter(l => l.demand_signal).length;
      const totalImpressions = lanes.reduce((s, l) => s + l.gsc_impressions, 0);
      const totalClicks = lanes.reduce((s, l) => s + l.gsc_clicks, 0);
      const totalQuotes = lanes.reduce((s, l) => s + l.quote_starts, 0);
      const totalBookings = lanes.reduce((s, l) => s + l.bookings, 0);

      return NextResponse.json({
        timestamp: publish?.timestamp || new Date().toISOString(),
        run_id: publish?.run_id || "none",
        mode: publish?.mode || "dry",
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
          gsc_impressions: totalImpressions,
          gsc_clicks: totalClicks,
          quote_starts: totalQuotes,
          bookings: totalBookings,
        },
        blocked_reasons: publish?.blocked_reasons || [],
        quality_distribution: publish?.quality_distribution || {
          excellent: lanes.filter(l => l.quality_score >= 80).length,
          good: lanes.filter(l => l.quality_score >= 65 && l.quality_score < 80).length,
          fair: lanes.filter(l => l.quality_score >= 40 && l.quality_score < 65).length,
          poor: lanes.filter(l => l.quality_score < 40).length,
        },
      });
    }
  }
}
