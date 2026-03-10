/**
 * /api/seo/publish-audit/momentum — Actual early SEO momentum
 *
 * Every response includes classification metadata.
 */

import { NextResponse } from "next/server";
import {
  loadSeoMomentumReport,
  loadLatestPublishDecision,
  loadLivePageVerification,
} from "@/lib/publish-audit";
import { classifyPublishRun } from "@/lib/publish-classification";

export async function GET() {
  const momentum = loadSeoMomentumReport();
  const decision = loadLatestPublishDecision();
  const verification = loadLivePageVerification();

  const cls = decision
    ? classifyPublishRun(decision, verification)
    : { classification: "unknown", display_status: "Unknown", trust_level: "low", confirmed_posted_today: false, reason_codes: ["no_publish_decision"] };

  return NextResponse.json({
    ok: Boolean(momentum),
    // Classification metadata
    classification: cls.classification,
    display_status: cls.display_status,
    trust_level: cls.trust_level,
    confirmed_posted_today: cls.confirmed_posted_today,
    reason_codes: cls.reason_codes,
    // Data
    momentum,
  });
}
