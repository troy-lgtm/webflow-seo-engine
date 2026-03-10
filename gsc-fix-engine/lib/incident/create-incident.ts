import type { ParsedGscEmail, Incident } from "@/lib/types";
import { createIncident } from "./incident-store";
import { getPlaybook } from "@/lib/playbooks";
import { generatePatchPrompt } from "@/lib/prompts/generate-patch-prompt";
import { generateRemediationReport } from "@/lib/prompts/generate-patch-prompt";

/**
 * Full incident creation pipeline:
 * 1. Persist the incident
 * 2. Look up the matching playbook
 * 3. Run the playbook scan if possible
 * 4. Generate diagnosis, patch prompt, and remediation report
 * 5. Update the incident with results
 */
export async function createIncidentFromEmail(parsed: ParsedGscEmail): Promise<Incident> {
  const playbook = getPlaybook(parsed.normalizedCode);

  // Determine scan URLs
  let scanUrls = parsed.affectedUrls.length > 0 ? parsed.affectedUrls : [];
  if (scanUrls.length === 0 && playbook) {
    scanUrls = playbook.scanTargets;
  }

  // Run playbook scan if available
  let scanResults = null;
  let diagnosis = `Issue classified as ${parsed.normalizedCode} (${parsed.issueFamily}).`;
  if (playbook && scanUrls.length > 0) {
    try {
      const results = await playbook.run(scanUrls);
      const pagesWithIssues = results.filter((r) => r.status === "issues_found").length;
      const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);
      scanResults = {
        totalPages: results.length,
        pagesWithIssues,
        totalFindings,
        findings: results,
      };
      diagnosis = buildDiagnosis(parsed, scanResults, playbook.diagnosisSteps);
    } catch (err) {
      diagnosis += ` Scan failed: ${err instanceof Error ? err.message : "unknown error"}.`;
    }
  }

  const patchPrompt = generatePatchPrompt(parsed, scanResults);
  const report = generateRemediationReport(parsed, scanResults, diagnosis);

  const incident = await createIncident({
    source: "email",
    property: parsed.property,
    emailSubject: parsed.subject,
    issueFamily: parsed.issueFamily,
    issueType: parsed.issueType,
    severity: parsed.severity,
    normalizedCode: parsed.normalizedCode,
    parsedPayload: {
      from: parsed.from,
      to: parsed.to,
      date: parsed.date,
      bodyText: parsed.bodyText.slice(0, 2000),
    },
    affectedUrls: scanUrls,
    scanSummary: scanResults || undefined,
    diagnosis,
    generatedPatchPrompt: patchPrompt,
    remediationReport: report,
  });

  return incident;
}

function buildDiagnosis(
  parsed: ParsedGscEmail,
  scan: { totalPages: number; pagesWithIssues: number; totalFindings: number; findings?: unknown[] },
  steps: string[]
): string {
  const lines: string[] = [];
  lines.push(`## Diagnosis: ${parsed.issueType}`);
  lines.push("");
  lines.push(`**Property:** ${parsed.property}`);
  lines.push(`**Severity:** ${parsed.severity}`);
  lines.push(`**Code:** ${parsed.normalizedCode}`);
  lines.push("");
  lines.push(`### Scan Results`);
  lines.push(`- Pages scanned: ${scan.totalPages}`);
  lines.push(`- Pages with issues: ${scan.pagesWithIssues}`);
  lines.push(`- Total findings: ${scan.totalFindings}`);
  lines.push("");
  lines.push(`### Diagnosis Steps`);
  for (const step of steps) {
    lines.push(`- ${step}`);
  }
  return lines.join("\n");
}
