/**
 * factory-route-regression.test.js — Factory Route Flow Regression Tests
 *
 * Verifies that:
 *   1. The lane page route uses the factory as its single entry point
 *   2. Factory produces benchmark lanes through the canonical pipeline
 *   3. Quality gate remains active in the route flow
 *   4. Benchmark lanes are route-resolvable (slug → factory → payload)
 *   5. Duplicate structural ownership does not exist
 *   6. Metadata and schema remain correct through factory
 *   7. Vehicle flexibility framing is preserved
 *   8. Factory output is consumed correctly by route components
 *   9. Route is fully dynamic (no generateStaticParams needed)
 *  10. Deployment verification script can validate routes
 *
 * Uses the existing custom test harness pattern.
 */

import { produceLanePage, produceLanePages, validateFactoryOutput } from "../lib/lane-page-factory.js";
import {
  extractNextMetadata,
  extractJsonLdObjects,
  ROUTE_CONTRACT_KEYS,
  ROUTE_CONTRACT_VERSION,
} from "../lib/route-contract.js";
import {
  buildPublishContract,
  contractToRenderedFields,
} from "../lib/publishers/publish-contract.js";
import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import { renderWebflowFields } from "../lib/render-lane-page.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
// SECTION 1: PAGE.JS USES FACTORY AS SINGLE ENTRY POINT
// ══════════════════════════════════════════════════════════════════════

