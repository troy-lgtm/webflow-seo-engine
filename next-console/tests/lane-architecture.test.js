/**
 * Lane Page Architecture Tests
 *
 * These tests enforce the ownership boundaries of the lane page
 * generation system. They exist to prevent architectural regression
 * where structured KPI content leaks back into rich text sections.
 *
 * ARCHITECTURE RULES ENFORCED:
 * 1. KPI card grid is EXCLUSIVELY owned by renderLaneIntelligencePanel()
 * 2. Freight Execution Flow is EXCLUSIVELY owned by renderExecutionFlow()
 * 3. faq-schema embed contains PROSE ONLY for operating details (no KPI cards)
 * 4. No duplicate section headings across components
 * 5. SEO integrity (H1, title, meta, canonical, schemas) preserved
 * 6. LTL vehicle flexibility framing preserved
 *
 * Run: node tests/lane-architecture.test.js
 */

import { buildPackageForLane, buildWebflowFields, buildFaqSchemaEmbed, buildBodyContent } from "../lib/lane-factory.js";

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

function assertNotContains(haystack, needle, message) {
  assert(!haystack.includes(needle), message);
}

function assertContains(haystack, needle, message) {
  assert(haystack.includes(needle), message);
}

// ── Test Data: Generate pages across distance classes ────────────────

const BENCHMARK_LANES = [
  { origin: "Atlanta, GA", destination: "Orlando, FL", label: "short (ATL-ORL)" },
  { origin: "Atlanta, GA", destination: "Miami, FL", label: "medium (ATL-MIA)" },
  { origin: "Los Angeles, CA", destination: "New York, NY", label: "long (LA-NY)" },
];

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║  LANE PAGE ARCHITECTURE TESTS                              ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

