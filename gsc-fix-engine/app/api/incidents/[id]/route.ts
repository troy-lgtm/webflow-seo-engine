import { NextRequest, NextResponse } from "next/server";
import { getIncidentById } from "@/lib/incident/incident-store";

/**
 * GET /api/incidents/[id]
 * Returns a single incident by ID.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const incident = await getIncidentById(id);

    if (!incident) {
      return NextResponse.json(
        { ok: false, error: "Incident not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, incident });
  } catch (err) {
    console.error("Get incident error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
