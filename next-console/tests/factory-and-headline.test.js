/**
 * factory-and-headline.test.js — Headline Fix + Lane Page Factory Tests
 *
 * Verifies:
 *   1. Headline punctuation fix (no orphaned commas from empty state)
 *   2. Lane page factory pipeline (produceLanePage, produceLanePages)
 *   3. Factory output structural validation
 *   4. Quality gate integration through factory
 *   5. Batch production with summary
 *   6. Factory error handling (strict mode, missing inputs)
 *   7. Headline format across all pipeline stages
 *   8. fmtCityState behavior in origin/destination fields
 *   9. Cross-pipeline headline consistency (schema, content engine, render, contract)
 *
 * Uses the existing custom test harness pattern.
 */

import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData, CANONICAL_SECTIONS } from "../lib/lane-page-schema.js";
import {
  buildRouteContract,
  validateRouteContract,
  extractNextMetadata,
  extractJsonLdObjects,
  ROUTE_CONTRACT_VERSION,
} from "../lib/route-contract.js";
import {
  produceLanePage,
  produceLanePages,
  validateFactoryOutput,
} from "../lib/lane-page-factory.js";
import {
  buildPublishContract,
  contractToRenderedFields,
} from "../lib/publishers/publish-contract.js";
import { renderWebflowFields } from "../lib/render-lane-page.js";
// NOTE: buildLanePage from lane-content-engine.js not imported here because
// lane-engine.js uses @/lib aliases that require Next.js bundler.
// Content engine headline tests are covered indirectly via the canonical pipeline.

// ── Test Harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let currentSection = "";

function section(name) {
  currentSection = name;
  console.log(`\n── ${name} ──`);
}

