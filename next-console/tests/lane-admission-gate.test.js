/**
 * Lane Admission Gate — Test Suite
 *
 * Validates the pre-publish admission system that determines whether a
 * lane page deserves to exist. Tests cover:
 *   1. Strong page admission
 *   2. Weak page rejection
 *   3. Deterministic scoring
 *   4. Explicit rejection reasons
 *   5. Dimension scoring behavior
 *   6. Pipeline integration
 *   7. Dimension weights
 *   8. Lane differentiation
 *   9. Check coverage
 *  10. Operational terms
 *  11. Grade scale
 *  12. No regression
 *  13. Edge cases
 *  14. FTL mode admission
 *
 * Run: node tests/lane-admission-gate.test.js
 */

import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import {
  assessLaneAdmission,
  _DIMENSION_WEIGHTS,
  _ADMISSION_THRESHOLD,
  _OPERATIONAL_TERMS,
  _FLUFF_TERMS,
} from "../lib/lane-admission-gate.js";
import { assessPublishQuality } from "../lib/lane-page-validator.js";
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

// ── Test Fixtures ─────────────────────────────────────────────────────

const RELATED = {
  corridor_hub: null,
  related_lanes: [
    { slug: "atlanta-to-tampa", label: "Atlanta to Tampa" },
    { slug: "atlanta-to-miami", label: "Atlanta to Miami" },
    { slug: "atlanta-to-charlotte", label: "Atlanta to Charlotte" },
  ],
  tool_link: "https://www.wearewarp.com/quote",
  data_link: null,
};

const RELATED_EMPTY = {
  corridor_hub: null,
  related_lanes: [],
  tool_link: "https://www.wearewarp.com/quote",
  data_link: null,
};

/**
 * Strong page: Atlanta to Orlando — medium haul, rich operational profile.
 */
const STRONG_KNOWLEDGE = buildLaneKnowledge({
  origin: "Atlanta, GA",
  destination: "Orlando, FL",
  mode: "LTL",
});
const STRONG_PAGEDATA = buildCanonicalLanePageData(STRONG_KNOWLEDGE, RELATED);

/**
 * Second strong page: Los Angeles to Chicago — long haul, different profile.
 */
const SECOND_KNOWLEDGE = buildLaneKnowledge({
  origin: "Los Angeles, CA",
  destination: "Chicago, IL",
  mode: "LTL",
});
const SECOND_PAGEDATA = buildCanonicalLanePageData(SECOND_KNOWLEDGE, RELATED_EMPTY);

/**
 * FTL strong page: LA to Dallas.
 */
const FTL_KNOWLEDGE = buildLaneKnowledge({
  origin: "Los Angeles, CA",
  destination: "Dallas, TX",
  mode: "FTL",
});
const FTL_PAGEDATA = buildCanonicalLanePageData(FTL_KNOWLEDGE, RELATED_EMPTY);

/**
 * LTL equivalent for comparison with FTL.
 */
const LTL_KNOWLEDGE = buildLaneKnowledge({
  origin: "Los Angeles, CA",
  destination: "Dallas, TX",
  mode: "LTL",
});
const LTL_PAGEDATA = buildCanonicalLanePageData(LTL_KNOWLEDGE, RELATED_EMPTY);

/**
 * Deliberately weak/thin page with minimal content.
 */
const WEAK_KNOWLEDGE = {
  lane_slug: "generic-to-generic",
  origin_city: "Generic",
  origin_state: "XX",
  destination_city: "Generic",
  destination_state: "XX",
  canonical_path: "/lanes/generic-to-generic",
  corridor_id: null,
  mode: "LTL",
  region_profile: { origin: "Unknown", destination: "Unknown" },
  distance_band: "medium_haul",
  lane_stats: {
    estimated_distance_miles: 0,
    estimated_transit_days_range: { min: 0, max: 0 },
    estimated_rate_range_usd: { low: 0, high: 0 },
    common_equipment: [],
    seasonality_notes: "",
    confidence: {},
    disclaimers: [],
  },
  network_proof: {
    estimated_carrier_count: 0,
    nearest_cross_docks: [],
    service_notes: [],
    origin_region: "Unknown",
    destination_region: "Unknown",
  },
  shipment_profile_fit: [],
  equipment_fit: [],
  operational_characteristics: [],
  pricing_logic: [],
  faq_seeds: [],
  related_corridor_logic: {
    corridor_hub: null,
    related_lane_count_target: 0,
    tool_link: "",
    data_link: null,
  },
};

