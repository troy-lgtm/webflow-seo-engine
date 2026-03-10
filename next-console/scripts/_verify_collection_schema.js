#!/usr/bin/env node

/**
 * _verify_collection_schema.js — Check which fields exist in the Webflow
 * Lane Pages CMS collection, compared to the fields our factory sends.
 *
 * Usage:  node scripts/_verify_collection_schema.js
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

const NEEDED = [
  // New structured hero fields
  "hero-kpi-distance", "hero-kpi-transit", "hero-kpi-carriers",
  "hero-visual-type", "hero-map-origin", "hero-map-destination",
  "hero-video-enabled", "hero-map-enabled",
  // Structured data embeds
  "faq-schema", "breadcrumb-schema",
  // City-only identity
  "origin-city", "destination-city",
  // Core fields (should already exist)
  "name", "slug", "hero-headline", "subheadline", "body-content",
  "seo-title", "seo-meta-description", "address",
  "origin", "destination", "mode", "segment",
  "traditional-ltl", "warp-ltl", "proof-section",
  "cta-primary-text", "cta-primary-url",
  "cta-secondary-text", "cta-secondary-url",
  "canonical-url", "index-page",
];

async function main() {
  const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID;
  const token = process.env.WEBFLOW_API_TOKEN;

  if (!collectionId || !token) {
    console.error("Missing WEBFLOW_LANE_COLLECTION_ID or WEBFLOW_API_TOKEN in .env.local");
    process.exit(1);
  }

  const res = await fetch(
    `https://api.webflow.com/v2/collections/${collectionId}`,
    { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } },
  );

  if (!res.ok) {
    console.error("Webflow API error:", res.status, await res.text());
    process.exit(1);
  }

  const data = await res.json();
  console.log("Collection:", data.displayName || data.slug);
  console.log("Total fields:", data.fields.length);
  console.log("");

  const fieldSlugs = new Set(data.fields.map(f => f.slug));
  const fieldMap = Object.fromEntries(data.fields.map(f => [f.slug, f]));

  // Print every field in the collection
  console.log("=== ALL COLLECTION FIELDS ===");
  for (const f of data.fields) {
    const flags = [];
    if (f.isRequired) flags.push("REQUIRED");
    if (f.isEditable === false) flags.push("readonly");
    console.log(`  ${f.slug} (${f.type})${flags.length ? " [" + flags.join(", ") + "]" : ""}`);
  }

  // Compare against what we need
  console.log("");
  console.log("=== FIELD STATUS CHECK ===");
  for (const slug of NEEDED) {
    const exists = fieldSlugs.has(slug);
    const type = exists ? fieldMap[slug].type : "-";
    console.log(exists ? "\u2713" : "\u2717", slug.padEnd(28), exists ? `(${type})` : "MISSING");
  }

  const missing = NEEDED.filter(s => !fieldSlugs.has(s));
  const present = NEEDED.filter(s => fieldSlugs.has(s));
  console.log("");
  console.log(`Present: ${present.length}/${NEEDED.length}`);
  if (missing.length > 0) {
    console.log(`Missing: ${missing.length} \u2192 ${missing.join(", ")}`);
  } else {
    console.log("Missing: 0 \u2014 all fields exist in Webflow");
  }

  // Return for programmatic use
  return { present, missing, allFields: data.fields };
}

main().catch(e => { console.error(e); process.exit(1); });
