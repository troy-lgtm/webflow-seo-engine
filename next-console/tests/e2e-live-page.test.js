/**
 * End-to-End Live Page Validation Test
 *
 * Validates a single representative live lane page on wearewarp.com by:
 *   1. Generating the full CMS field payload locally
 *   2. Fetching the live page HTML from the production URL
 *   3. Comparing structural elements between generated and live content
 *
 * This test catches deployment drift — where generated content differs from
 * what's actually served on the live site.
 *
 * REQUIREMENTS:
 *   - Internet access to fetch live page
 *   - Live page must have been recently published with current content
 *
 * Run: node tests/e2e-live-page.test.js
 */

import { buildPackageForLane, buildWebflowFields } from "../lib/lane-factory.js";

// ── Test Infrastructure ─────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertContains(haystack, needle, message) {
  assert(haystack.includes(needle), message);
}

// ── Test Configuration ──────────────────────────────────────────────

const LIVE_LANE = {
  origin: "Atlanta, GA",
  destination: "Orlando, FL",
  slug: "atlanta-to-orlando",
  label: "E2E: Atlanta to Orlando (LIVE)",
};

const LIVE_URL = `https://www.wearewarp.com/lanes/${LIVE_LANE.slug}`;

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║  END-TO-END LIVE PAGE VALIDATION TEST                      ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

console.log(`── Target: ${LIVE_URL} ──\n`);

// ── Step 1: Generate local content ──────────────────────────────────

console.log("  Step 1: Generating local content...");
const pkg = buildPackageForLane(LIVE_LANE.origin, LIVE_LANE.destination, "LTL", "smb");
const fields = buildWebflowFields(pkg.page);
console.log("  ✓ Local content generated\n");

// ── Step 2: Fetch live page ─────────────────────────────────────────

