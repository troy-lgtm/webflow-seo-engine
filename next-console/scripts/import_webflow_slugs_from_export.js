#!/usr/bin/env node

/**
 * Import Webflow Slugs from Export
 *
 * Parses an exported CSV/text file of existing Webflow CMS lane slugs
 * and writes data/webflow_existing_slugs.json (array of normalized slug strings).
 *
 * Usage:
 *   node scripts/import_webflow_slugs_from_export.js <path-to-file>
 *   node scripts/import_webflow_slugs_from_export.js --csv "slug1,slug2,slug3"
 *   node scripts/import_webflow_slugs_from_export.js --stdin  (pipe from stdin)
 *
 * Normalization:
 *   - Lowercase, trim whitespace
 *   - Replace unicode hyphen variants (–, —, ‐, ‑, ‒, ―) with ASCII hyphen
 *   - Strip leading/trailing slashes
 *   - Remove empty strings
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();
const OUTPUT_PATH = path.join(ROOT, "data", "webflow_existing_slugs.json");

/**
 * Normalize a single slug string.
 * Handles unicode hyphens, whitespace, leading/trailing slashes, casing.
 */
function normalizeSlug(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[\u2013\u2014\u2010\u2011\u2012\u2015\u00AD]/g, "-") // unicode hyphens → ASCII
    .replace(/^\/+|\/+$/g, "")                                      // strip leading/trailing /
    .replace(/\s+/g, "-")                                            // whitespace → hyphen
    .replace(/[^a-z0-9-]/g, "")                                     // remove non-slug chars
    .replace(/-{2,}/g, "-")                                          // collapse double hyphens
    .replace(/^-+|-+$/g, "");                                        // trim edge hyphens
}

/**
 * Extract slugs from raw text.
 * Supports:
 *   - One slug per line
 *   - CSV with header row (detects "slug" column)
 *   - Comma-separated inline
 *   - PDF-extracted text with slug-like patterns
 */
function extractSlugs(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Detect CSV with header
  const headerLine = lines[0].toLowerCase();
  if (headerLine.includes("slug")) {
    const headers = headerLine.split(",").map(h => h.trim());
    const slugIdx = headers.indexOf("slug");
    if (slugIdx >= 0) {
      return lines.slice(1)
        .map(line => {
          const cols = line.split(",");
          return cols[slugIdx] ? normalizeSlug(cols[slugIdx]) : "";
        })
        .filter(Boolean);
    }
  }

  // Single line, comma-separated
  if (lines.length === 1 && lines[0].includes(",")) {
    return lines[0].split(",").map(normalizeSlug).filter(Boolean);
  }

  // One slug per line (or PDF-extracted text with slug-like patterns)
  const slugs = [];
  for (const line of lines) {
    // Try to extract slug-like patterns: word-to-word or word-to-word-word
    const matches = line.match(/[a-z0-9][\w-]*-to-[\w-]+/gi);
    if (matches) {
      for (const m of matches) slugs.push(normalizeSlug(m));
    } else {
      // Treat whole line as potential slug
      const norm = normalizeSlug(line);
      if (norm && norm.includes("-")) slugs.push(norm);
    }
  }
  return slugs;
}

function dedup(arr) {
  return [...new Set(arr)];
}

async function main() {
  const args = process.argv.slice(2);
  let rawText = "";

  if (args.includes("--csv")) {
    const csvIdx = args.indexOf("--csv");
    rawText = args[csvIdx + 1] || "";
    if (!rawText) {
      console.error("ERROR: --csv requires a value. Usage: --csv \"slug1,slug2,slug3\"");
      process.exit(1);
    }
  } else if (args.includes("--stdin")) {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    rawText = Buffer.concat(chunks).toString("utf-8");
  } else if (args[0] && !args[0].startsWith("-")) {
    // Read from file path
    const filePath = path.resolve(args[0]);
    if (!fs.existsSync(filePath)) {
      console.error(`ERROR: File not found: ${filePath}`);
      process.exit(1);
    }
    rawText = fs.readFileSync(filePath, "utf-8");
  } else {
    console.log("Usage:");
    console.log("  node scripts/import_webflow_slugs_from_export.js <path-to-file>");
    console.log('  node scripts/import_webflow_slugs_from_export.js --csv "slug1,slug2,slug3"');
    console.log("  cat export.txt | node scripts/import_webflow_slugs_from_export.js --stdin");
    console.log("");
    console.log("Output: data/webflow_existing_slugs.json");
    process.exit(0);
  }

  const slugs = dedup(extractSlugs(rawText));
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(slugs, null, 2));

  console.log(`=== Webflow Slug Import ===`);
  console.log(`  Extracted: ${slugs.length} unique slugs`);
  console.log(`  Output:    ${OUTPUT_PATH}`);
  if (slugs.length > 0) {
    console.log(`  First 5:   ${slugs.slice(0, 5).join(", ")}`);
  }
  if (slugs.length === 0) {
    console.log("  WARNING: No slugs found. Check input format.");
  }
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
