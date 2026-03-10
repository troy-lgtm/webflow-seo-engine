import type { Playbook, PageScanResult } from "@/lib/types";
import { scanUrls, DEFAULT_SCAN_PATHS } from "@/lib/scan/scan-site";

const faqDuplicateField: Playbook = {
  id: "faq_duplicate_field",
  title: "FAQ Duplicate Field",
  description:
    "Detects pages emitting multiple FAQPage JSON-LD objects — typically caused by both a layout component and a page-level component each rendering FAQ schema independently.",
  issueFamily: "structured_data",
  normalizedCode: "faq_duplicate_field",

  scanTargets: DEFAULT_SCAN_PATHS.slice(0, 6),

  diagnosisSteps: [
    "Fetch candidate lane pages and extract all application/ld+json blocks",
    "Parse each JSON-LD block and identify FAQPage @type objects",
    "Count FAQPage objects per page — more than 1 indicates a duplicate emission",
    "Check for duplicate emission from layout vs page-level components",
    "Verify mainEntity arrays are valid with proper Question/@type entries",
    "Check for empty or malformed FAQ entries within each FAQPage",
  ],

  fixStrategy: [
    "Identify all components that emit FAQPage JSON-LD (layout, page, CMS embed)",
    "Consolidate to a single FAQPage emitter — preferably the page-level component",
    "Remove any duplicate FAQPage rendering from shared layout or template files",
    "Ensure the consolidated FAQPage includes all unique FAQ entries",
    "Validate one FAQPage object per page in the build output",
    "Deploy and request re-validation in Google Search Console",
  ],

  validationChecklist: [
    "Each page has exactly one FAQPage JSON-LD object",
    "FAQPage mainEntity contains valid Question entries",
    "Each Question has a name and acceptedAnswer with text",
    "No duplicate questions within the same FAQPage",
    "JSON-LD is well-formed and parseable",
    "Rich Results Test passes for sample pages",
  ],

  async run(urls: string[]): Promise<PageScanResult[]> {
    return scanUrls(urls, "faq");
  },
};

export default faqDuplicateField;
