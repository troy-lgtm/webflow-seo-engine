/**
 * Authority Associated Lanes Tests
 *
 * Proves that:
 *   1. Authority pages derive associated lanes from expansion artifacts
 *   2. Lane ordering is deterministic (rank → score → slug)
 *   3. Maximum lane count (10) is respected
 *   4. Renderer outputs correct HTML structure
 *   5. Empty lane case produces no HTML
 *   6. All 13 entities resolve associated lanes
 *   7. Primary lanes appear before secondary
 *   8. renderAuthorityPage includes associated_lanes_html field
 *   9. Labels use "Origin → Destination Mode" format
 *  10. No tertiary lanes appear in output
 *
 * Run: node tests/authority-associated-lanes.test.js
 */

import {
  buildAuthorityPageData,
  buildSolutionPageData,
  buildConceptPageData,
  buildEquipmentPageData,
  MAX_ASSOCIATED_LANES,
} from "../lib/authority-page-schema.js";

import {
  renderAuthorityPage,
  renderAuthorityPrimaryContent,
  renderAssociatedLanes,
} from "../lib/render-authority-page.js";

import { getAllEntities } from "../lib/authority-graph.js";

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

function assertLte(actual, max, message) {
  assert(actual <= max, `${message} (expected <= ${max}, got ${actual})`);
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

// ── 1. Schema: Associated Lanes Present ─────────────────────────────

section("1. Schema: Associated Lanes Present");

{
  const allEntities = getAllEntities();
  let totalLanes = 0;
  let entitiesWithLanes = 0;

  for (const entity of allEntities) {
    const pd = buildAuthorityPageData(entity.id);
    assert(Array.isArray(pd.associated_lanes), `${entity.id}: associated_lanes is an array`);
    if (pd.associated_lanes.length > 0) {
      entitiesWithLanes++;
      totalLanes += pd.associated_lanes.length;
    }
  }

  assertGte(allEntities.length, 13, "At least 13 entities in registry");
  assertGte(entitiesWithLanes, 1, "At least 1 entity has associated lanes");
  assertGte(totalLanes, 5, "At least 5 total associated lanes across all entities");
  console.log(`  ${entitiesWithLanes}/${allEntities.length} entities have associated lanes (${totalLanes} total)`);
}

// ── 2. Lane Ordering: Deterministic ─────────────────────────────────

section("2. Lane Ordering: Deterministic");

{
  // Run twice, verify identical output
  const pd1 = buildAuthorityPageData("cross-docking");
  const pd2 = buildAuthorityPageData("cross-docking");

  assertEqual(
    JSON.stringify(pd1.associated_lanes),
    JSON.stringify(pd2.associated_lanes),
    "cross-docking: associated_lanes identical across two builds"
  );

  // Verify ordering rules within a single entity
  const lanes = pd1.associated_lanes;
  if (lanes.length >= 2) {
    for (let i = 0; i < lanes.length - 1; i++) {
      const a = lanes[i];
      const b = lanes[i + 1];

      const rankOrder = { primary: 0, secondary: 1, tertiary: 2 };
      const ra = rankOrder[a.rank] ?? 9;
      const rb = rankOrder[b.rank] ?? 9;

      if (ra === rb && a.score === b.score) {
        // Tiebreaker: slug ascending
        assert(
          a.slug.localeCompare(b.slug) <= 0,
          `cross-docking: lane[${i}].slug "${a.slug}" <= lane[${i + 1}].slug "${b.slug}" (alphabetical tiebreaker)`
        );
      } else if (ra === rb) {
        // Same rank: score descending
        assertGte(a.score, b.score, `cross-docking: lane[${i}].score >= lane[${i + 1}].score (score descending within rank)`);
      } else {
        // Different rank: lower rank number first
        assert(ra <= rb, `cross-docking: lane[${i}].rank "${a.rank}" before lane[${i + 1}].rank "${b.rank}"`);
      }
    }
  }

  // Additional entity check
  const pd3a = buildAuthorityPageData("store-replenishment");
  const pd3b = buildAuthorityPageData("store-replenishment");
  assertEqual(
    JSON.stringify(pd3a.associated_lanes),
    JSON.stringify(pd3b.associated_lanes),
    "store-replenishment: deterministic across builds"
  );
}

// ── 3. Maximum Lane Count ───────────────────────────────────────────

section("3. Maximum Lane Count");

{
  assertEqual(MAX_ASSOCIATED_LANES, 10, "MAX_ASSOCIATED_LANES is 10");

  const allEntities = getAllEntities();
  for (const entity of allEntities) {
    const pd = buildAuthorityPageData(entity.id);
    assertLte(
      pd.associated_lanes.length,
      MAX_ASSOCIATED_LANES,
      `${entity.id}: lane count ${pd.associated_lanes.length} <= ${MAX_ASSOCIATED_LANES}`
    );
  }
}

// ── 4. Lane Structure Validation ────────────────────────────────────

section("4. Lane Structure Validation");

{
  const pd = buildAuthorityPageData("cross-docking");
  const lanes = pd.associated_lanes;

  if (lanes.length > 0) {
    const first = lanes[0];
    assert(typeof first.slug === "string" && first.slug.length > 0, "Lane has non-empty slug");
    assert(typeof first.label === "string" && first.label.length > 0, "Lane has non-empty label");
    assert(typeof first.mode === "string" && first.mode.length > 0, "Lane has non-empty mode");
    assert(typeof first.rank === "string", "Lane has rank field");
    assert(typeof first.score === "number", "Lane has numeric score");

    // Label format: "Origin → Destination Mode"
    assertIncludes(first.label, "→", "Label contains arrow separator");
    assert(first.label.endsWith(first.mode), `Label ends with mode "${first.mode}"`);
  }

  // Verify across all entities
  const allEntities = getAllEntities();
  for (const entity of allEntities) {
    const epd = buildAuthorityPageData(entity.id);
    for (const lane of epd.associated_lanes) {
      assert(typeof lane.slug === "string", `${entity.id}: lane slug is string`);
      assert(typeof lane.label === "string", `${entity.id}: lane label is string`);
      assert(
        lane.rank === "primary" || lane.rank === "secondary",
        `${entity.id}: lane rank is primary or secondary, got "${lane.rank}"`
      );
    }
  }
}

// ── 5. No Tertiary Lanes ────────────────────────────────────────────

section("5. No Tertiary Lanes");

{
  const allEntities = getAllEntities();
  for (const entity of allEntities) {
    const pd = buildAuthorityPageData(entity.id);
    for (const lane of pd.associated_lanes) {
      assert(
        lane.rank !== "tertiary",
        `${entity.id}: no tertiary lanes (found slug="${lane.slug}")`
      );
    }
  }
}

// ── 6. Primary Before Secondary ─────────────────────────────────────

section("6. Primary Before Secondary");

{
  const allEntities = getAllEntities();
  for (const entity of allEntities) {
    const pd = buildAuthorityPageData(entity.id);
    const lanes = pd.associated_lanes;
    let seenSecondary = false;
    for (const lane of lanes) {
      if (lane.rank === "secondary") seenSecondary = true;
      if (lane.rank === "primary" && seenSecondary) {
        assert(false, `${entity.id}: primary lane "${lane.slug}" appears after secondary`);
      }
    }
    if (lanes.length > 0) {
      assert(true, `${entity.id}: rank ordering correct (${lanes.length} lanes)`);
    }
  }
}

// ── 7. Renderer: HTML Output ────────────────────────────────────────

section("7. Renderer: HTML Output");

{
  const pd = buildAuthorityPageData("cross-docking");
  const html = renderAssociatedLanes(pd);

  if (pd.associated_lanes.length > 0) {
    assertIncludes(html, '<section class="associated-lanes">', "HTML has section wrapper");
    assertIncludes(html, "<h2>Associated Freight Lanes</h2>", "HTML has heading");
    assertIncludes(html, "<ul>", "HTML has list");
    assertIncludes(html, "</ul>", "HTML has closing list");
    assertIncludes(html, "</section>", "HTML has closing section");
    assertIncludes(html, '<a href="/lanes/', "HTML has lane links");

    // Each lane should produce a list item
    const liCount = (html.match(/<li>/g) || []).length;
    assertEqual(liCount, pd.associated_lanes.length, `HTML has ${pd.associated_lanes.length} list items`);

    // Verify first lane's link
    const first = pd.associated_lanes[0];
    assertIncludes(html, `/lanes/${first.slug}`, `First lane href includes slug "${first.slug}"`);
  }
}

// ── 8. Renderer: Empty Case ─────────────────────────────────────────

section("8. Renderer: Empty Case");

{
  // Simulate empty associated_lanes
  const emptyPd = { associated_lanes: [] };
  const html = renderAssociatedLanes(emptyPd);
  assertEqual(html, "", "Empty associated_lanes produces empty string");

  // Missing field
  const missingPd = {};
  const html2 = renderAssociatedLanes(missingPd);
  assertEqual(html2, "", "Missing associated_lanes produces empty string");

  // Null
  const nullPd = { associated_lanes: null };
  const html3 = renderAssociatedLanes(nullPd);
  assertEqual(html3, "", "Null associated_lanes produces empty string");
}

// ── 9. Primary Content Includes Associated Lanes ────────────────────

section("9. Primary Content Includes Associated Lanes");

{
  // Solution
  const solPd = buildAuthorityPageData("store-replenishment");
  const solHtml = renderAuthorityPrimaryContent(solPd);
  if (solPd.associated_lanes.length > 0) {
    assertIncludes(solHtml, "associated-lanes", "Solution primary content includes associated lanes section");
    assertIncludes(solHtml, "Associated Freight Lanes", "Solution content has lanes heading");
  }

  // Concept
  const conPd = buildAuthorityPageData("cross-docking");
  const conHtml = renderAuthorityPrimaryContent(conPd);
  if (conPd.associated_lanes.length > 0) {
    assertIncludes(conHtml, "associated-lanes", "Concept primary content includes associated lanes section");
  }

  // Equipment
  const eqPd = buildAuthorityPageData("box-truck");
  const eqHtml = renderAuthorityPrimaryContent(eqPd);
  if (eqPd.associated_lanes.length > 0) {
    assertIncludes(eqHtml, "associated-lanes", "Equipment primary content includes associated lanes section");
  }
}

// ── 10. renderAuthorityPage Returns associated_lanes_html ───────────

section("10. renderAuthorityPage Returns associated_lanes_html");

{
  const pd = buildAuthorityPageData("cross-docking");
  const rendered = renderAuthorityPage(pd);

  assert("associated_lanes_html" in rendered, "renderAuthorityPage output has associated_lanes_html key");
  assert(typeof rendered.associated_lanes_html === "string", "associated_lanes_html is a string");

  if (pd.associated_lanes.length > 0) {
    assertIncludes(rendered.associated_lanes_html, "associated-lanes", "associated_lanes_html has section class");
  }
}

// ── 11. All Page Types ──────────────────────────────────────────────

section("11. All Page Types");

{
  // Solution
  const sol = buildSolutionPageData("store-replenishment");
  assert(Array.isArray(sol.associated_lanes), "Solution page has associated_lanes");

  // Concept
  const con = buildConceptPageData("cross-docking");
  assert(Array.isArray(con.associated_lanes), "Concept page has associated_lanes");

  // Equipment
  const eq = buildEquipmentPageData("box-truck");
  assert(Array.isArray(eq.associated_lanes), "Equipment page has associated_lanes");
}

// ── 12. Renderer: Lanes Appear Before CTA ───────────────────────────

section("12. Renderer: Lanes Appear Before CTA");

{
  const pd = buildAuthorityPageData("cross-docking");
  const html = renderAuthorityPrimaryContent(pd);

  if (pd.associated_lanes.length > 0) {
    const lanesPos = html.indexOf("associated-lanes");
    const ctaPos = html.indexOf("authority-cta");
    assert(lanesPos > 0, "Lanes section found in HTML");
    assert(ctaPos > 0, "CTA section found in HTML");
    assert(lanesPos < ctaPos, "Lanes section appears before CTA");
  }
}

// ── 13. Cross-Entity Determinism ────────────────────────────────────

section("13. Cross-Entity Determinism");

{
  const entities = getAllEntities();
  for (const entity of entities) {
    const r1 = renderAuthorityPage(buildAuthorityPageData(entity.id));
    const r2 = renderAuthorityPage(buildAuthorityPageData(entity.id));
    assertEqual(
      r1.associated_lanes_html,
      r2.associated_lanes_html,
      `${entity.id}: associated_lanes_html deterministic`
    );
  }
}

// ── 14. Specific Lane Presence ──────────────────────────────────────

section("14. Specific Lane Presence");

{
  // cross-docking has known lanes from the artifact
  const pd = buildAuthorityPageData("cross-docking");
  const slugs = pd.associated_lanes.map(l => l.slug);

  // The artifact has 15 lanes, we should have up to 10
  assertGte(slugs.length, 1, "cross-docking has at least 1 associated lane");
  assertLte(slugs.length, 10, "cross-docking has at most 10 associated lanes");

  // All slugs should be non-empty strings
  for (const slug of slugs) {
    assert(typeof slug === "string" && slug.length > 3, `Lane slug "${slug}" is valid`);
    assert(slug.includes("-to-"), `Lane slug "${slug}" follows origin-to-destination format`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// RESULTS
// ══════════════════════════════════════════════════════════════════════

console.log("\n══════════════════════════════════════════════════════════");
console.log(`  Authority Associated Lanes: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════════════════════");

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  ✗ ${f}`);
  }
  process.exit(1);
}
