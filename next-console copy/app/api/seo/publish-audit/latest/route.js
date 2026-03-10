/**
 * /api/seo/publish-audit/latest — Latest publish decision + confirmation report
 *
 * Every response includes classification metadata:
 *   classification, display_status, trust_level, confirmed_posted_today, reason_codes
 */

import { NextResponse } from "next/server";
import {
  loadLatestPublishDecision,
  loadPublishConfirmationReport,
  loadPublishedPagesLatest,
  loadPublishIntegrityReport,
  loadLivePageVerification,
} from "@/lib/publish-audit";
import { classifyPublishRun } from "@/lib/publish-classification";

export async function GET() {
  const decision = loadLatestPublishDecision();
  const confirmation = loadPublishConfirmationReport();
  const pages = loadPublishedPagesLatest();
  const integrity = loadPublishIntegrityReport();
  const verification = loadLivePageVerification();

  // Classify using live artifacts
  const cls = decision
    ? classifyPublishRun(decision, verification)
    : { classification: "unknown", display_status: "Unknown", trust_level: "low", confirmed_posted_today: false, reason_codes: ["no_publish_decision"] };

  return NextResponse.json({
    ok: Boolean(decision),
    // Classification metadata — always present
    classification: cls.classification,
    display_status: cls.display_status,
    trust_level: cls.trust_level,
    confirmed_posted_today: cls.confirmed_posted_today,
    reason_codes: cls.reason_codes,
    // Data
    decision,
    confirmation,
    pages_summary: pages ? {
      run_id: pages.run_id,
      indexable_count: pages.live_indexable_pages?.length || 0,
      noindex_count: pages.live_noindex_pages?.length || 0,
      blocked_count: pages.blocked_pages?.length || 0,
    } : null,
    integrity: integrity ? {
      overall_status: integrity.overall_status,
      summary: integrity.summary,
    } : null,
  });
}
