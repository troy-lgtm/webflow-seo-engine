#!/usr/bin/env node
/**
 * update_lane_content.js — Update existing lane pages with improved content
 *
 * Regenerates body-content, hero-headline, subheadline, and all CMS fields
 * using the improved pipeline, then pushes updates to Webflow CMS.
 *
 * Usage:
 *   node scripts/update_lane_content.js [--dry-run] [--slugs slug1,slug2,...] [--limit N]
 *
 * Options:
 *   --dry-run   Print generated content without pushing to Webflow
 *   --slugs     Comma-separated list of specific slugs to update
 *   --limit     Maximum number of items to update (default: 10)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import { renderWebflowFields } from "../lib/render-lane-page.js";
import { sanitizeWebflowFields } from "../lib/lane-factory.js";
import { assessPublishQuality } from "../lib/lane-page-validator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load cities.json for state resolution
const CITIES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "cities.json"), "utf-8"));

const API_TOKEN = process.env.WEBFLOW_API_TOKEN || "f03f437275327315aee1f3a8e530726987e9264f4074b3bd49eadb3e0f6dde84";
const COLLECTION_ID = process.env.WEBFLOW_LANE_COLLECTION_ID || "68dbd9b0badadf2b8fa9a397";
const SITE_ID = process.env.WEBFLOW_SITE_ID || "688f073c4367c4fcf9651e08";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const slugsIdx = args.indexOf("--slugs");
const targetSlugs = slugsIdx >= 0 ? args[slugsIdx + 1].split(",") : null;
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 10;

async function fetchItems(offset = 0, pageLimit = 100) {
  const res = await fetch(
    `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items?limit=${pageLimit}&offset=${offset}`,
    { headers: { Authorization: `Bearer ${API_TOKEN}` } }
  );
  if (!res.ok) throw new Error(`Webflow API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function updateItem(itemId, fields) {
  const res = await fetch(
    `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items/${itemId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fieldData: fields }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Update failed for ${itemId}: ${res.status} ${errText}`);
  }
  return res.json();
}

async function publishSite() {
  const DOMAIN_IDS = ["689442045dc003d002d08285", "689442045dc003d002d08271"];
  const res = await fetch(
    `https://api.webflow.com/v2/sites/${SITE_ID}/publish`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ publishToWebflowSubdomain: false, customDomains: DOMAIN_IDS }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Publish failed: ${res.status} ${errText}`);
  }
  return res.json();
}

/**
 * Resolve a city name to "City, ST" format using cities.json lookup.
 * Falls back to just the city name if state not found.
 */
function resolveWithState(cityName) {
  const key = cityName.toLowerCase().trim();
  // Direct match
  if (CITIES[key]) return cityName; // Already has state if in cities.json
  // Try prefix match to find "city, st" key
  for (const k of Object.keys(CITIES)) {
    if (k.startsWith(key + ",") || k.startsWith(key + " ")) {
      // Extract state from the key
      const parts = k.split(",");
      if (parts.length >= 2) {
        return `${cityName}, ${parts[1].trim().toUpperCase()}`;
      }
    }
  }
  return cityName;
}

