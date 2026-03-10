/**
 * /api/seo/publish-audit/today — Today's publish runs and confirmation status
 *
 * Every response includes classification metadata:
 *   confirmed_posted_today, best_available_status, classification, trust_level, reason_codes
 */

import { NextResponse } from "next/server";
import {
  getTodaysPublishRuns,
  didSomethingPostToday,
} from "@/lib/publish-audit";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const timezone = searchParams.get("timezone") || undefined;

  const today = didSomethingPostToday({ timezone });
  const runsData = getTodaysPublishRuns({ timezone });

  return NextResponse.json({
    ok: true,
    // Classification metadata — always present
    confirmed_posted_today: today.confirmed_posted_today,
    best_available_status: today.best_available_status,
    classification: today.classification?.classification || "unknown",
    display_status: today.classification?.display_status || "Unknown",
    trust_level: today.classification?.trust_level || "low",
    reason_codes: today.classification?.reason_codes || [],
    // Data
    reason: today.reason,
    date_bucket: today.date_bucket,
    runs_today: today.runs_today,
    runs: runsData.runs,
  });
}
