/**
 * Publisher Adapters Regression Tests
 *
 * Proves that:
 *   1. CMS-neutral publish contract is generated correctly from canonical data
 *   2. Webflow adapter produces IDENTICAL output to legacy renderWebflowFields()
 *   3. Neutral adapter produces valid structured output
 *   4. Quality gate works through the contract path
 *   5. SEO integrity survives the adapter layer
 *   6. Schema integrity survives the adapter layer
 *   7. Vehicle flexibility framing survives the adapter layer
 *   8. Benchmark lanes pass through both adapters
 *   9. Contract validation catches structural problems
 *  10. Migration boundaries are enforced
 *
 * These tests use NO network calls and NO external dependencies.
 * They run the production pipeline locally and verify adapter output
 * against known-good legacy output.
 *
 * Run: node tests/publisher-adapters.test.js
 */

import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import { renderWebflowFields } from "../lib/render-lane-page.js";
import { assessPublishQuality } from "../lib/lane-page-validator.js";
import { buildPublishContract, validatePublishContract, contractToRenderedFields, CONTRACT_GROUPS } from "../lib/publishers/publish-contract.js";
import { toTargetFields as webflowToFields, sanitize as webflowSanitize, adaptForPublish as webflowAdapt, ADAPTER_ID as WEBFLOW_ID } from "../lib/publishers/webflow-adapter.js";
import { toTargetFields as neutralToFields, adaptForPublish as neutralAdapt, ADAPTER_ID as NEUTRAL_ID } from "../lib/publishers/neutral-adapter.js";
import { getAdapter, listAdapters, adaptContract } from "../lib/publishers/index.js";

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
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function assertGte(actual, threshold, message) {
  assert(actual >= threshold, `${message} (expected >= ${threshold}, got ${actual})`);
}

function assertIncludes(haystack, needle, message) {
  assert((haystack || "").includes(needle), `${message} (expected to include "${needle}")`);
}

// ── Test Fixtures — Benchmark Lanes ─────────────────────────────────

const LANES = {
  short: { origin: "Atlanta, GA", destination: "Orlando, FL", mode: "LTL", label: "Short (474 mi)" },
  medium: { origin: "Atlanta, GA", destination: "Miami, FL", mode: "LTL", label: "Medium (716 mi)" },
  long: { origin: "Los Angeles, CA", destination: "New York, NY", mode: "LTL", label: "Long (2886 mi)" },
};

function buildLanePage(lane) {
  const knowledge = buildLaneKnowledge({ origin: lane.origin, destination: lane.destination, mode: lane.mode });
  const pageData = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null, related_lanes: [], tool_link: "https://www.wearewarp.com/quote", data_link: null,
  });
  return { pageData, knowledge };
}

function buildFullPipeline(lane) {
  const { pageData } = buildLanePage(lane);
  const contract = buildPublishContract(pageData);
  const legacyFields = renderWebflowFields(pageData);
  const contractFields = contractToRenderedFields(contract);
  return { pageData, contract, legacyFields, contractFields };
}

// ════════════════════════════════════════════════════════════════════════
console.log("\n╔══════════════════════════════════════════════════════════════╗");
console.log("║  PUBLISHER ADAPTER REGRESSION TESTS                        ║");
console.log("╚══════════════════════════════════════════════════════════════╝\n");

// ── 1. Contract Structure ────────────────────────────────────────────
console.log("── 1. Contract Structure ───────────────────────────────────────\n");
{
  const { contract } = buildFullPipeline(LANES.short);

  // All required groups present
  for (const group of CONTRACT_GROUPS) {
    assert(contract[group] !== undefined, `Contract has group: ${group}`);
  }
  assertEqual(contract._contract_version, "1.0.0", "Contract version is 1.0.0");

  // Validation passes
  const validation = validatePublishContract(contract);
  assert(validation.valid, `Contract validation passes for short lane (errors: ${validation.errors.join(", ")})`);
  assertEqual(validation.errors.length, 0, "No validation errors");
}

