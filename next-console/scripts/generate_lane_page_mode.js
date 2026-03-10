#!/usr/bin/env node

/**
 * generate_lane_page_mode.js — Generate and validate the lane page mode
 * injection script for Webflow deployment.
 *
 * This script:
 *   1. Reads the lane-page-mode.html artifact
 *   2. Validates it contains all required CSS selectors and JS functions
 *   3. Prints deployment instructions
 *   4. Optionally outputs a minified version (--minify)
 *
 * Usage:
 *   node scripts/generate_lane_page_mode.js
 *   node scripts/generate_lane_page_mode.js --minify
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const artifactPath = path.join(ROOT, "artifacts", "seo-fix", "lane-page-mode.html");

if (!fs.existsSync(artifactPath)) {
  console.error("ERROR: lane-page-mode.html not found at", artifactPath);
  process.exit(1);
}

const content = fs.readFileSync(artifactPath, "utf-8");

// ── Validation ──────────────────────────────────────────────────────────

const REQUIRED_SELECTORS = [
  ".container-24",     // Wistia video container
  ".cta-bundle",       // "Book Freight Instantly" CTAs
  ".container-14",     // "Why Shippers Choose Warp"
  ".uui-page-padding-5", // "Stop Paying..." CTA
  ".container-15",     // Hero section
  ".container-13",     // Main content area
  ".container-18",     // Page wrapper
  ".div-block-27",     // Comparison section
  ".text-block-19",    // Body content text block
  ".crossdocknav",     // Nav bar
  ".uui-navbar07_component", // Nav component
  ".section-3",        // Footer
];

const REQUIRED_FEATURES = [
  { name: "URL gate (/lanes/)", pattern: /\/lanes\// },
  { name: "Dark body background", pattern: /#0B0C0E/ },
  { name: "WARP green accent", pattern: /#00ff33/ },
  { name: "Space Grotesk font", pattern: /Space Grotesk/ },
  { name: "SVG lane map", pattern: /<svg viewBox/ },
  { name: "KPI chips", pattern: /DISTANCE|TRANSIT|CARRIERS|TRACKING/ },
  { name: "CTA buttons", pattern: /Get Instant Quote/ },
  { name: "Comparison table rebuild", pattern: /lane-comp-table|Quote Speed/ },
  { name: "DOMContentLoaded gate", pattern: /DOMContentLoaded/ },
  { name: "Mobile responsive", pattern: /@media.*max-width/ },
];

console.log("\n╔══════════════════════════════════════════════════╗");
console.log("║  LANE PAGE MODE — Validation & Deployment        ║");
console.log("╚══════════════════════════════════════════════════╝\n");

let allPass = true;

console.log("── CSS Selectors ─────────────────────────────────");
for (const sel of REQUIRED_SELECTORS) {
  const found = content.includes(sel);
  console.log(`  ${found ? "✓" : "✗"} ${sel}`);
  if (!found) allPass = false;
}

console.log("\n── Features ──────────────────────────────────────");
for (const feat of REQUIRED_FEATURES) {
  const found = feat.pattern.test(content);
  console.log(`  ${found ? "✓" : "✗"} ${feat.name}`);
  if (!found) allPass = false;
}

const sizeKb = (Buffer.byteLength(content, "utf-8") / 1024).toFixed(1);
console.log(`\n── Size: ${sizeKb} KB ──`);

if (!allPass) {
  console.error("\n✗ VALIDATION FAILED — fix missing items before deploying");
  process.exit(1);
}

console.log("\n✓ All validations passed");

// ── Deployment Instructions ──────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  DEPLOYMENT INSTRUCTIONS                                      ║
╠══════════════════════════════════════════════════════════════╣
║                                                                ║
║  1. Open Webflow Designer for wearewarp.com                   ║
║  2. Go to: Site Settings → Custom Code → Footer Code         ║
║  3. PASTE the contents of:                                    ║
║     artifacts/seo-fix/lane-page-mode.html                     ║
║  4. Save and publish the site                                 ║
║                                                                ║
║  IMPORTANT: This script is SAFE — it only activates on        ║
║  /lanes/* pages. Non-lane pages are completely unaffected.     ║
║                                                                ║
║  OPTIONAL (for full schema + FAQ rendering):                  ║
║  In Webflow Designer, bind these CMS fields to elements:      ║
║    - faq-schema → Code Embed element (renders hide CSS +      ║
║      FAQ JSON-LD + FAQ HTML)                                  ║
║    - breadcrumb-schema → Code Embed element (renders          ║
║      BreadcrumbList + Service + Organization JSON-LD)         ║
║    - proof-section → Rich Text element (renders pilot         ║
║      validation content)                                      ║
║                                                                ║
╚══════════════════════════════════════════════════════════════╝
`);

// ── Optional minification ──────────────────────────────────────────

if (process.argv.includes("--minify")) {
  const minified = content
    .replace(/\/\*[\s\S]*?\*\//g, "")    // Remove block comments
    .replace(/\/\/[^\n]*/g, "")          // Remove line comments
    .replace(/\n\s*\n/g, "\n")           // Collapse blank lines
    .replace(/  +/g, " ")               // Collapse spaces
    .trim();

  const minPath = path.join(ROOT, "artifacts", "seo-fix", "lane-page-mode.min.html");
  fs.writeFileSync(minPath, minified);
  const minSizeKb = (Buffer.byteLength(minified, "utf-8") / 1024).toFixed(1);
  console.log(`  Minified version written: ${minPath} (${minSizeKb} KB)`);
}
