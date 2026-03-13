/**
 * route-contract.test.js — Route Contract Architecture Tests
 *
 * Verifies the Next.js route contract pipeline:
 *   - Route contract generation from canonical lane data
 *   - Metadata integrity (title, description, canonical, robots)
 *   - Schema integrity (BreadcrumbList, Service, Organization, FAQPage)
 *   - Section presence and ownership
 *   - Quality gate integration
 *   - Vehicle flexibility framing preservation
 *   - No duplicate structural ownership
 *   - Benchmark lane proof
 *   - Route contract validation
 *   - Legacy isolation boundary
 *
 * Uses the existing custom test harness pattern.
 */

import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import {
  buildRouteContract,
  validateRouteContract,
  extractNextMetadata,
  extractJsonLdObjects,
  ROUTE_CONTRACT_KEYS,
  METADATA_REQUIRED_KEYS,
  ROUTE_CONTRACT_VERSION,
} from "../lib/route-contract.js";
import {
  buildPublishContract,
  contractToRenderedFields,
} from "../lib/publishers/publish-contract.js";
import { toTargetFields } from "../lib/publishers/neutral-adapter.js";
import { assessPublishQuality } from "../lib/lane-page-validator.js";
import { renderWebflowFields } from "../lib/render-lane-page.js";
import { CANONICAL_SECTIONS } from "../lib/lane-page-schema.js";

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
  { origin: "Atlanta", destination: "Orlando", mode: "LTL" },
  { origin: "Los Angeles", destination: "Chicago", mode: "LTL" },
  { origin: "Dallas", destination: "Houston", mode: "LTL" },
  { origin: "New York", destination: "Miami", mode: "LTL" },
  { origin: "Seattle", destination: "Phoenix", mode: "LTL" },
];

function buildBenchmark(lane) {
  const knowledge = buildLaneKnowledge(lane);
  const canonical = buildCanonicalLanePageData(knowledge, {});
  return { knowledge, canonical, ...buildRouteContract(canonical) };
}

const atl = buildBenchmark(BENCHMARK_LANES[0]);

// ══════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════

// ── 1. Route Contract Structure ──────────────────────────────────────

section("Route Contract Structure");

assert(atl.payload !== null, "Payload is not null");
assert(typeof atl.payload === "object", "Payload is an object");
assert(atl.payload._route_contract_version === ROUTE_CONTRACT_VERSION, "Has route contract version");
assert(typeof atl.payload._generated_at === "string", "Has generation timestamp");

for (const key of ROUTE_CONTRACT_KEYS) {
  assert(atl.payload[key] !== undefined, `Has required key: ${key}`);
}

assert(atl.payload.slug === "atlanta-to-orlando", "Slug is correct");
assert(atl.payload.path === "/lanes/atlanta-to-orlando", "Path is correct");

// ── 2. Route Data ────────────────────────────────────────────────────

section("Route Data");

assert(typeof atl.payload.route === "object", "Route is an object");
assert(atl.payload.route.origin.city === "Atlanta", "Origin city");
assert(atl.payload.route.destination.city === "Orlando", "Destination city");
assert(atl.payload.route.mode === "LTL", "Mode is LTL");
assert(atl.payload.route.segment === "smb", "Segment is smb");
assert(typeof atl.payload.route.badge === "string", "Badge is a string");

// ── 3. Metadata Integrity ────────────────────────────────────────────

section("Metadata Integrity");

const meta = atl.payload.metadata;
assert(typeof meta === "object", "Metadata is an object");
assert(meta.title.includes("Atlanta"), "Title contains origin city");
assert(meta.title.includes("Orlando"), "Title contains destination city");
assert(meta.title.includes("LTL"), "Title contains mode");
assert(meta.title.includes("WARP"), "Title contains brand");
assert(meta.title.endsWith("| WARP"), "Title ends with | WARP");
assert(meta.description.length > 50, "Meta description has substantial content");
assert(meta.description.includes("Atlanta"), "Description includes origin");
assert(meta.description.includes("Orlando"), "Description includes destination");
assert(meta.canonical === "https://www.wearewarp.com/lanes/atlanta-to-orlando", "Canonical URL correct");
assert(meta.robots === "index, follow", "Robots is index, follow");

