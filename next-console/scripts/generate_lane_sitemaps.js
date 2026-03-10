#!/usr/bin/env node

/**
 * Generate Lane Sitemaps
 *
 * Reads the enriched lane registry, groups lanes by corridor, and produces
 * XML sitemaps that conform to the sitemap protocol (max 5 000 URLs per file).
 *
 * Inputs:
 *   data/lane_registry.json — enriched lane registry (origin, destination, slug, lane_set, corridor_id, ...)
 *
 * Outputs:
 *   sitemaps/sitemap-lanes.xml      — lane sitemap (split into sitemap-lanes-1.xml, -2.xml, ... if > 5000)
 *   sitemaps/sitemap-index.xml      — sitemap index referencing all sitemap files
 *   artifacts/sitemap_generation_report.json — generation summary
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = getProjectRoot();

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

const BASE_URL = "https://www.wearewarp.com";
const MAX_URLS_PER_SITEMAP = 5000;

// ---------------------------------------------------------------------------
// Priority mapping by lane_set
// ---------------------------------------------------------------------------

function getPriority(laneSet) {
  switch (laneSet) {
    case "tier1_core":
      return 0.8;
    case "tier1_to_tier2_expansion":
      return 0.6;
    default:
      return 0.7;
  }
}

// ---------------------------------------------------------------------------
// XML builders
// ---------------------------------------------------------------------------

function buildUrlEntry(slug, priority) {
  return [
    "  <url>",
    `    <loc>${BASE_URL}/lanes/${slug}</loc>`,
    "    <changefreq>weekly</changefreq>",
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
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

function buildSitemapIndex(sitemapFiles) {
  const today = new Date().toISOString().split("T")[0];
  const entries = sitemapFiles.map(
    (file) =>
      [
        "  <sitemap>",
        `    <loc>${BASE_URL}/${file}</loc>`,
        `    <lastmod>${today}</lastmod>`,
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
// Main
// ---------------------------------------------------------------------------

console.log("[generate_lane_sitemaps] Loading lane registry...");

const registry = readJSON("data/lane_registry.json");
console.log(`  Loaded ${registry.length} lanes`);

// Group by corridor for reporting
const byCorridor = {};
for (const lane of registry) {
  const cid = lane.corridor_id || "other";
  if (!byCorridor[cid]) byCorridor[cid] = [];
  byCorridor[cid].push(lane);
}
console.log(`  Corridors: ${Object.keys(byCorridor).length}`);

// Build URL entries sorted by order
const sorted = [...registry].sort((a, b) => a.order - b.order);

const urlEntries = sorted.map((lane) => {
  const priority = getPriority(lane.lane_set);
  return { slug: lane.slug, priority, xml: buildUrlEntry(lane.slug, priority) };
});

// Deduplicate slugs (lane_registry should be unique, but safety check)
const seen = new Set();
const deduped = [];
for (const entry of urlEntries) {
  if (!seen.has(entry.slug)) {
    seen.add(entry.slug);
    deduped.push(entry);
  }
}

console.log(`  Unique URLs: ${deduped.length}`);

// Split into chunks of MAX_URLS_PER_SITEMAP
const chunks = [];
for (let i = 0; i < deduped.length; i += MAX_URLS_PER_SITEMAP) {
  chunks.push(deduped.slice(i, i + MAX_URLS_PER_SITEMAP));
}

// Write sitemap files
const sitemapFiles = [];
const urlsPerFile = {};

for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i];
  const filename =
    chunks.length === 1
      ? "sitemap-lanes.xml"
      : `sitemap-lanes-${i + 1}.xml`;
  const relPath = `sitemaps/${filename}`;

  const xml = buildSitemapXml(chunk.map((e) => e.xml));
  writeFile(relPath, xml);

  sitemapFiles.push(filename);
  urlsPerFile[filename] = chunk.length;
  console.log(`  Wrote sitemaps/${filename} (${chunk.length} URLs)`);
}

// Write sitemap index
const indexXml = buildSitemapIndex(sitemapFiles.map((f) => `sitemaps/${f}`));
writeFile("sitemaps/sitemap-index.xml", indexXml);
console.log("  Wrote sitemaps/sitemap-index.xml");

// Count by priority
const byPriority = {};
for (const entry of deduped) {
  const key = String(entry.priority);
  byPriority[key] = (byPriority[key] || 0) + 1;
}

// Write generation report
const report = {
  timestamp: new Date().toISOString(),
  total_urls: deduped.length,
  sitemap_files: sitemapFiles,
  urls_per_file: urlsPerFile,
  by_priority: byPriority,
};

writeJSON("artifacts/sitemap_generation_report.json", report);
console.log("  Wrote artifacts/sitemap_generation_report.json");

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

console.log("\n===== Sitemap Generation Report =====");
console.log(`Timestamp       : ${report.timestamp}`);
console.log(`Total URLs      : ${report.total_urls}`);
console.log(`Sitemap files   : ${report.sitemap_files.length}`);
for (const [file, count] of Object.entries(report.urls_per_file)) {
  console.log(`  ${file}: ${count} URLs`);
}
console.log("\nBy priority:");
for (const [priority, count] of Object.entries(report.by_priority).sort(
  (a, b) => parseFloat(b[0]) - parseFloat(a[0])
)) {
  console.log(`  ${priority}: ${count} URLs`);
}
console.log("\nBy corridor:");
for (const [corridor, lanes] of Object.entries(byCorridor).sort(
  (a, b) => b[1].length - a[1].length
)) {
  console.log(`  ${corridor}: ${lanes.length} lanes`);
}
console.log("\n===== Generation complete =====");
