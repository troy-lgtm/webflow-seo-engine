#!/usr/bin/env node

/**
 * _republish_one.js — Update an existing Webflow CMS item with the latest
 * content from the lane page factory, then publish + email.
 *
 * Usage:
 *   node scripts/_republish_one.js --slug=orlando-to-new-york --notify=troy@wearewarp.com
 *   node scripts/_republish_one.js --slug=orlando-to-new-york --dry-run
 */

import { config } from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

import {
  buildPackageForLane,
  buildWebflowFields,
  sanitizeWebflowFields,
} from "../lib/lane-factory.js";
import { buildConfirmationEmailHtml } from "../lib/publish-receipt.js";
import { expectedUrlForSlug } from "../lib/page-url.js";
import { loadConfig } from "../lib/config.js";

// ── CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match ? match.split("=").slice(1).join("=") : null;
}
const hasFlag = (name) => args.includes(`--${name}`);

const targetSlug = getArg("slug") || "orlando-to-new-york";
const notifyEmail = getArg("notify") || "troy@wearewarp.com";
const dryRun = hasFlag("dry-run");

// ── Step 1: Find the lane in the registry ─────────────────────────────

const registryPath = path.join(__dirname, "..", "data", "lane_registry.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));

function slugify(origin, destination) {
  const o = origin.split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const d = destination.split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${o}-to-${d}`;
}

const lane = registry.find(l => slugify(l.origin, l.destination) === targetSlug);

if (!lane) {
  console.error(`Lane not found in registry for slug: ${targetSlug}`);
  console.error("Available slugs (first 20):");
  registry.slice(0, 20).forEach(l =>
    console.error("  ", slugify(l.origin, l.destination))
  );
  process.exit(1);
}

// Registry uses "modes" (array), not "mode" (string). Pick LTL if available, else first.
const laneMode = lane.mode || (lane.modes && lane.modes.includes("LTL") ? "LTL" : (lane.modes?.[0] || "LTL"));
const laneSegment = lane.segment || "smb";

console.log(`\n✓ Found lane: ${lane.origin} → ${lane.destination} (${laneMode})`);

// ── Step 2: Build the page package ────────────────────────────────────

console.log("Building page package...");
const pkg = buildPackageForLane(lane.origin, lane.destination, laneMode, laneSegment);
const page = pkg.page;
console.log(`✓ Package built: slug=${page.slug}, quality=${page.quality_score}`);

// ── Step 3: Build Webflow fields ──────────────────────────────────────

const rawFields = buildWebflowFields(page);
const fields = sanitizeWebflowFields(rawFields);
console.log(`✓ Webflow fields built: ${Object.keys(fields).length} fields`);

// Log body-content length and first 300 chars
const bodyContent = fields["body-content"] || "";
console.log(`  body-content length: ${bodyContent.length} chars`);
console.log(`  starts with <style>: ${bodyContent.startsWith("<style>")}`);
console.log(`  contains Wistia hide: ${bodyContent.includes("wistia")}`);
console.log(`  contains FAQ HTML: ${bodyContent.includes("<details>")}`);
console.log(`  contains JSON-LD: ${bodyContent.includes("application/ld+json")}`);

if (dryRun) {
  console.log("\n[DRY RUN] Would update Webflow item. Fields:");
  for (const [k, v] of Object.entries(fields)) {
    const val = typeof v === "string" && v.length > 80 ? v.slice(0, 80) + "..." : v;
    console.log(`  ${k}: ${val}`);
  }
  console.log("\n[DRY RUN] Done. No Webflow API calls made.");
  process.exit(0);
}

// ── Step 4: Find the existing Webflow item ────────────────────────────

const token = process.env.WEBFLOW_API_TOKEN;
const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID;
const siteId = process.env.WEBFLOW_SITE_ID;

if (!token || !collectionId || !siteId) {
  console.error("Missing WEBFLOW_API_TOKEN, WEBFLOW_LANE_COLLECTION_ID, or WEBFLOW_SITE_ID");
  process.exit(1);
}

console.log("\nQuerying Webflow for existing item...");

// Search for the item by listing items (offset-paginated)
let existingItemId = null;
let offset = 0;
const limit = 100;

while (!existingItemId) {
  const listRes = await fetch(
    `https://api.webflow.com/v2/collections/${collectionId}/items?limit=${limit}&offset=${offset}`,
    { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
  );
  if (!listRes.ok) {
    console.error("Webflow list error:", listRes.status, await listRes.text());
    process.exit(1);
  }
  const listData = await listRes.json();
  const items = listData.items || [];

  for (const item of items) {
    if (item.fieldData?.slug === targetSlug) {
      existingItemId = item.id;
      console.log(`✓ Found existing item: ${existingItemId} (slug: ${targetSlug})`);
      break;
    }
  }

  if (items.length < limit) break; // No more pages
  offset += limit;
}

if (!existingItemId) {
  console.error(`No existing Webflow item found for slug: ${targetSlug}`);
  console.error("Will create a new item instead.");

  // Create new item
  const createRes = await fetch(
    `https://api.webflow.com/v2/collections/${collectionId}/items`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ isArchived: false, isDraft: false, fieldData: fields }),
    }
  );
  if (!createRes.ok) {
    console.error("Webflow create error:", createRes.status, await createRes.text());
    process.exit(1);
  }
  const createData = await createRes.json();
  existingItemId = createData.id;
  console.log(`✓ Created new item: ${existingItemId}`);
} else {
  // ── Step 5: PATCH the existing item ───────────────────────────────
  console.log("Updating item with PATCH...");
  const patchRes = await fetch(
    `https://api.webflow.com/v2/collections/${collectionId}/items/${existingItemId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ isArchived: false, isDraft: false, fieldData: fields }),
    }
  );
  if (!patchRes.ok) {
    const errText = await patchRes.text();
    console.error("Webflow PATCH error:", patchRes.status, errText);
    process.exit(1);
  }
  const patchData = await patchRes.json();
  console.log(`✓ Item updated: ${patchData.id}`);
}

// ── Step 6: Publish the item ──────────────────────────────────────────

console.log("Publishing item...");
const pubRes = await fetch(
  `https://api.webflow.com/v2/collections/${collectionId}/items/publish`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ itemIds: [existingItemId] }),
  }
);
if (!pubRes.ok) {
  console.error("Webflow publish error:", pubRes.status, await pubRes.text());
  process.exit(1);
}
console.log("✓ Item published to Webflow");

