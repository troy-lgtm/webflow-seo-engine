#!/usr/bin/env node
/**
 * update_lane_content.js — Update existing lane pages with improved content
 *
 * Regenerates body-content, hero-headline, subheadline, and all CMS fields
 * using the canonical pipeline, then pushes updates via the publisher adapter.
 *
 * ARCHITECTURE (post-migration):
 *   buildLaneKnowledge() → buildCanonicalLanePageData() → buildPublishContract()
 *     → assessPublishQuality() → assessLaneAdmission() → webflow adapter → Webflow CMS API
 *
 * The publish contract is the CMS-neutral boundary. The Webflow adapter maps
 * semantic contract fields to Webflow CMS field names. This script no longer
 * constructs Webflow field payloads directly.
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
import { assessPublishQuality } from "../lib/lane-page-validator.js";
import { buildPublishContract, contractToRenderedFields } from "../lib/publishers/publish-contract.js";
import { adaptForPublish, publish as webflowPublish, publishSite as webflowPublishSite, ADAPTER_ID } from "../lib/publishers/webflow-adapter.js";
import { assessLaneAdmission } from "../lib/lane-admission-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load cities.json for state resolution
const CITIES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "cities.json"), "utf-8"));

const API_TOKEN = process.env.WEBFLOW_API_TOKEN || "f03f437275327315aee1f3a8e530726987e9264f4074b3bd49eadb3e0f6dde84";
const COLLECTION_ID = process.env.WEBFLOW_LANE_COLLECTION_ID || "68dbd9b0badadf2b8fa9a397";
const SITE_ID = process.env.WEBFLOW_SITE_ID || "688f073c4367c4fcf9651e08";
const DOMAIN_IDS = ["689442045dc003d002d08285", "689442045dc003d002d08271"];

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

/**
 * Resolve a city name to "City, ST" format using cities.json lookup.
 * Falls back to just the city name if state not found.
 */
function resolveWithState(cityName) {
  const key = cityName.toLowerCase().trim();
  if (CITIES[key]) return cityName;
  for (const k of Object.keys(CITIES)) {
    if (k.startsWith(key + ",") || k.startsWith(key + " ")) {
      const parts = k.split(",");
      if (parts.length >= 2) {
        return `${cityName}, ${parts[1].trim().toUpperCase()}`;
      }
    }
  }
  return cityName;
}

function parseLaneFromSlug(slug) {
  const clean = slug.replace(/-[0-9a-f]{4,8}$/i, "");
  const stripped = clean.replace(/^ltl-freight-/, "");
  const toIdx = stripped.indexOf("-to-");
  if (toIdx < 0) return null;

  const originSlug = stripped.substring(0, toIdx);
  const destSlug = stripped.substring(toIdx + 4);

  function titleCase(s) {
    return s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  return {
    origin: resolveWithState(titleCase(originSlug)),
    destination: resolveWithState(titleCase(destSlug)),
  };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Lane Content Updater — Publisher Adapter Pipeline");
  console.log(`  Adapter: ${ADAPTER_ID}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE UPDATE"}`);
  console.log(`Target slugs: ${targetSlugs ? targetSlugs.join(", ") : "auto-select"}`);
  console.log(`Limit: ${limit}`);
  console.log("");

  // Fetch items
  let items = [];
  if (targetSlugs) {
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const page = await fetchItems(offset, 100);
      total = page.pagination?.total || 0;
      items.push(...(page.items || []));
      offset += 100;
      if (offset >= 300) break;
    }
    items = items.filter(item => targetSlugs.includes(item.fieldData?.slug));
  } else {
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const page = await fetchItems(offset, 100);
      total = page.pagination?.total || 0;
      items.push(...(page.items || []));
      offset += 100;
      if (offset >= 500) break;
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
      const itemMode = item.fieldData?.mode || "LTL";

      // ── Step 1: Build canonical lane knowledge ────────────────────
      const knowledge = buildLaneKnowledge({
        origin: parsed.origin,
        destination: parsed.destination,
        mode: itemMode,
      });

      // ── Step 2: Build canonical page data ─────────────────────────
      const pageData = buildCanonicalLanePageData(knowledge, {
        corridor_hub: null,
        related_lanes: [],
        tool_link: "https://www.wearewarp.com/quote",
        data_link: null,
      });

      // ── Step 3: Build CMS-neutral publish contract ────────────────
      const contract = buildPublishContract(pageData);

      // ── Step 4: Map contract to rendered fields for quality gate ───
      const renderedFields = contractToRenderedFields(contract);

      // Show generation stats — read from contract (CMS-neutral), not rendered fields
      const bodyContent = contract.content.body_text;
      const headline = contract.hero.headline;
      const subheadline = contract.hero.subhead;
      const faqSchemaLen = (contract.content.primary_content_html || "").length;
      const proofLen = (contract.content.proof_html || "").length;
      const tradLen = (contract.comparison.traditional_text || "").length;
      const warpLen = (contract.comparison.warp_text || "").length;
      const breadcrumbLen = (contract.schema.structured_data_html || "").length;

      console.log(`──────────────────────────────────────────────────────`);
      console.log(`  📦 ${slug}`);
      console.log(`  Mode: ${itemMode}`);
      console.log(`  H1: ${headline}`);
      console.log(`  Sub: ${subheadline.substring(0, 120)}...`);
      console.log(`  Body: ${bodyContent.length} chars (was ${(item.fieldData?.["body-content"] || "").length})`);
      console.log(`  Paragraphs: ${bodyContent.split("\n\n").length}`);
      console.log(`  Comparison: traditional=${tradLen} chars, warp=${warpLen} chars`);
      console.log(`  Proof: ${proofLen} chars | FAQ-schema: ${faqSchemaLen} chars | Breadcrumb: ${breadcrumbLen} chars`);

      // ── Step 5: Quality gate (operates on canonical + rendered) ────
      const quality = assessPublishQuality(pageData, renderedFields);
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

      // ── Step 5b: Admission gate (page worthiness check) ────────────
      const admission = assessLaneAdmission(knowledge, pageData);
      console.log(`  Admission: ${admission.score}% (${admission.grade}) — ${admission.admitted ? "ADMITTED" : "REJECTED"}`);

      if (!admission.admitted) {
        console.log(`  ⛔ ADMISSION DENIED:`);
        for (const r of admission.rejections) {
          console.log(`     • ${r.dimension}: ${r.reason}`);
        }
        errors++;
        continue;
      }

      // ── Step 6: Attach quality report to contract ─────────────────
      contract.quality = quality;

      // ── Step 7: Adapt for Webflow CMS via adapter ─────────────────
      const updateFields = adaptForPublish(contract);

      if (dryRun) {
        console.log(`  [DRY RUN] Would update with ${Object.keys(updateFields).length} fields (adapter: ${ADAPTER_ID})`);
        console.log(`  Body preview:`);
        console.log(`  ${bodyContent.substring(0, 300)}...`);
        console.log(`  Traditional comparison preview:`);
        console.log(`  ${(contract.comparison.traditional_text || "").substring(0, 200)}...`);
        console.log("");
      } else {
        // ── Step 8: Push to Webflow via adapter ─────────────────────
        await webflowPublish({
          itemId: item.id,
          fields: updateFields,
          collectionId: COLLECTION_ID,
          apiToken: API_TOKEN,
        });
        console.log(`  ✅ Updated successfully (adapter: ${ADAPTER_ID})`);
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
      await webflowPublishSite({
        siteId: SITE_ID,
        apiToken: API_TOKEN,
        domainIds: DOMAIN_IDS,
      });
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
