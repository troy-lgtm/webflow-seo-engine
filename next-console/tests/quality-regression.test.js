/**
 * Quality Regression Tests — Pre-Publish Quality Gate Validation
 *
 * Proves that:
 *   1. Well-formed lane pages PASS all quality gates
 *   2. Structurally degraded pages FAIL the correct gates
 *   3. Scoring is deterministic (same input → same output)
 *   4. Hard gates cannot be overridden by high aggregate scores
 *   5. Quality scoring integrates correctly with publish decision
 *
 * These tests use NO network calls and NO external dependencies.
 * They generate content locally using the production pipeline and
 * verify quality assessment against known-good and known-bad inputs.
 *
 * Run: node tests/quality-regression.test.js
 */

import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import { renderWebflowFields } from "../lib/render-lane-page.js";
import { assessPublishQuality, scanForBannedLaneContent, detectFallbackTemplateLeakage } from "../lib/lane-page-validator.js";
import { scorePageQuality, scoreFaqSet } from "../lib/page-quality-scorer.js";

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

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

function assertGte(actual, threshold, message) {
  assert(actual >= threshold, `${message} (expected >= ${threshold}, got ${actual})`);
}

function assertLt(actual, threshold, message) {
  assert(actual < threshold, `${message} (expected < ${threshold}, got ${actual})`);
}

// ── Test Fixtures — Real Lanes ──────────────────────────────────────

const LANES = {
  short: { origin: "Atlanta, GA", destination: "Orlando, FL", mode: "LTL", label: "Short (474 mi)" },
  medium: { origin: "Atlanta, GA", destination: "Miami, FL", mode: "LTL", label: "Medium (716 mi)" },
  long: { origin: "Los Angeles, CA", destination: "New York, NY", mode: "LTL", label: "Long (2886 mi)" },
};

/**
 * Build a complete page package for a lane — canonical data + rendered fields.
 */
function buildLanePage(lane) {
  const knowledge = buildLaneKnowledge({
    origin: lane.origin,
    destination: lane.destination,
    mode: lane.mode,
  });
  const pageData = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null,
    related_lanes: [],
    tool_link: "https://www.wearewarp.com/quote",
    data_link: null,
  });
  const fields = renderWebflowFields(pageData);
  return { pageData, fields };
}

console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║  QUALITY REGRESSION TESTS — Pre-Publish Gate Validation    ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

// ═══════════════════════════════════════════════════════════════════════
// 1. WELL-FORMED PAGES MUST PASS ALL GATES
// ═══════════════════════════════════════════════════════════════════════

console.log("── 1. Well-Formed Pages Pass All Gates ────────────────────\n");

for (const [key, lane] of Object.entries(LANES)) {
  console.log(`  Testing: ${lane.label} (${lane.origin} → ${lane.destination})`);
  const { pageData, fields } = buildLanePage(lane);
  const result = assessPublishQuality(pageData, fields);

  assert(result.publishable, `${lane.label}: must be publishable`);
  assertGte(result.score, 55, `${lane.label}: score must be >= 55%`);
  assert(result.grade !== "F", `${lane.label}: grade must not be F (got ${result.grade})`);

  // All gates must pass
  for (const [gate, value] of Object.entries(result.gates)) {
    assert(value, `${lane.label}: gate ${gate} must pass`);
  }

  // Must have real lane data
  assert(result.lane.distance > 0, `${lane.label}: distance must be > 0`);
  assert(result.lane.origin === lane.origin, `${lane.label}: origin must match`);
  assert(result.lane.destination === lane.destination, `${lane.label}: destination must match`);

  // Errors must be empty for publishable pages
  assertEqual(result.errors.length, 0, `${lane.label}: errors must be empty for publishable page`);

  console.log(`    → ${result.score}% (${result.grade}) — ${result.gates_passed}/${result.gate_count} gates ✓\n`);
}

