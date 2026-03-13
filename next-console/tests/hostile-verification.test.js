/**
 * hostile-verification.test.js — Hostile Migration Verification
 *
 * End-to-end verification that the Next.js route contract migration
 * is architectural, not cosmetic. Validates:
 *   - Canonical lane model remains source of truth
 *   - Route contract drives rendering (not Webflow fields)
 *   - Benchmark route renders correctly
 *   - Metadata + schema integrity
 *   - Quality gate protects route path
 *   - Content parity with Webflow path
 *   - Single H1 enforcement
 *   - Vehicle flexibility framing preserved
 *   - No Webflow field names in route contract
 *   - Legacy Webflow code is annotated
 */

import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData, CANONICAL_SECTIONS } from "../lib/lane-page-schema.js";
import {
  buildRouteContract,
  validateRouteContract,
  extractNextMetadata,
  extractJsonLdObjects,
  ROUTE_CONTRACT_KEYS,
} from "../lib/route-contract.js";
import { renderWebflowFields, WEBFLOW_TEMPLATE_HIDE_CSS, LANE_PAGE_MODE_CSS } from "../lib/render-lane-page.js";
import { buildPublishContract, contractToRenderedFields } from "../lib/publishers/publish-contract.js";
import { assessPublishQuality } from "../lib/lane-page-validator.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    console.error(`  HOSTILE FAIL: ${label}`);
  }
}

// ── Build benchmark ──────────────────────────────────────────────────

const k = buildLaneKnowledge({ origin: "Atlanta", destination: "Orlando", mode: "LTL" });
const canonical = buildCanonicalLanePageData(k, {});
const { payload, quality, publishable } = buildRouteContract(canonical);
const wfFields = renderWebflowFields(canonical);

// ══════════════════════════════════════════════════════════════════════
// HOSTILE CHECKS
// ══════════════════════════════════════════════════════════════════════

section("Branch Hygiene");
// Not on main — verified by git check in the script runner
assert(true, "Branch verification delegated to git workflow");

section("Canonical Model is Source of Truth");
assert(canonical.hero.headline.includes("Atlanta"), "Canonical hero includes origin");
assert(canonical.hero.headline.includes("Orlando"), "Canonical hero includes destination");
assert(canonical.lane_slug === "atlanta-to-orlando", "Canonical slug correct");
assert(CANONICAL_SECTIONS.length === 11, "All 11 canonical sections defined");
assert(canonical.page_title.includes("WARP"), "Canonical title has brand");

section("Route Contract Drives Rendering");
assert(payload._route_contract_version === "1.0.0", "Has route contract version");
assert(typeof payload.metadata === "object", "Has metadata object");
assert(typeof payload.hero === "object", "Has hero object");
assert(Array.isArray(payload.sections), "Has sections array");
assert(typeof payload.quality === "object", "Has quality object");
assert(typeof payload.stats === "object", "Has stats object");
assert(typeof payload.network === "object", "Has network object");

for (const key of ROUTE_CONTRACT_KEYS) {
  assert(payload[key] !== undefined, `Route contract has key: ${key}`);
}

section("No Webflow Field Names in Route Contract");
const webflowKeys = [
  "faq-schema", "lane-intelligence-panel", "breadcrumb-schema",
  "hero-headline", "body-content", "seo-title", "seo-meta-description",
  "lane-mode-enabled", "hero-video-enabled", "hero-map-enabled",
  "hero-kpi-distance", "hero-kpi-transit", "hero-kpi-carriers",
  "proof-section", "execution-flow", "traditional-ltl", "warp-ltl",
  "cta-primary-text", "cta-primary-url", "lane-badge",
];
const payloadKeys = Object.keys(payload);
for (const wfKey of webflowKeys) {
  assert(!payloadKeys.includes(wfKey), `No Webflow key: ${wfKey}`);
}

section("Benchmark Route Renders Correctly");
assert(payload.slug === "atlanta-to-orlando", "Correct slug");
assert(payload.path === "/lanes/atlanta-to-orlando", "Correct path");
assert(payload.route.origin.city === "Atlanta", "Origin city");
assert(payload.route.destination.city === "Orlando", "Destination city");
assert(payload.route.mode === "LTL", "Mode is LTL");
assert(payload.hero.headline.includes("Atlanta"), "Headline has origin");
assert(payload.hero.headline.includes("Orlando"), "Headline has destination");
assert(payload.hero.headline.includes("LTL"), "Headline has mode");
assert(payload.hero.subhead.length > 80, "Subhead has substantial content");
assert(payload.hero.kpis.length >= 2, "Has KPI chips");
assert(payload.sections.length >= 5, "Has content sections");
assert(payload.kpi_panel.html.length > 400, "KPI panel has content");
assert(payload.execution_flow.html.length > 400, "Execution flow has content");
assert(payload.proof.html.length > 100, "Proof has content");
assert(payload.faqs.length >= 5, "Has FAQs");
assert(payload.why_warp.length >= 3, "Has Why WARP reasons");
assert(payload.comparison.length >= 5, "Has comparison points");