for (const key of METADATA_REQUIRED_KEYS) {
  assert(meta[key] !== undefined && meta[key] !== null, `Has metadata field: ${key}`);
}

// ── 4. Schema Integrity ──────────────────────────────────────────────

section("Schema Integrity");

const jsonLd = meta.jsonLd;
assert(Array.isArray(jsonLd), "jsonLd is an array");
assert(jsonLd.length >= 3, "Has at least 3 JSON-LD objects (breadcrumb, service, org)");

const schemaTypes = jsonLd.map(s => s["@type"]);
assert(schemaTypes.includes("BreadcrumbList"), "Has BreadcrumbList schema");
assert(schemaTypes.includes("Service"), "Has Service schema");
assert(schemaTypes.includes("Organization"), "Has Organization schema");
assert(schemaTypes.includes("FAQPage"), "Has FAQPage schema");

// BreadcrumbList validation
const breadcrumb = jsonLd.find(s => s["@type"] === "BreadcrumbList");
assert(breadcrumb["@context"] === "https://schema.org", "Breadcrumb has schema.org context");
assert(Array.isArray(breadcrumb.itemListElement), "Breadcrumb has itemListElement");
assert(breadcrumb.itemListElement.length >= 3, "Breadcrumb has ≥3 items");
assert(breadcrumb.itemListElement[0].name === "WARP", "Breadcrumb starts with WARP");

// Service validation
const service = jsonLd.find(s => s["@type"] === "Service");
assert(service.name.includes("LTL"), "Service name includes mode");
assert(service.name.includes("Atlanta"), "Service name includes origin");
assert(service.provider.name === "WARP", "Service provider is WARP");

// FAQPage validation
const faqSchema = jsonLd.find(s => s["@type"] === "FAQPage");
assert(Array.isArray(faqSchema.mainEntity), "FAQPage has mainEntity array");
assert(faqSchema.mainEntity.length > 0, "FAQPage has questions");
assert(faqSchema.mainEntity[0]["@type"] === "Question", "FAQ entries are Questions");

// ── 5. Hero Section ──────────────────────────────────────────────────

section("Hero Section");

const hero = atl.payload.hero;
assert(typeof hero === "object", "Hero is an object");
assert(hero.headline.includes("Atlanta"), "Headline includes origin");
assert(hero.headline.includes("Orlando"), "Headline includes destination");
assert(hero.headline.includes("LTL"), "Headline includes mode");
assert(hero.subhead.length > 50, "Subhead has substantial content");
assert(Array.isArray(hero.kpis), "KPIs is an array");
assert(hero.kpis.length >= 2, "Has at least 2 KPIs");

const kpiLabels = hero.kpis.map(k => k.label);
assert(kpiLabels.includes("Distance"), "Has Distance KPI");
assert(kpiLabels.includes("Transit"), "Has Transit KPI");

assert(hero.ctas.primary.url.includes("/quote"), "Primary CTA goes to quote");
assert(hero.ctas.secondary.url.includes("/book"), "Secondary CTA goes to book");

// ── 6. Content Sections ──────────────────────────────────────────────

section("Content Sections");

const sections = atl.payload.sections;
assert(Array.isArray(sections), "Sections is an array");
assert(sections.length >= 5, "Has at least 5 content sections");

const sectionIds = sections.map(s => s.id);
assert(sectionIds.some(id => id.includes("corridor")), "Has corridor/overview section");
assert(sectionIds.some(id => id.includes("operating") || id.includes("transit")), "Has operating details section");
assert(sectionIds.some(id => id.includes("visibility") || id.includes("proof")), "Has proof section");
assert(sectionIds.some(id => id.includes("warp")), "Has WARP section");
assert(sectionIds.some(id => id.includes("faq") || id.includes("question")), "Has FAQ section");

for (const s of sections) {
  assert(typeof s.id === "string" && s.id.length > 0, `Section has id: ${s.id}`);
  assert(typeof s.html === "string" && s.html.length > 0, `Section ${s.id} has HTML content`);
}

