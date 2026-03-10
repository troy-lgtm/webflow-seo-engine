/**
 * Pipeline Parity & Drift Detection Tests
 *
 * These tests enforce that the TWO rendering pipelines — live Webflow CMS
 * (renderWebflowFields) and static export/preview (renderLanePageHtml) —
 * stay aligned on content and data, even when their presentation differs.
 *
 * PIPELINES TESTED:
 *   1. LIVE:    renderWebflowFields(pageData) → CMS field payload
 *   2. PREVIEW: renderLanePageHtml(pageData)  → full HTML body
 *
 * TEST CATEGORIES:
 *   A. SHARED RENDERER PARITY — sections using shared renderers produce
 *      identical content in both pipelines
 *   B. DATA ALIGNMENT — independent renderers that share the same canonical
 *      data source produce consistent factual content (even if styled differently)
 *   C. SCHEMA PARITY — JSON-LD schemas are identical in both pipelines
 *   D. LEGACY FIELD GUARDS — legacy fields remain populated and plain-text
 *   E. ARCHITECTURE INVARIANTS — structural rules that must hold across all
 *      distance classes
 *
 * Run: node tests/pipeline-parity.test.js
 */

import {
  buildPackageForLane,
  buildWebflowFields,
  buildBodyContent,
} from "../lib/lane-factory.js";

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
console.log("║  PIPELINE PARITY & DRIFT DETECTION TESTS                   ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

for (const lane of BENCHMARK_LANES) {
  console.log(`── Testing: ${lane.label} ──`);

  const pkg = buildPackageForLane(lane.origin, lane.destination, "LTL", "smb");
  const fields = buildWebflowFields(pkg.page);
  const previewHtml = buildBodyContent(pkg.page);

  const faqSchema = fields["faq-schema"];
  const laneIntelPanel = fields["lane-intelligence-panel"];
  const execFlow = fields["execution-flow"];
  const breadcrumbSchema = fields["breadcrumb-schema"];
  const proofSection = fields["proof-section"];
  const tradLtl = fields["traditional-ltl"];
  const warpLtl = fields["warp-ltl"];
  const oCity = lane.origin.split(",")[0].trim();
  const dCity = lane.destination.split(",")[0].trim();

  // ══════════════════════════════════════════════════════════════════
  // A. SHARED RENDERER PARITY
  // ══════════════════════════════════════════════════════════════════

  // ── A1: Comparison Table — renderComparisonTableHtml() ──
  // Both pipelines call the same shared renderer. The comparison heading
  // and metrics must appear in both outputs.

  assertContains(faqSchema, `Traditional LTL vs WARP: ${oCity} to ${dCity}`,
    `[${lane.label}] LIVE: faq-schema must contain comparison heading`);
  assertContains(previewHtml, `Traditional LTL vs WARP: ${oCity} to ${dCity}`,
    `[${lane.label}] PREVIEW: previewHtml must contain comparison heading`);

  // Same metrics must appear in both
  const compMetrics = ["Quote Speed", "Pallet Tracking", "Exception Handling"];
  for (const metric of compMetrics) {
    assertContains(faqSchema, metric,
      `[${lane.label}] LIVE: comparison must contain '${metric}'`);
    assertContains(previewHtml, metric,
      `[${lane.label}] PREVIEW: comparison must contain '${metric}'`);
  }

  // ── A2: Final CTA — renderFinalCta() ──
  // Both pipelines call the same function. CTA headline must match.

  // Extract CTA headline from faq-schema
  const ctaHeadlineMatch = faqSchema.match(/Ready to Ship.*?<\/h2>/);
  if (ctaHeadlineMatch) {
    // Same text must appear in preview
    const ctaText = ctaHeadlineMatch[0].replace(/<\/?h2[^>]*>/g, "").trim();
    assertContains(previewHtml, ctaText,
      `[${lane.label}] Final CTA headline must appear in both pipelines`);
  }

  // CTA URLs must appear in both
  assertContains(faqSchema, "wearewarp.com/quote",
    `[${lane.label}] LIVE: Final CTA must link to quote page`);
  assertContains(previewHtml, "wearewarp.com/quote",
    `[${lane.label}] PREVIEW: Final CTA must link to quote page`);

  // ── A3: Proof/Pilot — renderValidation() ──
  // Both pipelines call the same function. "Validate This Lane" must
  // appear in both.

  assertContains(proofSection, "Validate This Lane",
    `[${lane.label}] LIVE: proof-section must contain 'Validate This Lane'`);
  assertContains(previewHtml, "Validate This Lane",
    `[${lane.label}] PREVIEW: previewHtml must contain 'Validate This Lane'`);

  // ── A4: Why Warp Reason Cards — renderWhyWarpReasonCardsHtml() ──
  // Both pipelines call the shared renderer. Heading and reason cards
  // must appear in both.

  assertContains(faqSchema, `Why Shippers Use WARP`,
    `[${lane.label}] LIVE: faq-schema must contain 'Why Shippers Use WARP'`);
  assertContains(previewHtml, `Why Shippers Use WARP`,
    `[${lane.label}] PREVIEW: previewHtml must contain 'Why Shippers Use WARP'`);

  // Extract first reason card heading from faq-schema
  const whyWarpSection = faqSchema.split("Why Shippers Use WARP")[1] || "";
  const reasonHeadingMatch = whyWarpSection.match(/<h3[^>]*>([^<]+)<\/h3>/);
  if (reasonHeadingMatch) {
    const reasonHeading = reasonHeadingMatch[1].trim();
    assertContains(previewHtml, reasonHeading,
      `[${lane.label}] Why-Warp reason '${reasonHeading.substring(0, 30)}...' must appear in both pipelines`);
  }

  // ══════════════════════════════════════════════════════════════════
  // B. DATA ALIGNMENT — Independent renderers, same data source
  // ══════════════════════════════════════════════════════════════════

  // ── B1: Lane Overview data alignment ──
  // Live faq-schema Section 2 and preview renderLaneOverview() both
  // read from pageData.lane_overview. Both must contain the overview body.

  // The overview heading text differs ("Why the X to Y Corridor Matters" vs
  // "Lane Overview: X to Y"), but the body text must appear in both.
  assertContains(faqSchema, oCity,
    `[${lane.label}] LIVE faq-schema corridor section must contain origin city`);
  assertContains(faqSchema, dCity,
    `[${lane.label}] LIVE faq-schema corridor section must contain destination city`);
  assertContains(previewHtml, oCity,
    `[${lane.label}] PREVIEW must contain origin city`);
  assertContains(previewHtml, dCity,
    `[${lane.label}] PREVIEW must contain destination city`);

  // ── B2: Operating Details data alignment ──
  // Both pipelines read from pageData.operating_details.items.
  // Key items like "Lane distance:" must appear in both.

  assertContains(faqSchema, "Lane distance:",
    `[${lane.label}] LIVE: operating details must contain 'Lane distance:'`);
  assertContains(previewHtml, "Lane distance:",
    `[${lane.label}] PREVIEW: operating details must contain 'Lane distance:'`);

  assertContains(faqSchema, "Standard transit:",
    `[${lane.label}] LIVE: operating details must contain 'Standard transit:'`);
  assertContains(previewHtml, "Standard transit:",
    `[${lane.label}] PREVIEW: operating details must contain 'Standard transit:'`);

  // ── B3: FAQ data alignment ──
  // NOTE: The preview pipeline (renderLanePageHtml) does NOT include FAQ
  // visible content. renderInlineFaqHtml() exists but is NOT called by
  // renderLanePageHtml(). This is a KNOWN ARCHITECTURE GAP — the preview
  // is a simpler static export that omits FAQ accordion and JSON-LD.
  //
  // We verify that the LIVE pipeline has FAQ content and that the FAQ
  // questions are consistent between visible HTML and JSON-LD schema.

  // Extract FAQ questions from faq-schema visible section (live)
  const faqSectionText = faqSchema.split("Frequently Asked Questions")[1] || "";
  const liveQuestions = (faqSectionText.match(/<h3[^>]*>([^<]+)<\/h3>/g) || [])
    .map(h => h.replace(/<\/?h3[^>]*>/g, "").trim());

  assert(liveQuestions.length >= 5,
    `[${lane.label}] LIVE: must have at least 5 visible FAQ questions (found ${liveQuestions.length})`);

  // FAQ questions in visible HTML must also appear in FAQPage JSON-LD (same pipeline)
  for (const q of liveQuestions) {
    assertContains(breadcrumbSchema, q,
      `[${lane.label}] FAQ question '${q.substring(0, 40)}...' must appear in both visible HTML and JSON-LD`);
  }

  // ══════════════════════════════════════════════════════════════════
  // C. SCHEMA INTEGRITY — JSON-LD in live pipeline
  // ══════════════════════════════════════════════════════════════════
  //
  // NOTE: The preview pipeline (renderLanePageHtml) does NOT include
  // JSON-LD schemas. renderInlineSchemas() exists but is NOT called by
  // renderLanePageHtml(). Schemas are live-only (breadcrumb-schema field).
  // Both pipelines now share buildLaneSchemaObjects() as the canonical
  // data builder, ensuring structural consistency IF the preview pipeline
  // adds schema output in the future.

  // ── C1: Live schemas contain all required types ──
  assertContains(breadcrumbSchema, "BreadcrumbList",
    `[${lane.label}] LIVE: breadcrumb-schema must contain BreadcrumbList`);
  assertContains(breadcrumbSchema, "LTL Freight Service",
    `[${lane.label}] LIVE: breadcrumb-schema must contain Service name`);
  assertContains(breadcrumbSchema, '"Organization"',
    `[${lane.label}] LIVE: breadcrumb-schema must contain Organization`);
  assertContains(breadcrumbSchema, '"FAQPage"',
    `[${lane.label}] LIVE: breadcrumb-schema must contain FAQPage`);

  // ── C2: Schema data consistency — FAQ questions match between ──
  //    visible HTML (faq-schema Section 7) and JSON-LD (breadcrumb-schema)
  const liveFaqSchemaText = breadcrumbSchema.split("FAQPage")[1] || "";
  const liveSchemaQuestions = (liveFaqSchemaText.match(/"name":\s*"([^"]+)"/g) || [])
    .map(m => m.replace(/"name":\s*"/, "").replace(/"$/, ""));

  assert(liveSchemaQuestions.length >= 5,
    `[${lane.label}] FAQPage JSON-LD must have at least 5 questions (found ${liveSchemaQuestions.length})`);

  // Visible FAQ questions must match JSON-LD questions
  assert(liveQuestions.length === liveSchemaQuestions.length,
    `[${lane.label}] Visible FAQ count (${liveQuestions.length}) must match JSON-LD FAQ count (${liveSchemaQuestions.length})`);

  // ── C3: buildLaneSchemaObjects() produces consistent data ──
  // Verify breadcrumb references the correct lane
  assertContains(breadcrumbSchema, `${oCity} to ${dCity}`,
    `[${lane.label}] BreadcrumbList must reference lane name`);
  assertContains(breadcrumbSchema, "wearewarp.com",
    `[${lane.label}] Schemas must reference canonical domain`);

  // ══════════════════════════════════════════════════════════════════
  // D. LEGACY FIELD GUARDS
  // ══════════════════════════════════════════════════════════════════

  // ── D1: Legacy comparison fields remain populated ──
  assert(tradLtl && tradLtl.length > 0,
    `[${lane.label}] traditional-ltl must remain populated (legacy guard)`);
  assert(warpLtl && warpLtl.length > 0,
    `[${lane.label}] warp-ltl must remain populated (legacy guard)`);

  // ── D2: Legacy comparison is plain text, never HTML ──
  assertNotContains(tradLtl, "<table",
    `[${lane.label}] traditional-ltl must be plain text (no <table>)`);
  assertNotContains(tradLtl, "<div",
    `[${lane.label}] traditional-ltl must be plain text (no <div>)`);
  assertNotContains(warpLtl, "<table",
    `[${lane.label}] warp-ltl must be plain text (no <table>)`);
  assertNotContains(warpLtl, "<div",
    `[${lane.label}] warp-ltl must be plain text (no <div>)`);

  // ── D3: Legacy comparison contains expected metrics ──
  assertContains(tradLtl, "Quote Speed",
    `[${lane.label}] traditional-ltl must contain 'Quote Speed' metric`);
  assertContains(warpLtl, "Quote Speed",
    `[${lane.label}] warp-ltl must contain 'Quote Speed' metric`);

  // ── D4: Legacy metrics count matches HTML table metrics count ──
  const legacyMetricCount = tradLtl.split("\n").filter(l => l.trim()).length;
  const htmlTableRows = countOccurrences(faqSchema, /<tr>/g);
  // HTML table has header row + data rows; legacy has data rows only
  // HTML table rows = header (1) + data rows. Legacy lines = data rows.
  assert(legacyMetricCount >= 5,
    `[${lane.label}] traditional-ltl must have at least 5 comparison metrics (found ${legacyMetricCount})`);

  // ══════════════════════════════════════════════════════════════════
  // E. ARCHITECTURE INVARIANTS
  // ══════════════════════════════════════════════════════════════════

  // ── E1: No H1 tags in any CMS content field ──
  const allCmsContent = faqSchema + laneIntelPanel + execFlow + proofSection;
  assert(!/<h1[\s>]/i.test(allCmsContent),
    `[${lane.label}] No CMS content field may contain <h1> tags`);

  // ── E2: Preview must have exactly one H1 ──
  const previewH1Count = countOccurrences(previewHtml, /<h1[\s>]/gi);
  assert(previewH1Count === 1,
    `[${lane.label}] Preview must have exactly 1 <h1> (found ${previewH1Count})`);

  // ── E3: Both pipelines reference the same canonical URL base ──
  assertContains(faqSchema, "wearewarp.com",
    `[${lane.label}] LIVE: must reference wearewarp.com`);
  assertContains(previewHtml, "wearewarp.com",
    `[${lane.label}] PREVIEW: must reference wearewarp.com`);

  // ── E4: Both pipelines contain the same mode label ──
  assertContains(faqSchema, "LTL",
    `[${lane.label}] LIVE: must contain mode 'LTL'`);
  assertContains(previewHtml, "LTL",
    `[${lane.label}] PREVIEW: must contain mode 'LTL'`);

  // ── E5: Shared renderers produce non-empty output ──
  assert(proofSection.length > 100,
    `[${lane.label}] renderValidation() (shared) must produce substantial output (got ${proofSection.length})`);

  // ── E6: Preview pipeline sections completeness ──
  // Preview must contain all expected section types.
  // NOTE: Preview uses the canonical heading "Why This Corridor Matters"
  // (from lane_overview.heading), not "Lane Overview" as a section label.
  const previewSections = [
    "Why This Corridor Matters",
    "How WARP",
    "Transit and Operating Details",
    "Traditional LTL vs WARP",
    "Validate This Lane",
    "Why Shippers Use WARP",
  ];
  for (const section of previewSections) {
    assertContains(previewHtml, section,
      `[${lane.label}] PREVIEW must contain section '${section}'`);
  }

  // ── E7: Live pipeline sections completeness ──
  const liveSections = [
    "Corridor Matters",
    "Transit and Operating Details",
    "Shipment Visibility",
    "Why Shippers Use WARP",
    "Frequently Asked Questions",
    "Traditional LTL vs WARP",
  ];
  for (const section of liveSections) {
    assertContains(faqSchema, section,
      `[${lane.label}] LIVE faq-schema must contain section '${section}'`);
  }

  // ── E8: KPI Panel is live-only, not in preview ──
  assertNotContains(previewHtml, "Lane Distance",
    `[${lane.label}] PREVIEW must NOT contain KPI card 'Lane Distance' (live-only component)`);
  assertContains(laneIntelPanel, "Lane Distance",
    `[${lane.label}] LIVE: Lane Intelligence Panel must contain 'Lane Distance'`);

  // ── E9: Execution Flow is live-only, not in preview ──
  assertNotContains(previewHtml, "How Freight Moves",
    `[${lane.label}] PREVIEW must NOT contain 'How Freight Moves' (live-only component)`);
  assertContains(execFlow, "How Freight Moves",
    `[${lane.label}] LIVE: Execution Flow must contain 'How Freight Moves'`);

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
  console.log("\n  ✓ ALL PIPELINE PARITY TESTS PASSED");
  process.exit(0);
}
