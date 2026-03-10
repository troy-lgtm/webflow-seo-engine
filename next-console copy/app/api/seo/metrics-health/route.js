/**
 * /api/seo/metrics-health — Metrics integrity debugging endpoint
 *
 * Returns connected status per source, coverage, and sanity issue counts.
 */

import { NextResponse } from "next/server";
import { getMetricsSnapshot, getSanityReport } from "@/lib/seo-dashboard-data";
import { getProjectRoot } from "@/lib/fs/project-root.js";

export async function GET() {
  const snapshot = getMetricsSnapshot();
  const sanity = getSanityReport();

  let projectRoot;
  try { projectRoot = getProjectRoot(); } catch { projectRoot = "(not found)"; }

  return NextResponse.json({
    ok: Boolean(snapshot),
    projectRoot,
    cwd: process.cwd(),
    metrics_snapshot: snapshot ? {
      run_id: snapshot.run_id,
      timestamp: snapshot.timestamp,
      window: snapshot.window,
      sources: snapshot.sources,
    } : null,
    sanity: sanity ? {
      run_id: sanity.run_id,
      timestamp: sanity.timestamp,
      summary: sanity.summary,
      issues: sanity.issues,
    } : null,
  });
}
