#!/usr/bin/env node

/**
 * Remove Video from Published Pages
 *
 * Updates already-published Webflow CMS items to inject CSS that hides
 * the Wistia video player embedded in the collection template, and adds
 * FAQPage JSON-LD structured data.
 *
 * The Webflow lane page template includes a Wistia video (media-id 8pogd36stc)
 * that is not controlled by CMS data. This script patches each published item
 * via the Webflow API to set the `faq-schema` code embed field with:
 *   1. CSS that hides the video player and collapses its spacing
 *   2. FAQPage JSON-LD for SEO
 *
 * Usage:
 *   node scripts/remove_video_from_published.js              # Dry run (default)
 *   node scripts/remove_video_from_published.js --live       # LIVE: update + re-publish items
 *   node scripts/remove_video_from_published.js --live --skip-publish  # Update but don't re-publish
 *
 * Requires env vars:
 *   WEBFLOW_API_TOKEN
 *   WEBFLOW_LANE_COLLECTION_ID
 */

import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = getProjectRoot();

config({ path: path.join(ROOT, ".env.local") });

const args = process.argv.slice(2);
const isLive = args.includes("--live");
const skipPublish = args.includes("--skip-publish");
const isDryRun = !isLive;

// ── Video-hiding CSS ────────────────────────────────────────────────

const HIDE_VIDEO_CSS = [
  "wistia-player,",
  "wistia-player:not(:defined),",
  ".w-embed wistia-player,",
  ".w-embed:has(wistia-player){",
  "display:none!important;",
  "padding:0!important;",
  "height:0!important;",
  "margin:0!important;",
  "overflow:hidden!important;",
  "}",
].join("");

function buildFaqSchemaEmbed(faq) {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: (faq || []).map((f) => ({
      "@type": "Question",
      name: f.q || f.question,
      acceptedAnswer: { "@type": "Answer", text: f.a || f.answer },
    })),
  };

  return [
    `<style>${HIDE_VIDEO_CSS}</style>`,
    `<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`,
  ].join("\n");
}

// ── Load published pages ────────────────────────────────────────────

function loadPublished() {
  const filePath = path.join(ROOT, "data", "published_pages.json");
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

function loadPackageData(slug) {
  const pkgPath = path.join(ROOT, "artifacts", "publish_next", slug, "package.json");
  try {
    return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

// ── Webflow API helpers ─────────────────────────────────────────────

async function patchItem(collectionId, itemId, fields) {
  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) throw new Error("Missing WEBFLOW_API_TOKEN");

  const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`;
  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ fieldData: fields }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webflow PATCH ${res.status}: ${text}`);
  }
  return res.json();
}

async function publishItems(collectionId, itemIds) {
  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) throw new Error("Missing WEBFLOW_API_TOKEN");

  const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/publish`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ itemIds }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webflow publish ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Remove Video from Published Pages ===");
  console.log(`  Mode: ${isDryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`  Re-publish: ${isDryRun ? "N/A" : skipPublish ? "SKIP" : "YES"}\n`);

  const published = loadPublished();
  if (published.length === 0) {
    console.log("  No published pages found in data/published_pages.json");
    return;
  }

  // Filter for real (non-dry-run) published pages
  const realPages = published.filter((p) => !p.dry_run && p.webflow_item_id);
  console.log(`  Found ${realPages.length} published pages with Webflow item IDs\n`);

  if (realPages.length === 0) {
    console.log("  No pages to update.");
    return;
  }

  const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID;
  if (!isDryRun && !collectionId) {
    throw new Error("Missing WEBFLOW_LANE_COLLECTION_ID");
  }

  const results = [];
  const artifactsDir = path.join(ROOT, "artifacts", "video_removal");
  fs.mkdirSync(artifactsDir, { recursive: true });

  for (const page of realPages) {
    const slug = page.slug;
    const itemId = page.webflow_item_id;

    // Load FAQ from package data if available
    const pkg = loadPackageData(slug);
    const faq = pkg?.page?.faq || [];

    const faqSchemaEmbed = buildFaqSchemaEmbed(faq);

    console.log(`  ${slug}`);
    console.log(`    Item ID: ${itemId}`);
    console.log(`    FAQ entries: ${faq.length}`);
    console.log(`    Embed size: ${faqSchemaEmbed.length} chars`);

    if (isDryRun) {
      console.log("    → DRY RUN — skipping API call\n");
      results.push({ slug, itemId, status: "dry_run", faqCount: faq.length });
      continue;
    }

    try {
      await patchItem(collectionId, itemId, { "faq-schema": faqSchemaEmbed });
      console.log("    → PATCHED ✓");
      results.push({ slug, itemId, status: "patched", faqCount: faq.length });
    } catch (err) {
      console.log(`    → FAILED: ${err.message}`);
      results.push({ slug, itemId, status: "failed", error: err.message });
    }

    // Rate limit: 60 req/min on Webflow API
    await new Promise((r) => setTimeout(r, 1100));
  }

  // Re-publish all patched items in one batch
  if (!isDryRun && !skipPublish) {
    const patchedIds = results.filter((r) => r.status === "patched").map((r) => r.itemId);
    if (patchedIds.length > 0) {
      console.log(`\n  Re-publishing ${patchedIds.length} items...`);
      try {
        await publishItems(collectionId, patchedIds);
        console.log("  → Published ✓");
      } catch (err) {
        console.log(`  → Publish FAILED: ${err.message}`);
      }
    }
  }

  // Write report
  const report = {
    timestamp: new Date().toISOString(),
    dry_run: isDryRun,
    pages_processed: results.length,
    patched: results.filter((r) => r.status === "patched").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };

  const reportPath = path.join(artifactsDir, "removal_report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  Report: ${reportPath}`);

  // Summary
  const patched = results.filter((r) => r.status === "patched").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const dryRun = results.filter((r) => r.status === "dry_run").length;

  console.log("\n=== Summary ===");
  if (isDryRun) {
    console.log(`  ${dryRun} pages would be updated (dry run)`);
    console.log("  Run with --live to apply changes");
  } else {
    console.log(`  ${patched} patched, ${failed} failed`);
  }
}

main().catch((err) => {
  console.error("[remove-video] Fatal error:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
