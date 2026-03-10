import type { ParsedGscEmail, ScanSummary } from "@/lib/types";

/**
 * Generates a high-quality Claude Code prompt for fixing the detected issue.
 */
export function generatePatchPrompt(
  issue: ParsedGscEmail,
  scanSummary: ScanSummary | null
): string {
  const generators: Record<string, () => string> = {
    faq_duplicate_field: () => generateFaqDuplicatePrompt(issue, scanSummary),
    sitemap_invalid_url: () => generateSitemapPrompt(issue, scanSummary),
    canonical_conflict: () => generateCanonicalPrompt(issue, scanSummary),
  };

  const generator = generators[issue.normalizedCode];
  if (generator) return generator();
  return generateGenericPrompt(issue, scanSummary);
}

function generateFaqDuplicatePrompt(
  issue: ParsedGscEmail,
  scan: ScanSummary | null
): string {
  const affectedPages = scan
    ? scan.findings
        .filter((f) => f.status === "issues_found")
        .map((f) => `  - ${f.url} (${f.findings.length} issues)`)
        .join("\n")
    : "  (no scan data — run scan first)";

  return `# Fix: Duplicate FAQPage Structured Data on ${issue.property}

## Context
Google Search Console detected duplicate FAQ structured data fields on ${issue.property}.
This means multiple FAQPage JSON-LD objects are being emitted on the same page, which
violates Google's structured data guidelines and causes rich result eligibility issues.

## Affected Pages
${affectedPages}

## Task
Inspect the codebase and fix the duplicate FAQPage emission.

### Steps:
1. Search for ALL files that emit \`<script type="application/ld+json">\` containing FAQPage
2. Identify the two emission sources — likely:
   - A layout or template component (e.g., \`layout.tsx\`, \`head.tsx\`, or Webflow embed)
   - A page-level component (e.g., \`faq-schema\` CMS field or page builder)
3. Remove the duplicate — keep only the page-level emitter
4. Ensure the surviving FAQPage object:
   - Has exactly one FAQPage @type
   - Contains a valid mainEntity array
   - Each entry is @type Question with name and acceptedAnswer.text
5. If the FAQ content comes from a CMS, consolidate in the CMS field builder
6. Validate: run \`grep -r "FAQPage" --include="*.tsx" --include="*.ts" --include="*.js"\`
   to confirm only one emission path remains

### Constraints:
- Do NOT delete visible FAQ content — only remove the duplicate JSON-LD emission
- Patch shared components/templates, not individual pages
- Preserve all FAQ question/answer content

### Validation:
After fixing, verify:
- Each page has exactly 1 FAQPage JSON-LD block
- Run Google Rich Results Test on 3 sample pages
- No FAQPage validation errors in structured data

## Output
List all changed files with before/after diffs and rationale for each change.
`;
}

function generateSitemapPrompt(
  issue: ParsedGscEmail,
  scan: ScanSummary | null
): string {
  return `# Fix: Sitemap Invalid URLs on ${issue.property}

## Context
Google Search Console detected invalid URLs in the sitemap for ${issue.property}.
This typically means the sitemap references pages that return 404, 301, or other non-200 status codes.

## Task
1. Regenerate the sitemap from the current lane registry / page inventory
2. Remove any entries for deleted, renamed, or redirected pages
3. Ensure all sitemap URLs return HTTP 200
4. Add proper 301 redirects for any URLs that have moved

## Scan Results
${scan ? `Pages scanned: ${scan.totalPages}, Issues found: ${scan.pagesWithIssues}` : "No scan data available."}

## Steps:
1. Compare sitemap URLs against the live page registry
2. Identify URLs that no longer exist or have changed slugs
3. Update the sitemap generation script to use the current registry
4. Add redirect rules for any URLs that have been renamed
5. Resubmit the sitemap in Google Search Console

## Output
List changed files and the URLs that were added/removed/redirected.
`;
}