const WEAK_PAGEDATA = {
  page_title: "Freight Shipping",
  meta_description: "Ship freight.",
  lane_slug: "generic-to-generic",
  canonical_path: "/lanes/generic-to-generic",
  mode: "LTL",
  segment: "smb",
  origin: "Generic, XX",
  destination: "Generic, XX",
  lane_stats: WEAK_KNOWLEDGE.lane_stats,
  network_proof: WEAK_KNOWLEDGE.network_proof,
  hero: {
    headline: "Freight Shipping",
    subhead: "Ship things from here to there.",
    primary_cta: { label: "Get Quote", url: "/quote" },
    secondary_cta: { label: "Book", url: "/book" },
  },
  lane_overview: {
    heading: "Overview",
    body: "This is a freight lane. We ship things.",
  },
  warp_fit_for_lane: {
    heading: "How We Ship",
    body: "We use trucks to move freight.",
  },
  operating_details: {
    heading: "Details",
    items: [{ label: "Mode", value: "LTL" }],
  },
  pricing_and_commercial_framing: {
    heading: "Pricing",
    body: "Prices vary.",
  },
  best_fit_shipments: {
    heading: "Best Fit",
    intro: "Good for shipping.",
    items: [],
  },
  lane_specific_faqs: [
    { question: "How much does shipping cost?", answer: "It depends." },
    { question: "How long does it take?", answer: "A few days." },
  ],
  related_links: {
    corridor_hub: null,
    related_lanes: [],
    tool_link: "",
    data_link: null,
  },
  authority_links: [],
  why_warp: { reasons: [] },
  final_cta: {
    headline: "Get Started",
    primary_cta: { label: "Quote", url: "/quote" },
    trust_signals: [],
  },
  lane_relevant_cta: {
    headline: "Ship Freight",
    body: "Get a quote.",
    primary_cta: { label: "Quote", url: "/quote" },
  },
};

/**
 * Page loaded with marketing fluff.
 */
const FLUFFY_KNOWLEDGE = { ...WEAK_KNOWLEDGE };
const FLUFFY_PAGEDATA = JSON.parse(JSON.stringify(WEAK_PAGEDATA));
FLUFFY_PAGEDATA.lane_overview.body =
  "Our revolutionary, game-changing, world-class, cutting-edge platform " +
  "provides seamless, frictionless freight shipping. We leverage our " +
  "best-in-class ecosystem to supercharge your supply chain with " +
  "next-generation holistic synergy solutions.";
FLUFFY_PAGEDATA.warp_fit_for_lane.body =
  "Our unparalleled, state-of-the-art paradigm disrupts the traditional freight model.";

// ══════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════

// ── Group 1: Strong Lane Admission ────────────────────────────────────

section("1. Strong Lane Admission");

const strongResult = assessLaneAdmission(STRONG_KNOWLEDGE, STRONG_PAGEDATA);

assert(strongResult.admitted === true,
  "Atlanta to Orlando should pass admission");

assert(strongResult.score >= _ADMISSION_THRESHOLD,
  `Strong page score ${strongResult.score} should be >= threshold ${_ADMISSION_THRESHOLD}`);

assert(strongResult.score >= 60,
  `Strong page score ${strongResult.score} should be >= 60`);

assert(["A", "B", "C"].includes(strongResult.grade),
  `Strong page grade ${strongResult.grade} should be A, B, or C`);

{
  const expectedDims = [
    "differentiation", "operational_signal_density", "graph_contribution",
    "internal_link_utility", "content_specificity", "publish_worthiness",
  ];
  for (const dim of expectedDims) {
    assert(strongResult.dimensions[dim] !== undefined,
      `Dimension ${dim} should exist`);
    assert(strongResult.dimensions[dim].score >= 0 && strongResult.dimensions[dim].score <= 100,
      `Dimension ${dim} score ${strongResult.dimensions[dim].score} should be 0-100`);
  }
}

assert(strongResult.rejections.length === 0,
  `Strong page should have 0 rejections, got ${strongResult.rejections.length}`);

{
  const secondResult = assessLaneAdmission(SECOND_KNOWLEDGE, SECOND_PAGEDATA);
  assert(secondResult.admitted === true,
    "Los Angeles to Chicago should also pass admission");
  assert(secondResult.score >= _ADMISSION_THRESHOLD,
    `LA-Chicago score ${secondResult.score} should be >= threshold`);
}