// ── Step 7: Site-wide publish ─────────────────────────────────────────

console.log("Triggering site-wide publish...");
const sitePublishRes = await fetch(
  `https://api.webflow.com/v2/sites/${siteId}/publish`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      customDomains: ["689442045dc003d002d08285", "689442045dc003d002d08271"],
      publishToWebflowSubdomain: false,
    }),
  }
);
if (!sitePublishRes.ok) {
  const errText = await sitePublishRes.text();
  // Non-fatal: site publish may fail but item is already in staging
  console.warn("⚠ Site publish warning:", sitePublishRes.status, errText);
} else {
  console.log("✓ Site publish triggered");
}

// ── Step 8: Build live URL ────────────────────────────────────────────

const liveUrl = expectedUrlForSlug(page.slug);
console.log(`\n✓ Live URL: ${liveUrl}`);

// ── Step 9: Send confirmation email ───────────────────────────────────

if (notifyEmail) {
  console.log(`\nSending confirmation email to ${notifyEmail}...`);

  try {
    const nodemailer = await import("nodemailer");
    const cfg = loadConfig();

    const transporter = nodemailer.default.createTransport({
      service: "gmail",
      auth: {
        user: cfg.email.user || process.env.EMAIL_USER,
        pass: cfg.email.appPassword || process.env.EMAIL_APP_PASSWORD,
      },
    });

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background: #0B0C0E; color: #F5F7FA; padding: 32px; border-radius: 8px;">
        <h1 style="color: #00ff33; margin-bottom: 24px;">Lane Page Republished</h1>

        <div style="background: #121418; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <h2 style="color: #F5F7FA; margin: 0 0 12px 0; font-size: 18px;">${page.h1 || `${lane.origin} → ${lane.destination}`}</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="color: #9CA3AF; padding: 4px 0;">Lane:</td><td style="color: #F5F7FA;">${lane.origin} → ${lane.destination}</td></tr>
            <tr><td style="color: #9CA3AF; padding: 4px 0;">Mode:</td><td style="color: #F5F7FA;">${lane.mode}</td></tr>
            <tr><td style="color: #9CA3AF; padding: 4px 0;">Slug:</td><td style="color: #F5F7FA;">${page.slug}</td></tr>
            <tr><td style="color: #9CA3AF; padding: 4px 0;">Quality:</td><td style="color: #00ff33;">${page.quality_score}/100</td></tr>
            <tr><td style="color: #9CA3AF; padding: 4px 0;">Webflow Item:</td><td style="color: #F5F7FA;">${existingItemId}</td></tr>
            <tr><td style="color: #9CA3AF; padding: 4px 0;">Action:</td><td style="color: #38BDF8;">REPUBLISH (PATCH update)</td></tr>
          </table>
        </div>

        <div style="background: #121418; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
          <h3 style="color: #F5F7FA; margin: 0 0 12px 0;">What Changed</h3>
          <ul style="color: #D1D5DB; padding-left: 20px; margin: 0;">
            <li>Hide CSS now embedded in body-content (not faq-schema field)</li>
            <li>FAQ HTML embedded inline with &lt;details&gt;/&lt;summary&gt; elements</li>
            <li>JSON-LD schemas embedded at bottom of body-content</li>
            <li>Hero video hidden via CSS (Wistia player display:none)</li>
            <li>Digital lane map hero in body-content</li>
            <li>9 structured sections: Overview, WARP Fit, Operating Details, Pricing, Comparison, Best-Fit Shipments, FAQ, Validation, Related Links</li>
          </ul>
        </div>

        <a href="${liveUrl}" style="display: inline-block; background: #00ff33; color: #0B0C0E; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-bottom: 20px;">View Live Page →</a>

        <p style="color: #6B7280; font-size: 12px; margin-top: 24px;">
          Republished at ${new Date().toISOString()} | Webflow item ${existingItemId}
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: cfg.email.user || process.env.EMAIL_USER,
      to: notifyEmail,
      subject: `✓ Lane Page Republished: ${lane.origin} → ${lane.destination}`,
      html: htmlBody,
    });

    console.log(`✓ Email sent to ${notifyEmail}`);
  } catch (emailErr) {
    console.error("⚠ Email failed:", emailErr.message);
  }
}

// ── Summary ───────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════╗");
console.log("║  REPUBLISH COMPLETE                              ║");
console.log("╠══════════════════════════════════════════════════╣");
console.log(`║  Lane:    ${(lane.origin + " → " + lane.destination).padEnd(38)}║`);
console.log(`║  Slug:    ${page.slug.padEnd(38)}║`);
console.log(`║  Mode:    ${laneMode.padEnd(38)}║`);
console.log(`║  Quality: ${String(page.quality_score).padEnd(38)}║`);
console.log(`║  Item ID: ${existingItemId.padEnd(38)}║`);
console.log(`║  URL:     ${liveUrl.slice(0, 38).padEnd(38)}║`);
console.log(`║  Email:   ${(notifyEmail || "none").padEnd(38)}║`);
console.log("╚══════════════════════════════════════════════════╝");
