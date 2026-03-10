#!/usr/bin/env node

/**
 * publish:list:last — Show the most recent publish run receipt.
 *
 * Prints: run_id, slug, webflowItemId, expectedUrl, verifiedLiveUrl, final_status.
 *
 * Usage:
 *   npm run publish:list:last            → formatted table
 *   npm run publish:list:last -- --json  → JSON output
 *   npm run publish:list:last -- --html  → render and save email HTML preview
 */

import { config } from "dotenv";
import path from "path";
import fs from "fs";
import { getProjectRoot, resolveFromRoot } from "../lib/fs/project-root.js";

const ROOT = getProjectRoot();
config({ path: path.join(ROOT, ".env.local") });

const args = process.argv.slice(2);
const JSON_OUTPUT = args.includes("--json");
const HTML_PREVIEW = args.includes("--html");

// ── Load the most recent receipt ─────────────────────────────────────

const receiptsDir = resolveFromRoot("artifacts/publish-receipts");
if (!fs.existsSync(receiptsDir)) {
  console.error("No receipts directory found. Run a publish first.");
  process.exit(1);
}

const files = fs.readdirSync(receiptsDir)
  .filter(f => f.startsWith("receipt_") && f.endsWith(".json") && f !== "receipt_undefined.json")
  .sort()
  .reverse();

if (files.length === 0) {
  console.error("No receipt files found.");
  process.exit(1);
}

const latestFile = files[0];
const latestPath = path.join(receiptsDir, latestFile);
const receipt = JSON.parse(fs.readFileSync(latestPath, "utf-8"));

// ── JSON mode ────────────────────────────────────────────────────────

if (JSON_OUTPUT) {
  const output = {
    run_id: receipt.run_id,
    final_status: receipt.final_status,
    script_name: receipt.script_name,
    receipt_generated_at: receipt.receipt_generated_at,
    intended_count: receipt.intended_count,
    published_count: receipt.published_count,
    verified_live_count: receipt.verified_live_count,
    failed_count: receipt.failed_count,
    blocked_count: receipt.blocked_count,
    email_sent: receipt.email_sent,
    recipient: receipt.recipient,
    pages: [
      ...(receipt.verified_live_urls || []).map(v => ({
        slug: v.slug,
        webflowItemId: v.webflowItemId || null,
        expectedUrl: v.url,
        verifiedLiveUrl: v.url,
        httpStatus: v.httpStatus,
        status: "verified_live",
      })),
      ...(receipt.published_unverified_urls || []).map(v => ({
        slug: v.slug,
        webflowItemId: v.webflowItemId || null,
        expectedUrl: v.url,
        verifiedLiveUrl: null,
        httpStatus: v.httpStatus,
        status: "published_unverified",
        error: v.error,
      })),
      ...(receipt.failed_slugs || []).map(f => ({
        slug: f.slug,
        webflowItemId: null,
        expectedUrl: null,
        verifiedLiveUrl: null,
        httpStatus: null,
        status: "failed",
        reason: f.reason,
      })),
      ...(receipt.blocked_slugs || []).map(b => ({
        slug: b.slug,
        webflowItemId: null,
        expectedUrl: null,
        verifiedLiveUrl: null,
        httpStatus: null,
        status: "blocked",
        reason: b.reason,
      })),
    ],
  };
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

// ── HTML preview mode ────────────────────────────────────────────────

if (HTML_PREVIEW) {
  const { buildConfirmationEmailHtml } = await import("../lib/publish-receipt.js");
  const html = buildConfirmationEmailHtml(receipt);
  const htmlPath = resolveFromRoot("artifacts/publish-receipts", `preview_${receipt.run_id}.html`);
  fs.writeFileSync(htmlPath, html);
  console.log(`Email HTML preview saved: ${htmlPath}`);
  console.log(`Open in browser: file://${htmlPath}`);

  // Also check for clickable links
  const linkMatches = html.match(/<a\s+href="(https:\/\/[^"]+)"/g) || [];
  if (linkMatches.length > 0) {
    console.log(`\nClickable links found in email:`);
    for (const m of linkMatches) {
      const url = m.match(/href="([^"]+)"/)[1];
      console.log(`  → ${url}`);
    }
  } else {
    console.log(`\nNo clickable page links in email (no verified live pages).`);
  }
  process.exit(0);
}

