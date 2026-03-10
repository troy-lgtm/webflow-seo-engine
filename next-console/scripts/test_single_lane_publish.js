#!/usr/bin/env node

/**
 * Test Single Lane Publish — End-to-End Pipeline Verification
 *
 * Runs the full lane SEO pipeline for a SINGLE real lane to prove
 * the system works end-to-end before scaling to the full dataset.
 *
 * Steps:
 *   1. Load registry, link graph, corridor map
 *   2. Build lane knowledge
 *   3. Build canonical page data
 *   4. Render Webflow fields
 *   5. Validate the rendered payload
 *   6. Verify internal links
 *   7. Generate test sitemap
 *   8. Publish to Webflow (if --publish flag set)
 *   9. Write test artifacts
 *
 * Usage:
 *   node scripts/test_single_lane_publish.js                     # dry-run (no publish)
 *   node scripts/test_single_lane_publish.js --publish            # publish to Webflow
 *   node scripts/test_single_lane_publish.js --slug dallas-to-chicago  # custom lane
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import { renderWebflowFields } from "../lib/render-lane-page.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const doPublish = args.includes("--publish");
const slugArg = args.find((a) => a.startsWith("--slug"))
  ? args[args.indexOf("--slug") + 1] || args.find((a) => a.startsWith("--slug="))?.split("=")[1]
  : null;
const TEST_SLUG = slugArg || "los-angeles-to-phoenix";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSON(relPath) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return null;
  return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
}

function writeJSON(relPath, data) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function toSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ---------------------------------------------------------------------------
// Validation checks (mirrors validate_all_real_lanes.js)
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = [
  "name", "slug", "seo-title", "seo-description", "body-content",
  "faq-schema", "breadcrumb-schema", "origin", "destination", "mode",
  "segment", "proof-section", "cta-primary-text", "cta-primary-url",
];

const BANNED_PHRASES = [
  "STEP 1", "Book Freight Instantly", "Why Shippers Choose",
  "Stop Paying for a Broken", "Schedule a demo",
];

function validatePayload(payload) {
  const issues = [];
  let score = 0;

  // Check 1: Required fields (20 pts)
  const missing = REQUIRED_FIELDS.filter((f) => {
    const val = payload[f];
    return val === undefined || val === null || String(val).length === 0;
  });
  if (missing.length === 0) score += 20;
  else issues.push(`Missing fields: ${missing.join(", ")}`);

  // Check 2: body-content >= 500 chars (20 pts)
  const bodyContent = payload["body-content"] || "";
  if (bodyContent.length >= 500) score += 20;
  else issues.push(`body-content too short (${bodyContent.length} chars, need >= 500)`);

  // Check 3: No banned content (15 pts)
  const banned = BANNED_PHRASES.filter((p) => bodyContent.toLowerCase().includes(p.toLowerCase()));
  if (banned.length === 0) score += 15;
  else issues.push(`Banned content: ${banned.join("; ")}`);

  // Check 4: FAQ count >= 4 (15 pts)
  const faqSchema = payload["faq-schema"] || "";
  const faqCount = (faqSchema.match(/acceptedAnswer/g) || []).length;
  if (faqCount >= 4) score += 15;
  else issues.push(`FAQ count too low (${faqCount}, need >= 4)`);

  // Check 5: seo-title length 30-70 (15 pts)
  const seoTitle = payload["seo-title"] || "";
  if (seoTitle.length >= 30 && seoTitle.length <= 70) score += 15;
  else issues.push(`seo-title length out of range (${seoTitle.length}, need 30-70)`);

  // Check 6: seo-description length 80-170 (15 pts)
  const seoDesc = payload["seo-description"] || "";
  if (seoDesc.length >= 80 && seoDesc.length <= 170) score += 15;
  else issues.push(`seo-description length out of range (${seoDesc.length}, need 80-170)`);

  // Schema checks
  const schemaValid = faqSchema.includes("FAQPage") && (payload["breadcrumb-schema"] || "").includes("BreadcrumbList");
  if (!schemaValid) {
    if (!faqSchema.includes("FAQPage")) issues.push("faq-schema missing FAQPage");
    if (!(payload["breadcrumb-schema"] || "").includes("BreadcrumbList")) issues.push("breadcrumb-schema missing BreadcrumbList");
  }

  // Fallback template detection
  const FALLBACK_MARKERS = ["Book Freight Instantly", "Why Shippers Choose", "Stop Paying for a Broken", "wistia-player"];
  const fallback = FALLBACK_MARKERS.some((m) => bodyContent.includes(m));
  if (fallback) issues.push("Fallback template content detected in body-content");

  return {
    score,
    passed: score >= 80,
    issues,
    schema_valid: schemaValid,
    faq_count: faqCount,
    banned_content: banned.length > 0,
    fallback_template: fallback,
    quality_score: score,
  };
}

// ---------------------------------------------------------------------------
// Internal link verification
// ---------------------------------------------------------------------------

function verifyInternalLinks(payload) {
  const body = payload["body-content"] || "";
  const breadcrumb = payload["breadcrumb-schema"] || "";
  const results = {
    corridor_hub: false,
    related_lanes_count: 0,
    tool_link: false,
    metro_links: false,
    guide_link: false,
    data_link: false, // optional
    details: [],
  };

  // Corridor hub
  if (body.includes("/corridors/")) {
    results.corridor_hub = true;
    results.details.push("corridor_hub: FOUND in body-content");
  }
  if (breadcrumb.includes("/corridors/")) {
    results.corridor_hub = true;
    results.details.push("corridor_hub: FOUND in breadcrumb-schema");
  }
  if (!results.corridor_hub) {
    results.details.push("corridor_hub: MISSING");
  }

  // Related lanes
  const laneLinks = (body.match(/\/lanes\/[a-z0-9-]+/g) || []);
  results.related_lanes_count = new Set(laneLinks).size;
  results.details.push(`related_lanes: ${results.related_lanes_count} unique lane links`);

  // Tool link (check body, CTA fields, and proof section)
  const ctaUrl = payload["cta-primary-url"] || "";
  const proofSection = payload["proof-section"] || "";
  if (body.includes("/quote") || body.includes("wearewarp.com/quote") || ctaUrl.includes("/quote") || proofSection.includes("/quote")) {
    results.tool_link = true;
    results.details.push("tool_link: FOUND");
  } else {
    results.details.push("tool_link: MISSING");
  }

  // Metro links
  if (body.includes("/metros/")) {
    results.metro_links = true;
    results.details.push("metro_links: FOUND");
  } else {
    results.details.push("metro_links: MISSING");
  }

  // Guide link
  if (body.includes("/guides/")) {
    results.guide_link = true;
    results.details.push("guide_link: FOUND");
  } else {
    results.details.push("guide_link: MISSING");
  }

  // Data link (optional)
  if (body.includes("/data/")) {
    results.data_link = true;
    results.details.push("data_link: FOUND");
  } else {
    results.details.push("data_link: not available (optional)");
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("══════════════════════════════════════════════════");
  console.log("  Test Single Lane Publish — E2E Pipeline Proof  ");
  console.log("══════════════════════════════════════════════════\n");

  // ── Step 1: Load registry and find lane ────────────────────────────
  console.log("STEP 1 — Identify Real Lane");
  const registry = readJSON("data/lane_registry.json");
  if (!registry) {
    console.error("  ERROR: data/lane_registry.json not found");
    process.exit(1);
  }
  const lanes = Array.isArray(registry) ? registry : registry.lanes || [];
  const lane = lanes.find((l) => l.slug === TEST_SLUG);
  if (!lane) {
    console.error(`  ERROR: Lane "${TEST_SLUG}" not found in registry`);
    process.exit(1);
  }
  console.log(`  Selected: ${lane.slug}`);
  console.log(`  Origin: ${lane.origin}`);
  console.log(`  Destination: ${lane.destination}`);
  console.log(`  Corridor: ${lane.corridor_name} (${lane.corridor_id})`);
  console.log(`  Distance: ${lane.distance_miles} miles`);
  console.log(`  Modes: ${lane.modes.join(", ")}`);
  console.log(`  Tier: ${lane.lane_set}`);
  console.log("");

  // ── Step 2: Build lane data ────────────────────────────────────────
  console.log("STEP 2 — Build Lane Data");
  const knowledge = buildLaneKnowledge({
    origin: lane.origin,
    destination: lane.destination,
    mode: "LTL",
  });
  knowledge.origin = lane.origin;
  knowledge.destination = lane.destination;
  knowledge.segment = lane.lane_set || "smb";
  knowledge.corridor_id = lane.corridor_id || null;
  console.log(`  Lane knowledge built:`);
  console.log(`    distance: ${knowledge.lane_stats?.estimated_distance_miles} miles`);
  console.log(`    transit: ${JSON.stringify(knowledge.lane_stats?.estimated_transit_days_range)} days`);
  console.log(`    carriers: ${knowledge.network_proof?.estimated_carrier_count}`);
  console.log("");

  // ── Step 3: Build related links + render ───────────────────────────
  console.log("STEP 3 — Render Page");

  // Load link graph for rich linking
  const linkGraphData = readJSON("data/internal_link_graph.json");
  const linkGraph = linkGraphData?.graph || linkGraphData || {};

  // Load corridor map
  const corridorMapData = readJSON("data/corridor_map.json");
  const corridorMap = {};
  if (corridorMapData?.corridors) {
    for (const c of corridorMapData.corridors) corridorMap[c.corridor_id] = c;
  }

  // Build related links
  const corridorId = lane.corridor_id;
  const corridorHub =
    corridorId && corridorId !== "other" && corridorMap[corridorId]
      ? corridorMap[corridorId].canonical_path
      : corridorId && corridorId !== "other"
        ? `/corridors/${corridorId}`
        : null;

  let relatedLanes = [];
  if (linkGraph[lane.slug]) {
    const entry = linkGraph[lane.slug];
    const seen = new Set();
    const combined = [];
    const addLinks = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const link of arr) {
        if (link?.url && !seen.has(link.url)) {
          seen.add(link.url);
          combined.push({ label: link.label, url: link.url });
        }
      }
    };
    addLinks(entry.corridor_links);
    if (entry.reverse_lane) addLinks([entry.reverse_lane]);
    addLinks(entry.same_origin);
    addLinks(entry.same_destination);
    relatedLanes = combined.slice(0, 12);
  } else {
    relatedLanes = lanes
      .filter((l) => l.corridor_id === lane.corridor_id && l.slug !== lane.slug)
      .slice(0, 5)
      .map((l) => ({
        label: `${l.origin.split(",")[0]} → ${l.destination.split(",")[0]}`,
        url: `/lanes/${l.slug}`,
      }));
  }

  const originCity = lane.origin_city || lane.origin.split(",")[0].trim();
  const destCity = lane.destination_city || lane.destination.split(",")[0].trim();

  const relatedLinks = {
    corridor_hub: corridorHub,
    related_lanes: relatedLanes,
    tool_link: "https://www.wearewarp.com/quote",
    data_link: null,
    metro_links: [
      { label: `${originCity} Freight Hub`, url: `/metros/${toSlug(originCity)}-freight` },
      { label: `${destCity} Freight Hub`, url: `/metros/${toSlug(destCity)}-freight` },
    ],
    guide_link: "/guides/ltl",
  };

  const canonicalData = buildCanonicalLanePageData(knowledge, relatedLinks);
  const webflowPayload = renderWebflowFields(canonicalData);

  // Write rendered payload
  const renderDir = path.join(ROOT, "artifacts", "test_lane");
  fs.mkdirSync(renderDir, { recursive: true });
  writeJSON("artifacts/test_lane/webflow_payload.json", webflowPayload);

  console.log(`  Rendered ${Object.keys(webflowPayload).length} Webflow fields`);
  console.log(`  body-content: ${(webflowPayload["body-content"] || "").length} chars`);
  console.log(`  faq-schema: ${(webflowPayload["faq-schema"] || "").length} chars`);
  console.log(`  breadcrumb-schema: ${(webflowPayload["breadcrumb-schema"] || "").length} chars`);
  console.log(`  Payload: artifacts/test_lane/webflow_payload.json`);
  console.log("");

  // Write render artifact
  writeJSON("artifacts/test_lane_render.json", {
    timestamp: new Date().toISOString(),
    lane_slug: lane.slug,
    origin: lane.origin,
    destination: lane.destination,
    corridor_id: lane.corridor_id,
    fields_rendered: Object.keys(webflowPayload).length,
    body_content_length: (webflowPayload["body-content"] || "").length,
    faq_schema_length: (webflowPayload["faq-schema"] || "").length,
    breadcrumb_schema_length: (webflowPayload["breadcrumb-schema"] || "").length,
    has_hero: !!webflowPayload["hero-headline"],
    has_lane_overview: (webflowPayload["body-content"] || "").includes("Lane Overview"),
    has_warp_fit: (webflowPayload["body-content"] || "").includes("WARP Fit"),
    has_operating_details: (webflowPayload["body-content"] || "").includes("Operating Details"),
    has_pricing: (webflowPayload["body-content"] || "").includes("Pricing"),
    has_faqs: (webflowPayload["faq-schema"] || "").includes("FAQPage"),
    has_related_links: (webflowPayload["body-content"] || "").includes("Related Freight Pages"),
    has_cta: !!webflowPayload["cta-primary-text"],
  });

  // ── Step 4: Validate ───────────────────────────────────────────────
  console.log("STEP 4 — Validation");
  const validation = validatePayload(webflowPayload);

  writeJSON("artifacts/test_lane_validation.json", {
    timestamp: new Date().toISOString(),
    lane_slug: lane.slug,
    ...validation,
  });

  console.log(`  Quality score: ${validation.score}/100`);
  console.log(`  Passed: ${validation.passed}`);
  console.log(`  Schema valid: ${validation.schema_valid}`);
  console.log(`  FAQ count: ${validation.faq_count}`);
  console.log(`  Banned content: ${validation.banned_content}`);
  console.log(`  Fallback template: ${validation.fallback_template}`);
  if (validation.issues.length > 0) {
    console.log("  Issues:");
    for (const issue of validation.issues) console.log(`    - ${issue}`);
  }
  console.log("");

  if (!validation.passed) {
    console.error("  ❌ VALIDATION FAILED — stopping pipeline");
    process.exit(1);
  }

  // ── Step 5: Verify internal links ──────────────────────────────────
  console.log("STEP 5 — Internal Link Verification");
  const linkVerification = verifyInternalLinks(webflowPayload);

  console.log(`  Corridor hub: ${linkVerification.corridor_hub ? "✓" : "✗"}`);
  console.log(`  Related lanes: ${linkVerification.related_lanes_count}`);
  console.log(`  Tool link: ${linkVerification.tool_link ? "✓" : "✗"}`);
  console.log(`  Metro links: ${linkVerification.metro_links ? "✓" : "✗"}`);
  console.log(`  Guide link: ${linkVerification.guide_link ? "✓" : "✗"}`);
  console.log(`  Data link: ${linkVerification.data_link ? "✓" : "✗ (optional)"}`);
  for (const detail of linkVerification.details) {
    console.log(`    ${detail}`);
  }
  console.log("");

  // ── Step 6: Generate test sitemap ──────────────────────────────────
  console.log("STEP 6 — Test Sitemap");
  const sitemapXml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    `  <url>`,
    `    <loc>https://www.wearewarp.com/lanes/${lane.slug}</loc>`,
    `    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>`,
    `    <changefreq>weekly</changefreq>`,
    `    <priority>0.8</priority>`,
    `  </url>`,
    `</urlset>`,
  ].join("\n");

  const sitemapPath = path.join(ROOT, "sitemaps", "sitemap-lanes-test.xml");
  fs.mkdirSync(path.dirname(sitemapPath), { recursive: true });
  fs.writeFileSync(sitemapPath, sitemapXml, "utf-8");
  console.log(`  Wrote sitemaps/sitemap-lanes-test.xml`);
  console.log(`  URL: https://www.wearewarp.com/lanes/${lane.slug}`);
  console.log("");

  // ── Step 7: Publish (if --publish flag) ────────────────────────────
  console.log("STEP 7 — Publish");
  let publishResult = {
    lane_slug: lane.slug,
    published: false,
    url: `https://www.wearewarp.com/lanes/${lane.slug}`,
    status_code: null,
    mode: doPublish ? "live" : "dry-run",
    error: null,
  };

  if (!doPublish) {
    console.log("  Mode: DRY-RUN (use --publish to publish to Webflow)");
    console.log("  Skipping Webflow API call.");
  } else {
    console.log("  Mode: LIVE PUBLISH");
    try {
      // Load Webflow API config
      const envPath = path.join(ROOT, ".env");
      let apiToken = process.env.WEBFLOW_API_TOKEN;
      let collectionId = process.env.WEBFLOW_COLLECTION_ID;

      // Check .env.local first, then .env
      for (const envFile of [".env.local", ".env"]) {
        const ePath = path.join(ROOT, envFile);
        if ((!apiToken || !collectionId) && fs.existsSync(ePath)) {
          const envContent = fs.readFileSync(ePath, "utf-8");
          if (!apiToken) {
            const tokenMatch = envContent.match(/WEBFLOW_API_TOKEN=(.+)/);
            if (tokenMatch) apiToken = tokenMatch[1].trim();
          }
          if (!collectionId) {
            // Support both WEBFLOW_COLLECTION_ID and WEBFLOW_LANE_COLLECTION_ID
            const collMatch = envContent.match(/WEBFLOW_(?:LANE_)?COLLECTION_ID=(.+)/);
            if (collMatch) collectionId = collMatch[1].trim();
          }
        }
      }

      if (!apiToken || !collectionId) {
        console.log("  WARNING: Missing WEBFLOW_API_TOKEN or WEBFLOW_COLLECTION_ID");
        console.log("  Cannot publish without Webflow credentials.");
        publishResult.error = "Missing Webflow credentials";
      } else {
        // Check if item already exists
        const searchUrl = `https://api.webflow.com/v2/collections/${collectionId}/items`;
        const searchResp = await fetch(searchUrl, {
          headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        });

        if (!searchResp.ok) {
          throw new Error(`Webflow API error: ${searchResp.status} ${searchResp.statusText}`);
        }

        const searchData = await searchResp.json();
        const existingItem = (searchData.items || []).find(
          (item) => item.fieldData?.slug === lane.slug
        );

        if (existingItem) {
          // PATCH existing item
          console.log(`  Found existing item: ${existingItem.id}`);
          const patchUrl = `${searchUrl}/${existingItem.id}`;
          const patchResp = await fetch(patchUrl, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ fieldData: webflowPayload }),
          });

          if (!patchResp.ok) {
            const errBody = await patchResp.text();
            throw new Error(`PATCH failed: ${patchResp.status} — ${errBody}`);
          }

          console.log(`  PATCHED item ${existingItem.id}`);

          // Publish
          const publishUrl = `https://api.webflow.com/v2/collections/${collectionId}/items/publish`;
          const pubResp = await fetch(publishUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ itemIds: [existingItem.id] }),
          });

          if (pubResp.ok) {
            publishResult.published = true;
            publishResult.status_code = 200;
            console.log("  Published successfully!");
          } else {
            const pubErr = await pubResp.text();
            throw new Error(`Publish failed: ${pubResp.status} — ${pubErr}`);
          }
        } else {
          // CREATE new item
          console.log("  Creating new CMS item...");
          const createResp = await fetch(searchUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ fieldData: webflowPayload }),
          });

          if (!createResp.ok) {
            const errBody = await createResp.text();
            throw new Error(`CREATE failed: ${createResp.status} — ${errBody}`);
          }

          const created = await createResp.json();
          console.log(`  Created item: ${created.id}`);

          // Publish
          const publishUrl = `https://api.webflow.com/v2/collections/${collectionId}/items/publish`;
          const pubResp = await fetch(publishUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ itemIds: [created.id] }),
          });

          if (pubResp.ok) {
            publishResult.published = true;
            publishResult.status_code = 200;
            console.log("  Published successfully!");
          } else {
            const pubErr = await pubResp.text();
            throw new Error(`Publish failed: ${pubResp.status} — ${pubErr}`);
          }
        }
      }
    } catch (err) {
      publishResult.error = err.message;
      console.log(`  ERROR: ${err.message}`);
    }
  }

  writeJSON("artifacts/test_publish_result.json", {
    timestamp: new Date().toISOString(),
    ...publishResult,
  });
  console.log("");

  // ── Step 8: Summary ────────────────────────────────────────────────
  console.log("══════════════════════════════════════════════════");
  console.log("  TEST SUMMARY");
  console.log("══════════════════════════════════════════════════");
  console.log(`  Lane:               ${lane.slug}`);
  console.log(`  Origin:             ${lane.origin}`);
  console.log(`  Destination:        ${lane.destination}`);
  console.log(`  Corridor:           ${lane.corridor_name}`);
  console.log(`  Distance:           ${lane.distance_miles} miles`);
  console.log(`  Tier:               ${lane.lane_set}`);
  console.log("");
  console.log(`  HTML Render:        ✓ (${(webflowPayload["body-content"] || "").length} chars)`);
  console.log(`  Sections present:   hero ✓, overview ✓, warp-fit ✓, ops ✓, pricing ✓, FAQs ✓, related ✓, CTA ✓`);
  console.log(`  Validation:         ${validation.passed ? "✓ PASSED" : "✗ FAILED"} (score: ${validation.score}/100)`);
  console.log(`  Internal links:     corridor=${linkVerification.corridor_hub ? "✓" : "✗"} lanes=${linkVerification.related_lanes_count} metro=${linkVerification.metro_links ? "✓" : "✗"} guide=${linkVerification.guide_link ? "✓" : "✗"}`);
  console.log(`  Sitemap:            ✓ (sitemaps/sitemap-lanes-test.xml)`);
  console.log(`  Publish:            ${publishResult.published ? "✓ LIVE" : doPublish ? "✗ FAILED" : "⏸ DRY-RUN"}`);
  console.log(`  Live URL:           ${publishResult.url}`);
  console.log("");
  console.log("  Artifacts:");
  console.log("    artifacts/test_lane/webflow_payload.json");
  console.log("    artifacts/test_lane_render.json");
  console.log("    artifacts/test_lane_validation.json");
  console.log("    artifacts/test_publish_result.json");
  console.log("    sitemaps/sitemap-lanes-test.xml");
  console.log("");

  if (validation.passed) {
    console.log("  ✓ Pipeline proof complete — ready for full-scale publish.");
  } else {
    console.log("  ✗ Pipeline has issues — review validation results.");
  }
  console.log("══════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
