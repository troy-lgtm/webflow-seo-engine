#!/usr/bin/env node

/**
 * Generate All Sitemaps
 *
 * Combined sitemap generator that produces sub-sitemaps for every page type
 * and a sitemap index referencing all of them.
 *
 * Outputs:
 *   sitemaps/sitemap-lanes.xml       — lane pages (max 5000 per file)
 *   sitemaps/sitemap-corridors.xml   — corridor hub pages
 *   sitemaps/sitemap-metros.xml      — metro hub pages
 *   sitemaps/sitemap-index.xml       — sitemap index referencing all sub-sitemaps
 *   artifacts/sitemap_generation_report.json — counts per file
 *
 * Inputs:
 *   data/lane_registry.json   — enriched lane registry
 *   data/corridors.json       — corridor definitions
 *   data/metro_map.json       — metro hub definitions
 */

import fs from "fs";
import path from "path";
import { getProjectRoot } from "../lib/fs/project-root.js";

// ---------------------------------------------------------------------------
// Paths & Constants
// ---------------------------------------------------------------------------

const ROOT = getProjectRoot();
const BASE_URL = "https://www.wearewarp.com";
const MAX_URLS_PER_SITEMAP = 5000;
const TODAY = new Date().toISOString().split("T")[0];

// CLI args
const args = process.argv.slice(2);
const PUBLISHED_ONLY = args.includes("--published-only");

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function readJSON(relPath) {
  const fullPath = path.join(ROOT, relPath);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
}

function writeFile(relPath, content) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

