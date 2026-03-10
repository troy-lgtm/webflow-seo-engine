import { NextResponse } from "next/server";
import { getAllIncidents, getIncidentStats } from "@/lib/incident/incident-store";

/**
 * GET /api/incidents
 * Returns all incidents with optional stats.
 */
export async function GET() {
  try {
    const [incidents, stats] = await Promise.all([
      getAllIncidents(),
      getIncidentStats(),
    ]);

    return NextResponse.json({ ok: true, incidents, stats });
  } catch (err) {
    console.error("Get incidents error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
