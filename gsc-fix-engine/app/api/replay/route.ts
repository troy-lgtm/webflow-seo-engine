import { NextRequest, NextResponse } from "next/server";
import { ReplayRequestSchema } from "@/lib/types";
import { getIncidentById, updateIncident } from "@/lib/incident/incident-store";
import { getPlaybook } from "@/lib/playbooks";
import { generatePatchPrompt, generateRemediationReport } from "@/lib/prompts/generate-patch-prompt";
import type { ParsedGscEmail, ScanSummary } from "@/lib/types";

/**
 * POST /api/replay
 * Re-run diagnosis, scan, and prompt generation for an existing incident.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { incidentId } = ReplayRequestSchema.parse(body);

    const incident = await getIncidentById(incidentId);
    if (!incident) {
      return NextResponse.json({ ok: false, error: "Incident not found" }, { status: 404 });
    }

    const playbook = getPlaybook(incident.normalizedCode);
    const urls =
      incident.affectedUrls.length > 0
        ? incident.affectedUrls
        : playbook?.scanTargets || [];

    // Re-run scan
    let scanSummary: ScanSummary | undefined;
    let diagnosis = `Re-diagnosed: ${incident.normalizedCode}`;

    if (playbook && urls.length > 0) {
      const results = await playbook.run(urls);
      const pagesWithIssues = results.filter((r) => r.status === "issues_found").length;
      const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
      scanSummary = { totalPages: results.length, pagesWithIssues, totalFindings, findings: results };

      diagnosis = `## Re-diagnosis: ${incident.issueType}\n\nPages scanned: ${results.length}\nIssues found: ${pagesWithIssues}\nTotal findings: ${totalFindings}`;
      if (playbook.diagnosisSteps.length > 0) {
        diagnosis += "\n\n### Steps\n" + playbook.diagnosisSteps.map((s) => `- ${s}`).join("\n");
      }
    }

    // Re-generate patch prompt and report
    const fakeEmail: ParsedGscEmail = {
      subject: incident.emailSubject || "",
      from: "",
      to: "",
      date: incident.detectedAt.toISOString(),
      bodyText: "",
      bodyHtml: null,
      property: incident.property,
      issueFamily: incident.issueFamily as ParsedGscEmail["issueFamily"],
      issueType: incident.issueType,
      normalizedCode: incident.normalizedCode,
      severity: incident.severity as ParsedGscEmail["severity"],
      affectedUrls: incident.affectedUrls,
    };

    const patchPrompt = generatePatchPrompt(fakeEmail, scanSummary || null);
    const report = generateRemediationReport(fakeEmail, scanSummary || null, diagnosis);

    const updated = await updateIncident(incidentId, {
      diagnosis,
      generatedPatchPrompt: patchPrompt,
      remediationReport: report,
      scanSummary,
      status: "investigating",
    });

    return NextResponse.json({ ok: true, incident: updated });
  } catch (err) {
    console.error("Replay error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
