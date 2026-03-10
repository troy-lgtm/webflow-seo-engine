import type { Playbook, PageScanResult } from "@/lib/types";
import { scanUrls, DEFAULT_SCAN_PATHS } from "@/lib/scan/scan-site";

const canonicalConflict: Playbook = {
  id: "canonical_conflict",
  title: "Canonical Conflict",
  description:
    "Detects pages with missing, mismatched, or conflicting canonical link elements. Commonly caused by Webflow CMS generating canonical URLs that don't match the actual page path.",
  issueFamily: "canonical",
  normalizedCode: "canonical_conflict",

  scanTargets: DEFAULT_SCAN_PATHS.slice(0, 5),

  diagnosisSteps: [
    "Fetch candidate pages and extract <link rel=canonical> elements",
    "Compare canonical URL with the actual page URL",
    "Check for pages with no canonical element at all",
    "Identify pages where the canonical points to a different page",
    "Check if canonical uses http:// vs https:// inconsistently",
  ],

  fixStrategy: [
    "Update the canonical URL field in the Webflow CMS for each affected item",
    "Ensure the canonical path matches the slug in the lane registry",
    "For template-level canonicals, update the Webflow template to use the CMS field",
    "Verify canonical URLs use https:// and the correct domain",
    "Redeploy and request re-validation in Google Search Console",
  ],

  validationChecklist: [
    "Every page has exactly one <link rel=canonical> element",
    "Canonical URL matches the page's actual URL path",
    "Canonical uses https:// protocol",
    "Canonical uses the correct domain (www.wearewarp.com)",
    "No duplicate canonical elements on any page",
  ],

  async run(urls: string[]): Promise<PageScanResult[]> {
    return scanUrls(urls, "canonical");
  },
};

export default canonicalConflict;