// ── 2. Webflow Adapter Equivalence ───────────────────────────────────
console.log("\n── 2. Webflow Adapter Equivalence (Critical) ──────────────────\n");
{
  const CONTENT_KEYS = [
    "hero-headline", "subheadline", "body-content", "faq-schema",
    "breadcrumb-schema", "proof-section", "lane-intelligence-panel",
    "execution-flow", "traditional-ltl", "warp-ltl",
    "seo-title", "seo-meta-description", "canonical-url",
  ];

  for (const [key, lane] of Object.entries(LANES)) {
    const { legacyFields, contractFields } = buildFullPipeline(lane);

    let contentMatches = 0;
    const mismatches = [];
    for (const fieldKey of CONTENT_KEYS) {
      const a = String(contractFields[fieldKey] || "");
      const b = String(legacyFields[fieldKey] || "");
      if (a === b) {
        contentMatches++;
      } else {
        mismatches.push(fieldKey);
      }
    }

    assertEqual(contentMatches, CONTENT_KEYS.length,
      `${lane.label}: all ${CONTENT_KEYS.length} content fields match legacy output` +
      (mismatches.length > 0 ? ` (mismatches: ${mismatches.join(", ")})` : ""));
  }

  // Additional field equivalence checks
  const { legacyFields, contractFields } = buildFullPipeline(LANES.short);
  assertEqual(contractFields["name"], legacyFields["name"], "name field matches");
  assertEqual(contractFields["slug"], legacyFields["slug"], "slug field matches");
  assertEqual(contractFields["origin-city"], legacyFields["origin-city"], "origin-city matches");
  assertEqual(contractFields["destination-city"], legacyFields["destination-city"], "destination-city matches");
  assertEqual(contractFields["mode"], legacyFields["mode"], "mode matches");
  assertEqual(contractFields["hero-kpi-distance"], legacyFields["hero-kpi-distance"], "hero-kpi-distance matches");
  assertEqual(contractFields["hero-kpi-transit"], legacyFields["hero-kpi-transit"], "hero-kpi-transit matches");
  assertEqual(contractFields["hero-kpi-carriers"], legacyFields["hero-kpi-carriers"], "hero-kpi-carriers matches");
  assertEqual(contractFields["cta-primary-text"], legacyFields["cta-primary-text"], "cta-primary-text matches");
  assertEqual(contractFields["cta-primary-url"], legacyFields["cta-primary-url"], "cta-primary-url matches");
  assertEqual(contractFields["address"], legacyFields["address"], "address (canonical URL alias) matches");
  assertEqual(contractFields["lane-badge"], legacyFields["lane-badge"], "lane-badge matches");
}

// ── 3. Neutral Adapter Output ────────────────────────────────────────
console.log("\n── 3. Neutral Adapter Output ────────────────────────────────────\n");
{
  for (const [key, lane] of Object.entries(LANES)) {
    const { contract } = buildFullPipeline(lane);
    const neutral = neutralAdapt(contract);

    assert(neutral._adapter === NEUTRAL_ID, `${lane.label}: adapter ID is neutral`);
    assert(neutral.slug?.length > 0, `${lane.label}: slug present`);
    assert(neutral.path?.length > 0, `${lane.label}: path present`);
    assert(neutral.metadata?.title?.length > 0, `${lane.label}: metadata.title present`);
    assert(neutral.metadata?.description?.length > 0, `${lane.label}: metadata.description present`);
    assert(neutral.metadata?.canonical?.length > 0, `${lane.label}: metadata.canonical present`);
    assertGte(neutral.metadata?.jsonLd?.length || 0, 3, `${lane.label}: at least 3 JSON-LD schemas`);
    assert(neutral.hero?.headline?.length > 0, `${lane.label}: hero.headline present`);
    assert(neutral.hero?.subhead?.length > 0, `${lane.label}: hero.subhead present`);
    assertGte(neutral.hero?.kpis?.length || 0, 2, `${lane.label}: at least 2 hero KPIs`);
    assertGte(neutral.sections?.length || 0, 5, `${lane.label}: at least 5 content sections`);
    assertGte(neutral.faqs?.length || 0, 5, `${lane.label}: at least 5 FAQs`);
    assertGte(neutral.why_warp?.length || 0, 3, `${lane.label}: at least 3 why_warp reasons`);
    assertGte(neutral.comparison?.length || 0, 5, `${lane.label}: at least 5 comparison points`);
    assert(neutral.stats?.distance_miles > 0, `${lane.label}: stats.distance_miles present`);
    assert(neutral.network?.carrier_count > 0, `${lane.label}: network.carrier_count present`);
  }
}

