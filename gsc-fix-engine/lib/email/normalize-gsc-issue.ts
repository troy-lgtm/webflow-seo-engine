import type { IssueFamily, Severity, ParsedGscEmail } from "@/lib/types";
import type { RawParsedEmail } from "./parse-gsc-email";

// ---------- Rule-based normalizer ----------

interface NormalizationRule {
  /** Regex tested against email subject (case-insensitive). */
  pattern: RegExp;
  issueFamily: IssueFamily;
  issueType: string;
  normalizedCode: string;
}

const RULES: NormalizationRule[] = [
  // FAQ structured data
  {
    pattern: /FAQ structured data issue/i,
    issueFamily: "structured_data",
    issueType: "FAQ structured data issue",
    normalizedCode: "faq_duplicate_field",
  },
  {
    pattern: /duplicate field.*FAQ/i,
    issueFamily: "structured_data",
    issueType: "Duplicate field FAQPage",
    normalizedCode: "faq_duplicate_field",
  },
  // Other structured data
  {
    pattern: /structured data issue/i,
    issueFamily: "structured_data",
    issueType: "Structured data issue",
    normalizedCode: "structured_data_generic",
  },
  // Sitemap
  {
    pattern: /sitemap issue/i,
    issueFamily: "sitemap",
    issueType: "Sitemap issue",
    normalizedCode: "sitemap_invalid_url",
  },
  // Canonical
  {
    pattern: /duplicate without user-selected canonical/i,
    issueFamily: "canonical",
    issueType: "Duplicate without user-selected canonical",
    normalizedCode: "canonical_conflict",
  },
  {
    pattern: /canonical/i,
    issueFamily: "canonical",
    issueType: "Canonical issue",
    normalizedCode: "canonical_conflict",
  },
  // Indexing
  {
    pattern: /indexing issue/i,
    issueFamily: "indexing",
    issueType: "Indexing issue",
    normalizedCode: "indexing_generic",
  },
  {
    pattern: /marked.*noindex/i,
    issueFamily: "indexing",
    issueType: "Submitted URL marked noindex",
    normalizedCode: "noindex_conflict",
  },
  // Mobile usability
  {
    pattern: /mobile usability/i,
    issueFamily: "mobile_usability",
    issueType: "Mobile usability issue",
    normalizedCode: "mobile_usability_generic",
  },
  // Security
  {
    pattern: /security issue/i,
    issueFamily: "security",
    issueType: "Security issue",
    normalizedCode: "security_generic",
  },
];

function extractProperty(subject: string, bodyText: string): string {
  // Try to extract domain from subject like "... for wearewarp.com"
  const subjectMatch = subject.match(/for\s+([\w.-]+\.\w+)/i);
  if (subjectMatch) return subjectMatch[1];
  const bodyMatch = bodyText.match(/(?:property|site)[:\s]+([\w.-]+\.\w+)/i);
  if (bodyMatch) return bodyMatch[1];
  return "wearewarp.com";
}

function extractSeverity(bodyText: string, subject: string): Severity {
  const combined = `${subject} ${bodyText}`.toLowerCase();
  if (combined.includes("critical")) return "critical";
  if (combined.includes("warning") || combined.includes("new")) return "warning";
  return "info";
}

function extractUrlsFromBody(bodyText: string): string[] {
  const urls: string[] = [];
  const urlPattern = /https?:\/\/[^\s<>"']+/g;
  const matches = bodyText.match(urlPattern) || [];
  for (const url of matches) {
    // Only include wearewarp.com URLs
    if (url.includes("wearewarp.com") && !url.includes("search.google.com")) {
      urls.push(url.replace(/[.,;)}\]]+$/, ""));
    }
  }
  return [...new Set(urls)];
}

/**
 * Normalize a parsed email into a structured GSC issue classification.
 */
export function normalizeGscIssue(email: RawParsedEmail): ParsedGscEmail {
  const { subject, bodyText } = email;

  // Find matching rule
  let matched: NormalizationRule | null = null;
  for (const rule of RULES) {
    if (rule.pattern.test(subject) || rule.pattern.test(bodyText)) {
      matched = rule;
      break;
    }
  }

  // Also check body text for "Duplicate field" pattern
  if (!matched && /duplicate field/i.test(bodyText)) {
    matched = RULES[1]; // faq_duplicate_field
  }

  const fallback: NormalizationRule = {
    pattern: /.*/,
    issueFamily: "other",
    issueType: "Unknown GSC issue",
    normalizedCode: "unknown",
  };

  const rule = matched || fallback;

  return {
    ...email,
    property: extractProperty(subject, bodyText),
    issueFamily: rule.issueFamily,
    issueType: rule.issueType,
    normalizedCode: rule.normalizedCode,
    severity: extractSeverity(bodyText, subject),
    affectedUrls: extractUrlsFromBody(bodyText),
  };
}
