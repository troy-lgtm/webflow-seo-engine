#!/usr/bin/env node

/**
 * Import Webflow Slugs — Fallback from Artifacts
 *
 * When no CSV export is available, this script extracts known slugs from:
 *   1) artifacts/publish_next/  — subdirectory names (each = a published slug)
 *   2) artifacts/ship/webflow_payload.json — slug field from first publish
 *   3) data/published_pages.json — any historical entries (real or dry-run)
 *
 * Writes:
 *   data/webflow_existing_slugs.json (array of normalized slug strings)
 *   artifacts/webflow_slug_import_report.json
 *
 * Usage:
 *   node scripts/import_webflow_slugs_from_artifacts.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = getProjectRoot();
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");
const OUTPUT_PATH = path.join(ROOT, "data", "webflow_existing_slugs.json");

function normalizeSlug(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[\u2013\u2014\u2010\u2011\u2012\u2015\u00AD]/g, "-")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function main() {
  const slugSet = new Set();
  const sources = [];

  // Source 1: artifacts/publish_next/ subdirectory names
  const publishNextDir = path.join(ARTIFACTS_DIR, "publish_next");
  if (fs.existsSync(publishNextDir)) {
    const dirs = fs.readdirSync(publishNextDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => normalizeSlug(d.name))
      .filter(Boolean);
    for (const s of dirs) slugSet.add(s);
    sources.push({ name: "artifacts/publish_next/ directories", count: dirs.length });
  }

  // Source 2: artifacts/ship/webflow_payload.json
  const shipPayload = loadJSON(path.join(ARTIFACTS_DIR, "ship", "webflow_payload.json"));
  if (shipPayload?.fields?.slug) {
    const s = normalizeSlug(shipPayload.fields.slug);
    if (s) {
      slugSet.add(s);
      sources.push({ name: "artifacts/ship/webflow_payload.json", count: 1 });
    }
  }

  // Source 3: data/published_pages.json — all entries (real or dry-run)
  const published = loadJSON(path.join(ROOT, "data", "published_pages.json")) || [];
  const pubSlugs = published.map(p => normalizeSlug(p.slug)).filter(Boolean);
  for (const s of pubSlugs) slugSet.add(s);
  if (pubSlugs.length > 0) {
    sources.push({ name: "data/published_pages.json", count: pubSlugs.length });
  }

  // Dedupe and sort
  const slugs = [...slugSet].sort();

  // Write output
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(slugs, null, 2));

  // Write import report
  const report = {
    generated_at: new Date().toISOString(),
    method: "artifact_fallback",
    total_slugs: slugs.length,
    sources,
    sample: slugs.slice(0, 10),
  };
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "webflow_slug_import_report.json"),
    JSON.stringify(report, null, 2)
  );

  // Print
  console.log("=== Webflow Slug Import (Artifact Fallback) ===");
  console.log(`  Total:    ${slugs.length} unique slugs`);
  console.log(`  Output:   ${OUTPUT_PATH}`);
  console.log(`  Sources:`);
  for (const s of sources) {
    console.log(`    - ${s.name}: ${s.count} slugs`);
  }
  if (slugs.length > 0) {
    console.log(`  Sample:   ${slugs.slice(0, 5).join(", ")}`);
  }
  if (slugs.length === 0) {
    console.log("  WARNING: No slugs found from any source.");
  }
  console.log(`  Report:   artifacts/webflow_slug_import_report.json`);
}

main();
