/**
 * Sample incident data for seeding the database.
 */
export const SAMPLE_INCIDENTS = [
  {
    source: "email",
    property: "wearewarp.com",
    emailSubject: "New FAQ structured data issues detected for wearewarp.com",
    issueFamily: "structured_data",
    issueType: "Duplicate field FAQPage",
    severity: "critical",
    normalizedCode: "faq_duplicate_field",
    status: "open",
    parsedPayload: JSON.stringify({
      from: "sc-noreply@google.com",
      to: "seo-alerts@wearewarp.com",
      date: "2026-03-06T14:30:00.000Z",
    }),
    affectedUrls: JSON.stringify([
      "https://www.wearewarp.com/lanes/los-angeles-to-dallas",
      "https://www.wearewarp.com/lanes/los-angeles-to-phoenix",
      "https://www.wearewarp.com/lanes/chicago-to-dallas",
    ]),
    diagnosis:
      "## Diagnosis: Duplicate field FAQPage\n\n**Property:** wearewarp.com\n**Severity:** critical\n**Code:** faq_duplicate_field\n\nMultiple FAQPage JSON-LD blocks detected on lane pages. Likely caused by both the faq-schema CMS embed and a layout-level structured data component emitting FAQPage independently.",
    generatedPatchPrompt:
      "# Fix: Duplicate FAQPage Structured Data\n\nInspect all FAQ schema emitters in the web repo. Find duplicate FAQPage render paths. Consolidate to one emitter per page.",
    remediationReport:
      "# Remediation Report\n\n## Issue Summary\n- **Type:** Duplicate field FAQPage\n- **Severity:** critical\n\n## Recommended Action\nRun the generated patch prompt in Claude Code against the webflow-seo-engine repo.",
  },
  {
    source: "email",
    property: "wearewarp.com",
    emailSubject: "Sitemap issues detected for wearewarp.com",
    issueFamily: "sitemap",
    issueType: "Sitemap issue",
    severity: "warning",
    normalizedCode: "sitemap_invalid_url",
    status: "investigating",
    parsedPayload: JSON.stringify({
      from: "sc-noreply@google.com",
      to: "seo-alerts@wearewarp.com",
      date: "2026-03-05T09:15:00.000Z",
    }),
    affectedUrls: JSON.stringify([
      "https://www.wearewarp.com/sitemap.xml",
    ]),
    diagnosis:
      "## Diagnosis: Sitemap Invalid URL\n\n**Property:** wearewarp.com\n**Severity:** warning\n\nSitemap may contain URLs that return non-200 status codes.",
    generatedPatchPrompt:
      "# Fix: Sitemap Invalid URLs\n\nRegenerate the sitemap from the current lane registry. Remove entries for deleted pages.",
    remediationReport:
      "# Remediation Report\n\n## Issue Summary\n- **Type:** Sitemap issue\n- **Severity:** warning\n\n## Recommended Action\nRegenerate sitemap and resubmit to GSC.",
  },
  {
    source: "email",
    property: "wearewarp.com",
    emailSubject:
      "Duplicate without user-selected canonical detected on wearewarp.com",
    issueFamily: "canonical",
    issueType: "Duplicate without user-selected canonical",
    severity: "warning",
    normalizedCode: "canonical_conflict",
    status: "resolved",
    parsedPayload: JSON.stringify({
      from: "sc-noreply@google.com",
      to: "seo-alerts@wearewarp.com",
      date: "2026-03-01T11:00:00.000Z",
    }),
    affectedUrls: JSON.stringify([
      "https://www.wearewarp.com/lanes/houston-to-dallas",
      "https://www.wearewarp.com/lanes/dallas-to-houston",
    ]),
    diagnosis:
      "## Diagnosis: Canonical Conflict\n\n**Property:** wearewarp.com\n**Severity:** warning\n\nCanonical link elements are missing or pointing to wrong URLs on some lane pages.",
    generatedPatchPrompt:
      "# Fix: Canonical URL Conflicts\n\nAudit all lane pages for correct canonical URL elements. Ensure each canonical matches the page slug.",
    remediationReport:
      "# Remediation Report\n\n## Issue Summary\n- **Type:** Canonical conflict\n- **Severity:** warning\n\n## Recommended Action\nUpdate canonical URLs in Webflow CMS.",
  },
];
