#!/usr/bin/env node

/**
 * publish:seo-check:last — Post-publish SEO readiness verification
 *
 * Checks every page from a publish run against 9 indexability gates:
 *   1. HTTP 200 status
 *   2. Correct canonical tag
 *   3. No noindex meta tag or header
 *   4. Not blocked by robots.txt
 *   5. Unique title tag
 *   6. Unique H1 tag
 *   7. Body content present (500+ chars)
 *   8. Internal links present (inbound link graph or outbound /lanes/ links)
 *   9. Included in XML sitemap
 *
 * Pages passing critical checks (1-4) are transitioned to verified_live.
 *
 * Usage:
 *   npm run publish:seo-check:last
 *   npm run publish:seo-check:last -- --run-id=2026-03-07T01-30-00-000Z
 *   npm run publish:seo-check:last -- --json
 *   npm run publish:seo-check:last -- --skip-transition
 */

import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { getProjectRoot, resolveFromRoot } from "../lib/fs/project-root.js";
import { listManifests, loadManifest } from "../lib/publish-manifest.js";
import { transitionState } from "../lib/approval-gate.js";

const ROOT = getProjectRoot();
config({ path: path.join(ROOT, ".env.local") });

const args = process.argv.slice(2);
const RUN_ID = args.find(a => a.startsWith("--run-id="))?.split("=")[1] || null;
const JSON_OUTPUT = args.includes("--json");
const SKIP_TRANSITION = args.includes("--skip-transition");

// ── Data loaders (cached) ───────────────────────────────────────────────

/**
 * Load sitemap slugs from sitemap-lanes.xml.
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
 * Build inbound link map from internal_link_graph.json.
 * @returns {Map<string, string[]>}
 */
