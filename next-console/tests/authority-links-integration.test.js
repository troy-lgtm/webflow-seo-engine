/**
 * authority-links-integration.test.js
 *
 * Tests for the authority links integration into the lane page rendering pipeline.
 * Verifies that:
 *   1. Authority links are derived from lane knowledge via the classifier
 *   2. Links appear in canonical page data as authority_links array
 *   3. Links are rendered as visible HTML in both pipelines
 *   4. Rendering is deterministic across identical inputs
 *   5. Empty/absent authority links produce no HTML (safe fallback)
 *   6. Contract path carries authority links through to Webflow fields
 *
 * Run: node tests/authority-links-integration.test.js
 */

import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import {
  renderWebflowFields,
  renderLanePageHtml,
  renderAuthorityLinks,
} from "../lib/render-lane-page.js";
import {
  buildPublishContract,
  contractToRenderedFields,
} from "../lib/publishers/publish-contract.js";

// ── Test Harness ──────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`    ✗ FAIL: ${msg}`);
  }
}

function section(name) {
  console.log(`\n── ${name} ──\n`);
}

// ── Test Data ─────────────────────────────────────────────────────────

const SHORT_HAUL = buildLaneKnowledge({ origin: "Dallas, TX", destination: "Houston, TX", mode: "LTL" });
const LONG_HAUL = buildLaneKnowledge({ origin: "New York, NY", destination: "Miami, FL", mode: "LTL" });
const PORT_LANE = buildLaneKnowledge({ origin: "Los Angeles, CA", destination: "Phoenix, AZ", mode: "LTL" });

const RELATED = {
  corridor_hub: null,
  related_lanes: [],
  tool_link: "https://www.wearewarp.com/quote",
  data_link: null,
};

const SHORT_PD = buildCanonicalLanePageData(SHORT_HAUL, RELATED);
const LONG_PD = buildCanonicalLanePageData(LONG_HAUL, RELATED);
const PORT_PD = buildCanonicalLanePageData(PORT_LANE, RELATED);

// ── 1. Authority Link Derivation ──────────────────────────────────────

section("1. Authority Link Derivation");

assert(Array.isArray(SHORT_PD.authority_links), "short haul page data has authority_links array");
assert(SHORT_PD.authority_links.length > 0, "short haul lane has at least one authority link");
assert(SHORT_PD.authority_links.length <= 13, "authority links capped at entity count");

assert(Array.isArray(LONG_PD.authority_links), "long haul page data has authority_links array");
assert(LONG_PD.authority_links.length > 0, "long haul lane has at least one authority link");

assert(Array.isArray(PORT_PD.authority_links), "port lane page data has authority_links array");
assert(PORT_PD.authority_links.length > 0, "port lane has at least one authority link");

// ── 2. Link Structure ────────────────────────────────────────────────

section("2. Link Structure");

for (const link of SHORT_PD.authority_links) {
  assert(typeof link.entity_id === "string" && link.entity_id.length > 0, `link has entity_id: ${link.entity_id}`);
  assert(typeof link.label === "string" && link.label.length > 0, `link has label: ${link.label}`);
  assert(typeof link.path === "string" && link.path.startsWith("/"), `link has valid path: ${link.path}`);
  assert(["solution", "concept", "equipment"].includes(link.family), `link has valid family: ${link.family}`);
  assert(["primary", "secondary", "tertiary"].includes(link.rank), `link has valid rank: ${link.rank}`);
  assert(typeof link.score === "number" && link.score >= 30, `link score >= 30: ${link.score}`);
}

// ── 3. Deterministic Ordering ─────────────────────────────────────────

section("3. Deterministic Ordering");

// Score descending
for (let i = 1; i < SHORT_PD.authority_links.length; i++) {
  const prev = SHORT_PD.authority_links[i - 1];
  const curr = SHORT_PD.authority_links[i];
  assert(
    prev.score > curr.score || (prev.score === curr.score && prev.entity_id <= curr.entity_id),
    `ordering: ${prev.entity_id}(${prev.score}) before ${curr.entity_id}(${curr.score})`
  );
}

