#!/usr/bin/env node

/**
 * site-crawl-audit.js — Cloudflare Browser Rendering Crawl Auditor
 *
 * Crawls the live WARP site via Cloudflare Browser Rendering /crawl API,
 * then audits the rendered page graph against the expected internal
 * linking structure (lane ↔ authority bidirectional links).
 *
 * Usage:
 *   node scripts/site-crawl-audit.js
 *   node scripts/site-crawl-audit.js --max-pages 50
 *   node scripts/site-crawl-audit.js --dry-run          (uses sample data)
 *
 * Environment variables:
 *   CF_ACCOUNT_ID     — Cloudflare account ID
 *   CF_API_TOKEN      — Cloudflare API token (Browser Rendering permission)
 *   SITE_BASE_URL     — Base URL to crawl (default: https://www.wearewarp.com)
 *
 * Output:
 *   artifacts/site-crawl-audit.json — Structured audit report
 *
 * @module scripts/site-crawl-audit
 */

import fs from "fs";
import { getProjectRoot, resolveFromRoot } from "../lib/fs/project-root.js";
import {
  classifyPage,
  extractInternalLinks,
  buildLiveGraph,
  detectOrphans,
  detectLanesMissingAuthorityLinks,
  detectAuthorityMissingLaneLinks,
  detectDuplicateTitles,
  detectWeakPages,
  buildAuditReport,
  WEAK_PAGE_THRESHOLD,
} from "../lib/crawl-auditor.js";

// ── Config ───────────────────────────────────────────────────────────

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "";
const CF_API_TOKEN = process.env.CF_API_TOKEN || "";
const SITE_BASE_URL = process.env.SITE_BASE_URL || "https://www.wearewarp.com";
const CF_CRAWL_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/browser-rendering/crawl`;

// CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const maxPagesIdx = args.indexOf("--max-pages");
const MAX_PAGES = maxPagesIdx >= 0 ? parseInt(args[maxPagesIdx + 1], 10) || 50 : 50;

// ── Cloudflare Crawl API ─────────────────────────────────────────────

/**
 * Submit a crawl job to Cloudflare Browser Rendering and retrieve results.
 *
 * @param {string} url - URL to crawl
 * @param {number} maxPages - Maximum pages to crawl
 * @returns {Promise<object[]>} Array of crawled page objects
 */
async function crawlWithCloudflare(url, maxPages) {
  console.log(`  Submitting crawl to Cloudflare Browser Rendering...`);
  console.log(`  URL: ${url}`);
  console.log(`  Max pages: ${maxPages}`);

  const body = {
    url,
    scrapeOptions: {
      formats: ["links", "metadata"],
    },
    limit: maxPages,
  };

  const response = await fetch(CF_CRAWL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloudflare crawl failed: ${response.status} ${response.statusText}\n${text}`);
  }

  const data = await response.json();

  if (!data.success) {
    const errors = (data.errors || []).map(e => e.message).join("; ");
    throw new Error(`Cloudflare crawl returned errors: ${errors}`);
  }

  // The crawl API returns results directly or within a result wrapper
  const pages = data.result?.pages || data.result || [];

  if (!Array.isArray(pages)) {
    throw new Error(`Unexpected crawl response format: expected array, got ${typeof pages}`);
  }

  console.log(`  Crawl complete: ${pages.length} pages returned\n`);
  return normalizeCloudflarePages(pages);
}

/**
 * Normalize Cloudflare crawl page objects to a standard format.
 *
 * @param {object[]} cfPages - Raw Cloudflare page objects
 * @returns {object[]} Normalized page objects
 */
function normalizeCloudflarePages(cfPages) {
  return cfPages.map(p => ({
    url: p.url || "",
    title: p.metadata?.title || p.title || "",
    h1: p.metadata?.h1 || p.h1 || "",
    canonical: p.metadata?.canonical || p.canonical || "",
    contentLength: p.metadata?.contentLength || p.contentLength || (p.text || p.markdown || "").length || 0,
    links: (p.links || []).map(l => (typeof l === "string" ? l : l.href || l.url || "")),
    text: p.text || p.markdown || "",
  }));
}

// ── Dry Run: Synthetic Crawl Data ────────────────────────────────────

/**
 * Generate synthetic crawl data from known artifacts for dry-run mode.
 * Reads published_pages_latest.json and authority-entities.json to build
 * a simulated crawl result.
 *
 * @returns {object[]} Synthetic page objects
 */
