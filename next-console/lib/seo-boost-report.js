/**
 * SEO Boost Report Builder
 *
 * Generates a post-publish SEO status report that combines:
 *   - Publish status (from manifest)
 *   - Verification status (from verification results)
 *   - Sitemap inclusion (from sitemap-lanes.xml)
 *   - Internal link status (from internal_link_graph.json)
 *
 * Status language (factual, never overstated):
 *   published_pending_verification — sent to CMS, URL not yet confirmed
 *   verified_live                  — HTTP 200 + identity confirmed
 *   sitemap_added                  — URL present in sitemap-lanes.xml
 *   internally_linked              — slug has inbound links in link graph
 *   indexability_passed            — all critical SEO checks pass
 *
 * Used by: publish_approved_batch.js, seo_readiness_check.js
 */

import fs from "fs";
import path from "path";
import { resolveFromRoot } from "./fs/project-root.js";
import { expectedUrlForSlug } from "./page-url.js";

/**
 * Parse lane slugs from sitemap-lanes.xml.
 * @returns {Set<string>}
 */
function loadSitemapSlugs() {
  const sitemapPath = resolveFromRoot("sitemaps", "sitemap-lanes.xml");
  if (!fs.existsSync(sitemapPath)) return new Set();
  try {
    const xml = fs.readFileSync(sitemapPath, "utf-8");
    const slugs = new Set();
    const matches = xml.matchAll(/<loc>[^<]*\/lanes\/([^<]+)<\/loc>/g);
    for (const m of matches) {
      slugs.add(m[1].replace(/\/$/, "").toLowerCase().trim());
    }
    return slugs;
  } catch {
    return new Set();
  }
}

/**
 * Build a reverse map of inbound links from internal_link_graph.json.
 * @returns {{ inboundMap: Map<string, string[]>, graphMeta: object }}
 */
function loadInternalLinkGraph() {
  const graphPath = resolveFromRoot("data", "internal_link_graph.json");
  if (!fs.existsSync(graphPath)) return { inboundMap: new Map(), graphMeta: {} };
  try {
    const data = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
    const graph = data.graph || {};
    const inboundMap = new Map();

    for (const [sourceSlug, links] of Object.entries(graph)) {
      // Collect all target slugs from this source
      const targets = [];
      if (links.reverse_lane) {
        const revSlug = extractSlugFromUrl(links.reverse_lane.url || links.reverse_lane);
        if (revSlug) targets.push(revSlug);
      }
      for (const group of ["same_origin", "same_destination", "corridor_links", "related"]) {
        for (const link of (links[group] || [])) {
          const slug = extractSlugFromUrl(link.url || link);
          if (slug) targets.push(slug);
        }
      }

      // Add source as inbound for each target
      for (const target of targets) {
        if (!inboundMap.has(target)) inboundMap.set(target, []);
        inboundMap.get(target).push(sourceSlug);
      }
    }

    return {
      inboundMap,
      graphMeta: {
        total_lanes: data.total_lanes || 0,
        total_links: data.total_links || 0,
        orphan_lanes: data.orphan_lanes || 0,
      },
    };
  } catch {
    return { inboundMap: new Map(), graphMeta: {} };
  }
}

/**
 * Extract slug from a lane URL.
 * @param {string} url
 * @returns {string|null}
 */
function extractSlugFromUrl(url) {
  if (!url) return null;
  const match = String(url).match(/\/lanes\/([^/?#]+)/);
  return match ? match[1].toLowerCase().trim() : null;
}

/**
 * Build SEO boost report for a publish run.
 *
 * @param {{ manifest: object, verificationResults?: array, sitemapReport?: object }} opts
 * @returns {object} SEO boost report
 */
export function buildSeoBoostReport({ manifest, verificationResults = [], sitemapReport = null }) {
  const publishedPages = manifest.published_pages || [];
  const publishedSlugs = publishedPages.map(p => p.slug);

  const sitemapSlugs = loadSitemapSlugs();
  const { inboundMap, graphMeta } = loadInternalLinkGraph();

  // Build per-page SEO status
  const pages = publishedSlugs.map(slug => {
    const verification = verificationResults.find(v => v.slug === slug);
    const slugLower = (slug || "").toLowerCase().trim();
    const inSitemap = sitemapSlugs.has(slugLower);
    const inboundLinks = inboundMap.get(slugLower) || [];
    const hasInternalLinks = inboundLinks.length > 0;

    return {
      slug,
      url: expectedUrlForSlug(slug),
      published: true,
      verification_status: verification?.status || "published_pending_verification",
      sitemap_added: inSitemap,
      internally_linked: hasInternalLinks,
      inbound_link_count: inboundLinks.length,
    };
  });

  const missingInternalLinks = pages
    .filter(p => !p.internally_linked)
    .map(p => p.slug);

  const missingSitemap = pages
    .filter(p => !p.sitemap_added)
    .map(p => p.slug);

  return {
    run_id: manifest.run_id,
    generated_at: new Date().toISOString(),
    summary: {
      published: publishedSlugs.length,
      pending_verification: pages.filter(p => p.verification_status === "published_pending_verification" || p.verification_status === "published_unverified").length,
      verified_live: pages.filter(p => p.verification_status === "verified_live").length,
      sitemap_added: pages.filter(p => p.sitemap_added).length,
      internally_linked: pages.filter(p => p.internally_linked).length,
    },
    pages,
    missing_internal_links: missingInternalLinks,
    missing_sitemap: missingSitemap,
    sitemap_total_urls: sitemapReport?.total_urls || sitemapSlugs.size,
    link_graph: graphMeta,
  };
}

/**
 * Save SEO boost report to disk.
 *
 * @param {object} report
 * @returns {{ path: string }}
 */
export function saveSeoBoostReport(report) {
  const dir = resolveFromRoot("artifacts", "seo-boost-reports");
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `seo_boost_${report.run_id}.json`;
  const absPath = path.join(dir, fileName);
  fs.writeFileSync(absPath, JSON.stringify(report, null, 2) + "\n");
  return { path: absPath };
}

/**
 * Print human-readable SEO boost summary to console.
 *
 * @param {object} report
 */
export function printSeoBoostReport(report) {
  const s = report.summary;
  console.log("");
  console.log("\u2500\u2500 SEO Status \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(`  published                  ${String(s.published).padStart(6)}`);
  console.log(`  pending_verification       ${String(s.pending_verification).padStart(6)}`);
  console.log(`  verified_live              ${String(s.verified_live).padStart(6)}`);
  console.log(`  sitemap_added              ${String(s.sitemap_added).padStart(6)}`);
  console.log(`  internally_linked          ${String(s.internally_linked).padStart(6)}`);

  if (report.missing_internal_links.length > 0) {
    console.log("");
    console.log(`  \u26A0 Missing internal links (${report.missing_internal_links.length}):`);
    for (const slug of report.missing_internal_links.slice(0, 10)) {
      console.log(`    ${slug}`);
    }
    if (report.missing_internal_links.length > 10) {
      console.log(`    ... and ${report.missing_internal_links.length - 10} more`);
    }
  }

  if (report.missing_sitemap.length > 0) {
    console.log("");
    console.log(`  \u26A0 Not in sitemap (${report.missing_sitemap.length}):`);
    for (const slug of report.missing_sitemap.slice(0, 10)) {
      console.log(`    ${slug}`);
    }
    if (report.missing_sitemap.length > 10) {
      console.log(`    ... and ${report.missing_sitemap.length - 10} more`);
    }
  }

  console.log("");
}