// ── 7. Dedicated Sections ────────────────────────────────────────────

section("Dedicated Sections");

assert(atl.payload.kpi_panel.html.length > 400, "KPI panel has substantial HTML");
assert(atl.payload.execution_flow.html.length > 400, "Execution flow has substantial HTML");
assert(atl.payload.proof.html.length > 200, "Proof section has substantial HTML");

// ── 8. Structured Data Sections ──────────────────────────────────────

section("Structured Data Sections");

const faqs = atl.payload.faqs;
assert(Array.isArray(faqs), "FAQs is an array");
assert(faqs.length >= 5, "Has at least 5 FAQs");
for (const faq of faqs) {
  assert(typeof faq.question === "string" && faq.question.length > 10, "FAQ has question");
  assert(typeof faq.answer === "string" && faq.answer.length > 10, "FAQ has answer");
}

const whyWarp = atl.payload.why_warp;
assert(Array.isArray(whyWarp), "Why WARP is an array");
assert(whyWarp.length >= 3, "Has at least 3 Why WARP reasons");
for (const r of whyWarp) {
  assert(typeof r.heading === "string" && r.heading.length > 0, "Reason has heading");
  assert(typeof r.body === "string" && r.body.length > 0, "Reason has body");
}

const comparison = atl.payload.comparison;
assert(Array.isArray(comparison), "Comparison is an array");
assert(comparison.length >= 5, "Has at least 5 comparison points");
for (const c of comparison) {
  assert(typeof c.metric === "string", "Comparison has metric");
  assert(typeof c.traditional === "string", "Comparison has traditional");
  assert(typeof c.warp === "string", "Comparison has warp");
}

// ── 9. Lane Statistics ───────────────────────────────────────────────

section("Lane Statistics");

const stats = atl.payload.stats;
assert(stats.distance_miles > 0, "Has distance");
assert(stats.transit_days.min > 0, "Has transit min");
assert(stats.transit_days.max > 0, "Has transit max");
assert(stats.transit_days.max >= stats.transit_days.min, "Transit max >= min");
assert(stats.rate_range_usd.low > 0, "Has rate low");
assert(stats.rate_range_usd.high > stats.rate_range_usd.low, "Rate high > low");
assert(Array.isArray(stats.common_equipment), "Has equipment array");
assert(stats.common_equipment.length > 0, "Has at least 1 equipment type");

// ── 10. Network Proof ────────────────────────────────────────────────

section("Network Proof");

const network = atl.payload.network;
assert(network.carrier_count > 0, "Has carrier count");
assert(Array.isArray(network.cross_docks), "Has cross docks array");
assert(typeof network.origin_region === "string", "Has origin region");
assert(typeof network.destination_region === "string", "Has destination region");

// ── 11. CTAs ─────────────────────────────────────────────────────────

section("CTAs");

const ctas = atl.payload.ctas;
assert(ctas.hero.url.includes("/quote"), "Hero CTA goes to quote");
assert(ctas.final.headline.length > 0, "Final CTA has headline");
assert(ctas.final.primary.url.includes("/quote"), "Final primary CTA goes to quote");

// ── 12. Quality Gate Integration ─────────────────────────────────────

section("Quality Gate Integration");

assert(atl.publishable === true, "Benchmark lane is publishable");
assert(atl.quality.publishable === true, "Quality report says publishable");
assert(atl.quality.grade === "B" || atl.quality.grade === "A", "Grade is A or B");
assert(atl.quality.score >= 70, "Score is ≥70%");
assert(atl.payload.quality.publishable === true, "Payload quality matches");
assert(atl.payload.quality.gates_passed === atl.payload.quality.gates_total, "All gates passed");
assert(atl.payload.quality.gates_total >= 17, "Has at least 17 quality gates");

// ── 13. Route Contract Validation ────────────────────────────────────

section("Route Contract Validation");

const validation = validateRouteContract(atl.payload);
assert(validation.valid === true, "Route contract validates");
assert(validation.errors.length === 0, "No validation errors");

