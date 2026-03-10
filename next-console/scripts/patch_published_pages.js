#!/usr/bin/env node

/**
 * Patch Published Pages — Full Operational Content Update
 *
 * Updates all previously-published Webflow CMS items with:
 *   1. Full operational body content (transit details, operations, pricing)
 *   2. Expanded CSS to hide generic marketing template sections
 *   3. Visible FAQ HTML + FAQPage JSON-LD
 *   4. BreadcrumbList + Service + Organization JSON-LD
 *   5. All previously-missing CMS fields (origin, destination, mode, CTAs, etc.)
 *
 * Usage:
 *   node scripts/patch_published_pages.js              # Dry run (default)
 *   node scripts/patch_published_pages.js --live       # LIVE: PATCH + re-publish
 *   node scripts/patch_published_pages.js --live --skip-publish  # PATCH only
 *
 * Requires env vars: WEBFLOW_API_TOKEN, WEBFLOW_LANE_COLLECTION_ID
 */

import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";
import { runFullValidation } from "../lib/lane-page-validator.js";
import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import { renderLanePageBody, renderLanePageHtml, renderFaqSchemaEmbed, renderBreadcrumbSchemaEmbed, renderWebflowFields } from "../lib/render-lane-page.js";

const __filename = fileURLToPath(import.meta.url);
const ROOT = getProjectRoot();
config({ path: path.join(ROOT, ".env.local") });

const args = process.argv.slice(2);
const isLive = args.includes("--live");
const skipPublish = args.includes("--skip-publish");
const isDryRun = !isLive;

// --- Lane intelligence (delegated to extracted module) ---

function enrichLaneInline(page) {
  if (!page?.lane) return;
  const knowledge = buildLaneKnowledge(page.lane);
  page.lane_stats = knowledge.lane_stats;
  page.network_proof = knowledge.network_proof;
}

// --- Content builders (delegated to extracted renderer) ---

function buildBodyContent(page) {
  const knowledge = buildLaneKnowledge(page.lane);
  knowledge.origin = page.lane.origin;
  knowledge.destination = page.lane.destination;
  knowledge.segment = page.target_segment || "smb";
  const canonicalData = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null, related_lanes: [], tool_link: "https://www.wearewarp.com/quote", data_link: null,
  });
  return renderLanePageHtml(canonicalData);
}

function buildFaqSchemaEmbed(page) {
  const knowledge = buildLaneKnowledge(page.lane);
  knowledge.origin = page.lane.origin;
  knowledge.destination = page.lane.destination;
  knowledge.segment = page.target_segment || "smb";
  const canonicalData = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null, related_lanes: [], tool_link: "https://www.wearewarp.com/quote", data_link: null,
  });
  return renderFaqSchemaEmbed(canonicalData);
}

function buildBreadcrumbSchemaEmbed(page) {
  const knowledge = buildLaneKnowledge(page.lane);
  knowledge.origin = page.lane.origin;
  knowledge.destination = page.lane.destination;
  knowledge.segment = page.target_segment || "smb";
  const canonicalData = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null, related_lanes: [], tool_link: "https://www.wearewarp.com/quote", data_link: null,
  });
  return renderBreadcrumbSchemaEmbed(canonicalData);
}

// --- Build page from published entry ---