function parseLaneFromSlug(slug) {
  // Strip hash suffixes (e.g., "atlanta-to-miami-062c5")
  const clean = slug.replace(/-[0-9a-f]{4,8}$/i, "");
  // Strip "ltl-freight-" prefix if present
  const stripped = clean.replace(/^ltl-freight-/, "");

  const toIdx = stripped.indexOf("-to-");
  if (toIdx < 0) return null;

  const originSlug = stripped.substring(0, toIdx);
  const destSlug = stripped.substring(toIdx + 4);

  function titleCase(s) {
    return s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  const originCity = titleCase(originSlug);
  const destCity = titleCase(destSlug);

  return {
    origin: resolveWithState(originCity),
    destination: resolveWithState(destCity),
  };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Lane Content Updater — Premium Pipeline Content Push");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE UPDATE"}`);
  console.log(`Target slugs: ${targetSlugs ? targetSlugs.join(", ") : "auto-select"}`);
  console.log(`Limit: ${limit}`);
  console.log("");

  // Fetch items
  let items = [];
  if (targetSlugs) {
    // Fetch all items and filter
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const page = await fetchItems(offset, 100);
      total = page.pagination?.total || 0;
      items.push(...(page.items || []));
      offset += 100;
      if (offset >= 300) break; // Safety limit for search
    }
    items = items.filter(item => targetSlugs.includes(item.fieldData?.slug));
  } else {
    // Fetch all items and update up to limit
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const page = await fetchItems(offset, 100);
      total = page.pagination?.total || 0;
      items.push(...(page.items || []));
      offset += 100;
      if (offset >= 500) break; // Safety limit
    }
    items = items.slice(0, limit);
  }

  console.log(`Found ${items.length} items to update\n`);

  let updated = 0;
  let errors = 0;

  for (const item of items) {
    const slug = item.fieldData?.slug;
    const parsed = parseLaneFromSlug(slug);
    if (!parsed) {
      console.log(`  ⚠ Skipping ${slug}: cannot parse origin/destination`);
      continue;
    }

    try {
      // Use mode from CMS item if available, otherwise default to LTL
      const itemMode = item.fieldData?.mode || "LTL";

      // Build knowledge — buildLaneKnowledge takes a lane object
      const knowledge = buildLaneKnowledge({
        origin: parsed.origin,
        destination: parsed.destination,
        mode: itemMode,
      });

      // Build canonical page data
      const pageData = buildCanonicalLanePageData(knowledge, {
        corridor_hub: null,
        related_lanes: [],
        tool_link: "https://www.wearewarp.com/quote",
        data_link: null,
      });

      // Render Webflow fields
      const fields = renderWebflowFields(pageData);

      // Show what we're generating
      const bodyContent = fields["body-content"];
      const headline = fields["hero-headline"];
      const subheadline = fields["subheadline"];
      const faqSchemaLen = (fields["faq-schema"] || "").length;
      const proofLen = (fields["proof-section"] || "").length;
      const tradLen = (fields["traditional-ltl"] || "").length;
      const warpLen = (fields["warp-ltl"] || "").length;
      const breadcrumbLen = (fields["breadcrumb-schema"] || "").length;

      console.log(`──────────────────────────────────────────────────────`);
      console.log(`  📦 ${slug}`);
      console.log(`  Mode: ${itemMode}`);
      console.log(`  H1: ${headline}`);
      console.log(`  Sub: ${subheadline.substring(0, 120)}...`);
      console.log(`  Body: ${bodyContent.length} chars (was ${(item.fieldData?.["body-content"] || "").length})`);
      console.log(`  Paragraphs: ${bodyContent.split("\n\n").length}`);
      console.log(`  Comparison: traditional=${tradLen} chars, warp=${warpLen} chars`);
      console.log(`  Proof: ${proofLen} chars | FAQ-schema: ${faqSchemaLen} chars | Breadcrumb: ${breadcrumbLen} chars`);

      // ── Quality Gate: Pre-publish validation ───────────────────────
      const quality = assessPublishQuality(pageData, fields);
      console.log(`  Quality: ${quality.score}% (${quality.grade}) — ${quality.gates_passed}/${quality.gate_count} gates passed`);

      if (!quality.publishable) {
        const failedGates = Object.entries(quality.gates)
          .filter(([, v]) => !v)
          .map(([k]) => k);
        console.log(`  ⛔ BLOCKED: Failed gates: ${failedGates.join(", ")}`);
        for (const err of quality.errors) {
          console.log(`     • ${err.gate}: ${err.message}`);
        }
        errors++;
        continue;
      }

      if (quality.warnings.length > 0) {
        for (const w of quality.warnings) {
          console.log(`  ⚠ ${w.gate}: ${w.message}`);
        }
      }

      // Sanitize fields: converts newlines to " | " for single-line fields,
      // filters to known schema fields only
      const sanitized = sanitizeWebflowFields(fields);

      // Remove slug and name — never overwrite these on existing items
      delete sanitized.slug;
      delete sanitized.name;

      // Build update payload: sanitized content + template flags
      const updateFields = {
        ...sanitized,
        // Template flags (not in renderWebflowFields but needed for CMS)
        "index-page": true,
        "lane-mode-enabled": true,
        "hero-map-enabled": true,
        "hero-video-enabled": false,
      };

      if (dryRun) {
        console.log(`  [DRY RUN] Would update with ${Object.keys(updateFields).length} fields`);
        console.log(`  Body preview:`);
        console.log(`  ${bodyContent.substring(0, 300)}...`);
        console.log(`  Traditional comparison preview:`);
        console.log(`  ${(fields["traditional-ltl"] || "").substring(0, 200)}...`);
        console.log("");
      } else {
        await updateItem(item.id, updateFields);
        console.log(`  ✅ Updated successfully`);
        updated++;

        // Rate limit: 60 requests/minute for Webflow API
        await new Promise(r => setTimeout(r, 1100));
      }
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`  Results: ${updated} updated, ${errors} errors`);

  if (!dryRun && updated > 0) {
    console.log(`  Publishing site...`);
    try {
      await publishSite();
      console.log(`  ✅ Site published successfully`);
    } catch (err) {
      console.log(`  ❌ Publish error: ${err.message}`);
    }
  }

  console.log(`═══════════════════════════════════════════════════════════`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
