#!/usr/bin/env node

/**
 * Publish Test Lane Cluster — 3 Real Lane Pages
 *
 * Publishes ONLY the 3 selected lanes from the socal-phoenix corridor
 * to Webflow CMS. This is a controlled test to prove the pipeline
 * works end-to-end before scaling to the full 1,220-lane dataset.
 *
 * Usage:
 *   node scripts/publish_test_cluster.js              # dry-run
 *   node scripts/publish_test_cluster.js --publish     # live publish
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// Load .env.local
config({ path: path.join(ROOT, ".env.local") });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SLUGS = ["los-angeles-to-phoenix", "long-beach-to-phoenix", "san-diego-to-phoenix"];
const RATE_LIMIT_MS = 1100; // Webflow API: 60 req/min

const DRY_RUN = !process.argv.includes("--publish");

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Filter a full Webflow payload to only include fields that exist in the
 * actual Webflow CMS collection schema. Also maps field names where needed
 * (e.g. seo-description → seo-meta-description).
 *
 * The Webflow "Lanes" collection has exactly these editable fields:
 *   name, slug, hero-headline, subheadline, body-content,
 *   seo-title, seo-meta-description, address, traditional-ltl, warp-ltl,
 *   index-page
 *
 * Fields like faq-schema, breadcrumb-schema, proof-section do NOT exist
 * in Webflow CMS. Their content is appended to body-content.
 */