assert(strongResult.debug !== undefined,
  "Strong page should have debug output");
assert(strongResult.debug.dimension_scores !== undefined,
  "Debug should have dimension_scores");
assert(strongResult.debug.total_weighted === strongResult.score,
  "Debug total_weighted should match score");
assert(strongResult.debug.threshold === _ADMISSION_THRESHOLD,
  "Debug threshold should match ADMISSION_THRESHOLD");

// ── Group 2: Weak Page Rejection ──────────────────────────────────────

section("2. Weak Page Rejection");

const weakResult = assessLaneAdmission(WEAK_KNOWLEDGE, WEAK_PAGEDATA);

assert(weakResult.admitted === false,
  "Generic weak page should be rejected");

assert(weakResult.score < _ADMISSION_THRESHOLD,
  `Weak page score ${weakResult.score} should be < threshold ${_ADMISSION_THRESHOLD}`);

assert(weakResult.grade === "F",
  `Weak page grade should be F, got ${weakResult.grade}`);

assert(weakResult.rejections.length > 0,
  "Weak page should have rejections");

{
  const overallRejection = weakResult.rejections.find(r => r.dimension === "_overall");
  assert(overallRejection !== undefined,
    "Weak page should have overall rejection");
  assert(overallRejection && overallRejection.reason.includes(String(_ADMISSION_THRESHOLD)),
    "Overall rejection should reference threshold");
}

{
  const fluffyResult = assessLaneAdmission(FLUFFY_KNOWLEDGE, FLUFFY_PAGEDATA);
  assert(fluffyResult.admitted === false,
    "Fluffy page should be rejected");
}

assert(weakResult.dimensions.operational_signal_density.score < 50,
  `Weak page ops density ${weakResult.dimensions.operational_signal_density.score} should be < 50`);

assert(weakResult.dimensions.content_specificity.score < 40,
  `Weak page content spec ${weakResult.dimensions.content_specificity.score} should be < 40`);

assert(weakResult.dimensions.graph_contribution.score < 40,
  `Weak page graph contribution ${weakResult.dimensions.graph_contribution.score} should be < 40`);

// ── Group 3: Deterministic Scoring ────────────────────────────────────

section("3. Deterministic Scoring");

{
  const r1 = assessLaneAdmission(STRONG_KNOWLEDGE, STRONG_PAGEDATA);
  const r2 = assessLaneAdmission(STRONG_KNOWLEDGE, STRONG_PAGEDATA);

  assert(r1.score === r2.score,
    `Strong page score should be deterministic: ${r1.score} vs ${r2.score}`);
  assert(r1.grade === r2.grade,
    "Strong page grade should be deterministic");
  assert(r1.admitted === r2.admitted,
    "Strong page admission should be deterministic");

  for (const dim of Object.keys(r1.dimensions)) {
    assert(r1.dimensions[dim].score === r2.dimensions[dim].score,
      `Dimension ${dim} score should be deterministic: ${r1.dimensions[dim].score} vs ${r2.dimensions[dim].score}`);
  }

  for (const dim of Object.keys(r1.dimensions)) {
    const c1 = r1.dimensions[dim].checks;
    const c2 = r2.dimensions[dim].checks;
    assert(c1.length === c2.length,
      `Dimension ${dim} check count should be deterministic`);
    for (let i = 0; i < c1.length; i++) {
      assert(c1[i].id === c2[i].id,
        `Check ${dim}[${i}] ID should be deterministic`);
      assert(c1[i].score === c2[i].score,
        `Check ${dim}[${i}] score should be deterministic: ${c1[i].id} ${c1[i].score} vs ${c2[i].score}`);
    }
  }
}

{
  const r1 = assessLaneAdmission(WEAK_KNOWLEDGE, WEAK_PAGEDATA);
  const r2 = assessLaneAdmission(WEAK_KNOWLEDGE, WEAK_PAGEDATA);
  assert(r1.score === r2.score,
    "Weak page score should be deterministic");
}

{
  const r1 = assessLaneAdmission(WEAK_KNOWLEDGE, WEAK_PAGEDATA);
  const r2 = assessLaneAdmission(WEAK_KNOWLEDGE, WEAK_PAGEDATA);
  assert(r1.rejections.length === r2.rejections.length,
    "Rejection count should be deterministic");
  for (let i = 0; i < r1.rejections.length; i++) {
    assert(r1.rejections[i].dimension === r2.rejections[i].dimension,
      "Rejection dimension should be deterministic");
    assert(r1.rejections[i].reason === r2.rejections[i].reason,
      "Rejection reason should be deterministic");
  }
}