const nullValidation = validateRouteContract(null);
assert(nullValidation.valid === false, "Null payload fails validation");
assert(nullValidation.errors.length > 0, "Null payload has errors");

// ── 14. extractNextMetadata ──────────────────────────────────────────

section("extractNextMetadata");

const nextMeta = extractNextMetadata(atl.payload);
assert(nextMeta.title === meta.title, "Next metadata title matches");
assert(nextMeta.description === meta.description, "Next metadata description matches");
assert(nextMeta.alternates.canonical === meta.canonical, "Next metadata canonical matches");
assert(nextMeta.robots === meta.robots, "Next metadata robots matches");
assert(nextMeta.openGraph.title === meta.title, "OpenGraph title matches");
assert(nextMeta.openGraph.siteName === "WARP", "OpenGraph siteName is WARP");

const emptyMeta = extractNextMetadata(null);
assert(Object.keys(emptyMeta).length === 0, "Null payload returns empty metadata");

// ── 15. extractJsonLdObjects ─────────────────────────────────────────

section("extractJsonLdObjects");

const extractedLd = extractJsonLdObjects(atl.payload);
assert(Array.isArray(extractedLd), "Returns array");
assert(extractedLd.length === jsonLd.length, "Same count as metadata.jsonLd");

const emptyLd = extractJsonLdObjects(null);
assert(Array.isArray(emptyLd), "Null returns empty array");
assert(emptyLd.length === 0, "Null returns zero items");

// ── 16. Single H1 Enforcement ────────────────────────────────────────

section("Single H1 Enforcement");

// The hero.headline is the H1. Content sections should NOT have H1 tags.
for (const s of sections) {
  const h1Count = (s.html.match(/<h1[\s>]/gi) || []).length;
  assert(h1Count === 0, `Section ${s.id} has no H1 tags (found ${h1Count})`);
}

// ── 17. Vehicle Flexibility Framing ──────────────────────────────────

section("Vehicle Flexibility Framing");

// Cargo vans and box trucks are operational tools inside LTL execution,
// not separate freight modes. The content must NOT frame them as separate modes.
const allContent = sections.map(s => s.html).join(" ") + " " + atl.payload.kpi_panel.html + " " + atl.payload.execution_flow.html;

// LTL pages should reference equipment as tools, not as independent services
const hasEquipment = allContent.toLowerCase().includes("equipment") ||
  allContent.toLowerCase().includes("cargo van") ||
  allContent.toLowerCase().includes("box truck") ||
  allContent.toLowerCase().includes("trailer");
assert(hasEquipment, "Content references equipment/vehicles");

// Comparison should be secondary — WARP vs Traditional, not mode vs mode
for (const c of comparison) {
  assert(!c.metric.toLowerCase().includes("cargo van vs"), "No cargo van vs mode comparison");
  assert(!c.metric.toLowerCase().includes("box truck vs"), "No box truck vs mode comparison");
}

// ── 18. No Duplicate Structural Ownership ────────────────────────────

section("No Duplicate Structural Ownership");

// KPI panel content should NOT also appear in sections
const kpiHtml = atl.payload.kpi_panel.html;
const kpiHasGrid = kpiHtml.includes("grid-template-columns");
assert(kpiHasGrid, "KPI panel uses grid layout");

// Check that sections don't duplicate the KPI grid pattern
for (const s of sections) {
  const hasKpiGrid = s.html.includes("grid-template-columns:repeat(auto-fit,minmax(1");
  if (hasKpiGrid) {
    // Only fail if it ALSO has KPI labels
    const hasKpiLabels = s.html.includes("Lane Distance") && s.html.includes("Transit Window");
    assert(!hasKpiLabels, `Section ${s.id} should not duplicate KPI panel labels`);
  }
}

// ── 19. Multi-Lane Benchmark ─────────────────────────────────────────

section("Multi-Lane Benchmark");

