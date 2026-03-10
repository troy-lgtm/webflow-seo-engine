import { NextResponse } from "next/server";
import { getPlaybookSummaries } from "@/lib/playbooks";

/**
 * GET /api/playbooks
 * Returns all available playbooks.
 */
export async function GET() {
  const playbooks = getPlaybookSummaries();
  return NextResponse.json({ ok: true, playbooks });
}