// ── Group 4: Explicit Rejection Reasons ───────────────────────────────

section("4. Explicit Rejection Reasons");

assert(weakResult.rejections.length > 0,
  "Weak page rejections should be non-empty");

for (const rejection of weakResult.rejections) {
  assert(typeof rejection.dimension === "string",
    "Rejection dimension should be string");
  assert(typeof rejection.reason === "string",
    "Rejection reason should be string");
  assert(rejection.reason.length > 0,
    "Rejection reason should be non-empty");
}

{
  const overall = weakResult.rejections.find(r => r.dimension === "_overall");
  assert(overall !== undefined, "Should have overall rejection");
  assert(overall && overall.reason.includes("%"), "Overall rejection should include %");
}

{
  const dimRejections = weakResult.rejections.filter(r => r.dimension !== "_overall");
  assert(dimRejections.length > 0,
    "Should have dimension-specific rejections");
  for (const r of dimRejections) {
    assert(r.reason.includes(r.dimension),
      `Dimension rejection should reference ${r.dimension}`);
    assert(r.reason.includes("critically low"),
      `Dimension rejection should say 'critically low': ${r.reason}`);
  }
}

assert(strongResult.rejections.length === 0,
  "Strong page should have zero rejections");

// ── Group 5: Dimension Scoring Behavior ───────────────────────────────

section("5. Dimension Scoring Behavior");

{
  assert(strongResult.dimensions.differentiation.score >
         weakResult.dimensions.differentiation.score,
    `Strong differentiation ${strongResult.dimensions.differentiation.score} > weak ${weakResult.dimensions.differentiation.score}`);
}

{
  const fluffyResult = assessLaneAdmission(FLUFFY_KNOWLEDGE, FLUFFY_PAGEDATA);
  assert(strongResult.dimensions.differentiation.score >
         fluffyResult.dimensions.differentiation.score,
    `Strong differentiation > fluffy differentiation`);
}

assert(strongResult.dimensions.operational_signal_density.score > 50,
  `Strong ops density ${strongResult.dimensions.operational_signal_density.score} should be > 50`);

assert(weakResult.dimensions.operational_signal_density.score < 40,
  `Weak ops density ${weakResult.dimensions.operational_signal_density.score} should be < 40`);

assert(strongResult.dimensions.graph_contribution.score > 40,
  `Strong graph contribution ${strongResult.dimensions.graph_contribution.score} should be > 40`);

{
  const familyCheck = strongResult.dimensions.graph_contribution.checks
    .find(c => c.id === "graph_family_coverage");
  assert(familyCheck !== undefined, "Graph should have family_coverage check");
  assert(familyCheck && familyCheck.score >= 0, "Family coverage score should be >= 0");
}

{
  const linkCheck = strongResult.dimensions.internal_link_utility.checks
    .find(c => c.id === "link_authority_count");
  assert(linkCheck !== undefined, "Link utility should have authority_count check");
}

{
  const faqCheck = strongResult.dimensions.content_specificity.checks
    .find(c => c.id === "spec_faq_lane_refs");
  assert(faqCheck !== undefined, "Content specificity should have faq_lane_refs check");
  assert(faqCheck && faqCheck.score > 0, "FAQ lane refs score should be > 0 for strong page");
}

{
  const weaknessCheck = weakResult.dimensions.publish_worthiness.checks
    .find(c => c.id === "worth_no_weakness");
  assert(weaknessCheck !== undefined, "Publish worthiness should have no_weakness check");
  assert(weaknessCheck && weaknessCheck.score <= 50,
    `Weak page worth_no_weakness should be <= 50, got ${weaknessCheck?.score}`);
}

{
  const consistencyCheck = strongResult.dimensions.publish_worthiness.checks
    .find(c => c.id === "worth_consistency");
  assert(consistencyCheck !== undefined, "Publish worthiness should have consistency check");
}

// ── Group 6: Pipeline Integration ─────────────────────────────────────

section("6. Pipeline Integration");