for (const lane of BENCHMARK_LANES) {
  const b = buildBenchmark(lane);
  const label = `${lane.origin} to ${lane.destination}`;
  assert(b.publishable, `${label} is publishable`);
  assert(b.payload.slug.length > 0, `${label} has slug`);
  assert(b.payload.metadata.title.length > 0, `${label} has title`);
  assert(b.payload.metadata.jsonLd.length >= 3, `${label} has ≥3 JSON-LD`);
  assert(b.payload.sections.length >= 5, `${label} has ≥5 sections`);
  assert(b.payload.faqs.length >= 3, `${label} has ≥3 FAQs`);
  assert(b.payload.quality.gates_passed === b.payload.quality.gates_total, `${label} passes all gates`);

  const v = validateRouteContract(b.payload);
  assert(v.valid, `${label} validates`);
}

// ── 20. Route Contract vs Webflow Parity ─────────────────────────────

section("Route Contract vs Webflow Parity");

// The route contract must produce content equivalent to the Webflow path.
// Both paths share the same section renderers via buildPublishContract().
const wfFields = renderWebflowFields(atl.canonical);
const contract = buildPublishContract(atl.canonical);

// Body content equivalence
assert(contract.content.body_text === wfFields["body-content"], "Body content matches Webflow");

// KPI panel equivalence
assert(contract.sections.kpi_panel_html === wfFields["lane-intelligence-panel"], "KPI panel matches Webflow");

// Execution flow equivalence
assert(contract.sections.execution_flow_html === wfFields["execution-flow"], "Execution flow matches Webflow");

// SEO title equivalence
assert(contract.seo.title === wfFields["seo-title"], "SEO title matches Webflow");

// Canonical URL equivalence
assert(contract.seo.canonical_url === wfFields["canonical-url"], "Canonical URL matches Webflow");

// ── 21. Determinism ──────────────────────────────────────────────────

section("Determinism");

// Same input must produce identical output (except timestamp)
const r1 = buildRouteContract(atl.canonical);
const r2 = buildRouteContract(atl.canonical);

assert(r1.payload.slug === r2.payload.slug, "Slug is deterministic");
assert(r1.payload.metadata.title === r2.payload.metadata.title, "Title is deterministic");
assert(r1.payload.hero.headline === r2.payload.hero.headline, "Headline is deterministic");
assert(r1.payload.sections.length === r2.payload.sections.length, "Section count is deterministic");
assert(r1.payload.faqs.length === r2.payload.faqs.length, "FAQ count is deterministic");
assert(r1.payload.quality.score === r2.payload.quality.score, "Quality score is deterministic");
assert(r1.payload.kpi_panel.html === r2.payload.kpi_panel.html, "KPI panel HTML is deterministic");

// ── 22. Error Handling ───────────────────────────────────────────────

section("Error Handling");

let threw = false;
try { buildRouteContract(null); } catch { threw = true; }
assert(threw, "buildRouteContract throws on null input");

threw = false;
try { buildRouteContract(undefined); } catch { threw = true; }
assert(threw, "buildRouteContract throws on undefined input");

// ── 23. Legacy Isolation Boundary ────────────────────────────────────

section("Legacy Isolation Boundary");

// Route contract must NOT contain Webflow field names
const payloadStr = JSON.stringify(atl.payload);
const webflowFieldNames = [
  "faq-schema",
  "lane-intelligence-panel",
  "breadcrumb-schema",
  "hero-headline",
  "body-content",
  "seo-title",
  "lane-mode-enabled",
  "hero-video-enabled",
];

for (const wf of webflowFieldNames) {
  // Check as object keys, not within HTML content
  const hasAsKey = Object.keys(atl.payload).includes(wf);
  assert(!hasAsKey, `Route contract does not use Webflow key: ${wf}`);
}

// Route contract should use semantic keys
assert("slug" in atl.payload, "Uses semantic key: slug");
assert("metadata" in atl.payload, "Uses semantic key: metadata");
assert("hero" in atl.payload, "Uses semantic key: hero");
assert("sections" in atl.payload, "Uses semantic key: sections");
assert("quality" in atl.payload, "Uses semantic key: quality");

// ── Report ───────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log(`Route Contract Tests: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(60)}`);

if (failed > 0) process.exit(1);