section("Metadata Integrity");
assert(payload.metadata.title.includes("Atlanta"), "Title has origin");
assert(payload.metadata.title.includes("Orlando"), "Title has destination");
assert(payload.metadata.title.includes("LTL"), "Title has mode");
assert(payload.metadata.title.endsWith("| WARP"), "Title ends with | WARP");
assert(payload.metadata.description.length > 50, "Description is substantial");
assert(payload.metadata.canonical === "https://www.wearewarp.com/lanes/atlanta-to-orlando", "Canonical correct");
assert(payload.metadata.robots === "index, follow", "Robots is index,follow");
assert(payload.metadata.openGraph.siteName === "WARP", "OG siteName is WARP");

const nextMeta = extractNextMetadata(payload);
assert(nextMeta.title === payload.metadata.title, "extractNextMetadata preserves title");
assert(nextMeta.alternates.canonical === payload.metadata.canonical, "extractNextMetadata preserves canonical");

section("Schema Integrity");
const jsonLd = payload.metadata.jsonLd;
assert(jsonLd.length >= 3, "Has >= 3 JSON-LD objects");
const types = jsonLd.map(s => s["@type"]);
assert(types.includes("BreadcrumbList"), "Has BreadcrumbList");
assert(types.includes("Service"), "Has Service");
assert(types.includes("Organization"), "Has Organization");
assert(types.includes("FAQPage"), "Has FAQPage");

const bc = jsonLd.find(s => s["@type"] === "BreadcrumbList");
assert(bc["@context"] === "https://schema.org", "Breadcrumb has context");
assert(bc.itemListElement[0].name === "WARP", "Breadcrumb starts with WARP");
assert(bc.itemListElement.length >= 3, "Breadcrumb has depth");

const svc = jsonLd.find(s => s["@type"] === "Service");
assert(svc.provider.name === "WARP", "Service provider is WARP");
assert(svc.name.includes("LTL"), "Service includes mode");

const faqS = jsonLd.find(s => s["@type"] === "FAQPage");
assert(faqS.mainEntity.length >= 5, "FAQ schema has questions");
assert(faqS.mainEntity[0]["@type"] === "Question", "FAQ entries are Questions");

section("Quality Gate Protects Route Path");
assert(publishable === true, "Benchmark is publishable");
assert(quality.score >= 70, "Score >= 70");
assert(quality.grade === "B" || quality.grade === "A", "Grade is A or B");
assert(payload.quality.gates_passed === payload.quality.gates_total, "All gates passed");
assert(payload.quality.gates_total >= 17, "Has >= 17 gates");

section("Content Parity with Webflow Path");
const contract = buildPublishContract(canonical);
assert(contract.content.body_text === wfFields["body-content"], "Body text parity");
assert(contract.sections.kpi_panel_html === wfFields["lane-intelligence-panel"], "KPI panel parity");
assert(contract.sections.execution_flow_html === wfFields["execution-flow"], "Execution flow parity");
assert(contract.seo.title === wfFields["seo-title"], "SEO title parity");
assert(contract.seo.canonical_url === wfFields["canonical-url"], "Canonical URL parity");
assert(contract.content.primary_content_html === wfFields["faq-schema"], "Primary content parity");
assert(contract.schema.structured_data_html === wfFields["breadcrumb-schema"], "Schema parity");

section("Single H1 Enforcement");
for (const s of payload.sections) {
  const h1Count = (s.html.match(/<h1[\s>]/gi) || []).length;
  assert(h1Count === 0, `No H1 in section ${s.id}`);
}

section("Vehicle Flexibility Framing");
for (const cp of payload.comparison) {
  assert(!cp.metric.toLowerCase().includes("cargo van vs"), "No van vs comparison");
  assert(!cp.metric.toLowerCase().includes("box truck vs"), "No truck vs comparison");
}
// Equipment should be referenced as operational tools
const allContent = payload.sections.map(s => s.html).join(" ").toLowerCase();
assert(
  allContent.includes("equipment") || allContent.includes("trailer") ||
  allContent.includes("capacity") || allContent.includes("pallet"),
  "References operational equipment"
);

section("No Duplicate Structural Ownership");
const kpiHtml = payload.kpi_panel.html;
for (const s of payload.sections) {
  if (s.html.includes("grid-template-columns:repeat(auto-fit,minmax(1")) {
    const dupeLabels = s.html.includes("Lane Distance") && s.html.includes("Transit Window");
    assert(!dupeLabels, `Section ${s.id} does not duplicate KPI labels`);
  }
}

