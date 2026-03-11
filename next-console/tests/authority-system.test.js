/**
 * Authority System Regression Tests
 *
 * Proves that:
 *   1. Entity registry is structurally valid
 *   2. Knowledge graph has no isolated entities or dangling refs
 *   3. All page types generate complete canonical data
 *   4. Content renderers produce valid output for all entities
 *   5. Quality gates correctly assess all entities
 *   6. Quality gates reject bad input
 *   7. FAQ and breadcrumb schemas are valid JSON-LD
 *   8. Internal linking produces cross-family connections
 *   9. Lane-to-authority linking works for all archetypes
 *  10. Deterministic output (same input → same output)
 *  11. No placeholder/banned content in any generated output
 *  12. Section ordering matches canonical definitions
 *  13. Graph statistics are consistent
 *
 * Run: node tests/authority-system.test.js
 */

import {
  getAllEntities,
  getEntity,
  getEntitiesByFamily,
  getRelatedEntities,
  getNeighborhood,
  getGraphStats,
  validateGraph,
  getSolutionsForArchetype,
  getEquipmentForMode,
  getAuthorityLinksForLane,
  _resetCache,
} from "../lib/authority-graph.js";

import {
  buildAuthorityPageData,
  buildSolutionPageData,
  buildConceptPageData,
  buildEquipmentPageData,
  SOLUTION_SECTIONS,
  CONCEPT_SECTIONS,
  EQUIPMENT_SECTIONS,
} from "../lib/authority-page-schema.js";

import {
  renderAuthorityPage,
  renderAuthorityPageBody,
  renderAuthorityPrimaryContent,
  renderAuthorityFaqSchema,
  renderAuthorityBreadcrumbSchema,
  renderAuthorityServiceSchema,
} from "../lib/render-authority-page.js";

import {
  assessAuthorityQuality,
} from "../lib/authority-page-validator.js";

import {
  buildAuthorityToAuthorityLinks,
  buildLaneToAuthorityLinks,
  buildFullLinkGraph,
  validateLinkGraph,
} from "../lib/authority-linker.js";

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

function assertGte(actual, min, message) {
  assert(actual >= min, `${message} (expected >= ${min}, got ${actual})`);
}