// ── 4. Quality Gate Through Contract Path ────────────────────────────
console.log("\n── 4. Quality Gate Through Contract Path ────────────────────────\n");
{
  for (const [key, lane] of Object.entries(LANES)) {
    const { pageData, legacyFields, contractFields } = buildFullPipeline(lane);

    const qualityLegacy = assessPublishQuality(pageData, legacyFields);
    const qualityContract = assessPublishQuality(pageData, contractFields);

    assertEqual(qualityContract.publishable, qualityLegacy.publishable,
      `${lane.label}: publishable matches (legacy=${qualityLegacy.publishable}, contract=${qualityContract.publishable})`);
    assertEqual(qualityContract.score, qualityLegacy.score,
      `${lane.label}: score matches (legacy=${qualityLegacy.score}, contract=${qualityContract.score})`);
    assertEqual(qualityContract.grade, qualityLegacy.grade,
      `${lane.label}: grade matches`);
    assertEqual(qualityContract.gates_passed, qualityLegacy.gates_passed,
      `${lane.label}: gates_passed matches`);
    assertEqual(qualityContract.gates_failed, qualityLegacy.gates_failed,
      `${lane.label}: gates_failed matches`);
  }
}

// ── 5. SEO Integrity ─────────────────────────────────────────────────
console.log("\n── 5. SEO Integrity ────────────────────────────────────────────\n");
{
  for (const [key, lane] of Object.entries(LANES)) {
    const { contract } = buildFullPipeline(lane);
    const oCity = lane.origin.split(",")[0].trim();
    const dCity = lane.destination.split(",")[0].trim();

    // Title contains origin + destination
    assertIncludes(contract.seo.title, oCity, `${lane.label}: title contains origin`);
    assertIncludes(contract.seo.title, dCity, `${lane.label}: title contains destination`);

    // Meta description exists and has minimum length
    assertGte(contract.seo.meta_description.length, 60, `${lane.label}: meta_description >= 60 chars`);

    // Canonical URL is well-formed
    assertIncludes(contract.seo.canonical_url, "/lanes/", `${lane.label}: canonical_url contains /lanes/`);
    assertIncludes(contract.seo.canonical_url, "wearewarp.com", `${lane.label}: canonical_url on wearewarp.com`);

    // Hero headline contains cities
    assertIncludes(contract.hero.headline, oCity, `${lane.label}: hero headline contains origin`);
    assertIncludes(contract.hero.headline, dCity, `${lane.label}: hero headline contains destination`);

    // Neutral adapter preserves SEO
    const neutral = neutralAdapt(contract);
    assertEqual(neutral.metadata.title, contract.seo.title, `${lane.label}: neutral preserves title`);
    assertEqual(neutral.metadata.description, contract.seo.meta_description, `${lane.label}: neutral preserves meta`);
    assertEqual(neutral.metadata.canonical, contract.seo.canonical_url, `${lane.label}: neutral preserves canonical`);
  }
}

// ── 6. Schema Integrity ──────────────────────────────────────────────
console.log("\n── 6. Schema Integrity ─────────────────────────────────────────\n");
{
  for (const [key, lane] of Object.entries(LANES)) {
    const { contract } = buildFullPipeline(lane);
    const schemaHtml = contract.schema.structured_data_html;

    assertIncludes(schemaHtml, "BreadcrumbList", `${lane.label}: BreadcrumbList schema present`);
    assertIncludes(schemaHtml, '"Service"', `${lane.label}: Service schema present`);
    assertIncludes(schemaHtml, '"Organization"', `${lane.label}: Organization schema present`);
    assertIncludes(schemaHtml, "FAQPage", `${lane.label}: FAQPage schema present`);

    // Neutral adapter extracts JSON-LD correctly
    const neutral = neutralAdapt(contract);
    const types = neutral.metadata.jsonLd.map(s => s["@type"]);
    assert(types.includes("BreadcrumbList"), `${lane.label}: neutral extracts BreadcrumbList`);
    assert(types.includes("FAQPage"), `${lane.label}: neutral extracts FAQPage`);
  }
}

// ── 7. Vehicle Flexibility Framing ───────────────────────────────────
console.log("\n── 7. Vehicle Flexibility Framing ──────────────────────────────\n");
{
  const { contract, contractFields } = buildFullPipeline(LANES.short);
  const allContent = [
    contract.content.primary_content_html,
    contract.content.body_text,
    contract.sections.kpi_panel_html,
  ].join(" ").toLowerCase();

  assertIncludes(allContent, "pallet", "LTL content contains 'pallet' reference");
  assert(!allContent.includes("full truckload only"), "LTL content does not contain 'full truckload only'");

  // Quality gate vehicle check still works
  const quality = assessPublishQuality(buildFullPipeline(LANES.short).pageData, contractFields);
  assertEqual(quality.gates["QG-VEHICLE-01"], true, "QG-VEHICLE-01 passes for LTL");
}