function buildPageFromEntry(entry) {
  const origin = `${entry.origin_city}, ${entry.origin_state}`;
  const destination = `${entry.destination_city}, ${entry.destination_state}`;
  const mode = entry.mode || "LTL";
  const oCity = entry.origin_city;
  const dCity = entry.destination_city;

  const page = {
    slug: entry.slug,
    seo_title: entry.seo_title || `${origin} to ${destination} ${mode} Freight Quotes | WARP`,
    h1: entry.h1 || `${origin} to ${destination} ${mode} freight quotes`,
    meta_description: `Compare ${mode} freight rates from ${oCity} to ${dCity}. Get instant quotes, estimated transit times, and book freight in minutes with WARP.`,
    target_segment: entry.segment || "smb",
    lane: { origin, destination, mode },
    lane_stats: {},
    network_proof: {},
    cta_primary: "Book 15-min Fit Call",
    cta_secondary: "Get Instant Quote",
    cta_primary_url: "https://www.wearewarp.com/book",
    cta_secondary_url: "https://www.wearewarp.com/quote",
    contrast: {
      headline: `Why ${mode} shippers switch from brokers to WARP`,
      points: [
        { metric: "Quote speed", legacy: "2–24 hours", warp: "Under 2 minutes" },
        { metric: "Carrier comparison", legacy: "Manual spreadsheets", warp: "Side-by-side dashboard" },
        { metric: "Booking", legacy: "Email chains, 30–60 min", warp: "One-click from quote to BOL" },
        { metric: "Tracking", legacy: "Call carrier for updates", warp: "Real-time dashboard" },
        { metric: "Exception handling", legacy: "Reactive, hours", warp: "Proactive alerts, minutes" },
      ],
      bottom_line: `Shipping ${mode} from ${oCity} to ${dCity} with WARP eliminates manual freight operations.`,
    },
  };

  enrichLaneInline(page);
  const stats = page.lane_stats;

  page.intro = `${mode} freight from ${origin} to ${destination} covers approximately ${stats.estimated_distance_miles.toLocaleString()} miles with estimated transit of ${stats.estimated_transit_days_range.min}–${stats.estimated_transit_days_range.max} business days. WARP's carrier network includes ${page.network_proof.estimated_carrier_count}+ providers with cross-dock facilities at ${page.network_proof.nearest_cross_docks.slice(0, 3).join(", ")}. Get instant lane-specific quotes, compare carriers, and book in minutes.`;
  page.problem_section = `${mode} shippers on the ${oCity} to ${dCity} corridor struggle with inconsistent transit times, opaque pricing, and fragmented visibility across multiple carriers.`;
  page.solution_section = `WARP provides instant ${mode} quotes on the ${oCity} to ${dCity} lane with real-time carrier comparison, one-click booking, and proactive exception management.`;
  page.proof_section = `Validate this lane with a controlled pilot: ${origin} to ${destination}. Track quote response time, transit predictability, and exception rate across ${page.network_proof.estimated_carrier_count} active carriers on this ${stats.estimated_distance_miles}-mile corridor.`;

  // FAQs
  const FAQ_KEYS = ["transit", "cost", "pilot", "tracking", "equipment"];
  page.faq = [
    { q: `How long does ${mode} freight take from ${oCity} to ${dCity}?`, a: `Estimated transit: ${stats.estimated_transit_days_range.min}–${stats.estimated_transit_days_range.max} business days on this ${stats.estimated_distance_miles}-mile lane.` },
    { q: `How much does ${mode} shipping from ${oCity} to ${dCity} cost?`, a: `Estimated rates: $${stats.estimated_rate_range_usd.low.toLocaleString()}–$${stats.estimated_rate_range_usd.high.toLocaleString()} depending on freight details.` },
    { q: `How fast can we launch a ${mode} pilot from ${oCity} to ${dCity}?`, a: `Most teams scope a single-lane pilot within days. Start this corridor, measure results, then expand.` },
    { q: `How does WARP handle tracking on the ${oCity} to ${dCity} lane?`, a: `Real-time visibility with scan events at pickup, in-transit, and delivery. Exception alerts within 30 minutes.` },
    { q: `What equipment is available for ${mode} freight from ${oCity} to ${dCity}?`, a: `Common equipment: ${stats.common_equipment.join(", ")}. Availability varies by season.` },
  ];

  // Schemas
  page.schema_breadcrumb = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "WARP", item: "https://www.wearewarp.com" },
    { "@type": "ListItem", position: 2, name: `${mode} Freight`, item: `https://www.wearewarp.com/guides/${mode.toLowerCase()}` },
    { "@type": "ListItem", position: 3, name: `${oCity} to ${dCity}` },
  ]};
  page.schema_service = { "@context": "https://schema.org", "@type": "Service", name: `${mode} Freight — ${oCity} to ${dCity}`, provider: { "@type": "Organization", name: "WARP", url: "https://www.wearewarp.com" }, areaServed: [origin, destination] };
  page.schema_organization = { "@context": "https://schema.org", "@type": "Organization", name: "WARP", url: "https://www.wearewarp.com" };

  return page;
}

function buildAllFields(page) {
  const knowledge = buildLaneKnowledge(page.lane);
  knowledge.origin = page.lane.origin;
  knowledge.destination = page.lane.destination;
  knowledge.segment = page.target_segment || "smb";
  const canonicalData = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null, related_lanes: [], tool_link: "https://www.wearewarp.com/quote", data_link: null,
  });
  return renderWebflowFields(canonicalData);
}

// --- Webflow API helpers ---

async function patchItem(collectionId, itemId, fields) {
  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) throw new Error("Missing WEBFLOW_API_TOKEN");
  const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${WEBFLOW_API_TOKEN}`, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ fieldData: fields }),
  });
  if (!res.ok) throw new Error(`Webflow PATCH ${res.status}: ${await res.text()}`);
  return res.json();
}

async function publishItems(collectionId, itemIds) {
  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) throw new Error("Missing WEBFLOW_API_TOKEN");
  const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WEBFLOW_API_TOKEN}`, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ itemIds }),
  });
  if (!res.ok) throw new Error(`Webflow publish ${res.status}: ${await res.text()}`);
  return res.json();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// --- Main ---