{
  const contract = buildPublishContract(STRONG_PAGEDATA);
  const renderedFields = contractToRenderedFields(contract);
  const quality = assessPublishQuality(STRONG_PAGEDATA, renderedFields);
  assert(quality.publishable === true,
    "Strong page should pass quality gate");

  const admission = assessLaneAdmission(STRONG_KNOWLEDGE, STRONG_PAGEDATA);
  assert(admission.admitted === true,
    "Strong page should pass admission gate after quality gate");
}

{
  const pageCopy = JSON.parse(JSON.stringify(STRONG_PAGEDATA));
  const r1 = assessLaneAdmission(STRONG_KNOWLEDGE, STRONG_PAGEDATA);
  const r2 = assessLaneAdmission(STRONG_KNOWLEDGE, pageCopy);
  assert(r1.score === r2.score,
    "Admission gate should be independent of object identity");
}

{
  const result = assessLaneAdmission(STRONG_KNOWLEDGE, STRONG_PAGEDATA);
  assert(typeof result.admitted === "boolean", "admitted should be boolean");
  assert(typeof result.score === "number", "score should be number");
  assert(typeof result.grade === "string", "grade should be string");
  assert(Array.isArray(result.rejections), "rejections should be array");
  assert(result.dimensions !== undefined, "dimensions should exist");
  assert(result.debug !== undefined, "debug should exist");
}

{
  const result = assessLaneAdmission(STRONG_KNOWLEDGE, STRONG_PAGEDATA);
  assert(Number.isInteger(result.score), "Score should be integer");
  assert(result.score >= 0 && result.score <= 100, "Score should be 0-100");
}

{
  const result = assessLaneAdmission(STRONG_KNOWLEDGE, STRONG_PAGEDATA);
  for (const [dimName, dim] of Object.entries(result.dimensions)) {
    assert(Number.isInteger(dim.score),
      `Dimension ${dimName} score should be integer, got ${dim.score}`);
    assert(dim.score >= 0 && dim.score <= 100,
      `Dimension ${dimName} score should be 0-100, got ${dim.score}`);
  }
}

// ── Group 7: Dimension Weights ────────────────────────────────────────

section("7. Dimension Weights");

{
  const sum = Object.values(_DIMENSION_WEIGHTS).reduce((s, w) => s + w, 0);
  assert(Math.abs(sum - 1.0) < 0.001,
    `Weights should sum to 1.0, got ${sum}`);
}

assert(Object.keys(_DIMENSION_WEIGHTS).length === 6,
  `Should have 6 dimension weights, got ${Object.keys(_DIMENSION_WEIGHTS).length}`);

assert(_DIMENSION_WEIGHTS.differentiation !== undefined, "Should have differentiation weight");
assert(_DIMENSION_WEIGHTS.operational_signal_density !== undefined, "Should have ops density weight");
assert(_DIMENSION_WEIGHTS.graph_contribution !== undefined, "Should have graph contribution weight");
assert(_DIMENSION_WEIGHTS.internal_link_utility !== undefined, "Should have link utility weight");
assert(_DIMENSION_WEIGHTS.content_specificity !== undefined, "Should have content specificity weight");
assert(_DIMENSION_WEIGHTS.publish_worthiness !== undefined, "Should have publish worthiness weight");

{
  const maxWeight = Math.max(...Object.values(_DIMENSION_WEIGHTS));
  assert(_DIMENSION_WEIGHTS.operational_signal_density === maxWeight,
    "Operational signal density should have highest weight");
}

assert(_ADMISSION_THRESHOLD === 50,
  `Admission threshold should be 50, got ${_ADMISSION_THRESHOLD}`);

// ── Group 8: Lane Differentiation ─────────────────────────────────────

section("8. Lane Differentiation");

{
  const atlResult = assessLaneAdmission(STRONG_KNOWLEDGE, STRONG_PAGEDATA);
  const laResult = assessLaneAdmission(SECOND_KNOWLEDGE, SECOND_PAGEDATA);
  assert(atlResult.admitted === true, "Atlanta page should be admitted");
  assert(laResult.admitted === true, "LA page should be admitted");
  assert(atlResult.dimensions.differentiation !== undefined, "Atlanta should have differentiation");
  assert(laResult.dimensions.differentiation !== undefined, "LA should have differentiation");
}

{
  const result = assessLaneAdmission(STRONG_KNOWLEDGE, STRONG_PAGEDATA);
  assert(result.score >= _ADMISSION_THRESHOLD + 10,
    `Strong page score ${result.score} should be >= ${_ADMISSION_THRESHOLD + 10} (meaningful margin)`);
}

