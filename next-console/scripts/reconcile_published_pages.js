#!/usr/bin/env node

/**
 * Reconcile published_pages.json from Webflow CMS API
 *
 * Queries the Webflow CMS API for all items created in the last 7 days,
 * merges them into published_pages.json, and writes the result.
 *
 * Usage:
 *   node scripts/reconcile_published_pages.js              # Dry run (default)
 *   node scripts/reconcile_published_pages.js --live       # Write to disk
 *
 * This script exists because _publish_cluster_v2.js previously had a bug
 * where it overwrote published_pages.json with only its own results, wiping
 * entries from other publish runs.
 */

import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
config({ path: path.join(ROOT, ".env.local") });

const RATE_LIMIT_MS = 600;
const LIVE = process.argv.includes("--live");
const DAYS_BACK = parseInt(process.argv.find(a => a.startsWith("--days="))?.split("=")[1] || "7", 10);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseSeoTitle(name) {
  const m = name.match(/^(.+?),\s*(\w+)\s+to\s+(.+?),\s*(\w+)\s+(\w+)/);
  if (!m) return { origin_city: "", origin_state: "", destination_city: "", destination_state: "", mode: "LTL" };
  return {
    origin_city: m[1],
    origin_state: m[2],
    destination_city: m[3],
    destination_state: m[4],
    mode: m[5],
  };
}

async function main() {
  const token = process.env.WEBFLOW_API_TOKEN;
  const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID;

  if (!token || !collectionId) {
    console.error("ERROR: Missing WEBFLOW_API_TOKEN or WEBFLOW_LANE_COLLECTION_ID in .env.local");
    process.exit(1);
  }

  console.log("=== Reconcile published_pages.json from Webflow CMS ===");
  console.log(`  Mode: ${LIVE ? "LIVE (will write)" : "DRY RUN"}`);
  console.log(`  Looking back: ${DAYS_BACK} days`);
  console.log("");

  // Calculate cutoff date
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS_BACK);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  console.log(`  Cutoff date: ${cutoffStr}`);

  // Fetch all items from Webflow CMS
  let recentItems = [];
  let totalScanned = 0;
  let offset = 0;

  while (true) {
    const res = await fetch(
      `https://api.webflow.com/v2/collections/${collectionId}/items?limit=100&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
    );
    const data = await res.json();
    const items = data.items || [];
    totalScanned += items.length;

    for (const item of items) {
      const created = item.createdOn || "";
      if (created >= cutoffStr && !item.isDraft && !item.isArchived) {
        recentItems.push(item);
      }
    }

    if (items.length < 100) break;
    offset += 100;
    await sleep(RATE_LIMIT_MS);
  }

  console.log(`  Scanned ${totalScanned} CMS items, found ${recentItems.length} recent non-draft items\n`);

  // Load existing published_pages.json
  const publishedPath = path.join(ROOT, "data", "published_pages.json");
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(publishedPath, "utf-8"));
    if (!Array.isArray(existing)) existing = [];
  } catch { existing = []; }

  console.log(`  Existing published_pages.json: ${existing.length} entries`);

  // Build entries from CMS items
  const existingSlugs = new Set(existing.map(e => e.slug));
  let added = 0;
  let updated = 0;

  for (const item of recentItems) {
    const slug = item.fieldData?.slug || "";
    const name = item.fieldData?.name || "";
    const parsed = parseSeoTitle(name);

    const entry = {
      canonical_path: "/lanes/" + slug,
      slug,
      seo_title: name,
      h1: name.replace(/ \| WARP$/, ""),
      intro: "",
      origin_city: parsed.origin_city,
      origin_state: parsed.origin_state,
      destination_city: parsed.destination_city,
      destination_state: parsed.destination_state,
      mode: parsed.mode,
      segment: "smb",
      published_at_iso: item.createdOn,
      wave_id: "reconciled-from-webflow-cms",
      content_fingerprint: null,
      webflow_item_id: item.id,
      dry_run: false,
    };

    const idx = existing.findIndex(e => e.slug === slug);
    if (idx >= 0) {
      // Only update if the existing entry doesn't have a webflow_item_id
      if (!existing[idx].webflow_item_id || existing[idx].webflow_item_id !== item.id) {
        existing[idx] = { ...existing[idx], ...entry };
        updated++;
      }
    } else {
      existing.push(entry);
      added++;
    }
  }

  console.log(`  Reconciliation: ${added} new, ${updated} updated, ${existing.length} total\n`);

  // Show all entries
  for (const e of existing) {
    const tag = e.wave_id === "reconciled-from-webflow-cms" ? "[RECONCILED]" : `[${e.wave_id}]`;
    console.log(`    ${e.slug} → ${e.origin_city}, ${e.origin_state} → ${e.destination_city}, ${e.destination_state} ${tag}`);
  }

  if (LIVE) {
    fs.writeFileSync(publishedPath, JSON.stringify(existing, null, 2) + "\n");
    console.log(`\n  ✓ Wrote ${existing.length} entries to published_pages.json`);
  } else {
    console.log(`\n  DRY RUN — no changes written. Use --live to write.`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
