/**
 * Section Ownership Tests — Comprehensive Boundary Enforcement
 *
 * These tests enforce that every major page section has ONE canonical owner,
 * no duplicate render paths produce the same structural content, and the
 * page factory behaves correctly across distance classes.
 *
 * OWNERSHIP MAP ENFORCED:
 *
 *  Section                    | Canonical Owner                    | CMS Field
 *  ---------------------------|------------------------------------|--------------------
 *  Hero H1                    | hero.headline → template H1        | hero-headline
 *  SEO Title                  | pageData.page_title                | seo-title
 *  SEO Meta Description       | pageData.meta_description          | seo-meta-description
 *  Canonical URL              | pageData.canonical_path            | canonical-url
 *  KPI Card Grid              | renderLaneIntelligencePanel()      | lane-intelligence-panel
 *  Execution Flow             | renderExecutionFlow()              | execution-flow
 *  Corridor Overview          | renderFaqSchemaEmbed() Section 2   | faq-schema
 *  Operating Details (prose)  | renderFaqSchemaEmbed() Section 4   | faq-schema
 *  Visibility/Proof           | renderFaqSchemaEmbed() Section 5   | faq-schema
 *  Why Shippers Use WARP      | renderFaqSchemaEmbed() Section 6   | faq-schema
 *  FAQ Visible                | renderFaqSchemaEmbed() Section 7   | faq-schema
 *  Final CTA                  | renderFaqSchemaEmbed() Section 8   | faq-schema
 *  Comparison Table (HTML)    | renderComparisonTableHtml()        | faq-schema (Section 9)
 *  Comparison (legacy text)   | buildTraditionalLtl/buildWarpLtl   | traditional-ltl, warp-ltl
 *  Proof/Pilot                | renderValidation()                 | proof-section
 *  Body Content (plain text)  | renderLanePageBody()               | body-content
 *  BreadcrumbList JSON-LD     | renderBreadcrumbSchemaEmbed()      | breadcrumb-schema
 *  Service JSON-LD            | renderBreadcrumbSchemaEmbed()      | breadcrumb-schema
 *  Organization JSON-LD       | renderBreadcrumbSchemaEmbed()      | breadcrumb-schema
 *  FAQPage JSON-LD            | renderBreadcrumbSchemaEmbed()      | breadcrumb-schema
 *
 * Run: node tests/section-ownership.test.js
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

function assertNotContains(haystack, needle, message) {
  assert(!haystack.includes(needle), message);
}

function countOccurrences(text, pattern) {
  return (text.match(pattern) || []).length;
}

// ── Test Data ────────────────────────────────────────────────────────

const BENCHMARK_LANES = [
  { origin: "Atlanta, GA", destination: "Orlando, FL", label: "short (ATL-ORL)" },
  { origin: "Atlanta, GA", destination: "Miami, FL", label: "medium (ATL-MIA)" },
  { origin: "Los Angeles, CA", destination: "New York, NY", label: "long (LA-NY)" },
];

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║  SECTION OWNERSHIP TESTS                                   ║");
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
  const proofSection = fields["proof-section"];
  const tradLtl = fields["traditional-ltl"];
  const warpLtl = fields["warp-ltl"];
  const heroHeadline = fields["hero-headline"];
  const subheadline = fields["subheadline"];
  const seoTitle = fields["seo-title"];
  const metaDesc = fields["seo-meta-description"];
  const canonicalUrl = fields["canonical-url"];
  const oCity = lane.origin.split(",")[0].trim();
  const dCity = lane.destination.split(",")[0].trim();

  // ────────────────────────────────────────────────────────────────
  // 1. HERO & H1 OWNERSHIP
  // ────────────────────────────────────────────────────────────────

  // Hero headline must contain origin and destination
  assertContains(heroHeadline, oCity,
    `[${lane.label}] hero-headline must contain origin city '${oCity}'`);
  assertContains(heroHeadline, dCity,
    `[${lane.label}] hero-headline must contain destination city '${dCity}'`);
  assertContains(heroHeadline, "LTL",
    `[${lane.label}] hero-headline must contain mode 'LTL'`);

  // Hero headline is the ONLY source of H1 — faq-schema must NOT contain H1 tags
  assert(!/<h1[\s>]/i.test(faqSchema),
    `[${lane.label}] faq-schema must NOT contain <h1> tags (H1 owned by template hero)`);
  assert(!/<h1[\s>]/i.test(laneIntelPanel),
    `[${lane.label}] lane-intelligence-panel must NOT contain <h1> tags`);
  assert(!/<h1[\s>]/i.test(execFlow),
    `[${lane.label}] execution-flow must NOT contain <h1> tags`);
  assert(!/<h1[\s>]/i.test(proofSection),
    `[${lane.label}] proof-section must NOT contain <h1> tags`);
  assert(!/<h1[\s>]/i.test(breadcrumbSchema),
    `[${lane.label}] breadcrumb-schema must NOT contain <h1> tags`);

  // ────────────────────────────────────────────────────────────────
  // 2. SEO TITLE & META DESCRIPTION OWNERSHIP
  // ────────────────────────────────────────────────────────────────

  // Title must be canonically sourced (contains city names + mode + brand)
  assertContains(seoTitle, oCity,
    `[${lane.label}] seo-title must contain origin city`);
  assertContains(seoTitle, dCity,
    `[${lane.label}] seo-title must contain destination city`);
  assertContains(seoTitle, "LTL",
    `[${lane.label}] seo-title must contain mode`);
  assertContains(seoTitle, "WARP",
    `[${lane.label}] seo-title must contain brand`);

  // Title length (Google truncates at ~60 chars)
  assert(seoTitle.length >= 30 && seoTitle.length <= 70,
    `[${lane.label}] seo-title must be 30-70 chars (got ${seoTitle.length})`);

  // Meta description length (Google truncates at ~160 chars)
  assert(metaDesc.length >= 80 && metaDesc.length <= 165,
    `[${lane.label}] meta description must be 80-165 chars (got ${metaDesc.length})`);

  // Meta must contain mode and cities
  assertContains(metaDesc, "LTL",
    `[${lane.label}] meta description must contain mode`);

  // Canonical URL must start with correct prefix
  assert(canonicalUrl.startsWith("https://www.wearewarp.com/lanes/"),
    `[${lane.label}] canonical-url must start with wearewarp.com/lanes/`);

  // ────────────────────────────────────────────────────────────────
  // 3. COMPARISON TABLE OWNERSHIP
  // ────────────────────────────────────────────────────────────────

  // Comparison HTML table must exist exactly once in faq-schema
  const compTableCount = countOccurrences(faqSchema, /Traditional.*?vs WARP/g);
  assert(compTableCount === 1,
    `[${lane.label}] faq-schema must contain exactly 1 comparison table heading (found ${compTableCount})`);

  // Comparison table must contain expected metrics
  assertContains(faqSchema, "Quote Speed",
    `[${lane.label}] faq-schema comparison must contain 'Quote Speed' metric`);
  assertContains(faqSchema, "Pallet Tracking",
    `[${lane.label}] faq-schema comparison must contain 'Pallet Tracking' metric`);

  // Comparison must NOT be in other fields
  assertNotContains(laneIntelPanel, "Traditional",
    `[${lane.label}] lane-intelligence-panel must NOT contain comparison`);
  assertNotContains(execFlow, "Traditional",
    `[${lane.label}] execution-flow must NOT contain comparison`);

  // Legacy plain-text comparison must still exist (backward compat)
  assert(tradLtl && tradLtl.length > 0,
    `[${lane.label}] traditional-ltl must be populated (legacy compat)`);
  assert(warpLtl && warpLtl.length > 0,
    `[${lane.label}] warp-ltl must be populated (legacy compat)`);

  // Legacy comparison is plain text, NOT HTML tables
  assert(!tradLtl.includes("<table"),
    `[${lane.label}] traditional-ltl must be plain text, not HTML`);
  assert(!warpLtl.includes("<table"),
    `[${lane.label}] warp-ltl must be plain text, not HTML`);

  // ────────────────────────────────────────────────────────────────
  // 4. CORRIDOR MATTERS OWNERSHIP
  // ────────────────────────────────────────────────────────────────

  // "Corridor Matters" must appear exactly once across all fields
  const allFields = faqSchema + laneIntelPanel + execFlow + proofSection;
  const corridorCount = countOccurrences(allFields, /Corridor Matters/g);
  assert(corridorCount === 1,
    `[${lane.label}] 'Corridor Matters' must appear exactly once across fields (found ${corridorCount})`);

  // Must be in faq-schema (its canonical owner)
  assertContains(faqSchema, "Corridor Matters",
    `[${lane.label}] 'Corridor Matters' must be in faq-schema (canonical owner)`);

  // ────────────────────────────────────────────────────────────────
  // 5. WHY SHIPPERS CHOOSE WARP OWNERSHIP
  // ────────────────────────────────────────────────────────────────

  // "Why Shippers Use WARP" heading (generated by buildWhyWarpSection in lane-page-schema.js)
  const whyWarpCount = countOccurrences(allFields, /Why Shippers Use WARP/g);
  assert(whyWarpCount === 1,
    `[${lane.label}] 'Why Shippers Use WARP' must appear exactly once (found ${whyWarpCount})`);

  // Must be in faq-schema
  assertContains(faqSchema, "Why Shippers Use WARP",
    `[${lane.label}] 'Why Shippers Use WARP' must be in faq-schema (canonical owner)`);

  // ────────────────────────────────────────────────────────────────
  // 6. FAQ DATA INTEGRITY (visible matches schema)
  // ────────────────────────────────────────────────────────────────

  // Visible FAQ must exist in faq-schema
  assertContains(faqSchema, "Frequently Asked Questions",
    `[${lane.label}] faq-schema must contain visible FAQ section`);

  // FAQPage JSON-LD must exist in breadcrumb-schema
  assertContains(breadcrumbSchema, "FAQPage",
    `[${lane.label}] breadcrumb-schema must contain FAQPage JSON-LD`);
  assertContains(breadcrumbSchema, "mainEntity",
    `[${lane.label}] FAQPage schema must contain mainEntity`);
  assertContains(breadcrumbSchema, "acceptedAnswer",
    `[${lane.label}] FAQPage schema must contain acceptedAnswer`);

  // FAQ questions in visible HTML must also appear in JSON-LD
  // Extract first FAQ question from faq-schema visible section
  const faqQuestionMatch = faqSchema.match(/Frequently Asked Questions[\s\S]*?<h3[^>]*>([^<]+)<\/h3>/);
  if (faqQuestionMatch) {
    const firstVisibleQuestion = faqQuestionMatch[1].trim();
    assertContains(breadcrumbSchema, firstVisibleQuestion,
      `[${lane.label}] First visible FAQ question must appear in FAQPage JSON-LD`);
  }

  // ────────────────────────────────────────────────────────────────
  // 7. BREADCRUMB SCHEMA INTEGRITY
  // ────────────────────────────────────────────────────────────────

  assertContains(breadcrumbSchema, "BreadcrumbList",
    `[${lane.label}] breadcrumb-schema must contain BreadcrumbList`);
  assertContains(breadcrumbSchema, "Service",
    `[${lane.label}] breadcrumb-schema must contain Service type`);
  assertContains(breadcrumbSchema, "Organization",
    `[${lane.label}] breadcrumb-schema must contain Organization type`);

  // BreadcrumbList must reference the lane page
  assertContains(breadcrumbSchema, `${oCity} to ${dCity}`,
    `[${lane.label}] BreadcrumbList must contain lane name`);

  // Service schema must reference the corridor
  assertContains(breadcrumbSchema, "LTL Freight Service",
    `[${lane.label}] Service schema must reference LTL Freight Service`);

  // Each schema type must appear exactly once
  const breadcrumbListCount = countOccurrences(breadcrumbSchema, /"@type":\s*"BreadcrumbList"/g);
  assert(breadcrumbListCount === 1,
    `[${lane.label}] BreadcrumbList must appear exactly once (found ${breadcrumbListCount})`);

  const serviceCount = countOccurrences(breadcrumbSchema, /"@type":\s*"Service"/g);
  assert(serviceCount === 1,
    `[${lane.label}] Service schema must appear exactly once (found ${serviceCount})`);

  // Organization appears twice: once as standalone schema, once nested in Service.provider.
  // This is correct — the Service provider references the Organization.
  const orgCount = countOccurrences(breadcrumbSchema, /"@type":\s*"Organization"/g);
  assert(orgCount === 2,
    `[${lane.label}] Organization type must appear exactly twice: standalone + Service.provider (found ${orgCount})`);

  const faqPageCount = countOccurrences(breadcrumbSchema, /"@type":\s*"FAQPage"/g);
  assert(faqPageCount === 1,
    `[${lane.label}] FAQPage schema must appear exactly once (found ${faqPageCount})`);

  // ────────────────────────────────────────────────────────────────
  // 8. NO DUPLICATE SECTION HEADINGS ACROSS FIELDS
  // ────────────────────────────────────────────────────────────────

  // Extract all H2 headings from faq-schema
  const faqSchemaH2s = (faqSchema.match(/<h2[^>]*>([^<]+)<\/h2>/g) || [])
    .map(h => h.replace(/<\/?h2[^>]*>/g, "").trim());

  // No H2 heading in faq-schema should also appear in other dedicated fields
  for (const heading of faqSchemaH2s) {
    assertNotContains(laneIntelPanel, heading,
      `[${lane.label}] H2 '${heading.substring(0, 40)}...' in faq-schema must NOT also be in lane-intel-panel`);
    assertNotContains(execFlow, heading,
      `[${lane.label}] H2 '${heading.substring(0, 40)}...' in faq-schema must NOT also be in execution-flow`);
  }

  // No duplicate H2 headings within faq-schema itself
  const uniqueH2s = new Set(faqSchemaH2s);
  assert(uniqueH2s.size === faqSchemaH2s.length,
    `[${lane.label}] faq-schema must not have duplicate H2 headings (${faqSchemaH2s.length} total, ${uniqueH2s.size} unique)`);

  // ────────────────────────────────────────────────────────────────
  // 9. NO HIDDEN LEGACY STRUCTURAL OWNERS
  // ────────────────────────────────────────────────────────────────

  // body-content must be plain text (no HTML tags)
  assert(!bodyContent.includes("<h2"),
    `[${lane.label}] body-content must be plain text (no <h2> tags)`);
  assert(!bodyContent.includes("<div"),
    `[${lane.label}] body-content must be plain text (no <div> tags)`);
  assert(!bodyContent.includes("<table"),
    `[${lane.label}] body-content must be plain text (no <table> tags)`);

  // proof-section must NOT contain comparison or KPI content
  assertNotContains(proofSection, "Traditional",
    `[${lane.label}] proof-section must NOT contain comparison`);
  assertNotContains(proofSection, "Lane Distance",
    `[${lane.label}] proof-section must NOT contain KPI card label`);

  // ────────────────────────────────────────────────────────────────
  // 10. FAQ-SCHEMA STRUCTURAL SECTION COUNT
  // ────────────────────────────────────────────────────────────────

  // Count <h2> tags as a proxy for structural sections
  const h2Count = countOccurrences(faqSchema, /<h2/g);
  assert(h2Count >= 5 && h2Count <= 7,
    `[${lane.label}] faq-schema should have 5-7 structural sections/H2s (found ${h2Count})`);

  // ────────────────────────────────────────────────────────────────
  // 11. LTL VEHICLE FLEXIBILITY PRESERVED
  // ────────────────────────────────────────────────────────────────

  // cargo van and box truck must appear in execution flow
  assert(execFlow.toLowerCase().includes("cargo van"),
    `[${lane.label}] execution-flow must mention 'cargo van'`);
  assert(execFlow.toLowerCase().includes("box truck"),
    `[${lane.label}] execution-flow must mention 'box truck'`);

  // body-content must frame vehicle flexibility correctly
  assert(bodyContent.toLowerCase().includes("cargo van") || bodyContent.toLowerCase().includes("box truck"),
    `[${lane.label}] body-content must mention vehicle flexibility`);

  // ────────────────────────────────────────────────────────────────
  // 12. CANONICAL DATA FLOW VERIFICATION
  // ────────────────────────────────────────────────────────────────

  // Hero subheadline must contain distance and transit data
  assert(subheadline.includes("mile") || subheadline.includes("mi"),
    `[${lane.label}] subheadline must contain distance`);
  assert(subheadline.includes("day"),
    `[${lane.label}] subheadline must contain transit days`);

  // All CMS fields with city references must use consistent names
  assert(fields["origin-city"] === oCity,
    `[${lane.label}] origin-city must equal '${oCity}'`);
  assert(fields["destination-city"] === dCity,
    `[${lane.label}] destination-city must equal '${dCity}'`);

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
  console.log("\n  ✓ ALL SECTION OWNERSHIP TESTS PASSED");
  process.exit(0);
}
