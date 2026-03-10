import type { PageScanResult, ScanFinding } from "@/lib/types";
import { fetchPage } from "./fetch-page";
import { extractJsonLd, extractTitle } from "./extract-jsonld";
import { findFaqIssues } from "./find-faq-issues";
import { resolveUrl } from "@/lib/utils";

type ScanMode = "faq" | "canonical" | "sitemap" | "generic";

/**
 * Default candidate URLs to scan when no specific URLs are provided.
 */
export const DEFAULT_SCAN_PATHS = [
  "/lanes/los-angeles-to-dallas",
  "/lanes/los-angeles-to-phoenix",
  "/lanes/chicago-to-dallas",
  "/lanes/houston-to-dallas",
  "/lanes/atlanta-to-charlotte",
  "/ltl-freight-shipping",
  "/ftl-freight-shipping",
  "/freight-shipping",
  "/resources",
];

/**
 * Scan a list of URLs for issues matching a scan mode.
 */
export async function scanUrls(
  urls: string[],
  mode: ScanMode = "generic"
): Promise<PageScanResult[]> {
  const results: PageScanResult[] = [];

  for (const rawUrl of urls) {
    const url = resolveUrl(rawUrl);
    const page = await fetchPage(url);

    if (page.error || page.status === 0) {
      results.push({
        url,
        status: "error",
        jsonLdBlocks: 0,
        findings: [
          {
            type: "fetch_error",
            message: page.error || `HTTP ${page.status}`,
          },
        ],
        scannedAt: new Date().toISOString(),
      });
      continue;
    }

    if (page.status >= 400) {
      results.push({
        url,
        status: "error",
        jsonLdBlocks: 0,
        findings: [
          {
            type: "http_error",
            message: `HTTP ${page.status}`,
          },
        ],
        scannedAt: new Date().toISOString(),
      });
      continue;
    }

    const title = extractTitle(page.html);
    const jsonLdBlocks = extractJsonLd(page.html);
    let findings: ScanFinding[] = [];

    switch (mode) {
      case "faq":
        findings = findFaqIssues(jsonLdBlocks);
        break;
      case "canonical":
        findings = findCanonicalIssues(page.html, url);
        break;
      case "sitemap":
        findings = findSitemapIssues(page.html, url);
        break;
      default:
        findings = [
          ...findFaqIssues(jsonLdBlocks),
          ...findCanonicalIssues(page.html, url),
        ];
    }

    results.push({
      url,
      status: findings.length > 0 ? "issues_found" : "ok",
      title,
      jsonLdBlocks: jsonLdBlocks.length,
      findings,
      scannedAt: new Date().toISOString(),
    });
  }

  return results;
}

function findCanonicalIssues(html: string, pageUrl: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);

  if (!canonicalMatch) {
    findings.push({
      type: "canonical_missing",
      message: "Page has no canonical link element.",
    });
  } else {
    const canonical = canonicalMatch[1];
    // Check for mismatch
    if (canonical && !pageUrl.includes(new URL(canonical, pageUrl).pathname)) {
      findings.push({
        type: "canonical_mismatch",
        message: `Canonical URL "${canonical}" does not match page URL.`,
        context: { canonical, pageUrl },
      });
    }
  }

  return findings;
}

function findSitemapIssues(html: string, url: string): ScanFinding[] {
  const findings: ScanFinding[] = [];

  // For sitemap scans, we check if the URL returns valid XML
  if (url.includes("sitemap") && !html.includes("<urlset") && !html.includes("<sitemapindex")) {
    findings.push({
      type: "sitemap_invalid_format",
      message: "URL does not contain valid sitemap XML.",
    });
  }

  return findings;
}