function buildDryRunPages() {
  console.log("  DRY RUN: Building synthetic crawl from local artifacts...\n");
  const pages = [];

  // Load known lane pages
  try {
    const latest = JSON.parse(
      fs.readFileSync(resolveFromRoot("artifacts", "published_pages_latest.json"), "utf-8")
    );
    for (const page of latest.live_indexable_pages || []) {
      pages.push({
        url: `${SITE_BASE_URL}${page.page_path}`,
        title: `LTL Freight ${page.lane_slug?.replace(/-/g, " ").replace(/\bto\b/, "to")} | Warp`,
        h1: `LTL Freight from ${page.lane_slug?.split("-to-")[0] || "Origin"} to ${page.lane_slug?.split("-to-")[1] || "Destination"}`,
        canonical: `${SITE_BASE_URL}${page.page_path}`,
        contentLength: 3500,
        links: [
          "/quote",
          "/book",
          "/lanes",
        ],
        text: "x".repeat(3500),
      });
    }
  } catch {
    // No published pages artifact — proceed without
  }

  // Load known authority entities
  try {
    const entities = JSON.parse(
      fs.readFileSync(resolveFromRoot("data", "authority-entities.json"), "utf-8")
    );
    const families = [
      { key: "solutions", prefix: "/solutions/" },
      { key: "concepts", prefix: "/network/" },
      { key: "equipment", prefix: "/equipment/" },
    ];
    for (const { key, prefix } of families) {
      for (const entity of Object.values(entities[key] || {})) {
        const path = entity.canonical_path || `${prefix}${entity.slug}`;
        // Build links from related entities + associated lanes
        const links = [];
        for (const cid of entity.related_concepts || []) {
          const c = entities.concepts?.[cid];
          if (c) links.push(c.canonical_path);
        }
        for (const sid of entity.related_solutions || []) {
          const s = entities.solutions?.[sid];
          if (s) links.push(s.canonical_path);
        }
        for (const eid of entity.related_equipment || []) {
          const e = entities.equipment?.[eid];
          if (e) links.push(e.canonical_path);
        }

        // Load associated lanes
        try {
          const lanesFile = resolveFromRoot("artifacts", "authority", "entity_lanes", `${entity.id}.json`);
          const lanesData = JSON.parse(fs.readFileSync(lanesFile, "utf-8"));
          for (const lane of (lanesData.lanes || []).slice(0, 10)) {
            links.push(`/lanes/${lane.lane_slug}`);
          }
        } catch {
          // No lanes artifact for this entity
        }

        links.push("/quote", "/book");

        pages.push({
          url: `${SITE_BASE_URL}${path}`,
          title: `${entity.label} | WARP`,
          h1: entity.label,
          canonical: `${SITE_BASE_URL}${path}`,
          contentLength: 2500,
          links: links.map(l => l.startsWith("/") ? `${SITE_BASE_URL}${l}` : l),
          text: "x".repeat(2500),
        });
      }
    }
  } catch {
    // No entities file — proceed without
  }

  // Add homepage
  const lanePaths = pages.filter(p => classifyPage(p.url).type === "lane").map(p => {
    const path = new URL(p.url).pathname;
    return `${SITE_BASE_URL}${path}`;
  });
  const authPaths = pages.filter(p => classifyPage(p.url).type === "authority").map(p => {
    const path = new URL(p.url).pathname;
    return `${SITE_BASE_URL}${path}`;
  });

  pages.push({
    url: SITE_BASE_URL,
    title: "WARP | Freight Logistics",
    h1: "WARP",
    canonical: SITE_BASE_URL,
    contentLength: 5000,
    links: [...lanePaths, ...authPaths, `${SITE_BASE_URL}/quote`, `${SITE_BASE_URL}/book`],
    text: "x".repeat(5000),
  });

  console.log(`  Synthetic crawl: ${pages.length} pages\n`);
  return pages;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Live Site Crawl Audit ===\n");

  const startTime = Date.now();

  // ── Step 1: Crawl ──────────────────────────────────────────────
  let pages;
  if (DRY_RUN) {
    pages = buildDryRunPages();
  } else {
    if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
      console.error("  ERROR: CF_ACCOUNT_ID and CF_API_TOKEN environment variables required.");
      console.error("  Use --dry-run for local testing without Cloudflare credentials.");
      process.exit(1);
    }
    pages = await crawlWithCloudflare(SITE_BASE_URL, MAX_PAGES);
  }

  if (pages.length === 0) {
    console.error("  ERROR: No pages returned from crawl.");
    process.exit(1);
  }

  // ── Step 2: Build graph ────────────────────────────────────────
  console.log("  Building live internal link graph...");
  const graph = buildLiveGraph(pages, SITE_BASE_URL);
  console.log(`  Graph: ${graph.nodes.size} nodes, ${graph.lanePages.length} lanes, ${graph.authorityPages.length} authority, ${graph.otherPages.length} other\n`);

  // ── Step 3: Detect issues ──────────────────────────────────────
  console.log("  Detecting issues...");
  const orphans = detectOrphans(graph);
  const lanesMissingAuthority = detectLanesMissingAuthorityLinks(graph);
  const authorityMissingLanes = detectAuthorityMissingLaneLinks(graph);
  const duplicateTitles = detectDuplicateTitles(graph);
  const weakPages = detectWeakPages(graph);

  const issues = {
    orphans,
    lanesMissingAuthority,
    authorityMissingLanes,
    duplicateTitles,
    weakPages,
    weakPageThreshold: WEAK_PAGE_THRESHOLD,
  };

  const totalIssues =
    orphans.length +
    lanesMissingAuthority.length +
    authorityMissingLanes.length +
    duplicateTitles.length +
    weakPages.length;

  console.log(`  Orphan pages: ${orphans.length}`);
  console.log(`  Lanes missing authority links: ${lanesMissingAuthority.length}`);
  console.log(`  Authority pages missing lane links: ${authorityMissingLanes.length}`);
  console.log(`  Duplicate title groups: ${duplicateTitles.length}`);
  console.log(`  Weak pages: ${weakPages.length}`);
  console.log(`  Total issues: ${totalIssues}\n`);

  // ── Step 4: Build report ───────────────────────────────────────
  const durationMs = Date.now() - startTime;
  const crawlMeta = {
    timestamp: new Date().toISOString(),
    baseUrl: SITE_BASE_URL,
    durationMs,
  };

  const report = buildAuditReport(crawlMeta, graph, issues);

  // ── Step 5: Write artifact ─────────────────────────────────────
  const artifactPath = resolveFromRoot("artifacts", "site-crawl-audit.json");
  fs.mkdirSync(resolveFromRoot("artifacts"), { recursive: true });
  fs.writeFileSync(artifactPath, JSON.stringify(report, null, 2));

  console.log(`  Written: artifacts/site-crawl-audit.json`);
  console.log(`  Health: ${report.summary.health}`);
  console.log(`  Duration: ${durationMs}ms`);
  console.log(`\n=== Audit Complete ===\n`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
