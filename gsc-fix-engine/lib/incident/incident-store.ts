import { prisma } from "@/lib/db";
import type { Incident, ScanSummary } from "@/lib/types";
import { toIncidentFromDb } from "@/lib/utils";

export async function getAllIncidents(): Promise<Incident[]> {
  const rows = await prisma.incident.findMany({
    orderBy: { detectedAt: "desc" },
  });
  return rows.map((r) => toIncidentFromDb(r as unknown as Record<string, unknown>) as Incident);
}

export async function getIncidentById(id: string): Promise<Incident | null> {
  const row = await prisma.incident.findUnique({ where: { id } });
  if (!row) return null;
  return toIncidentFromDb(row as unknown as Record<string, unknown>) as Incident;
}

export async function createIncident(data: {
  source?: string;
  property: string;
  emailSubject: string | null;
  issueFamily: string;
  issueType: string;
  severity: string;
  normalizedCode: string;
  rawEmailPath?: string;
  parsedPayload?: Record<string, unknown>;
  affectedUrls?: string[];
  diagnosis?: string;
  generatedPatchPrompt?: string;
  remediationReport?: string;
  scanSummary?: ScanSummary;
}): Promise<Incident> {
  const row = await prisma.incident.create({
    data: {
      source: data.source || "email",
      property: data.property,
      emailSubject: data.emailSubject,
      issueFamily: data.issueFamily,
      issueType: data.issueType,
      severity: data.severity,
      normalizedCode: data.normalizedCode,
      status: "open",
      rawEmailPath: data.rawEmailPath || null,
      parsedPayload: data.parsedPayload ? JSON.stringify(data.parsedPayload) : null,
      affectedUrls: JSON.stringify(data.affectedUrls || []),
      diagnosis: data.diagnosis || null,
      generatedPatchPrompt: data.generatedPatchPrompt || null,
      remediationReport: data.remediationReport || null,
      scanSummary: data.scanSummary ? JSON.stringify(data.scanSummary) : null,
    },
  });
  return toIncidentFromDb(row as unknown as Record<string, unknown>) as Incident;
}

export async function updateIncident(
  id: string,
  data: Partial<{
    status: string;
    diagnosis: string;
    generatedPatchPrompt: string;
    remediationReport: string;
    scanSummary: ScanSummary;
    affectedUrls: string[];
  }>
): Promise<Incident> {
  const update: Record<string, unknown> = {};
  if (data.status) update.status = data.status;
  if (data.diagnosis) update.diagnosis = data.diagnosis;
  if (data.generatedPatchPrompt) update.generatedPatchPrompt = data.generatedPatchPrompt;
  if (data.remediationReport) update.remediationReport = data.remediationReport;
  if (data.scanSummary) update.scanSummary = JSON.stringify(data.scanSummary);
  if (data.affectedUrls) update.affectedUrls = JSON.stringify(data.affectedUrls);

  const row = await prisma.incident.update({ where: { id }, data: update });
  return toIncidentFromDb(row as unknown as Record<string, unknown>) as Incident;
}

export async function getIncidentStats() {
  const all = await prisma.incident.findMany();
  const total = all.length;
  const open = all.filter((i) => i.status === "open").length;
  const investigating = all.filter((i) => i.status === "investigating").length;
  const resolved = all.filter((i) => i.status === "resolved").length;
  const byType: Record<string, number> = {};
  for (const i of all) {
    byType[i.normalizedCode] = (byType[i.normalizedCode] || 0) + 1;
  }
  return { total, open, investigating, resolved, byType };
}