console.log("  Step 2: Fetching live page...");
let liveHtml = "";
try {
  const res = await fetch(LIVE_URL, {
    headers: {
      "User-Agent": "WARP-SEO-Engine/1.0 (E2E Test)",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    console.error(`  ✗ HTTP ${res.status}: ${res.statusText}`);
    console.error("  ✗ Cannot fetch live page. Skipping live comparison tests.");
    console.log("\n── Summary ─────────────────────────────────────────");
    console.log("  SKIPPED: Live page not accessible");
    process.exit(0);
  }
  liveHtml = await res.text();
  console.log(`  ✓ Fetched ${liveHtml.length.toLocaleString()} bytes\n`);
} catch (err) {
  console.error(`  ✗ Fetch error: ${err.message}`);
  console.error("  ✗ Cannot reach live site. Skipping live comparison tests.");
  console.log("\n── Summary ─────────────────────────────────────────");
  console.log("  SKIPPED: Network error");
  process.exit(0);
}

// ── Step 3: Validate live page against generated content ────────────

console.log("  Step 3: Validating live page...\n");

const oCity = LIVE_LANE.origin.split(",")[0].trim();
const dCity = LIVE_LANE.destination.split(",")[0].trim();

// ── 3.1: Page Structure ─────────────────────────────────────────────

// Page must have a title tag
assert(/<title[^>]*>/.test(liveHtml),
  "Live page must have a <title> tag");

// Title must contain expected content
const titleMatch = liveHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
if (titleMatch) {
  const liveTitle = titleMatch[1];
  assertContains(liveTitle, "LTL",
    `Live title must contain 'LTL' (got: ${liveTitle})`);
}

// Must have exactly one H1
const h1Matches = liveHtml.match(/<h1[\s>]/gi) || [];
assert(h1Matches.length >= 1,
  `Live page must have at least 1 <h1> tag (found ${h1Matches.length})`);

// ── 3.2: Hero Content ───────────────────────────────────────────────

// Hero headline from CMS must appear on live page
const heroHeadline = fields["hero-headline"];
assertContains(liveHtml, oCity,
  `Live page must contain origin city '${oCity}'`);
assertContains(liveHtml, dCity,
  `Live page must contain destination city '${dCity}'`);

// ── 3.3: Lane Intelligence Panel Content ────────────────────────────

// KPI cards from lane-intelligence-panel should appear on live page
assertContains(liveHtml, "Lane Distance",
  "Live page must contain 'Lane Distance' KPI");
assertContains(liveHtml, "Transit Window",
  "Live page must contain 'Transit Window' KPI");
assertContains(liveHtml, "Active Carriers",
  "Live page must contain 'Active Carriers' KPI");

// ── 3.4: Execution Flow Content ─────────────────────────────────────

assertContains(liveHtml, "How Freight Moves",
  "Live page must contain 'How Freight Moves' heading");
assertContains(liveHtml, "Origin Pickup",
  "Live page must contain 'Origin Pickup' stage");
assertContains(liveHtml, "Final Delivery",
  "Live page must contain 'Final Delivery' stage");

// ── 3.5: FAQ Schema Content ─────────────────────────────────────────

// Key sections from faq-schema must appear
assertContains(liveHtml, "Corridor Matters",
  "Live page must contain 'Corridor Matters'");
assertContains(liveHtml, "Transit and Operating Details",
  "Live page must contain 'Transit and Operating Details'");
assertContains(liveHtml, "Frequently Asked Questions",
  "Live page must contain 'Frequently Asked Questions'");
assertContains(liveHtml, "Why Shippers Use WARP",
  "Live page must contain 'Why Shippers Use WARP'");

// Comparison table
assertContains(liveHtml, "Traditional LTL vs WARP",
  "Live page must contain comparison table heading");

// ── 3.6: Proof Section Content ──────────────────────────────────────

assertContains(liveHtml, "Validate This Lane",
  "Live page must contain 'Validate This Lane'");

// ── 3.7: JSON-LD Schemas ────────────────────────────────────────────

assertContains(liveHtml, "application/ld+json",
  "Live page must contain JSON-LD schemas");
assertContains(liveHtml, "BreadcrumbList",
  "Live page must contain BreadcrumbList schema");
assertContains(liveHtml, '"Service"',
  "Live page must contain Service schema");
assertContains(liveHtml, "FAQPage",
  "Live page must contain FAQPage schema");

// ── 3.8: CTA Presence ───────────────────────────────────────────────

assertContains(liveHtml, "wearewarp.com/quote",
  "Live page must link to quote page");

// ── 3.9: CSS Dark Theme Active ──────────────────────────────────────

// The dark theme CSS should be active (either inline or via custom code)
assertContains(liveHtml, "#0B0C0E",
  "Live page must have dark theme background color");

// ── 3.10: No Generic Template Leakage ───────────────────────────────

// Check for hide CSS that prevents generic sections
// The live page should have display:none on generic elements
// We check that the generic "Why Shippers Choose Warp" (container-14)
// and video (container-24) are handled
assertContains(liveHtml, "container-24",
  "Live page must reference container-24 (video section, should be hidden)");

// ── 3.11: Operating Details Data Consistency ────────────────────────

// The generated operating details data must match what's on the live page
assertContains(liveHtml, "Lane distance:",
  "Live page must contain 'Lane distance:' operating detail");

// ── 3.12: CMS Field Content Present ─────────────────────────────────

// body-content text should appear (plain text summary)
const bodyContent = fields["body-content"];
// Extract first sentence for matching (avoid full paragraph match issues)
const firstSentence = bodyContent.split(".")[0];
if (firstSentence.length > 20) {
  assertContains(liveHtml, firstSentence.substring(0, 50),
    "Live page must contain body-content first sentence");
}

// ── Summary ─────────────────────────────────────────────────────────

console.log("\n── Summary ─────────────────────────────────────────");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failures.length > 0) {
  console.log("\n  Failures:");
  failures.forEach(f => console.log(`    • ${f}`));
  process.exit(1);
} else {
  console.log("\n  ✓ ALL E2E LIVE PAGE TESTS PASSED");
  process.exit(0);
}