for (const lane of BENCHMARK_LANES) {
  console.log(`── Testing: ${lane.label} ──`);

  const pkg = buildPackageForLane(lane.origin, lane.destination, "LTL", "smb");
  const fields = buildWebflowFields(pkg.page);
  const faqSchema = fields["faq-schema"];
  const laneIntelPanel = fields["lane-intelligence-panel"];
  const execFlow = fields["execution-flow"];
  const breadcrumbSchema = fields["breadcrumb-schema"];
  const bodyContent = fields["body-content"];

  // ── 1. KPI CARD GRID OWNERSHIP ──────────────────────────────────

  // Lane Intelligence Panel MUST have KPI cards
  assertContains(laneIntelPanel, "Lane Distance",
    `[${lane.label}] Lane Intelligence Panel must contain 'Lane Distance' KPI card`);
  assertContains(laneIntelPanel, "Transit Window",
    `[${lane.label}] Lane Intelligence Panel must contain 'Transit Window' KPI card`);
  assertContains(laneIntelPanel, "Active Carriers",
    `[${lane.label}] Lane Intelligence Panel must contain 'Active Carriers' KPI card`);
  assertContains(laneIntelPanel, "Equipment",
    `[${lane.label}] Lane Intelligence Panel must contain 'Equipment' KPI card`);
  assertContains(laneIntelPanel, "Tracking",
    `[${lane.label}] Lane Intelligence Panel must contain 'Tracking' KPI card`);
  assertContains(laneIntelPanel, "Exception Alerts",
    `[${lane.label}] Lane Intelligence Panel must contain 'Exception Alerts' KPI card`);
  assertContains(laneIntelPanel, "Delivery",
    `[${lane.label}] Lane Intelligence Panel must contain 'Delivery' KPI card`);

  // Lane Intelligence Panel must have CTA buttons
  assertContains(laneIntelPanel, "Get LTL Rate",
    `[${lane.label}] Lane Intelligence Panel must contain primary CTA`);

  // ── 2. FAQ-SCHEMA MUST NOT CONTAIN KPI CARD GRID ────────────────

  // Check for KPI card labels in structured grid context
  // (labels like "Lane Distance" as standalone card headers, NOT prose like "Lane distance: 474 miles")
  const kpiCardPattern = /border-radius:12px;padding:16px/;
  assertNotContains(faqSchema, "Lane Distance",
    `[${lane.label}] faq-schema must NOT contain 'Lane Distance' KPI card label`);
  assertNotContains(faqSchema, "Transit Window",
    `[${lane.label}] faq-schema must NOT contain 'Transit Window' KPI card label`);
  assertNotContains(faqSchema, "Active Carriers",
    `[${lane.label}] faq-schema must NOT contain 'Active Carriers' KPI card label`);

  // Check for KPI grid layout pattern
  assert(!(/grid-template-columns:repeat\(auto-fit,minmax\(180px/.test(faqSchema)),
    `[${lane.label}] faq-schema must NOT contain KPI grid layout (180px minmax)`);

  // Check for KPI card cell styling
  assert(!(kpiCardPattern.test(faqSchema)),
    `[${lane.label}] faq-schema must NOT contain KPI card cell styling`);

  // ── 3. FAQ-SCHEMA MUST HAVE PROSE OPERATING DETAILS ─────────────

  assertContains(faqSchema, "Transit and Operating Details",
    `[${lane.label}] faq-schema must contain 'Transit and Operating Details' heading`);

  // Prose items use lowercase format like "Lane distance: X miles"
  assertContains(faqSchema, "Lane distance:",
    `[${lane.label}] faq-schema must contain prose 'Lane distance:' item`);
  assertContains(faqSchema, "Standard transit:",
    `[${lane.label}] faq-schema must contain prose 'Standard transit:' item`);

  // ── 4. EXECUTION FLOW OWNERSHIP ─────────────────────────────────

  assertContains(execFlow, "How Freight Moves",
    `[${lane.label}] Execution Flow must contain 'How Freight Moves' heading`);
  assertContains(execFlow, "Origin Pickup",
    `[${lane.label}] Execution Flow must contain 'Origin Pickup' step`);
  assertContains(execFlow, "Final Delivery",
    `[${lane.label}] Execution Flow must contain 'Final Delivery' step`);

  // Execution Flow must NOT be in faq-schema
  assertNotContains(faqSchema, "How Freight Moves",
    `[${lane.label}] faq-schema must NOT contain 'How Freight Moves' (exec flow)`);
  assertNotContains(faqSchema, "cross-dock routing model",
    `[${lane.label}] faq-schema must NOT contain execution flow prose`);

  // ── 5. NO DUPLICATE SECTION HEADINGS ────────────────────────────

  // Count "Corridor Matters" across all fields
  const allContent = faqSchema + laneIntelPanel + execFlow;
  const corridorMattersCount = (allContent.match(/Corridor Matters/g) || []).length;
  assert(corridorMattersCount <= 1,
    `[${lane.label}] 'Corridor Matters' heading must appear at most once (found ${corridorMattersCount})`);

  // ── 6. SEO INTEGRITY ────────────────────────────────────────────

  // Title
  const title = fields["seo-title"];
  assertContains(title, "LTL",
    `[${lane.label}] SEO title must contain 'LTL'`);
  assertContains(title, "WARP",
    `[${lane.label}] SEO title must contain 'WARP'`);

  // Meta description
  const meta = fields["seo-meta-description"];
  assert(meta.length >= 80 && meta.length <= 165,
    `[${lane.label}] Meta description must be 80-165 chars (got ${meta.length})`);

  // Canonical URL
  const canonical = fields["canonical-url"];
  assert(canonical.startsWith("https://www.wearewarp.com/lanes/"),
    `[${lane.label}] Canonical URL must start with wearewarp.com/lanes/`);

  // Breadcrumb schema
  assertContains(breadcrumbSchema, "BreadcrumbList",
    `[${lane.label}] Breadcrumb schema must contain BreadcrumbList`);
  assertContains(breadcrumbSchema, "Service",
    `[${lane.label}] Breadcrumb schema must contain Service type`);
  assertContains(breadcrumbSchema, "Organization",
    `[${lane.label}] Breadcrumb schema must contain Organization type`);
  assertContains(breadcrumbSchema, "FAQPage",
    `[${lane.label}] Breadcrumb schema must contain FAQPage type`);

  // FAQ questions in JSON-LD
  assertContains(breadcrumbSchema, "mainEntity",
    `[${lane.label}] FAQPage schema must contain mainEntity`);

  // ── 7. LTL VEHICLE FLEXIBILITY FRAMING ──────────────────────────

  // Execution flow must mention cargo van and box truck within LTL context
  assert(execFlow.toLowerCase().includes("cargo van"),
    `[${lane.label}] Execution Flow must mention 'cargo van' (vehicle flexibility)`);
  assert(execFlow.toLowerCase().includes("box truck"),
    `[${lane.label}] Execution Flow must mention 'box truck' (vehicle flexibility)`);

  // ── 8. PAGE STRUCTURE CHECKS ────────────────────────────────────

  // Comparison table should be clean
  const tradLtl = fields["traditional-ltl"];
  const warpLtl = fields["warp-ltl"];
  assert(tradLtl && tradLtl.length > 0,
    `[${lane.label}] traditional-ltl comparison field must not be empty`);
  assert(warpLtl && warpLtl.length > 0,
    `[${lane.label}] warp-ltl comparison field must not be empty`);

  // Body content should exist
  assert(bodyContent && bodyContent.length > 100,
    `[${lane.label}] body-content must be non-empty (got ${bodyContent?.length || 0} chars)`);

  console.log(`  ✓ All checks passed for ${lane.label}`);
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
  console.log("\n  ✓ ALL ARCHITECTURE TESTS PASSED");
  process.exit(0);
}