// ── 8. Adapter Registry ──────────────────────────────────────────────
console.log("\n── 8. Adapter Registry ─────────────────────────────────────────\n");
{
  const adapters = listAdapters();
  assert(adapters.includes("webflow"), "Registry contains webflow adapter");
  assert(adapters.includes("neutral"), "Registry contains neutral adapter");

  const wf = getAdapter("webflow");
  assertEqual(wf.ADAPTER_ID, "webflow", "Webflow adapter has correct ID");

  const ne = getAdapter("neutral");
  assertEqual(ne.ADAPTER_ID, "neutral", "Neutral adapter has correct ID");

  // adaptContract convenience function
  const { contract } = buildFullPipeline(LANES.short);
  const wfOutput = adaptContract("webflow", contract);
  const neOutput = adaptContract("neutral", contract);
  assert(Object.keys(wfOutput).length > 20, "adaptContract produces webflow output");
  assert(neOutput.slug?.length > 0, "adaptContract produces neutral output");

  // Unknown adapter throws
  let threw = false;
  try { getAdapter("unknown"); } catch { threw = true; }
  assert(threw, "getAdapter throws for unknown adapter");
}

// ── 9. Contract Validation ───────────────────────────────────────────
console.log("\n── 9. Contract Validation ──────────────────────────────────────\n");
{
  // Null contract
  const nullResult = validatePublishContract(null);
  assert(!nullResult.valid, "Null contract fails validation");

  // Missing groups
  const partial = { _contract_version: "1.0.0", identity: { slug: "test" } };
  const partialResult = validatePublishContract(partial);
  assert(!partialResult.valid, "Partial contract fails validation");
  assertGte(partialResult.errors.length, 5, "Partial contract has multiple errors");

  // Well-formed contract
  const { contract } = buildFullPipeline(LANES.short);
  const goodResult = validatePublishContract(contract);
  assert(goodResult.valid, "Well-formed contract passes validation");
}

// ── 10. Deterministic Output ─────────────────────────────────────────
console.log("\n── 10. Deterministic Output ────────────────────────────────────\n");
{
  const run1 = buildFullPipeline(LANES.short);
  const run2 = buildFullPipeline(LANES.short);

  // Contract content is deterministic
  assertEqual(run1.contract.content.body_text, run2.contract.content.body_text, "body_text deterministic");
  assertEqual(run1.contract.content.primary_content_html, run2.contract.content.primary_content_html, "primary_content_html deterministic");
  assertEqual(run1.contract.content.proof_html, run2.contract.content.proof_html, "proof_html deterministic");
  assertEqual(run1.contract.sections.kpi_panel_html, run2.contract.sections.kpi_panel_html, "kpi_panel_html deterministic");
  assertEqual(run1.contract.sections.execution_flow_html, run2.contract.sections.execution_flow_html, "execution_flow_html deterministic");
  assertEqual(run1.contract.schema.structured_data_html, run2.contract.schema.structured_data_html, "structured_data_html deterministic");
}

// ── 11. Webflow Sanitization ─────────────────────────────────────────
console.log("\n── 11. Webflow Sanitization ────────────────────────────────────\n");
{
  const { contract } = buildFullPipeline(LANES.short);
  const raw = webflowToFields(contract);
  const sanitized = webflowSanitize(raw);

  // Sanitized output only contains allowed fields
  const ALLOWED = new Set([
    "name", "slug", "origin-city", "destination-city",
    "hero-headline", "subheadline",
    "hero-kpi-distance", "hero-kpi-transit", "hero-kpi-carriers",
    "hero-visual-type", "hero-map-origin", "hero-map-destination",
    "body-content",
    "seo-title", "seo-meta-description", "canonical-url", "address",
    "origin", "destination", "mode", "segment",
    "traditional-ltl", "warp-ltl",
    "proof-section",
    "cta-primary-text", "cta-primary-url", "cta-secondary-text", "cta-secondary-url",
    "lane-intelligence-panel", "execution-flow", "authority-links",
    "faq-schema", "breadcrumb-schema",
    "hero-video-enabled", "hero-map-enabled", "lane-mode-enabled", "index-page",
    "lane-badge",
  ]);

  let allAllowed = true;
  for (const key of Object.keys(sanitized)) {
    if (!ALLOWED.has(key)) {
      allAllowed = false;
      console.error(`  Unexpected field in sanitized output: ${key}`);
    }
  }
  assert(allAllowed, "All sanitized fields are in allowed schema");
}