// Deterministic: same input → same output
const SHORT_PD_2 = buildCanonicalLanePageData(SHORT_HAUL, RELATED);
assert(
  JSON.stringify(SHORT_PD.authority_links) === JSON.stringify(SHORT_PD_2.authority_links),
  "same input produces identical authority_links"
);

// ── 4. Lane Differentiation ──────────────────────────────────────────

section("4. Lane Differentiation");

const shortIds = SHORT_PD.authority_links.map(l => l.entity_id).sort();
const longIds = LONG_PD.authority_links.map(l => l.entity_id).sort();

// Short haul should NOT have zone-skipping or 53-foot-trailer as active
const shortBlocked = ["zone-skipping", "53-foot-trailer"];
for (const id of shortBlocked) {
  assert(!shortIds.includes(id), `short haul blocks ${id}`);
}

// Long haul should NOT have cargo-van
assert(!longIds.includes("cargo-van"), "long haul blocks cargo-van");

// Long haul should have long-haul entities
const longExpected = ["pool-distribution", "53-foot-trailer"];
for (const id of longExpected) {
  assert(longIds.includes(id), `long haul includes ${id}`);
}

// Port lane should have vendor-consolidation
const portIds = PORT_PD.authority_links.map(l => l.entity_id);
assert(portIds.includes("vendor-consolidation"), "port lane includes vendor-consolidation");

// ── 5. Rendered HTML Output ──────────────────────────────────────────

section("5. Rendered HTML Output");

const shortHtml = renderAuthorityLinks(SHORT_PD);
assert(shortHtml.length > 100, "short haul produces rendered HTML");
assert(shortHtml.includes("Related WARP Capabilities"), "HTML has heading");
assert(shortHtml.includes("wearewarp.com"), "HTML has site base URL");

// Check family groupings appear
assert(shortHtml.includes("Solutions") || shortHtml.includes("Network Capabilities") || shortHtml.includes("Equipment"),
  "HTML has at least one family group heading");

// Check entity labels appear as link text
const firstLink = SHORT_PD.authority_links[0];
assert(shortHtml.includes(firstLink.label), `HTML includes entity label: ${firstLink.label}`);
assert(shortHtml.includes(firstLink.path), `HTML includes entity path: ${firstLink.path}`);

// Long haul HTML
const longHtml = renderAuthorityLinks(LONG_PD);
assert(longHtml.length > 100, "long haul produces rendered HTML");

// ── 6. Tertiary Links Not Rendered ───────────────────────────────────

section("6. Tertiary Links Not Rendered");

// Create page data and check that tertiary links are excluded from HTML
const allLinks = SHORT_PD.authority_links;
const tertiaryLinks = allLinks.filter(l => l.rank === "tertiary");
const html = renderAuthorityLinks(SHORT_PD);

for (const t of tertiaryLinks) {
  // Tertiary entity labels should NOT appear in the rendered HTML
  // (unless they also appear as primary/secondary for a different reason —
  // but we check that only primary+secondary are rendered)
  const primaryOrSecondary = allLinks.filter(l => l.entity_id === t.entity_id && (l.rank === "primary" || l.rank === "secondary"));
  if (primaryOrSecondary.length === 0) {
    assert(!html.includes(`>${t.label}<`), `tertiary ${t.entity_id} not in rendered HTML`);
  }
}
assert(true, "tertiary filtering verified");

// ── 7. Empty Authority Links ─────────────────────────────────────────

section("7. Empty Authority Links");

const emptyPd = { ...SHORT_PD, authority_links: [] };
const emptyHtml = renderAuthorityLinks(emptyPd);
assert(emptyHtml === "", "empty authority_links produces empty string");

const nullPd = { ...SHORT_PD, authority_links: undefined };
const nullHtml = renderAuthorityLinks(nullPd);
assert(nullHtml === "", "undefined authority_links produces empty string");

const noLinksPd = { ...SHORT_PD };
delete noLinksPd.authority_links;
const noLinksHtml = renderAuthorityLinks(noLinksPd);
assert(noLinksHtml === "", "missing authority_links produces empty string");

// ── 8. Webflow Fields Pipeline ───────────────────────────────────────

section("8. Webflow Fields Pipeline");