function writeJSON(relPath, data) {
  writeFile(relPath, JSON.stringify(data, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildUrlEntry({ loc, changefreq, priority }) {
  const parts = [`  <url>`, `    <loc>${escapeXml(loc)}</loc>`];
  if (changefreq) parts.push(`    <changefreq>${escapeXml(changefreq)}</changefreq>`);
  if (priority !== undefined) parts.push(`    <priority>${priority}</priority>`);
  parts.push(`  </url>`);
  return parts.join("\n");
}

function buildSitemapXml(urlEntries) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlEntries.join("\n"),
    "</urlset>",
    "",
  ].join("\n");
}

function buildSitemapIndex(sitemapRefs) {
  const entries = sitemapRefs.map(
    (ref) =>
      [
        "  <sitemap>",
        `    <loc>${escapeXml(ref.loc)}</loc>`,
        `    <lastmod>${ref.lastmod || TODAY}</lastmod>`,
        "  </sitemap>",
      ].join("\n")
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries.join("\n"),
    "</sitemapindex>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Priority helpers
// ---------------------------------------------------------------------------

function getLanePriority(laneSet) {
  switch (laneSet) {
    case "tier1_core":
      return 0.8;
    case "tier1_to_tier2_expansion":
      return 0.6;
    default:
      return 0.7;
  }
}

const CORRIDOR_PRIORITY = 0.9;
const METRO_PRIORITY = 0.7;

// ---------------------------------------------------------------------------
// 1. Lane sitemap
// ---------------------------------------------------------------------------

console.log("[generate_all_sitemaps] Loading lane registry...");
let registry = readJSON("data/lane_registry.json");
console.log(`  Loaded ${registry.length} lanes`);

// --published-only: filter to lanes that are approved/published/verified OR already in Webflow CMS
if (PUBLISHED_ONLY) {
  console.log("  --published-only mode: filtering to publishable lanes only");
  const publishableStates = new Set([
    "approved",
    "published_pending_verification",
    "published_unverified",
    "verified_live",
  ]);

  // Load approval state
  let approvedSlugs = new Set();
  const approvalPath = path.join(ROOT, "data", "approval_state.json");
  if (fs.existsSync(approvalPath)) {
    try {
      const approvalState = JSON.parse(fs.readFileSync(approvalPath, "utf-8"));
      for (const entry of approvalState) {
        if (entry.slug && publishableStates.has(entry.state)) {
          approvedSlugs.add(entry.slug.toLowerCase().trim());
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // Load webflow existing slugs (already live in CMS)
  let webflowSlugs = new Set();
  const webflowPath = path.join(ROOT, "data", "webflow_existing_slugs.json");
  if (fs.existsSync(webflowPath)) {
    try {
      const slugList = JSON.parse(fs.readFileSync(webflowPath, "utf-8"));
      for (const s of slugList) {
        if (s) webflowSlugs.add(String(s).toLowerCase().trim());
      }
    } catch { /* ignore parse errors */ }
  }

  const totalBefore = registry.length;
  registry = registry.filter(lane => {
    const slug = (lane.slug || "").toLowerCase().trim();
    return approvedSlugs.has(slug) || webflowSlugs.has(slug);
  });
  console.log(`  --published-only: ${registry.length} of ${totalBefore} lanes included`);
  console.log(`    approved/published state: ${approvedSlugs.size}`);
  console.log(`    webflow existing slugs:   ${webflowSlugs.size}`);
}

const sorted = [...registry].sort((a, b) => a.order - b.order);

// Deduplicate
const seenSlugs = new Set();
const laneEntries = [];
for (const lane of sorted) {
  if (!lane.slug || seenSlugs.has(lane.slug)) continue;
  seenSlugs.add(lane.slug);
  laneEntries.push(
    buildUrlEntry({
      loc: `${BASE_URL}/lanes/${lane.slug}`,
      changefreq: "weekly",
      priority: getLanePriority(lane.lane_set),
    })
  );
}
console.log(`  Unique lane URLs: ${laneEntries.length}`);

// Split into chunks if needed
const laneChunks = [];
for (let i = 0; i < laneEntries.length; i += MAX_URLS_PER_SITEMAP) {
  laneChunks.push(laneEntries.slice(i, i + MAX_URLS_PER_SITEMAP));
}

const laneSitemapFiles = [];
const urlsPerFile = {};

for (let i = 0; i < laneChunks.length; i++) {
  const chunk = laneChunks[i];
  const filename =
    laneChunks.length === 1
      ? "sitemap-lanes.xml"
      : `sitemap-lanes-${i + 1}.xml`;
  const relPath = `sitemaps/${filename}`;
  writeFile(relPath, buildSitemapXml(chunk));
  laneSitemapFiles.push(filename);
  urlsPerFile[filename] = chunk.length;
  console.log(`  Wrote sitemaps/${filename} (${chunk.length} URLs)`);
}

// Track newly-added URLs when in --published-only mode
if (PUBLISHED_ONLY) {
  // Compare with previous sitemap to find new URLs
  const previousSitemapPath = path.join(ROOT, "sitemaps", "sitemap-lanes.xml");
  let previousSlugs = new Set();
  // We already wrote the new sitemap above, but we can compare with seenSlugs
  // The new URLs artifact lists all slugs included (useful for downstream tracking)
  const newUrlsArtifact = {
    generated_at: new Date().toISOString(),
    mode: "published-only",
    included_slugs: [...seenSlugs].sort(),
    total_urls: seenSlugs.size,
  };
  writeJSON("artifacts/sitemap_new_urls.json", newUrlsArtifact);
  console.log(`  Wrote artifacts/sitemap_new_urls.json (${seenSlugs.size} slugs)`);
}

// ---------------------------------------------------------------------------
// 2. Corridor sitemap
// ---------------------------------------------------------------------------

console.log("[generate_all_sitemaps] Loading corridors...");
const corridorsData = readJSON("data/corridors.json");
const corridors = (corridorsData.corridors || []).filter(
  (c) => c.id !== "other"
);
console.log(`  Loaded ${corridors.length} corridors (excluding 'other')`);

const corridorEntries = corridors.map((c) =>
  buildUrlEntry({
    loc: `${BASE_URL}/corridors/${c.id}`,
    changefreq: "monthly",
    priority: CORRIDOR_PRIORITY,
  })
);

const corridorFilename = "sitemap-corridors.xml";
writeFile(`sitemaps/${corridorFilename}`, buildSitemapXml(corridorEntries));
urlsPerFile[corridorFilename] = corridorEntries.length;
console.log(
  `  Wrote sitemaps/${corridorFilename} (${corridorEntries.length} URLs)`
);

// ---------------------------------------------------------------------------
// 3. Metro sitemap
// ---------------------------------------------------------------------------

console.log("[generate_all_sitemaps] Loading metro map...");
let metroCount = 0;
const metroFilename = "sitemap-metros.xml";

try {
  const metroData = readJSON("data/metro_map.json");
  const metros = metroData.metros || [];
  metroCount = metros.length;
  console.log(`  Loaded ${metroCount} metros`);

  const metroEntries = metros.map((m) =>
    buildUrlEntry({
      loc: `${BASE_URL}/metros/${m.metro_id}`,
      changefreq: "monthly",
      priority: METRO_PRIORITY,
    })
  );

  writeFile(`sitemaps/${metroFilename}`, buildSitemapXml(metroEntries));
  urlsPerFile[metroFilename] = metroEntries.length;
  console.log(
    `  Wrote sitemaps/${metroFilename} (${metroEntries.length} URLs)`
  );
} catch (err) {
  console.log(`  WARNING: Could not load metro_map.json — ${err.message}`);
  console.log(`  Writing empty metro sitemap`);
  writeFile(
    `sitemaps/${metroFilename}`,
    buildSitemapXml([])
  );
  urlsPerFile[metroFilename] = 0;
}

// ---------------------------------------------------------------------------
// 4. Sitemap index
// ---------------------------------------------------------------------------

console.log("[generate_all_sitemaps] Building sitemap index...");

const allSitemapFiles = [...laneSitemapFiles, corridorFilename];
if (metroCount > 0) {
  allSitemapFiles.push(metroFilename);
}

const sitemapRefs = allSitemapFiles.map((f) => ({
  loc: `${BASE_URL}/sitemaps/${f}`,
  lastmod: TODAY,
}));

writeFile("sitemaps/sitemap-index.xml", buildSitemapIndex(sitemapRefs));
console.log(
  `  Wrote sitemaps/sitemap-index.xml (${allSitemapFiles.length} sitemaps)`
);

// ---------------------------------------------------------------------------
// 5. Generation report
// ---------------------------------------------------------------------------

const totalUrls = Object.values(urlsPerFile).reduce((a, b) => a + b, 0);

const report = {
  timestamp: new Date().toISOString(),
  total_urls: totalUrls,
  sitemap_files: allSitemapFiles,
  urls_per_file: urlsPerFile,
  page_counts: {
    lanes: laneEntries.length,
    corridors: corridorEntries.length,
    metros: metroCount,
  },
  sitemap_index_entries: allSitemapFiles.length,
};

writeJSON("artifacts/sitemap_generation_report.json", report);
console.log("  Wrote artifacts/sitemap_generation_report.json");

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

console.log("\n===== All Sitemaps Generation Report =====");
console.log(`Timestamp       : ${report.timestamp}`);
console.log(`Total URLs      : ${report.total_urls}`);
console.log(`Sitemap files   : ${report.sitemap_files.length}`);
console.log("");
console.log("URLs per file:");
for (const [file, count] of Object.entries(report.urls_per_file)) {
  console.log(`  ${file}: ${count}`);
}
console.log("");
console.log("Page counts:");
console.log(`  Lanes:     ${report.page_counts.lanes}`);
console.log(`  Corridors: ${report.page_counts.corridors}`);
console.log(`  Metros:    ${report.page_counts.metros}`);
console.log(`  Total:     ${report.total_urls}`);
console.log("\n===== Generation complete =====");