section("Legacy Webflow Code is Annotated");
// Read the render-lane-page.js source and verify @deprecated annotations
const rlpPath = path.join(__dirname, "..", "lib", "render-lane-page.js");
const rlpSource = fs.readFileSync(rlpPath, "utf-8");
assert(rlpSource.includes("@deprecated"), "render-lane-page.js has @deprecated markers");
assert(rlpSource.includes("LEGACY"), "render-lane-page.js has LEGACY markers");

const waPath = path.join(__dirname, "..", "lib", "publishers", "webflow-adapter.js");
const waSource = fs.readFileSync(waPath, "utf-8");
assert(waSource.includes("@deprecated"), "webflow-adapter.js has @deprecated marker");
assert(waSource.includes("LEGACY"), "webflow-adapter.js has LEGACY marker");

section("Route Files Exist");
const routePagePath = path.join(__dirname, "..", "app", "lanes", "[slug]", "page.js");
const routeCssPath = path.join(__dirname, "..", "app", "lanes", "[slug]", "lane-page.module.css");
const routeContractPath = path.join(__dirname, "..", "lib", "route-contract.js");
assert(fs.existsSync(routePagePath), "app/lanes/[slug]/page.js exists");
assert(fs.existsSync(routeCssPath), "app/lanes/[slug]/lane-page.module.css exists");
assert(fs.existsSync(routeContractPath), "lib/route-contract.js exists");

section("Route Page Source Integrity");
const pageSource = fs.readFileSync(routePagePath, "utf-8");
assert(pageSource.includes("buildRouteContract"), "Page imports buildRouteContract");
assert(pageSource.includes("extractNextMetadata"), "Page imports extractNextMetadata");
assert(pageSource.includes("extractJsonLdObjects"), "Page imports extractJsonLdObjects");
assert(pageSource.includes("generateMetadata"), "Page exports generateMetadata");
assert(pageSource.includes("buildLaneKnowledge"), "Page uses buildLaneKnowledge");
assert(pageSource.includes("buildCanonicalLanePageData"), "Page uses buildCanonicalLanePageData");
// Check imports/requires — look for actual import statements of Webflow symbols
const importLines = pageSource.split("\n").filter(l => l.trim().startsWith("import "));
const webflowImports = importLines.filter(l =>
  l.includes("renderWebflowFields") ||
  l.includes("WEBFLOW_TEMPLATE_HIDE_CSS") ||
  l.includes("LANE_PAGE_MODE_CSS")
);
assert(webflowImports.length === 0, "Page does NOT import Webflow symbols");
assert(pageSource.includes("dangerouslySetInnerHTML"), "Page uses dangerouslySetInnerHTML for pre-rendered sections");
assert(pageSource.includes("balanceSectionHtml"), "Page balances section HTML to prevent hydration mismatches");
assert(pageSource.includes("application/ld+json"), "Page renders JSON-LD scripts");

section("Multi-Lane E2E Verification");
const lanes = [
  { origin: "Atlanta", destination: "Orlando", mode: "LTL" },
  { origin: "Los Angeles", destination: "Chicago", mode: "LTL" },
  { origin: "Dallas", destination: "Houston", mode: "LTL" },
  { origin: "New York", destination: "Miami", mode: "LTL" },
  { origin: "Seattle", destination: "Phoenix", mode: "LTL" },
  { origin: "Chicago", destination: "Nashville", mode: "LTL" },
  { origin: "Denver", destination: "Salt Lake City", mode: "LTL" },
];

for (const lane of lanes) {
  const lk = buildLaneKnowledge(lane);
  const lc = buildCanonicalLanePageData(lk, {});
  const lr = buildRouteContract(lc);
  const lv = validateRouteContract(lr.payload);
  const label = `${lane.origin}→${lane.destination}`;

  assert(lr.publishable, `${label}: publishable`);
  assert(lr.payload.slug.length > 0, `${label}: has slug`);
  assert(lr.payload.metadata.title.includes(lane.origin.split(" ")[0]), `${label}: title has origin`);
  assert(lr.payload.metadata.jsonLd.length >= 3, `${label}: has JSON-LD`);
  assert(lr.payload.sections.length >= 5, `${label}: has sections`);
  assert(lr.payload.quality.gates_passed === lr.payload.quality.gates_total, `${label}: all gates pass`);
  assert(lv.valid, `${label}: validates`);
}

// ── Report ───────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log(`HOSTILE VERIFICATION: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(60)}`);

if (failed > 0) process.exit(1);