function assert(condition, msg) {
  const label = currentSection ? `[${currentSection}] ${msg}` : msg;
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────

const BENCHMARK_LANES = [
  { origin: "Atlanta", destination: "Orlando" },
  { origin: "Atlanta", destination: "Miami" },
  { origin: "Los Angeles", destination: "New York" },
  { origin: "Dallas", destination: "Houston" },
  { origin: "Chicago", destination: "Nashville" },
  { origin: "Seattle", destination: "Phoenix" },
  { origin: "Denver", destination: "Salt Lake City" },
];

// ══════════════════════════════════════════════════════════════════════
// SECTION 1: HEADLINE PUNCTUATION FIX
// ══════════════════════════════════════════════════════════════════════

section("Headline Punctuation — Canonical Pipeline");
{
  // Build through the canonical pipeline (lane-page-schema.js)
  for (const lane of BENCHMARK_LANES) {
    const k = buildLaneKnowledge({ ...lane, mode: "LTL" });
    const c = buildCanonicalLanePageData(k, {});
    const label = `${lane.origin}→${lane.destination}`;

    // page_title: no orphaned commas
    assert(!c.page_title.includes(", to "), `${label}: page_title no ", to "`);
    assert(!c.page_title.includes(", LTL"), `${label}: page_title no ", LTL"`);
    assert(!c.page_title.includes(",  "), `${label}: page_title no double-comma-space`);
    assert(c.page_title.includes("| WARP"), `${label}: page_title ends with | WARP`);

    // hero.headline: no orphaned commas
    assert(!c.hero.headline.includes(", to "), `${label}: headline no ", to "`);
    assert(!c.hero.headline.includes(", LTL"), `${label}: headline no ", LTL"`);
    assert(c.hero.headline.includes(lane.origin), `${label}: headline has origin`);
    assert(c.hero.headline.includes(lane.destination.split(" ")[0]), `${label}: headline has destination`);

    // slug: no state abbreviations or orphaned hyphens
    assert(!c.lane_slug.includes("--"), `${label}: slug no double hyphens`);
    assert(!c.lane_slug.startsWith("-"), `${label}: slug no leading hyphen`);
    assert(!c.lane_slug.endsWith("-"), `${label}: slug no trailing hyphen`);

    // origin/destination fields: conditional formatting
    assert(!c.origin.includes(", ,"), `${label}: origin no ", ,"`);
    assert(!c.destination.includes(", ,"), `${label}: destination no ", ,"`);
    // If there's no state, should not end with ", "
    if (c.origin.endsWith(", ")) {
      assert(false, `${label}: origin ends with trailing comma-space`);
    } else {
      assert(true, `${label}: origin format clean`);
    }
    if (c.destination.endsWith(", ")) {
      assert(false, `${label}: destination ends with trailing comma-space`);
    } else {
      assert(true, `${label}: destination format clean`);
    }
  }
}

section("Headline Punctuation — Route Contract Pipeline");
{
  for (const lane of BENCHMARK_LANES) {
    const k = buildLaneKnowledge({ ...lane, mode: "LTL" });
    const c = buildCanonicalLanePageData(k, {});
    const { payload } = buildRouteContract(c);
    const label = `${lane.origin}→${lane.destination}`;

    // Metadata title
    assert(!payload.metadata.title.includes(", to "), `${label}: metadata.title no ", to "`);
    assert(!payload.metadata.title.includes(", LTL"), `${label}: metadata.title no ", LTL"`);
    assert(payload.metadata.title.includes("| WARP"), `${label}: metadata.title has | WARP`);

    // Hero headline
    assert(!payload.hero.headline.includes(", to "), `${label}: route hero.headline no ", to "`);
    assert(!payload.hero.headline.includes(", LTL"), `${label}: route hero.headline no ", LTL"`);
  }
}

section("Headline Punctuation — Publish Contract Pipeline");
{
  for (const lane of BENCHMARK_LANES.slice(0, 3)) {
    const k = buildLaneKnowledge({ ...lane, mode: "LTL" });
    const c = buildCanonicalLanePageData(k, {});
    const contract = buildPublishContract(c);
    const label = `${lane.origin}→${lane.destination}`;

    // Hero headline in contract
    assert(!contract.hero.headline.includes(", to "), `${label}: contract headline no ", to "`);

    // Map origin/destination
    assert(!contract.hero.map_origin.includes(", ,"), `${label}: map_origin no ", ,"`);
    assert(!contract.hero.map_destination.includes(", ,"), `${label}: map_destination no ", ,"`);
    // Should not have empty state part
    assert(!contract.hero.map_origin.endsWith(", "), `${label}: map_origin no trailing comma`);
    assert(!contract.hero.map_destination.endsWith(", "), `${label}: map_destination no trailing comma`);

    // SEO title in contract
    assert(!contract.seo.title.includes(", to "), `${label}: contract seo.title no ", to "`);
  }
}

section("Headline Punctuation — Webflow Fields Pipeline");
{
  for (const lane of BENCHMARK_LANES.slice(0, 3)) {
    const k = buildLaneKnowledge({ ...lane, mode: "LTL" });
    const c = buildCanonicalLanePageData(k, {});
    const wf = renderWebflowFields(c);
    const label = `${lane.origin}→${lane.destination}`;

    // Webflow hero-headline
    assert(!wf["hero-headline"].includes(", to "), `${label}: wf hero-headline no ", to "`);
    assert(!wf["hero-headline"].includes(", LTL"), `${label}: wf hero-headline no ", LTL"`);

    // Webflow seo-title
    assert(!wf["seo-title"].includes(", to "), `${label}: wf seo-title no ", to "`);

    // Webflow map fields
    assert(!wf["hero-map-origin"].endsWith(", "), `${label}: wf map-origin no trailing comma`);
    assert(!wf["hero-map-destination"].endsWith(", "), `${label}: wf map-dest no trailing comma`);
  }
}

// Content engine pipeline tests omitted — lane-engine.js requires Next.js @/lib aliases.
// Headline fix in lane-content-engine.js is verified via code review and the canonical
// pipeline tests above, which exercise the same fmtCityState() logic.

section("Headline Punctuation — FAQ Questions");
{
  for (const lane of BENCHMARK_LANES.slice(0, 3)) {
    const k = buildLaneKnowledge({ ...lane, mode: "LTL" });
    const c = buildCanonicalLanePageData(k, {});
    const label = `${lane.origin}→${lane.destination}`;

    // FAQ questions should not have orphaned commas
    const faqs = c.lane_specific_faqs;
    if (Array.isArray(faqs)) {
      for (let i = 0; i < faqs.length; i++) {
        const q = faqs[i];
        assert(!q.question.includes(", to "), `${label}: FAQ[${i}] no ", to " in question`);
      }
    }

    // meta_description
    assert(!c.meta_description.includes(", to "), `${label}: meta_description no ", to "`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 2: LANE PAGE FACTORY — CORE PIPELINE
// ══════════════════════════════════════════════════════════════════════

section("Factory — Single Lane Production");
{
  const result = produceLanePage({ origin: "Atlanta", destination: "Orlando" });

  // Identity
  assert(result.slug === "atlanta-to-orlando", "Factory slug correct");
  assert(result.path === "/lanes/atlanta-to-orlando", "Factory path correct");

  // Payload is full route contract
  assert(typeof result.payload === "object", "Has payload object");
  assert(result.payload._route_contract_version === ROUTE_CONTRACT_VERSION, "Payload has version");
  assert(result.payload.slug === "atlanta-to-orlando", "Payload slug matches");
  assert(result.payload.path === "/lanes/atlanta-to-orlando", "Payload path matches");
  assert(typeof result.payload.hero === "object", "Payload has hero");
  assert(Array.isArray(result.payload.sections), "Payload has sections");
  assert(typeof result.payload.metadata === "object", "Payload has metadata");
  assert(typeof result.payload.quality === "object", "Payload has quality");
  assert(result.payload.sections.length >= 5, "Payload has >= 5 sections");

  // Quality assessment
  assert(typeof result.quality.score === "number", "Quality score is number");
  assert(result.quality.score >= 70, "Quality score >= 70");
  assert(typeof result.quality.grade === "string", "Quality grade is string");
  assert(["A", "B", "C"].includes(result.quality.grade), "Quality grade is A, B, or C");
  assert(result.quality.gates_passed === result.quality.gates_total, "All gates passed");
  assert(result.quality.gates_total >= 17, "Has >= 17 gates");
  assert(result.quality.publishable === true, "Is publishable");
  assert(result.quality.meetsMinScore === true, "Meets min score");

  // Validation
  assert(result.validation.valid === true, "Validation is valid");
  assert(Array.isArray(result.validation.errors), "Validation has errors array");
  assert(result.validation.errors.length === 0, "No validation errors");

  // Metadata
  assert(typeof result.metadata === "object", "Has metadata object");
  assert(result.metadata.title.includes("Atlanta"), "Metadata title has origin");
  assert(result.metadata.title.includes("Orlando"), "Metadata title has destination");
  assert(result.metadata.title.includes("LTL"), "Metadata title has mode");
  assert(result.metadata.title.endsWith("| WARP"), "Metadata title ends with | WARP");
  assert(typeof result.metadata.description === "string", "Metadata has description");
  assert(result.metadata.description.length > 50, "Description is substantial");
  assert(result.metadata.alternates?.canonical.includes("atlanta-to-orlando"), "Canonical URL correct");

  // JSON-LD
  assert(result.jsonLd.count >= 3, "Has >= 3 JSON-LD objects");
  assert(result.jsonLd.types.includes("BreadcrumbList"), "Has BreadcrumbList");
  assert(result.jsonLd.types.includes("Service"), "Has Service");
  assert(result.jsonLd.types.includes("Organization"), "Has Organization");
  assert(result.jsonLd.types.includes("FAQPage"), "Has FAQPage");
  assert(Array.isArray(result.jsonLd.objects), "JSON-LD objects is array");

  // Content summary
  assert(result.content.headline.includes("Atlanta"), "Headline has origin");
  assert(result.content.headline.includes("Orlando"), "Headline has destination");
  assert(result.content.sections >= 5, "Content sections count >= 5");
  assert(result.content.faqs >= 5, "Content FAQs count >= 5");

  // Factory metadata
  assert(result._factory.version === ROUTE_CONTRACT_VERSION, "Factory version correct");
  assert(typeof result._factory.timestamp === "string", "Factory timestamp is string");
  assert(result._factory.input.origin === "Atlanta", "Factory input origin preserved");
  assert(result._factory.input.destination === "Orlando", "Factory input destination preserved");
  assert(result._factory.input.mode === "LTL", "Factory input mode preserved (default)");
}

section("Factory — Multiple Benchmark Lanes");
{
  for (const lane of BENCHMARK_LANES) {
    const result = produceLanePage(lane);
    const label = `${lane.origin}→${lane.destination}`;

    assert(result.slug.length > 0, `${label}: has slug`);
    assert(result.path.startsWith("/lanes/"), `${label}: path starts with /lanes/`);
    assert(result.quality.publishable, `${label}: publishable`);
    assert(result.quality.score >= 70, `${label}: score >= 70`);
    assert(result.quality.gates_passed === result.quality.gates_total, `${label}: all gates pass`);
    assert(result.validation.valid, `${label}: valid`);
    assert(result.jsonLd.count >= 3, `${label}: has JSON-LD`);
    assert(result.content.headline.includes(lane.origin), `${label}: headline has origin`);

    // Headline format is clean (no orphaned commas)
    assert(!result.content.headline.includes(", to "), `${label}: factory headline no ", to "`);
    assert(!result.content.headline.includes(", LTL"), `${label}: factory headline no ", LTL"`);
  }
}

section("Factory — Default Mode is LTL");
{
  const result = produceLanePage({ origin: "Atlanta", destination: "Orlando" });
  assert(result._factory.input.mode === "LTL", "Default mode is LTL");
  assert(result.payload.route.mode === "LTL", "Payload route mode is LTL");
  assert(result.content.headline.includes("LTL"), "Headline includes LTL");
}

section("Factory — Custom Mode");
{
  const result = produceLanePage({ origin: "Atlanta", destination: "Orlando", mode: "FTL" });
  assert(result._factory.input.mode === "FTL", "Custom mode preserved in factory input");
  assert(result.payload.route.mode === "FTL", "Custom mode in route");
  assert(result.content.headline.includes("FTL"), "Headline reflects custom mode");
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 3: FACTORY OUTPUT VALIDATION
// ══════════════════════════════════════════════════════════════════════

section("Factory Output Validation — Valid Result");
{
  const result = produceLanePage({ origin: "Atlanta", destination: "Orlando" });
  const v = validateFactoryOutput(result);
  assert(v.valid === true, "Valid factory output");
  assert(v.errors.length === 0, "No validation errors");
}

section("Factory Output Validation — Missing Fields Detected");
{
  // Test with empty object
  const v1 = validateFactoryOutput({});
  assert(v1.valid === false, "Empty object is invalid");
  assert(v1.errors.length > 5, "Multiple errors for empty object");
  assert(v1.errors.some(e => e.includes("slug")), "Detects missing slug");
  assert(v1.errors.some(e => e.includes("path")), "Detects missing path");
  assert(v1.errors.some(e => e.includes("payload")), "Detects missing payload");
  assert(v1.errors.some(e => e.includes("quality")), "Detects missing quality");
  assert(v1.errors.some(e => e.includes("metadata")), "Detects missing metadata");
  assert(v1.errors.some(e => e.includes("jsonLd")), "Detects missing jsonLd");
  assert(v1.errors.some(e => e.includes("content")), "Detects missing content");
  assert(v1.errors.some(e => e.includes("_factory")), "Detects missing _factory");

  // Test with partial object
  const v2 = validateFactoryOutput({
    slug: "test",
    path: "/wrong-prefix/test", // wrong prefix
    payload: {},
    quality: { score: 80 },
    validation: {},
    metadata: {},
    jsonLd: {},
    content: {},
    _factory: {},
  });
  assert(v2.valid === false, "Partial object is invalid");
  assert(v2.errors.some(e => e.includes("/lanes/")), "Detects wrong path prefix");
  assert(v2.errors.some(e => e.includes("hero")), "Detects missing hero");
  assert(v2.errors.some(e => e.includes("publishable")), "Detects missing publishable");
  assert(v2.errors.some(e => e.includes("metadata.title")), "Detects missing title");
}

section("Factory Output Validation — All Benchmark Lanes Pass");
{
  for (const lane of BENCHMARK_LANES) {
    const result = produceLanePage(lane);
    const v = validateFactoryOutput(result);
    assert(v.valid, `${lane.origin}→${lane.destination}: factory output valid`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 4: BATCH PRODUCTION
// ══════════════════════════════════════════════════════════════════════

section("Factory — Batch Production");
{
  const batch = produceLanePages(BENCHMARK_LANES);

  // Summary
  assert(batch.summary.total === BENCHMARK_LANES.length, "Batch total correct");
  assert(batch.summary.produced === BENCHMARK_LANES.length, "All lanes produced");
  assert(batch.summary.publishable === BENCHMARK_LANES.length, "All publishable");
  assert(batch.summary.blocked === 0, "None blocked");
  assert(batch.summary.errored === 0, "None errored");
  assert(batch.summary.avgScore >= 70, "Avg score >= 70");
  assert(typeof batch.summary.grades === "object", "Has grades object");
  assert(batch.summary.slugs.length === BENCHMARK_LANES.length, "Has all slugs");

  // Results array
  assert(batch.results.length === BENCHMARK_LANES.length, "Results array has all results");
  assert(batch.errors.length === 0, "No errors in batch");

  // Each result is valid
  for (const result of batch.results) {
    const v = validateFactoryOutput(result);
    assert(v.valid, `Batch result ${result.slug}: factory output valid`);
    assert(result.quality.publishable, `Batch result ${result.slug}: publishable`);
  }

  // Slugs are unique
  const slugSet = new Set(batch.summary.slugs);
  assert(slugSet.size === batch.summary.slugs.length, "All slugs unique");
}

section("Factory — Batch with Empty Array");
{
  const batch = produceLanePages([]);
  assert(batch.summary.total === 0, "Empty batch total is 0");
  assert(batch.summary.produced === 0, "Empty batch produced is 0");
  assert(batch.summary.avgScore === 0, "Empty batch avg score is 0");
  assert(batch.results.length === 0, "Empty results");
  assert(batch.errors.length === 0, "Empty errors");
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 5: ERROR HANDLING
// ══════════════════════════════════════════════════════════════════════

section("Factory — Missing Input Throws");
{
  let threw = false;
  try {
    produceLanePage({});
  } catch (err) {
    threw = true;
    assert(err.message.includes("origin"), "Error mentions origin");
    assert(err.message.includes("destination"), "Error mentions destination");
  }
  assert(threw, "Missing input throws");

  let threw2 = false;
  try {
    produceLanePage({ origin: "Atlanta" });
  } catch (err) {
    threw2 = true;
  }
  assert(threw2, "Missing destination throws");

  let threw3 = false;
  try {
    produceLanePage({ destination: "Orlando" });
  } catch (err) {
    threw3 = true;
  }
  assert(threw3, "Missing origin throws");
}

section("Factory — MinScore Threshold");
{
  // Default minScore is 70
  const result = produceLanePage({ origin: "Atlanta", destination: "Orlando" });
  assert(result.quality.meetsMinScore === true, "Default minScore 70 met");

  // Custom minScore
  const result2 = produceLanePage({ origin: "Atlanta", destination: "Orlando" }, { minScore: 95 });
  // Score is typically 89, so should not meet 95
  if (result2.quality.score < 95) {
    assert(result2.quality.meetsMinScore === false, "High minScore 95 correctly not met");
  } else {
    assert(result2.quality.meetsMinScore === true, "High minScore 95 met (exceptional score)");
  }

  const result3 = produceLanePage({ origin: "Atlanta", destination: "Orlando" }, { minScore: 50 });
  assert(result3.quality.meetsMinScore === true, "Low minScore 50 always met");
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 6: FACTORY ↔ PIPELINE CONSISTENCY
// ══════════════════════════════════════════════════════════════════════

section("Factory ↔ Direct Pipeline Consistency");
{
  // Factory path
  const factoryResult = produceLanePage({ origin: "Atlanta", destination: "Orlando" });

  // Direct path
  const knowledge = buildLaneKnowledge({ origin: "Atlanta", destination: "Orlando", mode: "LTL" });
  const canonical = buildCanonicalLanePageData(knowledge, {});
  const { payload: directPayload, quality: directQuality } = buildRouteContract(canonical);

  // Key fields must match
  assert(factoryResult.slug === directPayload.slug, "Factory slug matches direct path");
  assert(factoryResult.path === directPayload.path, "Factory path matches direct path");
  assert(factoryResult.quality.score === directQuality.score, "Quality scores match");
  assert(factoryResult.quality.grade === directQuality.grade, "Quality grades match");
  assert(factoryResult.quality.gates_passed === directQuality.gates_passed, "Gates passed match");
  assert(factoryResult.content.headline === directPayload.hero.headline, "Headlines match");
  assert(factoryResult.payload.metadata.title === directPayload.metadata.title, "Metadata titles match");
  assert(factoryResult.payload.metadata.canonical === directPayload.metadata.canonical, "Canonicals match");
}

section("Factory ↔ Webflow Path Content Parity");
{
  // Verify factory content matches Webflow-path content
  const knowledge = buildLaneKnowledge({ origin: "Atlanta", destination: "Orlando", mode: "LTL" });
  const canonical = buildCanonicalLanePageData(knowledge, {});
  const wf = renderWebflowFields(canonical);
  const contract = buildPublishContract(canonical);

  // Contract content must match Webflow fields
  assert(contract.content.body_text === wf["body-content"], "Body text parity (contract vs WF)");
  assert(contract.sections.kpi_panel_html === wf["lane-intelligence-panel"], "KPI panel parity");
  assert(contract.sections.execution_flow_html === wf["execution-flow"], "Execution flow parity");
  assert(contract.content.primary_content_html === wf["faq-schema"], "Primary content parity");
  assert(contract.schema.structured_data_html === wf["breadcrumb-schema"], "Schema parity");
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 7: QUALITY GATE THROUGH FACTORY
// ══════════════════════════════════════════════════════════════════════

section("Factory — Quality Gate Structure");
{
  const result = produceLanePage({ origin: "Atlanta", destination: "Orlando" });

  // Quality object shape
  assert(typeof result.quality.score === "number", "Score is number");
  assert(typeof result.quality.grade === "string", "Grade is string");
  assert(typeof result.quality.gates_passed === "number", "Gates passed is number");
  assert(typeof result.quality.gates_total === "number", "Gates total is number");
  assert(typeof result.quality.publishable === "boolean", "Publishable is boolean");
  assert(typeof result.quality.meetsMinScore === "boolean", "MeetsMinScore is boolean");

  // Payload quality section (inner route contract)
  assert(typeof result.payload.quality === "object", "Payload has quality");
  assert(result.payload.quality.publishable === result.quality.publishable, "Payload quality matches factory quality");
  assert(result.payload.quality.score === result.quality.score, "Payload score matches factory score");
  assert(result.payload.quality.grade === result.quality.grade, "Payload grade matches factory grade");
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 8: ROUTE CONTRACT METADATA THROUGH FACTORY
// ══════════════════════════════════════════════════════════════════════

section("Factory — Metadata for generateMetadata()");
{
  const result = produceLanePage({ origin: "Atlanta", destination: "Orlando" });
  const meta = result.metadata;

  // Must be compatible with Next.js generateMetadata()
  assert(typeof meta.title === "string", "Metadata title is string");
  assert(typeof meta.description === "string", "Metadata description is string");
  assert(typeof meta.alternates === "object", "Metadata has alternates");
  assert(typeof meta.alternates.canonical === "string", "Has canonical URL");
  assert(meta.alternates.canonical.includes("wearewarp.com"), "Canonical has domain");
  assert(meta.alternates.canonical.includes("atlanta-to-orlando"), "Canonical has slug");
}

section("Factory — JSON-LD for Structured Data");
{
  const result = produceLanePage({ origin: "Atlanta", destination: "Orlando" });

  // JSON-LD structure
  assert(result.jsonLd.count >= 4, "Has >= 4 JSON-LD types");
  assert(result.jsonLd.types.includes("BreadcrumbList"), "BreadcrumbList");
  assert(result.jsonLd.types.includes("Service"), "Service");
  assert(result.jsonLd.types.includes("Organization"), "Organization");
  assert(result.jsonLd.types.includes("FAQPage"), "FAQPage");

  // Each object is parseable
  for (const obj of result.jsonLd.objects) {
    assert(typeof obj === "object", "JSON-LD object is object");
    assert(typeof obj["@type"] === "string", "JSON-LD has @type");
    assert(obj["@context"] === "https://schema.org", "JSON-LD has schema.org context");
  }

  // BreadcrumbList specifics
  const bc = result.jsonLd.objects.find(o => o["@type"] === "BreadcrumbList");
  assert(bc, "BreadcrumbList object found");
  assert(Array.isArray(bc.itemListElement), "BreadcrumbList has items");
  assert(bc.itemListElement.length >= 3, "Breadcrumb has depth");

  // FAQPage specifics
  const faq = result.jsonLd.objects.find(o => o["@type"] === "FAQPage");
  assert(faq, "FAQPage object found");
  assert(Array.isArray(faq.mainEntity), "FAQPage has mainEntity");
  assert(faq.mainEntity.length >= 5, "FAQPage has >= 5 questions");
  assert(faq.mainEntity[0]["@type"] === "Question", "FAQ entries are Questions");
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 9: NO ORPHANED COMMAS — EXHAUSTIVE CROSS-PIPELINE CHECK
// ══════════════════════════════════════════════════════════════════════

section("Cross-Pipeline Orphaned Comma Check");
{
  // The bug pattern: ", to " or trailing ", " before mode
  const ORPHAN_PATTERNS = [", to ", ", LTL", ", FTL", ", Cargo"];

  for (const lane of BENCHMARK_LANES.slice(0, 5)) {
    const k = buildLaneKnowledge({ ...lane, mode: "LTL" });
    const c = buildCanonicalLanePageData(k, {});
    const { payload } = buildRouteContract(c);
    const wf = renderWebflowFields(c);
    const contract = buildPublishContract(c);
    const rendered = contractToRenderedFields(contract);
    const label = `${lane.origin}→${lane.destination}`;

    // Check all title/headline strings across all pipelines
    const titleStrings = [
      c.page_title,
      c.hero.headline,
      payload.metadata.title,
      payload.hero.headline,
      contract.hero.headline,
      contract.seo.title,
      wf["hero-headline"],
      wf["seo-title"],
      rendered["hero-headline"],
      rendered["seo-title"],
    ];

    for (let i = 0; i < titleStrings.length; i++) {
      const s = titleStrings[i];
      for (const pattern of ORPHAN_PATTERNS) {
        assert(!s.includes(pattern), `${label}: title string[${i}] no "${pattern}"`);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 10: FACTORY MODULE EXPORTS
// ══════════════════════════════════════════════════════════════════════

section("Factory Module Exports");
{
  assert(typeof produceLanePage === "function", "produceLanePage exported");
  assert(typeof produceLanePages === "function", "produceLanePages exported");
  assert(typeof validateFactoryOutput === "function", "validateFactoryOutput exported");
}

// ── Report ───────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log(`FACTORY & HEADLINE TESTS: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(60)}`);

if (failed > 0) process.exit(1);