function loadInboundLinkMap() {
  const graphPath = resolveFromRoot("data", "internal_link_graph.json");
  if (!fs.existsSync(graphPath)) return new Map();
  try {
    const data = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
    const graph = data.graph || {};
    const inboundMap = new Map();

    for (const [sourceSlug, links] of Object.entries(graph)) {
      const targets = [];
      if (links.reverse_lane) {
        const url = links.reverse_lane.url || links.reverse_lane;
        const m = String(url).match(/\/lanes\/([^/?#]+)/);
        if (m) targets.push(m[1].toLowerCase().trim());
      }
      for (const group of ["same_origin", "same_destination", "corridor_links", "related"]) {
        for (const link of (links[group] || [])) {
          const url = link.url || link;
          const m = String(url).match(/\/lanes\/([^/?#]+)/);
          if (m) targets.push(m[1].toLowerCase().trim());
        }
      }
      for (const target of targets) {
        if (!inboundMap.has(target)) inboundMap.set(target, []);
        inboundMap.get(target).push(sourceSlug);
      }
    }
    return inboundMap;
  } catch {
    return new Map();
  }
}

// robots.txt cache
let robotsDisallowRules = null;

/**
 * Load and parse robots.txt Disallow rules.
 * @returns {Promise<string[]>}
 */
async function loadRobotsTxt() {
  if (robotsDisallowRules !== null) return robotsDisallowRules;
  try {
    const res = await fetch("https://www.wearewarp.com/robots.txt", {
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    robotsDisallowRules = text.split("\n")
      .filter(l => l.toLowerCase().trim().startsWith("disallow:"))
      .map(l => l.split(":").slice(1).join(":").trim())
      .filter(Boolean);
  } catch {
    robotsDisallowRules = [];
  }
  return robotsDisallowRules;
}

function isBlockedByRobots(pagePath) {
  return (robotsDisallowRules || []).some(rule => rule && pagePath.startsWith(rule));
}

// ── Per-page SEO check ──────────────────────────────────────────────────

const CHECK_NAMES = [
  "http_200",
  "canonical_correct",
  "no_noindex",
  "not_robots_blocked",
  "unique_title",
  "unique_h1",
  "body_content_present",
  "has_internal_links",
  "in_sitemap",
];

/**
 * Run all 9 SEO checks on a single page.
 *
 * @param {string} url
 * @param {string} slug
 * @param {{ sitemapSlugs: Set, inboundMap: Map, seenTitles: Set, seenH1s: Set }} ctx
 * @returns {Promise<object>}
 */
async function checkPageSeo(url, slug, ctx) {
  const result = {
    slug,
    url,
    checks: {},
    passed: 0,
    failed: 0,
    total: 9,
    error: null,
  };

  let html = "";
  let resStatus = 0;
  let resHeaders = {};

  // Fetch the page
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "WarpSEO-ReadinessCheck/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    resStatus = res.status;
    resHeaders = Object.fromEntries(res.headers.entries());
    html = await res.text();
  } catch (err) {
    result.error = err.message;
    result.checks = Object.fromEntries(CHECK_NAMES.map(c => [c, false]));
    result.failed = 9;
    return result;
  }

  const htmlLower = html.toLowerCase();

  // 1. HTTP 200
  result.checks.http_200 = resStatus === 200;

  // 2. Canonical correct
  const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  const canonical = canonicalMatch ? canonicalMatch[1] : null;
  result.checks.canonical_correct = canonical !== null &&
    (canonical.endsWith(`/${slug}`) || canonical.endsWith(`/${slug}/`));

  // 3. No noindex
  const hasNoindex = htmlLower.includes('content="noindex') ||
    htmlLower.includes("content='noindex") ||
    (resHeaders["x-robots-tag"] || "").toLowerCase().includes("noindex");
  result.checks.no_noindex = !hasNoindex;

  // 4. Not robots-blocked
  await loadRobotsTxt();
  result.checks.not_robots_blocked = !isBlockedByRobots(`/lanes/${slug}`);

  // 5. Unique title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
  if (titleText && titleText.length > 0 && !ctx.seenTitles.has(titleText.toLowerCase())) {
    result.checks.unique_title = true;
    ctx.seenTitles.add(titleText.toLowerCase());
  } else {
    result.checks.unique_title = titleText.length > 0 && !ctx.seenTitles.has(titleText.toLowerCase());
    if (titleText) ctx.seenTitles.add(titleText.toLowerCase());
  }

  // 6. Unique H1
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1Match ? h1Match[1].replace(/<[^>]+>/g, "").trim() : "";
  if (h1Text && h1Text.length > 0 && !ctx.seenH1s.has(h1Text.toLowerCase())) {
    result.checks.unique_h1 = true;
    ctx.seenH1s.add(h1Text.toLowerCase());
  } else {
    result.checks.unique_h1 = h1Text.length > 0 && !ctx.seenH1s.has(h1Text.toLowerCase());
    if (h1Text) ctx.seenH1s.add(h1Text.toLowerCase());
  }

  // 7. Body content present (500+ chars visible text)
  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  result.checks.body_content_present = textContent.length >= 500;

  // 8. Internal links present
  const hasInbound = (ctx.inboundMap.get(slug.toLowerCase()) || []).length > 0;
  const hasOutbound = htmlLower.includes("/lanes/");
  result.checks.has_internal_links = hasInbound || hasOutbound;

  // 9. In XML sitemap
  result.checks.in_sitemap = ctx.sitemapSlugs.has(slug.toLowerCase().trim());

  // Tally
  for (const v of Object.values(result.checks)) {
    if (v) result.passed++;
    else result.failed++;
  }

  return result;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  // Find manifest
  let manifest;

  if (RUN_ID) {
    manifest = loadManifest(RUN_ID);
    if (!manifest) {
      console.error(`ERROR: Manifest not found for run_id: ${RUN_ID}`);
      process.exit(1);
    }
  } else {
    const recent = listManifests({ limit: 20 });
    const publishManifest = recent.find(m =>
      (m.script_name === "publish_next.js" || m.script_name === "lanes_auto_publish.js") && m.published_count > 0 && !m.dry_run
    );
    if (publishManifest) {
      manifest = loadManifest(publishManifest.run_id);
    }
    if (!manifest) {
      // Fall back to any manifest with published pages
      const any = recent.find(m => m.published_count > 0);
      if (any) manifest = loadManifest(any.run_id);
    }
    if (!manifest) {
      console.error("ERROR: No publish manifest found. Run a publish pipeline first.");
      process.exit(1);
    }
  }

  const runId = manifest.run_id;
  const publishedPages = manifest.published_pages || [];

  if (publishedPages.length === 0) {
    if (JSON_OUTPUT) {
      console.log(JSON.stringify({ run_id: runId, pages_checked: 0, error: "no published pages" }, null, 2));
    } else {
      console.log(`\n  Run ${runId}: No published pages to check.\n`);
    }
    process.exit(0);
  }

  // Load cross-page data
  const sitemapSlugs = loadSitemapSlugs();
  const inboundMap = loadInboundLinkMap();
  const seenTitles = new Set();
  const seenH1s = new Set();

  const ctx = { sitemapSlugs, inboundMap, seenTitles, seenH1s };

  // Run checks
  const results = [];
  let transitioned = 0;

  if (!JSON_OUTPUT) {
    console.log("");
    console.log("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
    console.log("\u2551  SEO READINESS CHECK                             \u2551");
    console.log(`\u2551  Run: ${runId.padEnd(43)}\u2551`);
    console.log("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
    console.log(`\n  Checking ${publishedPages.length} pages...\n`);
  }

  for (const page of publishedPages) {
    const slug = page.slug;
    const url = page.url || `https://www.wearewarp.com/lanes/${slug}`;

    const result = await checkPageSeo(url, slug, ctx);
    results.push(result);

    // Transition to verified_live if critical checks pass
    if (!SKIP_TRANSITION && result.checks.http_200 && result.checks.canonical_correct &&
        result.checks.no_noindex && result.checks.not_robots_blocked) {
      transitionState(slug, "LTL", "verified_live", {
        by: "seo_readiness_check.js",
        note: `SEO readiness: ${result.passed}/${result.total} checks passed`,
      });
      transitioned++;
    }

    if (!JSON_OUTPUT) {
      const icon = result.failed === 0 ? "\u2713" : (result.checks.http_200 ? "\u26A0" : "\u2717");
      console.log(`  ${icon} ${slug} \u2014 ${result.passed}/${result.total} passed${result.error ? ` [${result.error}]` : ""}`);
    }

    // Small delay between requests to avoid rate limiting
    if (publishedPages.indexOf(page) < publishedPages.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Build report
  const allPassed = results.filter(r => r.failed === 0).length;
  const partialIssues = results.filter(r => r.failed > 0 && r.checks.http_200).length;
  const criticalFailures = results.filter(r => !r.checks.http_200).length;

  const perCheckSummary = {};
  for (const check of CHECK_NAMES) {
    perCheckSummary[check] = {
      passed: results.filter(r => r.checks[check]).length,
      failed: results.filter(r => !r.checks[check]).length,
    };
  }

  const report = {
    run_id: runId,
    checked_at: new Date().toISOString(),
    pages_checked: results.length,
    all_checks_passed: allPassed,
    partial_issues: partialIssues,
    critical_failures: criticalFailures,
    transitioned_to_verified_live: transitioned,
    per_check_summary: perCheckSummary,
    pages: results,
  };

  // Save report
  const reportDir = resolveFromRoot("artifacts", "seo-readiness-reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `seo_readiness_${runId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  // Human-readable output
  console.log("");
  console.log("\u2500\u2500 Summary \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  console.log(`  Pages checked:        ${String(results.length).padStart(4)}`);
  console.log(`  All checks passed:    ${String(allPassed).padStart(4)}`);
  console.log(`  Partial issues:       ${String(partialIssues).padStart(4)}`);
  console.log(`  Critical failures:    ${String(criticalFailures).padStart(4)}`);
  if (transitioned > 0) {
    console.log(`  Transitioned:         ${String(transitioned).padStart(4)}  \u2192 verified_live`);
  }

  console.log("");
  console.log("\u2500\u2500 Per-Check Results \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  for (const check of CHECK_NAMES) {
    const s = perCheckSummary[check];
    const icon = s.failed === 0 ? "\u2713" : "\u26A0";
    const note = s.failed > 0 ? ` (${s.failed} failed)` : "";
    console.log(`  ${check.padEnd(25)} ${String(s.passed).padStart(3)}/${results.length}  ${icon}${note}`);
  }

  // Pages with issues
  const pagesWithIssues = results.filter(r => r.failed > 0);
  if (pagesWithIssues.length > 0) {
    console.log("");
    console.log(`\u2500\u2500 Pages With Issues (${pagesWithIssues.length}) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    for (const r of pagesWithIssues.slice(0, 20)) {
      const failedChecks = Object.entries(r.checks)
        .filter(([, v]) => !v)
        .map(([k]) => k)
        .join(", ");
      console.log(`  ${r.slug}    ${failedChecks}`);
    }
    if (pagesWithIssues.length > 20) {
      console.log(`  ... and ${pagesWithIssues.length - 20} more`);
    }
  }

  console.log("");
  console.log(`  Report saved: ${reportPath}`);
  console.log("");

  process.exit(criticalFailures > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