async function main() {
  console.log("=== WARP Patch Published Pages (Full Operational Content) ===");
  console.log(`  Mode: ${isDryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`  Publish: ${skipPublish ? "SKIP" : "YES"}`);
  console.log("");

  const published = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "published_pages.json"), "utf-8"));
  const toProcess = published.filter((p) => p.webflow_item_id && !p.dry_run);
  console.log(`  Found ${toProcess.length} live published pages to patch.`);

  if (toProcess.length === 0) {
    console.log("  Nothing to patch.");
    process.exit(0);
  }

  const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID;
  if (!collectionId && !isDryRun) {
    console.error("  ERROR: Missing WEBFLOW_LANE_COLLECTION_ID");
    process.exit(1);
  }

  const report = { patched: [], failed: [], skipped: [] };

  for (const entry of toProcess) {
    const { slug, webflow_item_id } = entry;
    console.log(`\n  [${slug}] item=${webflow_item_id}`);

    try {
      const page = buildPageFromEntry(entry);
      const fields = buildAllFields(page);
      const fieldCount = Object.keys(fields).length;

      // --- LANE PAGE VALIDATION GATE ---
      const bodyHtml = buildBodyContent(page);
      const faqEmbed = buildFaqSchemaEmbed(page);
      const breadcrumbEmbed = buildBreadcrumbSchemaEmbed(page);
      const validation = runFullValidation(page, bodyHtml, faqEmbed, breadcrumbEmbed);

      // Store validation result on the page
      page.quality_score = validation.quality_score;
      page.banned_content_scan_result = validation.banned_content_found.length === 0 ? "clean" : validation.banned_content_found;
      page.rendered_html_validation_result = validation.valid ? "passed" : validation.errors.map(e => e.message);

      if (!validation.valid) {
        const failedGates = Object.entries(validation.gates).filter(([, v]) => !v).map(([k]) => k);
        console.log(`    ⚠ Validation WARN: ${failedGates.join(", ")} | score: ${validation.quality_score} (continuing — remediation patch)`);
      } else {
        console.log(`    ✓ Validation passed (score: ${validation.quality_score})`);
      }

      const validationSummary = {
        valid: validation.valid,
        quality_score: validation.quality_score,
        gates: validation.gates,
        errors: validation.errors.slice(0, 5).map(e => e.message),
        banned_content: page.banned_content_scan_result,
      };

      if (isDryRun) {
        console.log(`    DRY RUN: Would PATCH ${fieldCount} fields`);
        console.log(`    body-content length: ${fields["body-content"].length} chars`);
        console.log(`    faq-schema length: ${fields["faq-schema"].length} chars`);
        console.log(`    distance: ${page.lane_stats.estimated_distance_miles} mi`);
        console.log(`    transit: ${page.lane_stats.estimated_transit_days_range.min}–${page.lane_stats.estimated_transit_days_range.max} days`);
        console.log(`    rate: $${page.lane_stats.estimated_rate_range_usd.low}–$${page.lane_stats.estimated_rate_range_usd.high}`);
        report.patched.push({ slug, fields: fieldCount, dryRun: true, validation: validationSummary });
      } else {
        await patchItem(collectionId, webflow_item_id, fields);
        console.log(`    ✓ PATCHED ${fieldCount} fields`);
        report.patched.push({ slug, itemId: webflow_item_id, fields: fieldCount, validation: validationSummary });
        await sleep(1100); // Webflow rate limit: 60 req/min
      }
    } catch (err) {
      console.log(`    ✗ FAILED: ${err.message}`);
      report.failed.push({ slug, error: err.message });
    }
  }

  // Re-publish all patched items
  if (!isDryRun && !skipPublish && report.patched.length > 0) {
    console.log(`\n  Re-publishing ${report.patched.length} items...`);
    try {
      const ids = report.patched.map((p) => p.itemId).filter(Boolean);
      if (ids.length > 0) {
        await publishItems(collectionId, ids);
        console.log("    ✓ All items re-published.");
      }
    } catch (err) {
      console.log(`    ✗ Publish failed: ${err.message}`);
    }
  }

  // Write report
  const reportDir = path.join(ROOT, "artifacts", "patch_report");
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "patch_report.json"), JSON.stringify(report, null, 2));

  console.log("\n=== Summary ===");
  console.log(`  Patched:  ${report.patched.length}`);
  console.log(`  Failed:   ${report.failed.length}`);
  console.log(`  Report:   ${path.join(reportDir, "patch_report.json")}`);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