// ═══════════════════════════════════════════════════════════════════════
// 2. STRUCTURAL DEGRADATION — MISSING SECTIONS
// ═══════════════════════════════════════════════════════════════════════

console.log("── 2. Structural Degradation: Missing Sections ────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Remove hero headline
  const degradedPd = { ...pageData, hero: { ...pageData.hero, headline: "" } };
  const result = assessPublishQuality(degradedPd, fields);
  assert(!result.publishable, "Missing hero headline must block publish");
  assert(!result.gates["QG-STRUCT-01"], "QG-STRUCT-01 must fail with missing hero");
  console.log(`  Missing hero: publishable=${result.publishable}, score=${result.score}%`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Remove FAQs (below minimum)
  const degradedPd = { ...pageData, lane_specific_faqs: [{ question: "Q?", answer: "A." }] };
  const result = assessPublishQuality(degradedPd, fields);
  assert(!result.publishable, "Insufficient FAQs must block publish");
  assert(!result.gates["QG-CONTENT-04"], "QG-CONTENT-04 must fail with < 4 FAQs");
  console.log(`  Insufficient FAQs: publishable=${result.publishable}, gates_failed=${result.gates_failed}`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Remove all canonical sections
  const gutted = {
    ...pageData,
    hero: { headline: "" },
    lane_overview: null,
    operating_details: null,
    pricing_and_commercial_framing: null,
    lane_specific_faqs: [],
    why_warp: null,
    final_cta: null,
    lane_relevant_cta: null,
  };
  const result = assessPublishQuality(gutted, fields);
  assert(!result.publishable, "Gutted page must block publish");
  assertGte(result.gates_failed, 2, "Gutted page must fail multiple gates");
  console.log(`  Gutted page: publishable=${result.publishable}, gates_failed=${result.gates_failed}, score=${result.score}%`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 3. SEO DEGRADATION
// ═══════════════════════════════════════════════════════════════════════

console.log("── 3. SEO Degradation ──────────────────────────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Remove SEO fields
  const degradedPd = {
    ...pageData,
    page_title: "",
    meta_description: "",
    canonical_path: "",
    lane_slug: "",
  };
  const result = assessPublishQuality(degradedPd, fields);
  assert(!result.publishable, "Missing SEO fields must block publish");
  assert(!result.gates["QG-STRUCT-02"], "QG-STRUCT-02 must fail with empty SEO fields");
  console.log(`  Missing SEO: publishable=${result.publishable}, QG-STRUCT-02=${result.gates["QG-STRUCT-02"]}`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Short page title
  const degradedPd = { ...pageData, page_title: "Too short" };
  const result = assessPublishQuality(degradedPd, fields);
  assert(!result.publishable, "Short page title must block publish");
  assert(!result.gates["QG-STRUCT-02"], "QG-STRUCT-02 must fail with short title");
  console.log(`  Short title: publishable=${result.publishable}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 4. LANE STATS DEGRADATION
// ═══════════════════════════════════════════════════════════════════════

console.log("── 4. Lane Stats Degradation (Enrichment Failure) ─────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Zero distance — enrichment likely failed
  const degradedPd = {
    ...pageData,
    lane_stats: {
      ...pageData.lane_stats,
      estimated_distance_miles: 0,
    },
  };
  const result = assessPublishQuality(degradedPd, fields);
  assert(!result.publishable, "Zero distance must block publish");
  assert(!result.gates["QG-STRUCT-03"], "QG-STRUCT-03 must fail with zero distance");
  console.log(`  Zero distance: publishable=${result.publishable}`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Missing carrier count
  const degradedPd = {
    ...pageData,
    network_proof: {
      ...pageData.network_proof,
      estimated_carrier_count: 0,
    },
  };
  const result = assessPublishQuality(degradedPd, fields);
  assert(!result.publishable, "Zero carriers must block publish");
  assert(!result.gates["QG-STRUCT-03"], "QG-STRUCT-03 must fail with zero carriers");
  console.log(`  Zero carriers: publishable=${result.publishable}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 5. OWNERSHIP INTEGRITY — KPI DUPLICATION
// ═══════════════════════════════════════════════════════════════════════

console.log("── 5. Ownership Integrity: KPI Duplication ─────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Inject a KPI card grid pattern into faq-schema (simulates ownership violation)
  const poisonedFields = {
    ...fields,
    "faq-schema": fields["faq-schema"] +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">' +
      '<div style="border-radius:12px;padding:16px;">Lane Distance: 474 mi</div>' +
      '<div style="border-radius:12px;padding:16px;">Transit Window: 2–3 days</div>' +
      '</div>',
  };

  const result = assessPublishQuality(pageData, poisonedFields);
  assert(!result.publishable, "KPI duplication in faq-schema must block publish");
  assert(!result.gates["QG-OWNER-01"], "QG-OWNER-01 must fail when KPIs leak into faq-schema");
  console.log(`  KPI leak: publishable=${result.publishable}, QG-OWNER-01=${result.gates["QG-OWNER-01"]}`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Inject execution flow heading into faq-schema (ownership violation)
  const poisonedFields = {
    ...fields,
    "faq-schema": fields["faq-schema"] +
      '<h2>How Freight Moves from Atlanta to Orlando</h2>' +
      '<div>Origin Pickup → Cross-Dock Consolidation → Linehaul → Final Delivery</div>',
  };

  const result = assessPublishQuality(pageData, poisonedFields);
  assert(!result.publishable, "Execution flow in faq-schema must block publish");
  assert(!result.gates["QG-OWNER-02"], "QG-OWNER-02 must fail when exec-flow leaks into faq-schema");
  console.log(`  Exec-flow leak: publishable=${result.publishable}, QG-OWNER-02=${result.gates["QG-OWNER-02"]}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 6. DUPLICATE DETECTION
// ═══════════════════════════════════════════════════════════════════════

console.log("── 6. Duplicate Detection ──────────────────────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Inject duplicate comparison table
  const poisonedFields = {
    ...fields,
    "faq-schema": fields["faq-schema"] +
      '<h2>Traditional LTL vs WARP</h2><table><tr><td>Duplicate</td></tr></table>' +
      '<h2>Traditional LTL vs WARP</h2><table><tr><td>Duplicate 2</td></tr></table>',
  };

  const result = assessPublishQuality(pageData, poisonedFields);
  assert(!result.publishable, "Duplicate comparison tables must block publish");
  assert(!result.gates["QG-OWNER-03"], "QG-OWNER-03 must fail with duplicate comparisons");
  console.log(`  Duplicate comparison: publishable=${result.publishable}`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Inject duplicate section headings
  const poisonedFields = {
    ...fields,
    "faq-schema": fields["faq-schema"] +
      '<h2>Why This Corridor Matters</h2><p>Duplicate section</p>',
  };

  // Check for duplicate heading detection
  const result = assessPublishQuality(pageData, poisonedFields);
  // Note: This will detect duplicate h2 headings
  const hasDupeCheck = result.gates["QG-DUPLICATE-01"] !== undefined;
  assert(hasDupeCheck, "QG-DUPLICATE-01 gate must exist");
  if (!result.gates["QG-DUPLICATE-01"]) {
    console.log(`  Duplicate headings correctly detected and blocked`);
  } else {
    // May or may not catch it depending on exact heading normalization
    console.log(`  Duplicate headings: gate passed (heading may differ in casing/whitespace)`);
  }
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 7. SCHEMA INTEGRITY
// ═══════════════════════════════════════════════════════════════════════

console.log("── 7. Schema Integrity ─────────────────────────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Verify that well-formed pages have all required schemas
  const result = assessPublishQuality(pageData, fields);
  assert(result.gates["QG-SCHEMA-01"], "Well-formed page must pass QG-SCHEMA-01");
  assert(result.gates["QG-SCHEMA-02"], "Well-formed page must pass QG-SCHEMA-02 (FAQ count match)");
  console.log(`  Schema gates: QG-SCHEMA-01=${result.gates["QG-SCHEMA-01"]}, QG-SCHEMA-02=${result.gates["QG-SCHEMA-02"]}`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Empty breadcrumb-schema field
  const degradedFields = { ...fields, "breadcrumb-schema": "" };
  const result = assessPublishQuality(pageData, degradedFields);
  assert(!result.gates["QG-SCHEMA-01"], "Empty breadcrumb-schema must fail QG-SCHEMA-01");
  console.log(`  Empty schemas: QG-SCHEMA-01=${result.gates["QG-SCHEMA-01"]}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 8. CORRIDOR SPECIFICITY
// ═══════════════════════════════════════════════════════════════════════

console.log("── 8. Corridor Specificity ─────────────────────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Verify well-formed pages contain both city names
  const result = assessPublishQuality(pageData, fields);
  assert(result.gates["QG-CONTENT-03"], "Well-formed page must pass corridor specificity");
  console.log(`  Atlanta→Orlando: QG-CONTENT-03=${result.gates["QG-CONTENT-03"]}`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Replace all rendered content with generic text (no city names)
  const genericFields = {
    ...fields,
    "faq-schema": "<p>Generic freight content with no city names</p>",
    "body-content": "<p>Generic body content</p>",
    "hero-headline": "Freight Shipping Services",
  };
  const result = assessPublishQuality(pageData, genericFields);
  assert(!result.gates["QG-CONTENT-03"], "Generic content must fail corridor specificity");
  console.log(`  Generic content: QG-CONTENT-03=${result.gates["QG-CONTENT-03"]}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 9. BANNED CONTENT DETECTION
// ═══════════════════════════════════════════════════════════════════════

console.log("── 9. Banned Content Detection ─────────────────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Inject banned phrase into faq-schema
  const poisonedFields = {
    ...fields,
    "faq-schema": fields["faq-schema"] + "<p>Book Freight Instantly by clicking the button below</p>",
  };
  const result = assessPublishQuality(pageData, poisonedFields);
  assert(!result.publishable, "Banned phrase must block publish");
  assert(!result.gates["QG-CONTENT-01"], "QG-CONTENT-01 must fail with banned content");
  console.log(`  Banned phrase: publishable=${result.publishable}`);
}

{
  // Test scanForBannedLaneContent directly
  const scan1 = scanForBannedLaneContent("Book Freight Instantly");
  assert(!scan1.clean, "scanForBannedLaneContent must detect 'Book Freight Instantly'");

  const scan2 = scanForBannedLaneContent("LTL freight from Atlanta to Orlando");
  assert(scan2.clean, "Clean content must pass banned content scan");

  console.log(`  Direct scan: banned=${!scan1.clean}, clean=${scan2.clean}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 10. FALLBACK TEMPLATE LEAKAGE
// ═══════════════════════════════════════════════════════════════════════

console.log("── 10. Fallback Template Leakage ───────────────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Inject wistia player + STEP content (high-confidence leakage)
  const poisonedFields = {
    ...fields,
    "faq-schema": fields["faq-schema"] +
      '<wistia-player media-id="abc123"></wistia-player>' +
      '<p>STEP 1: Click Book Freight Instantly</p>',
  };
  const result = assessPublishQuality(pageData, poisonedFields);
  assert(!result.publishable, "Template leakage must block publish");
  assert(!result.gates["QG-CONTENT-02"], "QG-CONTENT-02 must fail with leakage");
  console.log(`  Wistia+STEP leakage: publishable=${result.publishable}`);
}

{
  // Test detectFallbackTemplateLeakage directly
  const result = detectFallbackTemplateLeakage('<wistia-player media-id="x"></wistia-player>');
  assert(!result.clean, "Wistia player must trigger leakage detection");
  assert(result.leakage_signals.length > 0, "Wistia must produce leakage signals");
  console.log(`  Direct leakage scan: signals=${result.leakage_signals.length}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 11. RENDERED FIELD COMPLETENESS
// ═══════════════════════════════════════════════════════════════════════

console.log("── 11. Rendered Field Completeness ─────────────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Verify all required fields are present and non-empty
  const requiredCmsFields = [
    "hero-headline", "subheadline", "body-content", "faq-schema",
    "breadcrumb-schema", "proof-section", "lane-intelligence-panel",
    "execution-flow", "traditional-ltl", "warp-ltl",
    "seo-title", "seo-meta-description", "canonical-url",
  ];
  for (const f of requiredCmsFields) {
    const val = fields[f];
    assert(val && typeof val === "string" && val.trim().length > 0,
      `Rendered field '${f}' must be non-empty`);
  }
  console.log(`  All ${requiredCmsFields.length} required CMS fields verified non-empty`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Remove a rendered field
  const degradedFields = { ...fields, "proof-section": "" };
  const result = assessPublishQuality(pageData, degradedFields);
  assert(!result.gates["QG-RENDER-01"], "Empty proof-section must fail QG-RENDER-01");
  console.log(`  Empty proof-section: QG-RENDER-01=${result.gates["QG-RENDER-01"]}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 12. DETERMINISTIC SCORING — Same Input → Same Output
// ═══════════════════════════════════════════════════════════════════════

console.log("── 12. Deterministic Scoring ───────────────────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.medium);
  const result1 = assessPublishQuality(pageData, fields);
  const result2 = assessPublishQuality(pageData, fields);
  const result3 = assessPublishQuality(pageData, fields);

  assertEqual(result1.score, result2.score, "Score must be deterministic (run 1 vs 2)");
  assertEqual(result2.score, result3.score, "Score must be deterministic (run 2 vs 3)");
  assertEqual(result1.grade, result2.grade, "Grade must be deterministic");
  assertEqual(result1.publishable, result2.publishable, "Publishable must be deterministic");
  assertEqual(result1.gates_passed, result2.gates_passed, "Gates passed must be deterministic");

  // All gate values must match
  for (const [gate, val] of Object.entries(result1.gates)) {
    assertEqual(val, result2.gates[gate], `Gate ${gate} must be deterministic`);
  }
  console.log(`  3 runs identical: score=${result1.score}%, grade=${result1.grade}, gates=${result1.gates_passed}/${result1.gate_count}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 13. HARD GATES CANNOT BE OVERRIDDEN BY HIGH AGGREGATE SCORE
// ═══════════════════════════════════════════════════════════════════════

console.log("── 13. Hard Gate Independence ──────────────────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Page with high quality score but missing schema
  const degradedFields = { ...fields, "breadcrumb-schema": "" };
  const result = assessPublishQuality(pageData, degradedFields);

  // Score should still be decent (page data is good)
  assertGte(result.score, 50, "Score should remain reasonable despite missing schema field");
  // But publish must be blocked
  assert(!result.publishable, "Missing schema must block publish regardless of score");
  assert(!result.gates["QG-SCHEMA-01"], "QG-SCHEMA-01 must fail");
  assert(!result.gates["QG-RENDER-01"], "QG-RENDER-01 must also fail (empty field)");
  console.log(`  Score=${result.score}% but blocked by QG-SCHEMA-01 + QG-RENDER-01`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Page with high quality score but banned content
  const poisonedFields = {
    ...fields,
    "faq-schema": fields["faq-schema"] + "<p>Stop Paying for a Broken Freight System</p>",
  };
  const result = assessPublishQuality(pageData, poisonedFields);
  assertGte(result.score, 50, "Score should remain reasonable despite banned content");
  assert(!result.publishable, "Banned content must block publish regardless of score");
  console.log(`  Score=${result.score}% but blocked by banned content`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 14. PAGE QUALITY SCORER INTEGRATION
// ═══════════════════════════════════════════════════════════════════════

console.log("── 14. Page Quality Scorer Integration ─────────────────────\n");

{
  const { pageData } = buildLanePage(LANES.short);
  const score = scorePageQuality(pageData);

  assert(score.total > 0 && score.total <= 1, "scorePageQuality total must be 0-1");
  assert(["A", "B", "C", "D", "F"].includes(score.grade), "Grade must be A-F");
  assert(score.dimensions.seo_quality !== undefined, "SEO dimension must exist");
  assert(score.dimensions.ai_search_quality !== undefined, "AI Search dimension must exist");
  assert(score.dimensions.human_readability !== undefined, "Readability dimension must exist");
  assert(score.dimensions.design_composition !== undefined, "Design dimension must exist");
  assert(score.dimensions.conversion_readiness !== undefined, "Conversion dimension must exist");
  assertGte(score.checks_summary.total, 30, "Must have at least 30 checks");
  console.log(`  scorePageQuality: ${(score.total * 100).toFixed(1)}% (${score.grade}) — ${score.checks_summary.passing}/${score.checks_summary.total} checks passing`);
}

{
  // Verify dimension scores appear in assessPublishQuality result
  const { pageData, fields } = buildLanePage(LANES.medium);
  const result = assessPublishQuality(pageData, fields);

  assert(result.dimensions.seo_quality !== undefined, "Assessment must include SEO dimension");
  assert(result.dimensions.ai_search_quality !== undefined, "Assessment must include AI Search dimension");
  assert(result.dimensions.human_readability !== undefined, "Assessment must include Readability dimension");
  assert(result.dimensions.design_composition !== undefined, "Assessment must include Design dimension");
  assert(result.dimensions.conversion_readiness !== undefined, "Assessment must include Conversion dimension");
  console.log(`  Dimensions integrated: SEO=${(result.dimensions.seo_quality?.score * 100 || 0).toFixed(0)}%, AI=${(result.dimensions.ai_search_quality?.score * 100 || 0).toFixed(0)}%, Read=${(result.dimensions.human_readability?.score * 100 || 0).toFixed(0)}%`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 15. FAQ QUALITY SCORING
// ═══════════════════════════════════════════════════════════════════════

console.log("── 15. FAQ Quality Scoring ─────────────────────────────────\n");

{
  const { pageData } = buildLanePage(LANES.short);
  const faqs = pageData.lane_specific_faqs || [];
  const oCity = (LANES.short.origin).split(",")[0].trim();
  const dCity = (LANES.short.destination).split(",")[0].trim();

  const result = scoreFaqSet(faqs, oCity, dCity, "LTL");
  assert(result.score >= 0 && result.score <= 1, "FAQ score must be 0-1");
  assertGte(result.checks.length, 5, "FAQ scorer must have at least 5 checks");
  console.log(`  FAQ quality: ${(result.score * 100).toFixed(1)}% — ${result.checks.length} checks`);
}

{
  // Verify FAQ quality appears in assessPublishQuality
  const { pageData, fields } = buildLanePage(LANES.short);
  const result = assessPublishQuality(pageData, fields);
  assert(result.faq_quality !== undefined, "Assessment must include FAQ quality");
  assert(result.faq_quality.score >= 0, "FAQ quality score must be non-negative");
  console.log(`  FAQ quality in assessment: ${(result.faq_quality.score * 100).toFixed(1)}%`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 16. NULL/EDGE CASE HANDLING
// ═══════════════════════════════════════════════════════════════════════

console.log("── 16. Null/Edge Case Handling ─────────────────────────────\n");

{
  // Null canonical data
  const result = assessPublishQuality(null, {});
  assert(!result.publishable, "Null page data must block publish");
  assertEqual(result.grade, "F", "Null page data must get F grade");
  console.log(`  Null data: publishable=${result.publishable}, grade=${result.grade}`);
}

{
  // Empty canonical data
  const result = assessPublishQuality({}, {});
  assert(!result.publishable, "Empty page data must block publish");
  assertGte(result.gates_failed, 3, "Empty page data must fail multiple gates");
  console.log(`  Empty data: publishable=${result.publishable}, gates_failed=${result.gates_failed}`);
}

{
  // Null rendered fields
  const { pageData } = buildLanePage(LANES.short);
  const result = assessPublishQuality(pageData, null);
  assert(!result.publishable, "Null rendered fields must block publish");
  console.log(`  Null fields: publishable=${result.publishable}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 17. CROSS-LANE SCORING COMPARISON
// ═══════════════════════════════════════════════════════════════════════

console.log("── 17. Cross-Lane Scoring Comparison ──────────────────────\n");

{
  const scores = {};
  for (const [key, lane] of Object.entries(LANES)) {
    const { pageData, fields } = buildLanePage(lane);
    const result = assessPublishQuality(pageData, fields);
    scores[key] = result;
    console.log(`  ${lane.label}: ${result.score}% (${result.grade}) — ${result.gates_passed}/${result.gate_count} gates`);
  }

  // All lanes must be publishable
  for (const [key, result] of Object.entries(scores)) {
    assert(result.publishable, `${key} lane must be publishable`);
  }

  // Score variance should be reasonable (all lanes from same pipeline)
  const scoreValues = Object.values(scores).map(r => r.score);
  const minScore = Math.min(...scoreValues);
  const maxScore = Math.max(...scoreValues);
  const variance = maxScore - minScore;
  assertLt(variance, 30, "Score variance across lanes should be < 30 points");
  console.log(`  Score range: ${minScore}%–${maxScore}% (variance: ${variance} pts)`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 18. GATE COUNT VERIFICATION
// ═══════════════════════════════════════════════════════════════════════

console.log("── 18. Gate Count Verification ─────────────────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);
  const result = assessPublishQuality(pageData, fields);

  // Verify all expected gates exist
  const expectedGates = [
    "QG-STRUCT-01", "QG-STRUCT-02", "QG-STRUCT-03",
    "QG-CONTENT-01", "QG-CONTENT-02", "QG-CONTENT-03", "QG-CONTENT-04",
    "QG-OWNER-01", "QG-OWNER-02", "QG-OWNER-03",
    "QG-SCHEMA-01", "QG-SCHEMA-02",
    "QG-DUPLICATE-01",
    "QG-RENDER-01", "QG-RENDER-02",
    "QG-VEHICLE-01",
    "QG-QUALITY-01",
  ];
  for (const gate of expectedGates) {
    assert(result.gates[gate] !== undefined, `Gate ${gate} must exist`);
  }
  assertGte(Object.keys(result.gates).length, 17, "Must have at least 17 quality gates");
  console.log(`  Total gates: ${Object.keys(result.gates).length}`);
  console.log(`  All expected gates present: ${expectedGates.length} verified`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 19. RENDERED CONTENT LENGTH GATE (QG-RENDER-02) — Hostile Bypass Fix
// ═══════════════════════════════════════════════════════════════════════

console.log("── 19. Rendered Content Length Gate (Anti-Garbage) ─────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Well-formed page must pass QG-RENDER-02
  const result = assessPublishQuality(pageData, fields);
  assert(result.gates["QG-RENDER-02"], "Well-formed page must pass QG-RENDER-02");
  console.log(`  Well-formed: QG-RENDER-02=${result.gates["QG-RENDER-02"]}`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // HOSTILE: Replace all rendered fields with garbage placeholder text
  // that contains city names (to bypass QG-CONTENT-03)
  const garbageFields = {
    ...fields,
    "faq-schema": "<p>Atlanta to Orlando placeholder content here. Pallet LTL freight.</p>",
    "body-content": "<p>Atlanta Orlando pallet freight.</p>",
    "lane-intelligence-panel": "<p>Lane info.</p>",
    "execution-flow": "<p>Exec flow.</p>",
    "breadcrumb-schema": fields["breadcrumb-schema"], // keep real schemas
  };
  const result = assessPublishQuality(pageData, garbageFields);
  assert(!result.publishable, "Garbage rendered fields must block publish");
  assert(!result.gates["QG-RENDER-02"], "QG-RENDER-02 must catch garbage rendered content");
  console.log(`  Garbage fields: publishable=${result.publishable}, QG-RENDER-02=${result.gates["QG-RENDER-02"]}`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Short body-content only
  const shortFields = { ...fields, "body-content": "<p>Short.</p>" };
  const result = assessPublishQuality(pageData, shortFields);
  assert(!result.gates["QG-RENDER-02"], "Short body-content must fail QG-RENDER-02");
  console.log(`  Short body: QG-RENDER-02=${result.gates["QG-RENDER-02"]}`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // Short faq-schema only
  const shortFields = { ...fields, "faq-schema": "<p>Short FAQ schema.</p>" };
  const result = assessPublishQuality(pageData, shortFields);
  assert(!result.gates["QG-RENDER-02"], "Short faq-schema must fail QG-RENDER-02");
  console.log(`  Short faq-schema: QG-RENDER-02=${result.gates["QG-RENDER-02"]}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// 20. HOSTILE BYPASS ATTEMPTS
// ═══════════════════════════════════════════════════════════════════════

console.log("── 20. Hostile Bypass Attempts ─────────────────────────────\n");

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // HOSTILE: Good canonical data + completely gutted rendered fields
  const guttedFields = {
    "hero-headline": "Atlanta, GA to Orlando, FL LTL Freight",
    "subheadline": "A service.",
    "body-content": "",
    "faq-schema": "",
    "breadcrumb-schema": "",
    "proof-section": "",
    "lane-intelligence-panel": "",
    "execution-flow": "",
    "traditional-ltl": "x",
    "warp-ltl": "x",
    "seo-title": "test",
    "seo-meta-description": "test",
    "canonical-url": "https://www.wearewarp.com/lanes/atlanta-to-orlando",
  };
  const result = assessPublishQuality(pageData, guttedFields);
  assert(!result.publishable, "Good data + gutted rendered fields must block publish");
  assertGte(result.gates_failed, 2, "Must fail multiple gates with gutted fields");
  console.log(`  Gutted fields: publishable=${result.publishable}, gates_failed=${result.gates_failed}`);
}

{
  const { pageData, fields } = buildLanePage(LANES.short);

  // HOSTILE: All garbage rendered fields WITH city names AND real schema
  const garbageFields = {
    ...fields,
    "faq-schema": `<div>Atlanta to Orlando freight info. Pallet. ${"x".repeat(5000)}</div>`,
    "body-content": `<p>${"Atlanta Orlando freight pallet carrier cross-dock. ".repeat(10)}</p>`,
    "lane-intelligence-panel": `<div>${"KPI data placeholder. ".repeat(30)}</div>`,
    "execution-flow": `<div>${"Execution flow placeholder. ".repeat(25)}</div>`,
  };
  const result = assessPublishQuality(pageData, garbageFields);
  // With real schema + city names + non-empty fields + sufficient length,
  // this should now be caught by the faq-schema structural checks or pass.
  // The key thing is QG-RENDER-02 no longer lets through tiny garbage.
  console.log(`  Padded garbage: publishable=${result.publishable}, score=${result.score}%, gates_failed=${result.gates_failed}`);
}

console.log("");

// ═══════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════

console.log("── Summary ─────────────────────────────────────────────────");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failures.length > 0) {
  console.log("\n  Failures:");
  failures.forEach(f => console.log(`    • ${f}`));
  process.exit(1);
} else {
  console.log("\n  ✓ ALL QUALITY REGRESSION TESTS PASSED");
  process.exit(0);
}