{
  const result = assessLaneAdmission(WEAK_KNOWLEDGE, WEAK_PAGEDATA);
  assert(result.score < _ADMISSION_THRESHOLD - 10,
    `Weak page score ${result.score} should be < ${_ADMISSION_THRESHOLD - 10} (meaningful margin)`);
}

// ── Group 9: Check Coverage ───────────────────────────────────────────

section("9. Check Coverage");

assert(strongResult.dimensions.differentiation.checks.length === 5,
  `Differentiation should have 5 checks, got ${strongResult.dimensions.differentiation.checks.length}`);

assert(strongResult.dimensions.operational_signal_density.checks.length === 6,
  `Ops density should have 6 checks, got ${strongResult.dimensions.operational_signal_density.checks.length}`);

assert(strongResult.dimensions.graph_contribution.checks.length === 5,
  `Graph contribution should have 5 checks, got ${strongResult.dimensions.graph_contribution.checks.length}`);

assert(strongResult.dimensions.internal_link_utility.checks.length === 4,
  `Link utility should have 4 checks, got ${strongResult.dimensions.internal_link_utility.checks.length}`);

assert(strongResult.dimensions.content_specificity.checks.length === 6,
  `Content specificity should have 6 checks, got ${strongResult.dimensions.content_specificity.checks.length}`);

assert(strongResult.dimensions.publish_worthiness.checks.length === 3,
  `Publish worthiness should have 3 checks, got ${strongResult.dimensions.publish_worthiness.checks.length}`);

{
  for (const [dimName, dim] of Object.entries(strongResult.dimensions)) {
    for (const check of dim.checks) {
      assert(typeof check.id === "string" && check.id.length > 0,
        `Check in ${dimName} should have string id`);
      assert(typeof check.score === "number",
        `Check ${check.id} should have number score`);
      assert(typeof check.weight === "number",
        `Check ${check.id} should have number weight`);
    }
  }
}

{
  for (const [dimName, dim] of Object.entries(strongResult.dimensions)) {
    const ids = dim.checks.map(c => c.id);
    assert(new Set(ids).size === ids.length,
      `Check IDs should be unique within ${dimName}`);
  }
}

// ── Group 10: Operational Terms ───────────────────────────────────────

section("10. Operational Terms");

assert(_OPERATIONAL_TERMS.length > 10,
  `Operational terms list should be > 10, got ${_OPERATIONAL_TERMS.length}`);

{
  const core = ["carrier", "pallet", "transit", "freight", "shipment", "routing"];
  for (const term of core) {
    assert(_OPERATIONAL_TERMS.includes(term),
      `Operational terms should include '${term}'`);
  }
}

assert(_FLUFF_TERMS.length > 5,
  `Fluff terms list should be > 5, got ${_FLUFF_TERMS.length}`);

{
  const opSet = new Set(_OPERATIONAL_TERMS.map(t => t.toLowerCase()));
  for (const fluff of _FLUFF_TERMS) {
    assert(!opSet.has(fluff.toLowerCase()),
      `Fluff term '${fluff}' should not be in operational terms`);
  }
}

// ── Group 11: Grade Scale ─────────────────────────────────────────────

section("11. Grade Scale");

assert(["A", "B", "C"].includes(strongResult.grade),
  `Strong page grade should be A/B/C, got ${strongResult.grade}`);

assert(weakResult.grade === "F",
  `Weak page grade should be F, got ${weakResult.grade}`);

{
  const s = strongResult.score;
  const g = strongResult.grade;
  if (s >= 90) assert(g === "A", `Score ${s} should give grade A, got ${g}`);
  else if (s >= 80) assert(g === "B", `Score ${s} should give grade B, got ${g}`);
  else if (s >= 70) assert(g === "C", `Score ${s} should give grade C, got ${g}`);
  else if (s >= 60) assert(g === "D", `Score ${s} should give grade D, got ${g}`);
  else if (s >= 50) assert(g === "D-", `Score ${s} should give grade D-, got ${g}`);
  else assert(g === "F", `Score ${s} should give grade F, got ${g}`);
}

// ── Group 12: No Regression ───────────────────────────────────────────

section("12. No Regression");

{
  const k = buildLaneKnowledge({ origin: "Dallas, TX", destination: "Houston, TX", mode: "LTL" });
  assert(k !== undefined, "buildLaneKnowledge should still work");
  assert(k.lane_slug !== undefined, "lane_slug should exist");
  assert(k.lane_stats !== undefined, "lane_stats should exist");
}

