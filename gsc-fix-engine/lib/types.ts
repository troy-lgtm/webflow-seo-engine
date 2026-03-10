import { z } from "zod";

// ---------- Issue Classification ----------

export const ISSUE_FAMILIES = [
  "structured_data",
  "indexing",
  "sitemap",
  "canonical",
  "mobile_usability",
  "security",
  "other",
] as const;

export type IssueFamily = (typeof ISSUE_FAMILIES)[number];

export const SEVERITIES = ["critical", "warning", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = ["open", "investigating", "patching", "resolved", "dismissed"] as const;
export type Status = (typeof STATUSES)[number];

// ---------- Incident ----------

export interface Incident {
  id: string;
  source: string;
  property: string;
  emailSubject: string | null;
  issueFamily: IssueFamily;
  issueType: string;
  severity: Severity;
  normalizedCode: string;
  detectedAt: Date;
  status: Status;
  rawEmailPath: string | null;
  parsedPayload: Record<string, unknown> | null;
  affectedUrls: string[];
  scanSummary: ScanSummary | null;
  diagnosis: string | null;
  generatedPatchPrompt: string | null;
  remediationReport: string | null;
}

// ---------- Scan ----------

export interface ScanFinding {
  type: string;
  message: string;
  selector?: string;
  context?: Record<string, unknown>;
}

export interface PageScanResult {
  url: string;
  status: "ok" | "issues_found" | "error";
  title?: string;
  jsonLdBlocks: number;
  findings: ScanFinding[];
  scannedAt: string;
}

export interface ScanSummary {
  totalPages: number;
  pagesWithIssues: number;
  totalFindings: number;
  findings: PageScanResult[];
}

// ---------- Playbook ----------

export interface Playbook {
  id: string;
  title: string;
  description: string;
  issueFamily: IssueFamily;
  normalizedCode: string;
  scanTargets: string[];
  diagnosisSteps: string[];
  fixStrategy: string[];
  validationChecklist: string[];
  run: (urls: string[]) => Promise<PageScanResult[]>;
}

// ---------- Email Parsing ----------

export interface ParsedGscEmail {
  subject: string;
  from: string;
  to: string;
  date: string;
  bodyText: string;
  bodyHtml: string | null;
  property: string;
  issueFamily: IssueFamily;
  issueType: string;
  normalizedCode: string;
  severity: Severity;
  affectedUrls: string[];
}

// ---------- Zod Schemas ----------

export const ScanRequestSchema = z.object({
  incidentId: z.string().optional(),
  normalizedCode: z.string().optional(),
  urls: z.array(z.string().url()).optional(),
});

export const ReplayRequestSchema = z.object({
  incidentId: z.string(),
});