// ── Formatted output ─────────────────────────────────────────────────

console.log("");
console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║  LAST PUBLISH RUN                                              ║");
console.log("╠══════════════════════════════════════════════════════════════════╣");
console.log(`║  Run ID:     ${(receipt.run_id || "").slice(0, 50).padEnd(50)}║`);
console.log(`║  Script:     ${(receipt.script_name || "").padEnd(50)}║`);
console.log(`║  Status:     ${(receipt.final_status || "").padEnd(50)}║`);
console.log(`║  Time:       ${(receipt.receipt_generated_at || "").padEnd(50)}║`);
console.log("╠══════════════════════════════════════════════════════════════════╣");
console.log(`║  Intended:   ${String(receipt.intended_count).padEnd(50)}║`);
console.log(`║  Published:  ${String(receipt.published_count).padEnd(50)}║`);
console.log(`║  Verified:   ${String(receipt.verified_live_count).padEnd(50)}║`);
console.log(`║  Failed:     ${String(receipt.failed_count).padEnd(50)}║`);
console.log(`║  Blocked:    ${String(receipt.blocked_count).padEnd(50)}║`);
console.log("╠══════════════════════════════════════════════════════════════════╣");
console.log(`║  Email sent: ${(receipt.email_sent ? "YES" : "NO").padEnd(50)}║`);
console.log(`║  Recipient:  ${(receipt.recipient || "none").padEnd(50)}║`);
console.log("╠══════════════════════════════════════════════════════════════════╣");

// Verified live pages
if (receipt.verified_live_urls && receipt.verified_live_urls.length > 0) {
  console.log("║  VERIFIED LIVE PAGES:                                          ║");
  for (const v of receipt.verified_live_urls) {
    const slug = v.slug || "";
    const url = v.url || "";
    const itemId = v.webflowItemId || "(none)";
    console.log(`║    ✓ ${slug.padEnd(58)}║`);
    console.log(`║      ${url.padEnd(58)}║`);
    console.log(`║      HTTP ${String(v.httpStatus).padEnd(53)}║`);
    console.log(`║      Item: ${itemId.padEnd(52)}║`);
  }
}

// Unverified pages
if (receipt.published_unverified_urls && receipt.published_unverified_urls.length > 0) {
  console.log("║  PUBLISHED (NOT VERIFIED):                                     ║");
  for (const v of receipt.published_unverified_urls) {
    const itemId = v.webflowItemId || "(none)";
    console.log(`║    ? ${(v.slug || "").padEnd(58)}║`);
    console.log(`║      ${(v.url || "").padEnd(58)}║`);
    console.log(`║      ${(v.error || "pending").padEnd(58)}║`);
    console.log(`║      Item: ${itemId.padEnd(52)}║`);
  }
}

// Failed
if (receipt.failed_slugs && receipt.failed_slugs.length > 0) {
  console.log("║  FAILED:                                                       ║");
  for (const f of receipt.failed_slugs) {
    console.log(`║    ✗ ${(f.slug || "").padEnd(58)}║`);
    console.log(`║      ${(f.reason || "").slice(0, 58).padEnd(58)}║`);
  }
}

// Blocked
if (receipt.blocked_slugs && receipt.blocked_slugs.length > 0) {
  console.log("║  BLOCKED:                                                      ║");
  for (const b of receipt.blocked_slugs) {
    console.log(`║    ⊘ ${(b.slug || "").padEnd(58)}║`);
    console.log(`║      ${(b.reason || "").slice(0, 58).padEnd(58)}║`);
  }
}

console.log("╠══════════════════════════════════════════════════════════════════╣");
console.log(`║  Receipt: ${latestPath.slice(-53).padEnd(53)}║`);
console.log("╚══════════════════════════════════════════════════════════════════╝");
console.log("");