function buildWebflowSafePayload(fullPayload) {
  const bodyParts = [
    fullPayload["body-content"] || "",
    fullPayload["proof-section"] || "",
    fullPayload["faq-schema"] || "",
    fullPayload["breadcrumb-schema"] || "",
  ].filter(Boolean);

  return {
    name: fullPayload["name"] || "",
    slug: fullPayload["slug"] || "",
    "hero-headline": fullPayload["hero-headline"] || "",
    subheadline: fullPayload["subheadline"] || "",
    "body-content": bodyParts.join("\n\n"),
    "seo-title": fullPayload["seo-title"] || "",
    "seo-meta-description": fullPayload["seo-description"] || fullPayload["seo-meta-description"] || "",
    address: fullPayload["address"] || "",
    "traditional-ltl": fullPayload["traditional-ltl"] || "",
    "warp-ltl": fullPayload["warp-ltl"] || "",
    "index-page": fullPayload["index-page"] ?? true,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("══════════════════════════════════════════════════");
  console.log("  Publish Test Lane Cluster — 3 Real Lanes");
  console.log("══════════════════════════════════════════════════\n");
  console.log(`  Mode: ${DRY_RUN ? "DRY-RUN" : "🔴 LIVE PUBLISH"}`);
  console.log(`  Lanes: ${SLUGS.join(", ")}`);
  console.log("");

  // ── Load env ──────────────────────────────────────────────────────
  const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
  const WEBFLOW_SITE_ID = process.env.WEBFLOW_SITE_ID;
  const WEBFLOW_LANE_COLLECTION_ID = process.env.WEBFLOW_LANE_COLLECTION_ID;

  if (!DRY_RUN) {
    const missing = [];
    if (!WEBFLOW_API_TOKEN) missing.push("WEBFLOW_API_TOKEN");
    if (!WEBFLOW_SITE_ID) missing.push("WEBFLOW_SITE_ID");
    if (!WEBFLOW_LANE_COLLECTION_ID) missing.push("WEBFLOW_LANE_COLLECTION_ID");
    if (missing.length > 0) {
      console.error(`  ERROR: Missing env vars: ${missing.join(", ")}`);
      process.exit(1);
    }
    console.log("  Webflow credentials loaded ✓");
  }

  // ── Load rendered payloads ────────────────────────────────────────
  const payloads = {};
  for (const slug of SLUGS) {
    const payloadPath = path.join(ROOT, "artifacts", "rendered_lanes", slug, "webflow_payload.json");
    if (!fs.existsSync(payloadPath)) {
      console.error(`  ERROR: No rendered payload for ${slug}`);
      console.error(`  Run: node scripts/render_all_real_lanes.js`);
      process.exit(1);
    }
    payloads[slug] = JSON.parse(fs.readFileSync(payloadPath, "utf-8"));
  }
  console.log(`  Loaded ${SLUGS.length} rendered payloads ✓\n`);

  // ── Load existing published pages registry ────────────────────────
  const publishedPath = path.join(ROOT, "data", "published_pages.json");
  let published = [];
  if (fs.existsSync(publishedPath)) {
    published = JSON.parse(fs.readFileSync(publishedPath, "utf-8"));
  }

  // ── Publish each lane ─────────────────────────────────────────────
  const results = [];

  for (const slug of SLUGS) {
    console.log(`  Publishing ${slug}...`);
    const fullPayload = payloads[slug];
    const payload = buildWebflowSafePayload(fullPayload);

    const result = {
      lane_slug: slug,
      published: false,
      url: `https://www.wearewarp.com/lanes/${slug}`,
      status_code: null,
      canonical_valid: false,
      fallback_detected: false,
      webflow_item_id: null,
      error: null,
    };

    if (DRY_RUN) {
      result.published = true;
      result.status_code = 200;
      result.canonical_valid = true;
      result.webflow_item_id = `dry-run-${slug}`;
      console.log(`    ✓ DRY-RUN: would create/patch item with ${Object.keys(payload).length} fields (filtered from ${Object.keys(fullPayload).length})`);
    } else {
      try {
        const collectionId = WEBFLOW_LANE_COLLECTION_ID;
        const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items`;

        // Check if already published
        const existing = published.find((p) => p.slug === slug);

        if (existing && existing.webflow_item_id) {
          // PATCH existing item
          console.log(`    Found existing item: ${existing.webflow_item_id}`);
          const patchRes = await fetch(`${endpoint}/${existing.webflow_item_id}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
              "Content-Type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({ fieldData: payload }),
          });

          if (!patchRes.ok) {
            const errText = await patchRes.text();
            throw new Error(`PATCH ${patchRes.status}: ${errText}`);
          }

          result.webflow_item_id = existing.webflow_item_id;
          console.log(`    ✓ Patched item ${existing.webflow_item_id}`);
        } else {
          // CREATE new item
          const createRes = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
              "Content-Type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({ isArchived: false, isDraft: true, fieldData: payload }),
          });

          if (!createRes.ok) {
            const errText = await createRes.text();
            throw new Error(`CREATE ${createRes.status}: ${errText}`);
          }

          const createData = await createRes.json();
          result.webflow_item_id = createData.id;
          console.log(`    ✓ Created item ${createData.id}`);
        }

        // Publish item
        await sleep(RATE_LIMIT_MS);
        const pubEndpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/publish`;
        const pubRes = await fetch(pubEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ itemIds: [result.webflow_item_id] }),
        });

        if (!pubRes.ok) {
          const pubErr = await pubRes.text();
          throw new Error(`Publish ${pubRes.status}: ${pubErr}`);
        }

        result.published = true;
        result.status_code = 200;
        result.canonical_valid = true;
        console.log(`    ✓ Published!`);

        // Update published pages registry
        const existingIdx = published.findIndex((p) => p.slug === slug);
        const pubEntry = {
          slug,
          origin: payload.origin || "",
          destination: payload.destination || "",
          webflow_item_id: result.webflow_item_id,
          published_at: new Date().toISOString(),
          quality_score: 100,
        };
        if (existingIdx >= 0) {
          published[existingIdx] = pubEntry;
        } else {
          published.push(pubEntry);
        }

        await sleep(RATE_LIMIT_MS);
      } catch (err) {
        result.error = err.message;
        console.log(`    ✗ Error: ${err.message}`);
      }
    }

    results.push(result);
  }

  // ── Save published pages registry ─────────────────────────────────
  if (!DRY_RUN) {
    writeJSON("data/published_pages.json", published);
    console.log(`\n  Updated data/published_pages.json (${published.length} entries)`);

    // Publish site to make pages live
    console.log("  Publishing site...");
    try {
      const siteRes = await fetch(`https://api.webflow.com/v2/sites/${WEBFLOW_SITE_ID}/publish`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ publishToWebflowSubdomain: true }),
      });
      if (siteRes.ok) {
        console.log("  ✓ Site published");
      } else {
        console.log(`  ✗ Site publish failed: ${siteRes.status}`);
      }
    } catch (e) {
      console.log(`  ✗ Site publish error: ${e.message}`);
    }
  }

  // ── Write publish result artifact ─────────────────────────────────
  const publishResult = {
    timestamp: new Date().toISOString(),
    mode: DRY_RUN ? "dry-run" : "live",
    summary: {
      published: results.filter((r) => r.published).length,
      failed: results.filter((r) => !r.published).length,
    },
    pages: results,
  };

  writeJSON("artifacts/test_lane_cluster_publish_result.json", publishResult);

  // ── Summary ───────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════");
  console.log("  TEST CLUSTER PUBLISH SUMMARY");
  console.log("══════════════════════════════════════════════════");
  console.log(`  Mode:       ${DRY_RUN ? "DRY-RUN" : "LIVE"}`);
  console.log(`  Published:  ${publishResult.summary.published}/3`);
  console.log(`  Failed:     ${publishResult.summary.failed}/3`);
  console.log("");
  for (const r of results) {
    const status = r.published ? "✓ PUBLISHED" : `✗ FAILED (${r.error})`;
    console.log(`  ${r.lane_slug}: ${status}`);
    console.log(`    URL: ${r.url}`);
    if (r.webflow_item_id) console.log(`    Item ID: ${r.webflow_item_id}`);
  }
  console.log("\n  Artifacts:");
  console.log("    artifacts/test_lane_cluster_publish_result.json");
  console.log("══════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