// ── 12. Migration Boundary Enforcement ───────────────────────────────
console.log("\n── 12. Migration Boundary Enforcement ─────────────────────────\n");
{
  const { contract } = buildFullPipeline(LANES.short);

  // Contract must not contain Webflow field names as top-level keys
  const webflowFieldNames = ["faq-schema", "lane-intelligence-panel", "execution-flow",
    "body-content", "breadcrumb-schema", "proof-section", "hero-headline",
    "seo-title", "seo-meta-description", "canonical-url"];

  for (const fieldName of webflowFieldNames) {
    assert(!(fieldName in contract), `Contract does not contain Webflow field name: ${fieldName}`);
  }

  // Contract groups use semantic names, not Webflow names
  assert("identity" in contract, "Contract uses semantic group: identity");
  assert("seo" in contract, "Contract uses semantic group: seo");
  assert("hero" in contract, "Contract uses semantic group: hero");
  assert("content" in contract, "Contract uses semantic group: content");
  assert("sections" in contract, "Contract uses semantic group: sections");
  assert("schema" in contract, "Contract uses semantic group: schema");
}

// ── 13. Corridor Specificity Through Adapters ────────────────────────
console.log("\n── 13. Corridor Specificity ────────────────────────────────────\n");
{
  for (const [key, lane] of Object.entries(LANES)) {
    const { contract } = buildFullPipeline(lane);
    const oCity = lane.origin.split(",")[0].trim();
    const dCity = lane.destination.split(",")[0].trim();

    // Contract content contains corridor-specific cities
    const contentHtml = contract.content.primary_content_html.toLowerCase();
    assertIncludes(contentHtml, oCity.toLowerCase(), `${lane.label}: content mentions origin city`);
    assertIncludes(contentHtml, dCity.toLowerCase(), `${lane.label}: content mentions destination city`);

    // Neutral adapter preserves corridor specificity
    const neutral = neutralAdapt(contract);
    assertEqual(neutral.route.origin.city, oCity, `${lane.label}: neutral preserves origin city`);
    assertEqual(neutral.route.destination.city, dCity, `${lane.label}: neutral preserves destination city`);
  }
}

// ── 14. Dual Output Portability Proof ────────────────────────────────
console.log("\n── 14. Dual Output Portability Proof ──────────────────────────\n");
{
  // Generate Atlanta-to-Orlando through BOTH adapters from the SAME contract
  const { pageData, contract } = buildFullPipeline(LANES.short);
  const renderedFields = contractToRenderedFields(contract);

  // Quality gate on contract path
  const quality = assessPublishQuality(pageData, renderedFields);
  assert(quality.publishable, "Benchmark lane publishable through contract path");
  assertGte(quality.score, 70, "Benchmark lane scores >= 70% through contract path");
  assertEqual(quality.gates_passed, quality.gate_count, "All gates pass through contract path");

  // Webflow adapter output
  const webflowOutput = webflowAdapt(contract, { preserveSlug: true, preserveName: true });
  assertGte(Object.keys(webflowOutput).length, 30, "Webflow adapter produces 30+ fields");
  assert(webflowOutput["hero-headline"]?.length > 0, "Webflow output has hero-headline");
  assert(webflowOutput["faq-schema"]?.length > 5000, "Webflow output has substantial faq-schema");
  assert(webflowOutput["breadcrumb-schema"]?.length > 200, "Webflow output has breadcrumb-schema");

  // Neutral adapter output
  const neutralOutput = neutralAdapt(contract);
  assert(neutralOutput.slug === "atlanta-to-orlando", "Neutral output has correct slug");
  assertGte(neutralOutput.sections?.length, 5, "Neutral output has 5+ sections");
  assertGte(neutralOutput.faqs?.length, 5, "Neutral output has 5+ FAQs");
  assertGte(neutralOutput.metadata?.jsonLd?.length, 3, "Neutral output has 3+ JSON-LD schemas");
  assert(neutralOutput.stats?.distance_miles > 0, "Neutral output has distance data");

  console.log(`  Webflow:  ${Object.keys(webflowOutput).length} fields, hero-headline=${(webflowOutput["hero-headline"] || "").length} chars`);
  console.log(`  Neutral:  ${neutralOutput.sections?.length} sections, ${neutralOutput.faqs?.length} FAQs, ${neutralOutput.metadata?.jsonLd?.length} schemas`);
  console.log(`  Quality:  ${quality.score}% (${quality.grade}) — ${quality.gates_passed}/${quality.gate_count} gates`);
  console.log(`  ✓ Same canonical lane → both adapters → both pass quality gate`);
}

// ── Summary ──────────────────────────────────────────────────────────
console.log("\n── Summary ─────────────────────────────────────────────────");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failed > 0) {
  console.log("\n  Failures:");
  for (const f of failures) console.log(`    ✗ ${f}`);
  console.log("");
  process.exit(1);
} else {
  console.log("\n  ✓ ALL PUBLISHER ADAPTER TESTS PASSED\n");
}