function generateCanonicalPrompt(
  issue: ParsedGscEmail,
  scan: ScanSummary | null
): string {
  return `# Fix: Canonical URL Conflicts on ${issue.property}

## Context
Google Search Console detected canonical URL issues on ${issue.property}.
Pages have missing, mismatched, or conflicting canonical link elements.

## Task
1. Audit all lane pages for correct canonical URL elements
2. Ensure each page's <link rel="canonical"> matches its actual URL
3. Fix any pages where the canonical points to a different page

## Scan Results
${scan ? `Pages scanned: ${scan.totalPages}, Issues found: ${scan.pagesWithIssues}` : "No scan data available."}

## Steps:
1. Check the canonical URL CMS field for each Webflow CMS item
2. Ensure the canonical matches the slug: https://www.wearewarp.com/lanes/{slug}
3. Update the publish script to always set the correct canonical
4. Verify template-level <link rel="canonical"> uses the CMS field value
5. Republish affected pages

## Output
List all pages with canonical mismatches and the corrections applied.
`;
}

function generateGenericPrompt(
  issue: ParsedGscEmail,
  scan: ScanSummary | null
): string {
  return `# Fix: ${issue.issueType} on ${issue.property}

## Context
Google Search Console detected: ${issue.issueType}
Issue family: ${issue.issueFamily}
Severity: ${issue.severity}

## Scan Results
${scan ? `Pages scanned: ${scan.totalPages}, Issues found: ${scan.pagesWithIssues}` : "No scan data available."}

## Task
Investigate and fix the detected issue. Check the site's published pages for the specific
problem described above, identify the root cause in the codebase or CMS, and apply the fix.

## Output
List all changed files with rationale.
`;
}

/**
 * Generates a human-readable remediation report for the incident.
 */
export function generateRemediationReport(
  issue: ParsedGscEmail,
  scan: ScanSummary | null,
  diagnosis: string
): string {
  const lines: string[] = [];

  lines.push(`# Remediation Report`);
  lines.push("");
  lines.push(`## Issue Summary`);
  lines.push(`- **Type:** ${issue.issueType}`);
  lines.push(`- **Family:** ${issue.issueFamily}`);
  lines.push(`- **Code:** ${issue.normalizedCode}`);
  lines.push(`- **Severity:** ${issue.severity}`);
  lines.push(`- **Property:** ${issue.property}`);
  lines.push(`- **Detected:** ${issue.date}`);
  lines.push("");

  lines.push(`## Likely Affected Area`);
  if (issue.normalizedCode === "faq_duplicate_field") {
    lines.push(
      "FAQ JSON-LD structured data emission — likely a duplicate FAQPage object from layout + page-level components."
    );
  } else if (issue.normalizedCode === "sitemap_invalid_url") {
    lines.push("Sitemap XML contains URLs that no longer return HTTP 200.");
  } else if (issue.normalizedCode === "canonical_conflict") {
    lines.push(
      "Canonical link elements are missing or mismatched on one or more pages."
    );
  } else {
    lines.push(`Detected issue: ${issue.issueType}`);
  }
  lines.push("");

  if (scan) {
    lines.push(`## Scan Results`);
    lines.push(`- Pages scanned: ${scan.totalPages}`);
    lines.push(`- Pages with issues: ${scan.pagesWithIssues}`);
    lines.push(`- Total findings: ${scan.totalFindings}`);
    lines.push("");

    if (scan.findings.length > 0) {
      lines.push(`### URLs Scanned`);
      for (const f of scan.findings) {
        const icon = f.status === "ok" ? "✓" : f.status === "error" ? "✗" : "⚠";
        lines.push(`- ${icon} ${f.url} — ${f.findings.length} finding(s)`);
        for (const finding of f.findings) {
          lines.push(`  - [${finding.type}] ${finding.message}`);
        }
      }
      lines.push("");
    }
  }

  lines.push(`## Diagnosis`);
  lines.push(diagnosis);
  lines.push("");

  lines.push(`## Recommended Next Action`);
  lines.push(
    "1. Review the generated patch prompt below and run it in Claude Code against the web repo."
  );
  lines.push("2. Test the fix locally and verify with Google Rich Results Test.");
  lines.push("3. Deploy and request re-validation in Google Search Console.");
  lines.push("");

  lines.push(`---`);
  lines.push(`*Generated by gsc-fix-engine at ${new Date().toISOString()}*`);

  return lines.join("\n");
}
