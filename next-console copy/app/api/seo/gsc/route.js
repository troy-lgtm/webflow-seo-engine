/**
 * /api/seo/gsc — GSC SEO Progress API
 *
 * Internal endpoint for SEO progress tracking data.
 *
 * Query params:
 *   ?view=summary          → site summary (7d, 28d, 90d)
 *   ?view=pages             → page leaderboard (gaining/losing)
 *   ?view=queries           → query leaderboard (gaining/losing)
 *   ?view=page-detail       → daily trend for a page (&page=...)
 *   ?view=query-detail      → daily trend for a query (&query=...)
 *   ?view=priority          → priority page performance
 *   ?view=branded           → branded vs non-branded
 *   ?view=new-queries       → newly appearing queries
 *   ?view=position-movers   → pages gaining/losing position
 *   ?view=rising-flat       → rising impressions, flat clicks
 *   ?view=rolling           → rolling 7d/28d metrics
 *   ?view=stats             → table row counts
 *
 * Optional:
 *   &days=7|28|90           → period length (default: 7)
 *   &limit=20               → result limit
 *
 * Auth: INTERNAL_DASHBOARD_KEY header or query param
 */

import { NextResponse } from "next/server";
import {
  siteSummary,
  siteRolling,
  pageLeaderboard,
  queryLeaderboard,
  pageDetailTrend,
  queryDetailTrend,
  priorityPagePerformance,
  brandedVsNonBranded,
  newQueries,
  positionImprovers,
  positionDecliners,
  risingImpressionsFlatClicks,
} from "@/lib/gsc/progress.js";
import { getTableStats } from "@/lib/gsc/store.js";

function checkAuth(request) {
  const key = process.env.INTERNAL_DASHBOARD_KEY;
  if (!key) return true;
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
  const view = searchParams.get("view") || "summary";
  const siteUrl = process.env.GSC_SITE_URL || "sc-domain:wearewarp.com";
  const days = parseInt(searchParams.get("days") || "7", 10);
  const limit = parseInt(searchParams.get("limit") || "20", 10);

  try {
    switch (view) {
      case "summary": {
        const summary7 = siteSummary(siteUrl, 7);
        const summary28 = siteSummary(siteUrl, 28);
        const summary90 = siteSummary(siteUrl, 90);
        return NextResponse.json({ summary_7d: summary7, summary_28d: summary28, summary_90d: summary90 });
      }

      case "pages": {
        return NextResponse.json(pageLeaderboard(siteUrl, { days, limit }));
      }

      case "queries": {
        return NextResponse.json(queryLeaderboard(siteUrl, { days, limit }));
      }

      case "page-detail": {
        const page = searchParams.get("page");
        if (!page) return NextResponse.json({ error: "Missing 'page' param" }, { status: 400 });
        return NextResponse.json({ page, trend: pageDetailTrend(siteUrl, page, { days }) });
      }

      case "query-detail": {
        const query = searchParams.get("query");
        if (!query) return NextResponse.json({ error: "Missing 'query' param" }, { status: 400 });
        return NextResponse.json({ query, trend: queryDetailTrend(siteUrl, query, { days }) });
      }

      case "priority": {
        return NextResponse.json(priorityPagePerformance(siteUrl, { days }));
      }

      case "branded": {
        return NextResponse.json(brandedVsNonBranded(siteUrl, { days }));
      }

      case "new-queries": {
        return NextResponse.json({ queries: newQueries(siteUrl, { days, limit }) });
      }

      case "position-movers": {
        return NextResponse.json({
          improving: positionImprovers(siteUrl, { days, limit }),
          declining: positionDecliners(siteUrl, { days, limit }),
        });
      }

      case "rising-flat": {
        return NextResponse.json({
          pages: risingImpressionsFlatClicks(siteUrl, { days, limit }),
        });
      }

      case "rolling": {
        return NextResponse.json(siteRolling(siteUrl));
      }

      case "stats": {
        return NextResponse.json(getTableStats());
      }

      default:
        return NextResponse.json({ error: `Unknown view: ${view}` }, { status: 400 });
    }
  } catch (err) {
    console.error(`[api/seo/gsc] Error for view=${view}:`, err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