{
  const k = buildLaneKnowledge({ origin: "Dallas, TX", destination: "Houston, TX", mode: "LTL" });
  const pd = buildCanonicalLanePageData(k, RELATED_EMPTY);
  assert(pd !== undefined, "buildCanonicalLanePageData should still work");
  assert(pd.hero !== undefined, "hero should exist");
  assert(pd.lane_overview !== undefined, "lane_overview should exist");
}

{
  const k = buildLaneKnowledge({ origin: "Atlanta, GA", destination: "Orlando, FL", mode: "LTL" });
  const pd = buildCanonicalLanePageData(k, RELATED_EMPTY);
  const contract = buildPublishContract(pd);
  const rf = contractToRenderedFields(contract);
  const quality = assessPublishQuality(pd, rf);
  assert(quality !== undefined, "assessPublishQuality should still work");
  assert(quality.publishable === true, "Strong page should still be publishable");
  assert(quality.score >= 70, `Quality score ${quality.score} should be >= 70`);
}

{
  const kBefore = JSON.stringify(STRONG_KNOWLEDGE);
  const pdBefore = JSON.stringify(STRONG_PAGEDATA);
  assessLaneAdmission(STRONG_KNOWLEDGE, STRONG_PAGEDATA);
  assert(JSON.stringify(STRONG_KNOWLEDGE) === kBefore,
    "assessLaneAdmission should not modify knowledge");
  assert(JSON.stringify(STRONG_PAGEDATA) === pdBefore,
    "assessLaneAdmission should not modify pageData");
}

// ── Group 13: Edge Cases ──────────────────────────────────────────────

section("13. Edge Cases");

{
  const pdNoLinks = JSON.parse(JSON.stringify(STRONG_PAGEDATA));
  delete pdNoLinks.authority_links;
  const result = assessLaneAdmission(STRONG_KNOWLEDGE, pdNoLinks);
  assert(result !== undefined, "Should handle missing authority_links");
  assert(typeof result.admitted === "boolean", "Should return boolean for missing authority_links");
}

{
  const pdNoFaqs = JSON.parse(JSON.stringify(STRONG_PAGEDATA));
  delete pdNoFaqs.lane_specific_faqs;
  const result = assessLaneAdmission(STRONG_KNOWLEDGE, pdNoFaqs);
  assert(result !== undefined, "Should handle missing FAQs");
  assert(typeof result.admitted === "boolean", "Should return boolean for missing FAQs");
}

{
  const result = assessLaneAdmission(STRONG_KNOWLEDGE, {});
  assert(result !== undefined, "Should handle empty pageData");
  assert(result.admitted === false, "Empty pageData should be rejected");
}

{
  const result = assessLaneAdmission({}, { lane_overview: { body: "test" } });
  assert(result !== undefined, "Should handle empty knowledge");
  assert(typeof result.score === "number", "Should return numeric score for empty knowledge");
}

// ── Group 14: FTL Mode Admission ──────────────────────────────────────

section("14. FTL Mode Admission");

{
  const ftlResult = assessLaneAdmission(FTL_KNOWLEDGE, FTL_PAGEDATA);
  assert(ftlResult.admitted === true,
    `FTL page should pass admission, score: ${ftlResult.score}`);
  assert(ftlResult.score >= _ADMISSION_THRESHOLD,
    `FTL score ${ftlResult.score} should be >= ${_ADMISSION_THRESHOLD}`);
}

{
  const ltlResult = assessLaneAdmission(LTL_KNOWLEDGE, LTL_PAGEDATA);
  const ftlResult = assessLaneAdmission(FTL_KNOWLEDGE, FTL_PAGEDATA);
  assert(ltlResult.admitted === true, "LTL page should be admitted");
  assert(ftlResult.admitted === true, "FTL page should be admitted");
  assert(ltlResult.dimensions.graph_contribution.score !==
         ftlResult.dimensions.graph_contribution.score,
    "LTL and FTL should have different graph contribution scores");
}

// ── Summary ───────────────────────────────────────────────────────────

console.log(`\n${"═".repeat(60)}`);
console.log(`  Lane Admission Gate Tests: ${pass} passed, ${fail} failed`);
console.log(`  Total assertions: ${pass + fail}`);
console.log(`${"═".repeat(60)}\n`);

if (fail > 0) {
  process.exit(1);
}