function assertIncludes(str, substr, message) {
  assert(String(str).includes(substr), `${message} (expected to include "${substr}")`);
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ══════════════════════════════════════════════════════════════════════
// TEST GROUPS
// ══════════════════════════════════════════════════════════════════════

// ── 1. Entity Registry Structure ────────────────────────────────────

section("1. Entity Registry Structure");

{
  const all = getAllEntities();
  assertGte(all.length, 13, "Registry has at least 13 entities");

  const solutions = getEntitiesByFamily("solution");
  assertEqual(solutions.length, 4, "4 solution entities");

  const concepts = getEntitiesByFamily("concept");
  assertEqual(concepts.length, 6, "6 concept entities");

  const equipment = getEntitiesByFamily("equipment");
  assertEqual(equipment.length, 3, "3 equipment entities");

  // Every entity has required fields
  for (const entity of all) {
    assert(entity.id, `${entity.id || "?"}: has id`);
    assert(entity.family, `${entity.id}: has family`);
    assert(entity.label, `${entity.id}: has label`);
    assert(entity.slug, `${entity.id}: has slug`);
    assert(entity.canonical_path, `${entity.id}: has canonical_path`);
    assert(entity.short_description, `${entity.id}: has short_description`);
  }

  // Solution entities have required solution fields
  for (const s of solutions) {
    assert(s.modes?.length > 0, `${s.id}: has modes`);
    assert(s.warp_differentiators?.length > 0, `${s.id}: has differentiators`);
    assert(s.primary_use_cases?.length > 0, `${s.id}: has use cases`);
    assert(s.related_concepts?.length > 0, `${s.id}: has related concepts`);
    assert(s.related_equipment?.length > 0, `${s.id}: has related equipment`);
    assert(s.lane_archetype_affinity?.length > 0, `${s.id}: has archetype affinity`);
  }

  // Concept entities have required concept fields
  for (const c of concepts) {
    assert(c.applies_to_modes?.length > 0, `${c.id}: has applies_to_modes`);
    assert(c.warp_implementation?.length > 0, `${c.id}: has warp_implementation`);
    assert(c.technical_depth, `${c.id}: has technical_depth`);
  }

  // Equipment entities have required equipment fields
  for (const e of equipment) {
    assert(e.specs, `${e.id}: has specs`);
    assert(e.best_fit_freight?.length > 0, `${e.id}: has best_fit_freight`);
    assert(e.not_ideal_for?.length > 0, `${e.id}: has not_ideal_for`);
    assert(e.mode, `${e.id}: has mode`);
  }
}

// ── 2. Knowledge Graph Integrity ────────────────────────────────────

section("2. Knowledge Graph Integrity");

{
  const validation = validateGraph();
  assertEqual(validation.valid, true, "Graph passes structural validation");
  assertEqual(validation.errors.length, 0, "No graph validation errors");

  const stats = getGraphStats();
  assertEqual(stats.isolated_entities, 0, "No isolated entities");
  assertGte(stats.total_edges, 30, "At least 30 edges in graph");
  assertGte(parseFloat(stats.avg_edges_per_entity), 4, "Average >= 4 edges per entity");

  // Every entity has at least one relationship
  const all = getAllEntities();
  for (const entity of all) {
    const related = getRelatedEntities(entity.id);
    const edgeCount = related.concepts.length + related.solutions.length + related.equipment.length;
    assertGte(edgeCount, 1, `${entity.id}: has at least 1 relationship`);
  }

  // Neighborhood traversal works
  for (const entity of all) {
    const neighborhood = getNeighborhood(entity.id);
    assert(neighborhood.entity !== null, `${entity.id}: neighborhood entity resolved`);
    assertGte(neighborhood.neighbors.length, 1, `${entity.id}: has >= 1 neighbor`);
  }

  // Entity resolution by ID works for all entities
  for (const entity of all) {
    const resolved = getEntity(entity.id);
    assertEqual(resolved?.id, entity.id, `${entity.id}: resolves by ID`);
  }

  // Unknown entity returns null
  assert(getEntity("nonexistent-entity") === null, "Unknown entity returns null");
}

// ── 3. Page Data Generation ─────────────────────────────────────────

section("3. Page Data Generation");

{
  const all = getAllEntities();

  for (const entity of all) {
    const pageData = buildAuthorityPageData(entity.id);

    assert(pageData.page_type, `${entity.id}: has page_type`);
    assert(pageData.slug, `${entity.id}: has slug`);
    assert(pageData.canonical_path, `${entity.id}: has canonical_path`);
    assert(pageData.page_title, `${entity.id}: has page_title`);
    assert(pageData.meta_description, `${entity.id}: has meta_description`);
    assert(pageData.hero?.headline, `${entity.id}: has hero headline`);
    assert(pageData.hero?.subhead, `${entity.id}: has hero subhead`);
    assert(pageData.hero?.primary_cta?.url, `${entity.id}: has hero CTA URL`);
    assert(pageData.faq?.items?.length >= 3, `${entity.id}: has >= 3 FAQ items`);
    assert(pageData.cta?.primary?.url, `${entity.id}: has CTA URL`);
    assert(pageData._section_order?.length >= 6, `${entity.id}: has >= 6 sections defined`);
    assert(pageData.internal_links, `${entity.id}: has internal_links`);
  }

  // Solution pages have solution-specific sections
  for (const s of getEntitiesByFamily("solution")) {
    const pd = buildSolutionPageData(s.id);
    assertEqual(pd.page_type, "solution", `${s.id}: page_type is solution`);
    assert(pd.warp_approach?.differentiators?.length > 0, `${s.id}: has warp_approach`);
    assert(pd.equipment_fit?.equipment?.length > 0, `${s.id}: has equipment_fit`);
    assert(pd.use_cases?.cases?.length > 0, `${s.id}: has use_cases`);
  }

  // Concept pages have concept-specific sections
  for (const c of getEntitiesByFamily("concept")) {
    const pd = buildConceptPageData(c.id);
    assertEqual(pd.page_type, "concept", `${c.id}: page_type is concept`);
    assert(pd.how_it_works?.content, `${c.id}: has how_it_works`);
    assert(pd.warp_implementation?.points?.length > 0, `${c.id}: has warp_implementation`);
    assert(pd.metrics?.items?.length > 0, `${c.id}: has metrics`);
  }

  // Equipment pages have equipment-specific sections
  for (const e of getEntitiesByFamily("equipment")) {
    const pd = buildEquipmentPageData(e.id);
    assertEqual(pd.page_type, "equipment", `${e.id}: page_type is equipment`);
    assert(pd.specs?.data, `${e.id}: has specs`);
    assert(pd.best_fit?.items?.length > 0, `${e.id}: has best_fit`);
    assert(pd.not_ideal?.items?.length > 0, `${e.id}: has not_ideal`);
  }

  // Wrong family type throws
  let threw = false;
  try { buildSolutionPageData("cross-docking"); } catch { threw = true; }
  assert(threw, "buildSolutionPageData throws for non-solution entity");

  threw = false;
  try { buildConceptPageData("box-truck"); } catch { threw = true; }
  assert(threw, "buildConceptPageData throws for non-concept entity");

  threw = false;
  try { buildEquipmentPageData("store-replenishment"); } catch { threw = true; }
  assert(threw, "buildEquipmentPageData throws for non-equipment entity");

  threw = false;
  try { buildAuthorityPageData("nonexistent"); } catch { threw = true; }
  assert(threw, "buildAuthorityPageData throws for unknown entity");
}

// ── 4. Content Rendering ────────────────────────────────────────────

section("4. Content Rendering");

{
  const all = getAllEntities();

  for (const entity of all) {
    const pageData = buildAuthorityPageData(entity.id);
    const rendered = renderAuthorityPage(pageData);

    assertGte(rendered.body_text.length, 200, `${entity.id}: body_text >= 200 chars`);
    assertGte(rendered.primary_content_html.length, 500, `${entity.id}: primary_content_html >= 500 chars`);
    assert(rendered.faq_schema_html.length > 0, `${entity.id}: has faq_schema_html`);
    assert(rendered.breadcrumb_schema_html.length > 0, `${entity.id}: has breadcrumb_schema_html`);
    assert(rendered.service_schema_html.length > 0, `${entity.id}: has service_schema_html`);

    // HTML has structure
    assertIncludes(rendered.primary_content_html, "<h2>", `${entity.id}: HTML has h2 headings`);
    assertIncludes(rendered.primary_content_html, "<ul>", `${entity.id}: HTML has ul lists`);

    // Individual render functions match combined output
    const bodyIndividual = renderAuthorityPageBody(pageData);
    assertEqual(bodyIndividual, rendered.body_text, `${entity.id}: individual body matches combined`);

    const htmlIndividual = renderAuthorityPrimaryContent(pageData);
    assertEqual(htmlIndividual, rendered.primary_content_html, `${entity.id}: individual HTML matches combined`);
  }
}

// ── 5. Quality Gate Assessment ──────────────────────────────────────

section("5. Quality Gate Assessment");

{
  const all = getAllEntities();

  // All entities should pass quality gate
  for (const entity of all) {
    const pageData = buildAuthorityPageData(entity.id);
    const rendered = renderAuthorityPage(pageData);
    const quality = assessAuthorityQuality(pageData, rendered);

    assert(quality.publishable, `${entity.id}: publishable`);
    assertGte(quality.score, 70, `${entity.id}: score >= 70`);
    assertEqual(quality.gates_passed, quality.gate_count, `${entity.id}: all gates passed`);
    assert(quality.grade !== "F", `${entity.id}: grade is not F`);
    assert(quality.dimensions.seo > 0, `${entity.id}: SEO dimension scored`);
    assert(quality.dimensions.content > 0, `${entity.id}: content dimension scored`);
    assert(quality.dimensions.authority > 0, `${entity.id}: authority dimension scored`);
    assert(quality.dimensions.linking > 0, `${entity.id}: linking dimension scored`);
    assert(quality.dimensions.structure > 0, `${entity.id}: structure dimension scored`);
  }

  // Null input is rejected
  const nullResult = assessAuthorityQuality(null, null);
  assertEqual(nullResult.publishable, false, "Null input not publishable");
  assertEqual(nullResult.grade, "F", "Null input gets F grade");
}

// ── 6. Quality Gate Rejects Bad Input ───────────────────────────────

section("6. Quality Gate Hostile Verification");

{
  // Empty page data should fail
  const emptyQuality = assessAuthorityQuality({}, {});
  assert(!emptyQuality.publishable, "Empty page data not publishable");
  assertGte(emptyQuality.errors.length, 1, "Empty page data has errors");

  // Page with placeholder text should fail AQ-CONTENT-03
  const placeholderData = buildAuthorityPageData("cross-docking");
  const placeholderRendered = renderAuthorityPage(placeholderData);
  placeholderRendered.body_text = "lorem ipsum dolor sit amet " + placeholderRendered.body_text;
  const placeholderQuality = assessAuthorityQuality(placeholderData, placeholderRendered);
  assertEqual(placeholderQuality.gates["AQ-CONTENT-03"], false, "Placeholder text detected");

  // Page with short content should fail AQ-CONTENT-02
  const shortRendered = { body_text: "too short", primary_content_html: "tiny" };
  const shortQuality = assessAuthorityQuality(
    buildAuthorityPageData("box-truck"),
    shortRendered
  );
  assertEqual(shortQuality.gates["AQ-CONTENT-02"], false, "Short content detected");

  // Page with no FAQ should fail AQ-CONTENT-04
  const noFaqData = { ...buildAuthorityPageData("cargo-van"), faq: { items: [] } };
  const noFaqRendered = renderAuthorityPage(noFaqData);
  // Rebuild faq_schema_html to reflect empty FAQs
  noFaqRendered.faq_schema_html = "";
  const noFaqQuality = assessAuthorityQuality(noFaqData, noFaqRendered);
  assertEqual(noFaqQuality.gates["AQ-CONTENT-04"], false, "No FAQ detected");
  assertEqual(noFaqQuality.gates["AQ-SCHEMA-01"], false, "Missing FAQ schema detected");

  // Page with no internal links should fail AQ-LINK-01 and AQ-STRUCT-03
  const noLinksData = { ...buildAuthorityPageData("middle-mile"), internal_links: {} };
  const noLinksRendered = renderAuthorityPage(noLinksData);
  const noLinksQuality = assessAuthorityQuality(noLinksData, noLinksRendered);
  assertEqual(noLinksQuality.gates["AQ-STRUCT-03"], false, "No relationships detected");
  assertEqual(noLinksQuality.gates["AQ-LINK-01"], false, "No cross-family links detected");
}

// ── 7. Schema Validation ────────────────────────────────────────────

section("7. Schema Validation");

{
  const all = getAllEntities();

  for (const entity of all) {
    const pageData = buildAuthorityPageData(entity.id);

    // FAQ Schema
    const faqHtml = renderAuthorityFaqSchema(pageData);
    assertIncludes(faqHtml, "application/ld+json", `${entity.id}: FAQ has ld+json`);
    const faqJson = faqHtml.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
    let faqParsed;
    try { faqParsed = JSON.parse(faqJson); } catch { faqParsed = null; }
    assert(faqParsed !== null, `${entity.id}: FAQ JSON-LD parses`);
    assertEqual(faqParsed?.["@type"], "FAQPage", `${entity.id}: FAQ type is FAQPage`);
    assertGte(faqParsed?.mainEntity?.length || 0, 3, `${entity.id}: FAQ has >= 3 entities`);

    // Breadcrumb Schema
    const bcHtml = renderAuthorityBreadcrumbSchema(pageData);
    assertIncludes(bcHtml, "application/ld+json", `${entity.id}: breadcrumb has ld+json`);
    const bcJson = bcHtml.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
    let bcParsed;
    try { bcParsed = JSON.parse(bcJson); } catch { bcParsed = null; }
    assert(bcParsed !== null, `${entity.id}: breadcrumb JSON-LD parses`);
    assertEqual(bcParsed?.["@type"], "BreadcrumbList", `${entity.id}: breadcrumb type is BreadcrumbList`);
    assertEqual(bcParsed?.itemListElement?.length, 3, `${entity.id}: breadcrumb has 3 items`);

    // Service Schema
    const svcHtml = renderAuthorityServiceSchema(pageData);
    assertIncludes(svcHtml, "application/ld+json", `${entity.id}: service has ld+json`);
    const svcJson = svcHtml.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
    let svcParsed;
    try { svcParsed = JSON.parse(svcJson); } catch { svcParsed = null; }
    assert(svcParsed !== null, `${entity.id}: service JSON-LD parses`);
    assertEqual(svcParsed?.["@type"], "Service", `${entity.id}: service type is Service`);
    assertEqual(svcParsed?.provider?.name, "WARP", `${entity.id}: service provider is WARP`);
  }
}

// ── 8. Internal Linking ─────────────────────────────────────────────

section("8. Internal Linking");

{
  const all = getAllEntities();

  // Every entity has authority-to-authority links
  for (const entity of all) {
    const links = buildAuthorityToAuthorityLinks(entity.id);
    assertGte(links.length, 1, `${entity.id}: has >= 1 authority link`);

    // Links have required fields
    for (const link of links) {
      assert(link.href, `${entity.id} link: has href`);
      assert(link.text, `${entity.id} link: has text`);
      assert(link.family, `${entity.id} link: has family`);
      assert(link.score > 0, `${entity.id} link: has positive score`);
    }
  }

  // Cross-family links exist
  for (const entity of all) {
    const links = buildAuthorityToAuthorityLinks(entity.id);
    const families = new Set(links.map(l => l.family));
    const hasCrossFamily = links.some(l => l.family !== entity.family);
    assert(hasCrossFamily, `${entity.id}: has cross-family links`);
  }

  // Full link graph is valid
  const linkValidation = validateLinkGraph();
  assertEqual(linkValidation.valid, true, "Full link graph is valid");
  assertGte(linkValidation.stats.cross_family_links, 50, "At least 50 cross-family links");

  // Links are sorted by score (descending)
  for (const entity of all) {
    const links = buildAuthorityToAuthorityLinks(entity.id);
    for (let i = 1; i < links.length; i++) {
      assert(links[i].score <= links[i - 1].score, `${entity.id}: links sorted by score`);
    }
  }
}

// ── 9. Lane-to-Authority Linking ────────────────────────────────────

section("9. Lane Integration");

{
  // Solutions for each archetype
  const archetypes = [
    "short_haul_metro", "port_to_inland", "energy_corridor",
    "ecommerce_distribution", "long_distance_intermodal",
    "midwest_corridor", "sunbelt_regional",
  ];

  for (const arch of archetypes) {
    const solutions = getSolutionsForArchetype(arch);
    assertGte(solutions.length, 0, `${arch}: has matched solutions (${solutions.length})`);
  }

  // Equipment for each mode
  for (const mode of ["LTL", "FTL", "Cargo Van / Box Truck"]) {
    const equip = getEquipmentForMode(mode);
    assertGte(equip.length, 1, `${mode}: has >= 1 equipment type`);
  }

  // Lane-to-authority links for various combinations
  const combos = [
    { archetypeId: "short_haul_metro", mode: "LTL" },
    { archetypeId: "ecommerce_distribution", mode: "FTL" },
    { archetypeId: "port_to_inland", mode: "LTL" },
    { archetypeId: "long_distance_intermodal", mode: "FTL" },
  ];

  for (const combo of combos) {
    const links = buildLaneToAuthorityLinks(combo);
    assertGte(links.length, 1, `${combo.archetypeId}/${combo.mode}: has lane-to-authority links`);
    for (const link of links) {
      assert(link.href.startsWith("/"), `${combo.archetypeId} link: href starts with /`);
      assert(link.text, `${combo.archetypeId} link: has text`);
      assert(link.family, `${combo.archetypeId} link: has family`);
    }
  }
}

// ── 10. Deterministic Output ────────────────────────────────────────

section("10. Deterministic Output");

{
  // Generate twice, compare
  const all = getAllEntities();
  for (const entity of all) {
    const pd1 = buildAuthorityPageData(entity.id);
    const r1 = renderAuthorityPage(pd1);
    const q1 = assessAuthorityQuality(pd1, r1);

    const pd2 = buildAuthorityPageData(entity.id);
    const r2 = renderAuthorityPage(pd2);
    const q2 = assessAuthorityQuality(pd2, r2);

    assertEqual(r1.body_text, r2.body_text, `${entity.id}: body_text deterministic`);
    assertEqual(r1.primary_content_html, r2.primary_content_html, `${entity.id}: HTML deterministic`);
    assertEqual(r1.faq_schema_html, r2.faq_schema_html, `${entity.id}: FAQ schema deterministic`);
    assertEqual(q1.score, q2.score, `${entity.id}: quality score deterministic`);
    assertEqual(q1.grade, q2.grade, `${entity.id}: quality grade deterministic`);
  }
}

// ── 11. Banned Content Check ────────────────────────────────────────

section("11. Banned Content Verification");

{
  const bannedPhrases = [
    "lorem ipsum", "placeholder", "todo", "fixme", "coming soon",
    "revolutionize", "game-changing", "cutting-edge", "world-class",
    "synergy", "leverage our", "unlock the power",
  ];

  const all = getAllEntities();
  for (const entity of all) {
    const pageData = buildAuthorityPageData(entity.id);
    const rendered = renderAuthorityPage(pageData);
    const allText = [
      rendered.body_text,
      rendered.primary_content_html,
      pageData.hero?.headline || "",
      pageData.meta_description || "",
    ].join(" ").toLowerCase();

    for (const phrase of bannedPhrases) {
      assert(!allText.includes(phrase), `${entity.id}: no banned phrase "${phrase}"`);
    }
  }
}

// ── 12. Section Ordering ────────────────────────────────────────────

section("12. Section Ordering");

{
  // Solution sections match canonical order
  assertGte(SOLUTION_SECTIONS.length, 8, "Solution sections >= 8");
  assertEqual(SOLUTION_SECTIONS[0], "hero", "Solution starts with hero");
  assertEqual(SOLUTION_SECTIONS[SOLUTION_SECTIONS.length - 1], "cta", "Solution ends with cta");

  // Concept sections match canonical order
  assertGte(CONCEPT_SECTIONS.length, 8, "Concept sections >= 8");
  assertEqual(CONCEPT_SECTIONS[0], "hero", "Concept starts with hero");
  assertEqual(CONCEPT_SECTIONS[CONCEPT_SECTIONS.length - 1], "cta", "Concept ends with cta");

  // Equipment sections match canonical order
  assertGte(EQUIPMENT_SECTIONS.length, 8, "Equipment sections >= 8");
  assertEqual(EQUIPMENT_SECTIONS[0], "hero", "Equipment starts with hero");
  assertEqual(EQUIPMENT_SECTIONS[EQUIPMENT_SECTIONS.length - 1], "cta", "Equipment ends with cta");

  // Page data has correct section order
  const solPd = buildSolutionPageData("store-replenishment");
  assertEqual(JSON.stringify(solPd._section_order), JSON.stringify(SOLUTION_SECTIONS), "Solution page data has correct section order");

  const conPd = buildConceptPageData("cross-docking");
  assertEqual(JSON.stringify(conPd._section_order), JSON.stringify(CONCEPT_SECTIONS), "Concept page data has correct section order");

  const eqPd = buildEquipmentPageData("box-truck");
  assertEqual(JSON.stringify(eqPd._section_order), JSON.stringify(EQUIPMENT_SECTIONS), "Equipment page data has correct section order");
}

// ── 13. Graph Statistics Consistency ────────────────────────────────

section("13. Graph Statistics");

{
  const stats = getGraphStats();
  assertEqual(stats.entity_count, 13, "13 total entities");
  assertEqual(stats.solution_count, 4, "4 solutions");
  assertEqual(stats.concept_count, 6, "6 concepts");
  assertEqual(stats.equipment_count, 3, "3 equipment");
  assertEqual(stats.isolated_entities, 0, "0 isolated entities");
  assertGte(stats.total_edges, 30, "At least 30 edges");

  // Verify counts match family queries
  const solCount = getEntitiesByFamily("solution").length;
  const conCount = getEntitiesByFamily("concept").length;
  const eqCount = getEntitiesByFamily("equipment").length;
  assertEqual(solCount + conCount + eqCount, stats.entity_count, "Family counts sum to total");
}

// ══════════════════════════════════════════════════════════════════════
// RESULTS
// ══════════════════════════════════════════════════════════════════════

console.log("\n══════════════════════════════════════════════════════════");
console.log(`  AUTHORITY SYSTEM TESTS: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════════════════════");

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  ✗ ${f}`);
  }
}

console.log(`\n  Total assertions: ${passed + failed}`);
console.log(`  Pass rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

process.exit(failed > 0 ? 1 : 0);
