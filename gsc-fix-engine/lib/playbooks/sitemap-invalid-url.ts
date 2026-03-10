import type { Playbook, PageScanResult } from "@/lib/types";
import { scanUrls } from "@/lib/scan/scan-site";

const sitemapInvalidUrl: Playbook = {
  id: "sitemap_invalid_url",
  title: "Sitemap Invalid URL",
  description:
    "Detects sitemap entries pointing to non-existent or redirecting pages. Commonly caused by removed lanes, renamed slugs, or stale sitemap generation.",
  issueFamily: "sitemap",
  normalizedCode: "sitemap_invalid_url",

  scanTargets: [
    "/sitemap.xml",
    "/lanes/sitemap.xml",
  ],

  diagnosisSteps: [
    "Fetch the sitemap XML and parse all <loc> entries",
    "Spot-check a sample of URLs for HTTP status codes",
    "Identify any URLs returning 404, 301, or 410",
    "Cross-reference sitemap URLs against the lane registry",
    "Check for recently removed or renamed pages that are still in the sitemap",
  ],

  fixStrategy: [
    "Regenerate the sitemap from the current lane registry",
    "Remove or update entries for deleted or renamed pages",
    "Add proper 301 redirects for any URLs that have moved",
    "Ensure the sitemap generation script pulls from the live registry",
    "Resubmit the sitemap in Google Search Console",
  ],

  validationChecklist: [
    "All sitemap URLs return HTTP 200",
    "No 404 or soft-404 pages in the sitemap",
    "Sitemap URL count matches the lane registry count",
    "Sitemap is well-formed XML",
    "Sitemap is resubmitted to GSC after fix",
  ],

  async run(urls: string[]): Promise<PageScanResult[]> {
    return scanUrls(urls, "sitemap");
  },
};

export default sitemapInvalidUrl;