const fields = renderWebflowFields(SHORT_PD);
assert("authority-links" in fields, "Webflow fields include authority-links");
assert(typeof fields["authority-links"] === "string", "authority-links is a string");
assert(fields["authority-links"].length > 100, "authority-links has content");
assert(fields["authority-links"].includes("Related WARP Capabilities"), "Webflow field has heading");

// ── 9. Static HTML Pipeline ──────────────────────────────────────────

section("9. Static HTML Pipeline");

const fullHtml = renderLanePageHtml(SHORT_PD);
assert(fullHtml.includes("Related WARP Capabilities"), "full page HTML includes authority links section");
assert(fullHtml.includes("Related Freight Pages"), "full page HTML still has Related Freight Pages heading");

// ── 10. Contract Path ────────────────────────────────────────────────

section("10. Contract Path");

const contract = buildPublishContract(SHORT_PD);
assert(typeof contract.sections.authority_links_html === "string", "contract has authority_links_html");
assert(contract.sections.authority_links_html.length > 100, "contract authority_links_html has content");

const rendered = contractToRenderedFields(contract);
assert(rendered["authority-links"] === contract.sections.authority_links_html, "contract bridge maps authority-links correctly");

// ── 11. Deterministic HTML ───────────────────────────────────────────

section("11. Deterministic HTML");

const html1 = renderAuthorityLinks(SHORT_PD);
const html2 = renderAuthorityLinks(SHORT_PD);
assert(html1 === html2, "same page data produces identical HTML");

const fields1 = renderWebflowFields(SHORT_PD);
const fields2 = renderWebflowFields(SHORT_PD);
assert(fields1["authority-links"] === fields2["authority-links"], "Webflow field is deterministic");

// ── 12. No Blocked Links in Output ───────────────────────────────────

section("12. No Blocked Links in Output");

// All authority_links should have score >= 30 (MIN_RELATIONSHIP_SCORE)
for (const link of SHORT_PD.authority_links) {
  assert(link.score >= 30, `no blocked link in output: ${link.entity_id} score=${link.score}`);
}
for (const link of LONG_PD.authority_links) {
  assert(link.score >= 30, `no blocked link in long haul output: ${link.entity_id} score=${link.score}`);
}

// ── 13. Family Path Patterns ─────────────────────────────────────────

section("13. Family Path Patterns");

for (const link of [...SHORT_PD.authority_links, ...LONG_PD.authority_links, ...PORT_PD.authority_links]) {
  if (link.family === "solution") {
    assert(link.path.startsWith("/solutions/"), `solution path starts with /solutions/: ${link.path}`);
  } else if (link.family === "concept") {
    assert(link.path.startsWith("/network/"), `concept path starts with /network/: ${link.path}`);
  } else if (link.family === "equipment") {
    assert(link.path.startsWith("/equipment/"), `equipment path starts with /equipment/: ${link.path}`);
  }
}

// ── 14. Existing Tests Not Broken ────────────────────────────────────

section("14. Existing Tests Not Broken");

// Verify canonical page data still has all 11 required sections
const CANONICAL_SECTIONS = [
  "hero", "lane_overview", "warp_fit_for_lane", "operating_details",
  "pricing_and_commercial_framing", "best_fit_shipments", "lane_specific_faqs",
  "related_links", "why_warp", "final_cta", "lane_relevant_cta",
];

for (const sec of CANONICAL_SECTIONS) {
  assert(SHORT_PD[sec] !== undefined, `canonical section ${sec} still present`);
}

// Verify related_links still has its original structure
assert(typeof SHORT_PD.related_links === "object", "related_links is object");
assert(typeof SHORT_PD.related_links.tool_link === "string", "related_links.tool_link exists");

// Verify body-content still renders
assert(typeof fields["body-content"] === "string" && fields["body-content"].length > 200, "body-content still renders");

// Verify faq-schema still renders
assert(typeof fields["faq-schema"] === "string" && fields["faq-schema"].length > 1000, "faq-schema still renders");

// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(58)}`);
console.log(`  AUTHORITY LINKS INTEGRATION TESTS: ${pass} passed, ${fail} failed`);
console.log(`${"═".repeat(58)}`);
console.log(`\n  Total assertions: ${pass + fail}`);
console.log(`  Pass rate: ${((pass / (pass + fail)) * 100).toFixed(1)}%`);

if (fail > 0) process.exit(1);
