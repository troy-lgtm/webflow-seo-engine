import { NextRequest, NextResponse } from "next/server";
import { ScanRequestSchema } from "@/lib/types";
import { getPlaybook } from "@/lib/playbooks";
import { getIncidentById, updateIncident } from "@/lib/incident/incident-store";
import { scanUrls, DEFAULT_SCAN_PATHS } from "@/lib/scan/scan-site";

/**
 * POST /api/scan
 * Run a playbook scan.
 *
 * Body: { incidentId?, normalizedCode?, urls? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ScanRequestSchema.parse(body);

    // Determine normalized code and URLs
    let code = parsed.normalizedCode;
    let urls = parsed.urls || [];

    if (parsed.incidentId) {
      const incident = await getIncidentById(parsed.incidentId);
      if (!incident) {
        return NextResponse.json({ ok: false, error: "Incident not found" }, { status: 404 });
      }
      code = code || incident.normalizedCode;
      if (urls.length === 0) {
        urls = incident.affectedUrls;
      }
    }

    if (!code) {
      return NextResponse.json(
        { ok: false, error: "normalizedCode or incidentId required" },
        { status: 400 }
      );
    }

    const playbook = getPlaybook(code);
    if (urls.length === 0) {
      urls = playbook?.scanTargets || DEFAULT_SCAN_PATHS;
    }

    // Run scan
    const results = playbook ? await playbook.run(urls) : await scanUrls(urls, "generic");
    const pagesWithIssues = results.filter((r) => r.status === "issues_found").length;
    const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);

    const scanSummary = {
      totalPages: results.length,
      pagesWithIssues,
      totalFindings,
      findings: results,
    };

    // Update incident if provided
    if (parsed.incidentId) {
      await updateIncident(parsed.incidentId, {
        scanSummary,
        status: "investigating",
      });
    }

    return NextResponse.json({ ok: true, scanSummary });
  } catch (err) {
    console.error("Scan error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