section("Page Route Uses Factory");
{
  const pageSource = fs.readFileSync(
    path.join(__dirname, "..", "app", "lanes", "[slug]", "page.js"),
    "utf-8"
  );

  // Factory is the entry point
  assert(pageSource.includes("produceLanePage"), "Route imports produceLanePage");
  assert(pageSource.includes("lane-page-factory"), "Route imports from lane-page-factory module");

  // Check import lines specifically (comments may reference these for documentation)
  const routeImports = pageSource.split("\n").filter(l => l.trim().startsWith("import "));

  // Factory replaces direct pipeline imports
  assert(!routeImports.some(l => l.includes("buildLaneKnowledge")), "Route does NOT import buildLaneKnowledge");
  assert(!routeImports.some(l => l.includes("buildCanonicalLanePageData")), "Route does NOT import buildCanonicalLanePageData");

  // Still has metadata and JSON-LD helpers
  assert(routeImports.some(l => l.includes("extractNextMetadata")), "Route imports extractNextMetadata");
  assert(routeImports.some(l => l.includes("extractJsonLdObjects")), "Route imports extractJsonLdObjects");

  // No Webflow dependencies in imports
  assert(!routeImports.some(l => l.includes("renderWebflowFields")), "No renderWebflowFields import");
  assert(!routeImports.some(l => l.includes("WEBFLOW_TEMPLATE_HIDE_CSS")), "No WEBFLOW_TEMPLATE_HIDE_CSS import");
  assert(!routeImports.some(l => l.includes("LANE_PAGE_MODE_CSS")), "No LANE_PAGE_MODE_CSS import");

  // No generateStaticParams export — fully dynamic
  const exportLines = pageSource.split("\n").filter(l => l.includes("export") && l.includes("generateStaticParams"));
  assert(exportLines.length === 0, "No generateStaticParams (fully dynamic)");

  // Has generateMetadata
  assert(pageSource.includes("generateMetadata"), "Has generateMetadata export");

  // Has balanceSectionHtml
  assert(pageSource.includes("balanceSectionHtml"), "Has balanceSectionHtml sanitizer");
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 2: BENCHMARK LANES ROUTE-RESOLVABLE
// ══════════════════════════════════════════════════════════════════════

section("Benchmark Lanes Route-Resolvable");
{
  // Simulate what page.js does: parse slug → produce lane → get payload
  function simulateRouteLoad(slug) {
    const match = slug.match(/^(.+?)-to-(.+?)$/);
    if (!match) return null;
    const toDisplayName = (s) =>
      s.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const origin = toDisplayName(match[1]);
    const destination = toDisplayName(match[2]);
    try {
      const result = produceLanePage({ origin, destination });
      return result.payload;
    } catch { return null; }
  }

  const slugs = [
    "atlanta-to-orlando",
    "atlanta-to-miami",
    "los-angeles-to-new-york",
    "dallas-to-houston",
    "chicago-to-nashville",
    "seattle-to-phoenix",
    "denver-to-salt-lake-city",
  ];

  for (const slug of slugs) {
    const payload = simulateRouteLoad(slug);
    const label = slug;

    assert(payload !== null, `${label}: resolves to payload`);
    if (!payload) continue;

    assert(payload.slug === slug, `${label}: payload slug matches`);
    assert(payload.path === `/lanes/${slug}`, `${label}: payload path correct`);
    assert(payload._route_contract_version === ROUTE_CONTRACT_VERSION, `${label}: has route contract version`);
    assert(payload.hero?.headline?.length > 10, `${label}: has headline`);
    assert(payload.metadata?.title?.length > 10, `${label}: has title`);
    assert(payload.metadata?.description?.length > 50, `${label}: has description`);
    assert(payload.metadata?.canonical?.includes(slug), `${label}: canonical includes slug`);
    assert(payload.metadata?.robots === "index, follow", `${label}: robots correct`);
    assert(payload.quality?.publishable === true, `${label}: publishable`);
    assert(payload.quality?.gates_passed === payload.quality?.gates_total, `${label}: all gates pass`);
  }
}

section("Invalid Slugs Return Null");
{
  function simulateRouteLoad(slug) {
    const match = slug.match(/^(.+?)-to-(.+?)$/);
    if (!match) return null;
    const toDisplayName = (s) =>
      s.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    try {
      return produceLanePage({ origin: toDisplayName(match[1]), destination: toDisplayName(match[2]) }).payload;
    } catch { return null; }
  }

  assert(simulateRouteLoad("not-a-valid-slug") === null, "Invalid slug returns null");
  assert(simulateRouteLoad("") === null, "Empty slug returns null");
  assert(simulateRouteLoad("just-one-city") === null, "Single city returns null");
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 3: QUALITY GATE ACTIVE IN ROUTE FLOW
// ══════════════════════════════════════════════════════════════════════

section("Quality Gate Active in Route Flow");
{
  for (const lane of BENCHMARK_LANES) {
    const result = produceLanePage(lane);
    const label = `${lane.origin}→${lane.destination}`;

    // Quality gate must have run
    assert(typeof result.quality.score === "number", `${label}: has quality score`);
    assert(result.quality.score >= 70, `${label}: score >= 70`);
    assert(result.quality.gates_passed >= 17, `${label}: >= 17 gates passed`);
    assert(result.quality.gates_total >= 17, `${label}: >= 17 total gates`);
    assert(result.quality.publishable === true, `${label}: publishable`);

    // Quality data flows through to payload
    assert(result.payload.quality.publishable === true, `${label}: payload quality publishable`);
    assert(result.payload.quality.score === result.quality.score, `${label}: payload score matches`);
    assert(result.payload.quality.grade === result.quality.grade, `${label}: payload grade matches`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 4: NO DUPLICATE STRUCTURAL OWNERSHIP
// ══════════════════════════════════════════════════════════════════════

section("No Duplicate Structural Ownership");
{
  for (const lane of BENCHMARK_LANES.slice(0, 3)) {
    const result = produceLanePage(lane);
    const payload = result.payload;
    const label = `${lane.origin}→${lane.destination}`;

    // KPI panel content should not appear in sections
    if (payload.kpi_panel?.html) {
      for (const s of payload.sections || []) {
        // Check for KPI grid pattern
        const kpiGridInSection = s.html.includes("grid-template-columns:repeat(auto-fit,minmax(1") &&
          s.html.includes("Lane Distance") && s.html.includes("Transit Window");
        assert(!kpiGridInSection, `${label}: section ${s.id} does not duplicate KPI grid`);
      }
    }

    // Execution flow should not appear in sections
    if (payload.execution_flow?.html) {
      for (const s of payload.sections || []) {
        const execInSection = s.html.includes("Origin Pickup") && s.html.includes("Final Delivery") &&
          s.html.includes("Cross-Dock Consolidation");
        assert(!execInSection, `${label}: section ${s.id} does not duplicate execution flow`);
      }
    }

    // Single H1 check across all HTML
    const allHtml = [
      payload.kpi_panel?.html || "",
      payload.execution_flow?.html || "",
      ...(payload.sections?.map(s => s.html) || []),
      payload.proof?.html || "",
    ].join("\n");
    const h1Count = (allHtml.match(/<h1[\s>]/gi) || []).length;
    assert(h1Count === 0, `${label}: no H1 in pre-rendered HTML (H1 is in React component)`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 5: METADATA AND SCHEMA CORRECT
// ══════════════════════════════════════════════════════════════════════

section("Metadata Correct Through Factory");
{
  for (const lane of BENCHMARK_LANES.slice(0, 3)) {
    const result = produceLanePage(lane);
    const meta = result.metadata;
    const label = `${lane.origin}→${lane.destination}`;

    // Title
    assert(meta.title.includes(lane.origin), `${label}: title has origin`);
    assert(meta.title.includes(lane.destination.split(" ")[0]), `${label}: title has destination`);
    assert(meta.title.includes("LTL"), `${label}: title has mode`);
    assert(meta.title.endsWith("| WARP"), `${label}: title ends with | WARP`);
    assert(!meta.title.includes(", to "), `${label}: title no orphaned commas`);

    // Description
    assert(meta.description.length > 50, `${label}: description is substantial`);

    // Canonical
    assert(meta.alternates.canonical.includes("wearewarp.com"), `${label}: canonical has domain`);
    assert(meta.alternates.canonical.includes(result.slug), `${label}: canonical has slug`);

    // Robots
    assert(meta.robots === "index, follow", `${label}: robots correct`);
  }
}

section("JSON-LD Schema Correct Through Factory");
{
  for (const lane of BENCHMARK_LANES.slice(0, 3)) {
    const result = produceLanePage(lane);
    const label = `${lane.origin}→${lane.destination}`;

    // Must have all 4 schema types
    assert(result.jsonLd.types.includes("BreadcrumbList"), `${label}: BreadcrumbList`);
    assert(result.jsonLd.types.includes("Service"), `${label}: Service`);
    assert(result.jsonLd.types.includes("Organization"), `${label}: Organization`);
    assert(result.jsonLd.types.includes("FAQPage"), `${label}: FAQPage`);

    // Each has context
    for (const obj of result.jsonLd.objects) {
      assert(obj["@context"] === "https://schema.org", `${label}: ${obj["@type"]} has schema.org context`);
    }

    // FAQPage has questions
    const faq = result.jsonLd.objects.find(o => o["@type"] === "FAQPage");
    assert(faq.mainEntity.length >= 5, `${label}: FAQ has >= 5 questions`);

    // BreadcrumbList has depth
    const bc = result.jsonLd.objects.find(o => o["@type"] === "BreadcrumbList");
    assert(bc.itemListElement.length >= 3, `${label}: breadcrumb has depth`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 6: VEHICLE FLEXIBILITY FRAMING PRESERVED
// ══════════════════════════════════════════════════════════════════════

section("Vehicle Flexibility Framing");
{
  for (const lane of BENCHMARK_LANES.slice(0, 3)) {
    const result = produceLanePage(lane);
    const payload = result.payload;
    const label = `${lane.origin}→${lane.destination}`;

    // Comparison should NOT frame equipment as "van vs truck"
    if (payload.comparison) {
      for (const cp of payload.comparison) {
        assert(!cp.metric.toLowerCase().includes("cargo van vs"), `${label}: no van vs comparison`);
        assert(!cp.metric.toLowerCase().includes("box truck vs"), `${label}: no truck vs comparison`);
      }
    }

    // Equipment should be referenced operationally
    const allContent = (payload.sections || []).map(s => s.html).join(" ").toLowerCase();
    assert(
      allContent.includes("equipment") || allContent.includes("trailer") ||
      allContent.includes("capacity") || allContent.includes("pallet"),
      `${label}: references operational equipment`
    );
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 7: FACTORY ↔ WEBFLOW PARITY (MIGRATION SAFETY)
// ══════════════════════════════════════════════════════════════════════

section("Factory Output Content Parity with Webflow Path");
{
  // Verify that the factory pipeline produces content identical to the
  // Webflow path for the same canonical data
  for (const lane of BENCHMARK_LANES.slice(0, 3)) {
    const k = buildLaneKnowledge({ ...lane, mode: "LTL" });
    const c = buildCanonicalLanePageData(k, {});
    const wf = renderWebflowFields(c);
    const contract = buildPublishContract(c);
    const label = `${lane.origin}→${lane.destination}`;

    // Content parity checks
    assert(contract.content.body_text === wf["body-content"], `${label}: body text parity`);
    assert(contract.sections.kpi_panel_html === wf["lane-intelligence-panel"], `${label}: KPI panel parity`);
    assert(contract.sections.execution_flow_html === wf["execution-flow"], `${label}: execution flow parity`);
    assert(contract.content.primary_content_html === wf["faq-schema"], `${label}: primary content parity`);
    assert(contract.schema.structured_data_html === wf["breadcrumb-schema"], `${label}: schema parity`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 8: VERCEL DEPLOYMENT CONFIG
// ══════════════════════════════════════════════════════════════════════

section("Vercel Deployment Config");
{
  const vercelPath = path.join(__dirname, "..", "vercel.json");
  assert(fs.existsSync(vercelPath), "vercel.json exists");

  if (fs.existsSync(vercelPath)) {
    const config = JSON.parse(fs.readFileSync(vercelPath, "utf-8"));
    assert(config.framework === "nextjs", "Framework is nextjs");
    assert(config.buildCommand === "npm run build", "Build command correct");
    assert(config.outputDirectory === ".next", "Output directory correct");
  }
}

section("Deployment Verification Script Exists");
{
  const verifyPath = path.join(__dirname, "..", "scripts", "verify_deployment_routes.js");
  assert(fs.existsSync(verifyPath), "verify_deployment_routes.js exists");

  if (fs.existsSync(verifyPath)) {
    const source = fs.readFileSync(verifyPath, "utf-8");
    assert(source.includes("atlanta-to-orlando"), "Verification covers atlanta-to-orlando");
    assert(source.includes("atlanta-to-miami"), "Verification covers atlanta-to-miami");
    assert(source.includes("los-angeles-to-new-york"), "Verification covers los-angeles-to-new-york");
    assert(source.includes("--base-url"), "Supports base URL parameter");
    assert(source.includes("JSON-LD") || source.includes("json-ld") || source.includes("ld+json"), "Checks JSON-LD");
  }
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 9: FACTORY FILE INTEGRITY
// ══════════════════════════════════════════════════════════════════════

section("Factory File Integrity");
{
  const factoryPath = path.join(__dirname, "..", "lib", "lane-page-factory.js");
  assert(fs.existsSync(factoryPath), "lane-page-factory.js exists");

  const source = fs.readFileSync(factoryPath, "utf-8");

  // Uses correct pipeline
  assert(source.includes("buildLaneKnowledge"), "Factory uses buildLaneKnowledge");
  assert(source.includes("buildCanonicalLanePageData"), "Factory uses buildCanonicalLanePageData");
  assert(source.includes("buildRouteContract"), "Factory uses buildRouteContract");
  assert(source.includes("validateRouteContract"), "Factory uses validateRouteContract");
  assert(source.includes("extractNextMetadata"), "Factory uses extractNextMetadata");
  assert(source.includes("extractJsonLdObjects"), "Factory uses extractJsonLdObjects");

  // Does NOT import Webflow
  const factoryImports = source.split("\n").filter(l => l.trim().startsWith("import "));
  assert(!factoryImports.some(l => l.includes("renderWebflowFields")), "Factory does not import renderWebflowFields");
  assert(!factoryImports.some(l => l.includes("webflow")), "Factory has no webflow import");

  // Exports correct functions
  assert(source.includes("export function produceLanePage"), "Exports produceLanePage");
  assert(source.includes("export function produceLanePages"), "Exports produceLanePages");
  assert(source.includes("export function validateFactoryOutput"), "Exports validateFactoryOutput");
}

// ── Report ───────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log(`FACTORY ROUTE REGRESSION: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(60)}`);

if (failed > 0) process.exit(1);
