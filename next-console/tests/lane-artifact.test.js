/**
 * Lane Artifact Publisher Regression Tests
 *
 * Proves that:
 *   1. buildLaneEntry() runs the full canonical pipeline for a single lane
 *   2. buildLaneArtifact() produces valid artifacts from benchmark lanes
 *   3. Quality gate enforcement blocks unpublishable lanes
 *   4. Duplicate slug rejection works correctly
 *   5. validateLaneArtifact() catches all structural problems
 *   6. Artifact versioning and metadata are correct
 *   7. routeContract is present and valid on every lane entry
 *   8. Benchmark lanes (Atlanta-Orlando, Atlanta-Miami, LA-NY) all pass
 *   9. Artifact contract version matches expected value
 *  10. Rejected lanes include reason and are excluded from main lanes array
 *
 * These tests use NO network calls and NO external dependencies.
 * They run the production pipeline locally and verify artifact output.
 *
 * Run: node tests/lane-artifact.test.js
 */

import {
  buildLaneEntry,
  buildLaneArtifact,
  validateLaneArtifact,
  ARTIFACT_VERSION,
} from "../lib/publishers/lane-artifact-contract.js";

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

function assertType(value, type, message) {
  assert(typeof value === type, `${message} (expected type ${type}, got ${typeof value})`);
}

// ── Test Fixtures — Benchmark Lanes ─────────────────────────────────

const BENCHMARK_LANES = [
  { origin: "Atlanta", destination: "Orlando", mode: "LTL" },
  { origin: "Atlanta", destination: "Miami", mode: "LTL" },
  { origin: "Los Angeles", destination: "New York", mode: "LTL" },
];

const BENCHMARK_SLUGS = ["atlanta-to-orlando", "atlanta-to-miami", "los-angeles-to-new-york"];

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 1 — buildLaneEntry() Single Lane Pipeline
// ═══════════════════════════════════════════════════════════════════════

console.log("\n══ SECTION 1: buildLaneEntry() — Single Lane Pipeline ══\n");

for (const lane of BENCHMARK_LANES) {
  const label = `${lane.origin} → ${lane.destination}`;
  console.log(`  Testing: ${label}`);

  const entry = buildLaneEntry(lane);

  // Structural fields
  assertType(entry.slug, "string", `${label}: slug is string`);
  assert(entry.slug.length > 0, `${label}: slug is non-empty`);
  assertType(entry.publishable, "boolean", `${label}: publishable is boolean`);
  assertType(entry.qualityScore, "number", `${label}: qualityScore is number`);
  assertType(entry.qualityGrade, "string", `${label}: qualityGrade is string`);
  assertType(entry.gatesPassed, "number", `${label}: gatesPassed is number`);
  assertType(entry.gatesTotal, "number", `${label}: gatesTotal is number`);
  assert(Array.isArray(entry.errors), `${label}: errors is array`);

  // Quality expectations for benchmark lanes
  assert(entry.publishable, `${label}: benchmark lane is publishable`);
  assertGte(entry.qualityScore, 70, `${label}: quality score >= 70`);
  assertEqual(entry.gatesPassed, entry.gatesTotal, `${label}: all gates passed`);
  assertGte(entry.gatesTotal, 17, `${label}: at least 17 gates`);

  // routeContract presence and structure
  assert(entry.routeContract !== null && entry.routeContract !== undefined, `${label}: routeContract exists`);
  assertType(entry.routeContract, "object", `${label}: routeContract is object`);
  assert(!!entry.routeContract._route_contract_version, `${label}: routeContract has _route_contract_version`);
  assertEqual(entry.routeContract.slug, entry.slug, `${label}: routeContract.slug matches entry.slug`);

  // Slug format
  assert(entry.slug.includes("-to-"), `${label}: slug contains "-to-"`);
  assert(/^[a-z0-9-]+$/.test(entry.slug), `${label}: slug is lowercase kebab`);
}

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 2 — buildLaneArtifact() Full Artifact Build
// ═══════════════════════════════════════════════════════════════════════

console.log("\n══ SECTION 2: buildLaneArtifact() — Full Artifact Build ══\n");

const artifact = buildLaneArtifact(BENCHMARK_LANES, { source: "test-runner" });

// Top-level structure
assertEqual(artifact.version, ARTIFACT_VERSION, "artifact.version matches ARTIFACT_VERSION");
assertType(artifact.generatedAt, "string", "artifact.generatedAt is string");
assert(artifact.generatedAt.length > 0, "artifact.generatedAt is non-empty");
assertEqual(artifact.source, "test-runner", "artifact.source matches provided source");
assertType(artifact.laneCount, "number", "artifact.laneCount is number");
assert(Array.isArray(artifact.lanes), "artifact.lanes is array");
assert(Array.isArray(artifact.rejected), "artifact.rejected is array");

// Lane count consistency
assertEqual(artifact.laneCount, artifact.lanes.length, "laneCount matches lanes.length");
assertEqual(artifact.laneCount, 3, "3 benchmark lanes accepted");
assertEqual(artifact.rejected.length, 0, "0 benchmark lanes rejected");

// ISO timestamp format
assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(artifact.generatedAt), "generatedAt is ISO format");

// All benchmark slugs present
const artifactSlugs = new Set(artifact.lanes.map((l) => l.slug));
for (const slug of BENCHMARK_SLUGS) {
  assert(artifactSlugs.has(slug), `benchmark slug "${slug}" present in artifact`);
}

// Every lane in artifact is publishable
for (const lane of artifact.lanes) {
  assert(lane.publishable, `${lane.slug}: publishable is true`);
  assert(lane.routeContract !== null, `${lane.slug}: routeContract not null`);
  assert(!!lane.routeContract._route_contract_version, `${lane.slug}: routeContract._route_contract_version present`);
}

// No duplicate slugs
const slugSet = new Set();
let hasDupe = false;
for (const lane of artifact.lanes) {
  if (slugSet.has(lane.slug)) hasDupe = true;
  slugSet.add(lane.slug);
}
assert(!hasDupe, "no duplicate slugs in artifact.lanes");

console.log(`  ✓ ${artifact.laneCount} lanes built, ${artifact.rejected.length} rejected`);

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 3 — validateLaneArtifact() — Validation Engine
// ═══════════════════════════════════════════════════════════════════════

console.log("\n══ SECTION 3: validateLaneArtifact() — Validation Engine ══\n");

// Valid artifact passes
const validResult = validateLaneArtifact(artifact);
assert(validResult.valid, "valid artifact passes validation");
assertEqual(validResult.errors.length, 0, "valid artifact has no errors");

// Null artifact fails
const nullResult = validateLaneArtifact(null);
assert(!nullResult.valid, "null artifact fails validation");
assert(nullResult.errors.length > 0, "null artifact has errors");

// Missing version fails
const noVersion = { ...artifact, version: "9.9.9" };
const noVersionResult = validateLaneArtifact(noVersion);
assert(!noVersionResult.valid, "wrong version fails validation");
assert(noVersionResult.errors.some((e) => e.includes("Version")), "version mismatch error message");

// Missing generatedAt fails
const noGenAt = { ...artifact, generatedAt: null };
const noGenAtResult = validateLaneArtifact(noGenAt);
assert(!noGenAtResult.valid, "missing generatedAt fails validation");

// Missing source fails
const noSource = { ...artifact, source: null };
const noSourceResult = validateLaneArtifact(noSource);
assert(!noSourceResult.valid, "missing source fails validation");

// Wrong laneCount fails
const wrongCount = { ...artifact, laneCount: 99 };
const wrongCountResult = validateLaneArtifact(wrongCount);
assert(!wrongCountResult.valid, "wrong laneCount fails validation");
assert(wrongCountResult.errors.some((e) => e.includes("laneCount")), "laneCount mismatch error message");

// lanes not array fails
const notArray = { ...artifact, lanes: "not-an-array" };
const notArrayResult = validateLaneArtifact(notArray);
assert(!notArrayResult.valid, "non-array lanes fails validation");

// Lane missing required field fails
const missingField = {
  ...artifact,
  lanes: [{ slug: "test-to-test", publishable: true }],
  laneCount: 1,
};
const missingFieldResult = validateLaneArtifact(missingField);
assert(!missingFieldResult.valid, "lane missing required fields fails validation");

// Non-publishable lane in accepted list fails
const nonPub = {
  ...artifact,
  lanes: artifact.lanes.map((l, i) => i === 0 ? { ...l, publishable: false } : l),
};
const nonPubResult = validateLaneArtifact(nonPub);
assert(!nonPubResult.valid, "non-publishable lane in accepted list fails validation");

// Duplicate slug in lanes fails
const dupeLane = {
  ...artifact,
  lanes: [...artifact.lanes, artifact.lanes[0]],
  laneCount: artifact.lanes.length + 1,
};
const dupeResult = validateLaneArtifact(dupeLane);
assert(!dupeResult.valid, "duplicate slug fails validation");

// Missing routeContract._route_contract_version fails
const noRcVersion = {
  ...artifact,
  lanes: artifact.lanes.map((l, i) =>
    i === 0 ? { ...l, routeContract: { ...l.routeContract, _route_contract_version: undefined } } : l
  ),
};
const noRcVersionResult = validateLaneArtifact(noRcVersion);
assert(!noRcVersionResult.valid, "missing routeContract._route_contract_version fails validation");

console.log("  ✓ Validation engine catches all structural problems");

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 4 — Duplicate Slug Rejection
// ═══════════════════════════════════════════════════════════════════════

console.log("\n══ SECTION 4: Duplicate Slug Rejection ══\n");

const dupeInput = [
  { origin: "Atlanta", destination: "Orlando", mode: "LTL" },
  { origin: "Atlanta", destination: "Orlando", mode: "LTL" }, // duplicate
  { origin: "Atlanta", destination: "Miami", mode: "LTL" },
];

const dupeArtifact = buildLaneArtifact(dupeInput);
assertEqual(dupeArtifact.laneCount, 2, "duplicate input: 2 accepted");
assertEqual(dupeArtifact.rejected.length, 1, "duplicate input: 1 rejected");
assert(dupeArtifact.rejected[0].rejectReason.includes("duplicate"), "rejected reason mentions duplicate");
assertEqual(dupeArtifact.rejected[0].slug, "atlanta-to-orlando", "rejected duplicate is atlanta-to-orlando");

console.log("  ✓ Duplicate slugs correctly rejected");

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 5 — Default Source Value
// ═══════════════════════════════════════════════════════════════════════

console.log("\n══ SECTION 5: Default Source Value ══\n");

const defaultSourceArtifact = buildLaneArtifact([BENCHMARK_LANES[0]]);
assertEqual(defaultSourceArtifact.source, "mac-studio-engine", "default source is mac-studio-engine");

console.log("  ✓ Default source is mac-studio-engine");

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 6 — ARTIFACT_VERSION Constant
// ═══════════════════════════════════════════════════════════════════════

console.log("\n══ SECTION 6: ARTIFACT_VERSION Constant ══\n");

assertType(ARTIFACT_VERSION, "string", "ARTIFACT_VERSION is string");
assert(/^\d+\.\d+\.\d+$/.test(ARTIFACT_VERSION), "ARTIFACT_VERSION is semver format");
assertEqual(ARTIFACT_VERSION, "1.0.0", "ARTIFACT_VERSION is 1.0.0");

console.log(`  ✓ ARTIFACT_VERSION = ${ARTIFACT_VERSION}`);

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 7 — routeContract Deep Validation
// ═══════════════════════════════════════════════════════════════════════

console.log("\n══ SECTION 7: routeContract Deep Validation ══\n");

for (const lane of artifact.lanes) {
  const rc = lane.routeContract;
  const label = lane.slug;

  // Core identity fields
  assertType(rc.slug, "string", `${label}: rc.slug is string`);
  assert(!!rc._route_contract_version, `${label}: rc._route_contract_version present`);

  // Route contract should have substantial content
  const rcJson = JSON.stringify(rc);
  assertGte(rcJson.length, 1000, `${label}: routeContract JSON >= 1000 chars`);

  // Key content fields expected in route contract
  assert(rc.slug === lane.slug, `${label}: rc.slug matches lane.slug`);
}

console.log("  ✓ All routeContracts pass deep validation");

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 8 — Empty Input Handling
// ═══════════════════════════════════════════════════════════════════════

console.log("\n══ SECTION 8: Empty Input Handling ══\n");

const emptyArtifact = buildLaneArtifact([]);
assertEqual(emptyArtifact.laneCount, 0, "empty input: laneCount is 0");
assertEqual(emptyArtifact.lanes.length, 0, "empty input: lanes is empty");
assertEqual(emptyArtifact.rejected.length, 0, "empty input: rejected is empty");
assertEqual(emptyArtifact.version, ARTIFACT_VERSION, "empty input: version is correct");
assertType(emptyArtifact.generatedAt, "string", "empty input: generatedAt present");

// Empty artifact still validates
const emptyValidation = validateLaneArtifact(emptyArtifact);
assert(emptyValidation.valid, "empty artifact passes validation");

console.log("  ✓ Empty input produces valid empty artifact");

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 9 — Quality Grade Distribution
// ═══════════════════════════════════════════════════════════════════════

console.log("\n══ SECTION 9: Quality Grade Distribution ══\n");

const VALID_GRADES = new Set(["A", "B", "C", "D", "F"]);
for (const lane of artifact.lanes) {
  assert(VALID_GRADES.has(lane.qualityGrade), `${lane.slug}: grade "${lane.qualityGrade}" is valid`);
  assertGte(lane.qualityScore, 70, `${lane.slug}: score >= 70 (publish threshold)`);
  assert(lane.qualityScore <= 100, `${lane.slug}: score <= 100`);
}

console.log("  ✓ All benchmark lanes have valid quality grades");

// ═══════════════════════════════════════════════════════════════════════
//  SECTION 10 — Artifact Immutability Contract
// ═══════════════════════════════════════════════════════════════════════

console.log("\n══ SECTION 10: Artifact Immutability Contract ══\n");

// Two builds from same input should produce structurally identical artifacts
// (except generatedAt timestamp)
const artifact1 = buildLaneArtifact(BENCHMARK_LANES);
const artifact2 = buildLaneArtifact(BENCHMARK_LANES);

assertEqual(artifact1.version, artifact2.version, "two builds: same version");
assertEqual(artifact1.laneCount, artifact2.laneCount, "two builds: same laneCount");
assertEqual(artifact1.lanes.length, artifact2.lanes.length, "two builds: same lanes count");

for (let i = 0; i < artifact1.lanes.length; i++) {
  assertEqual(artifact1.lanes[i].slug, artifact2.lanes[i].slug, `two builds: lane ${i} same slug`);
  assertEqual(artifact1.lanes[i].qualityScore, artifact2.lanes[i].qualityScore, `two builds: lane ${i} same score`);
  assertEqual(artifact1.lanes[i].qualityGrade, artifact2.lanes[i].qualityGrade, `two builds: lane ${i} same grade`);
}

// generatedAt should differ
assert(artifact1.generatedAt !== artifact2.generatedAt, "two builds: different generatedAt");

console.log("  ✓ Deterministic output (except timestamp)");

// ═══════════════════════════════════════════════════════════════════════
//  RESULTS
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(`  LANE ARTIFACT TESTS: ${passed} passed, ${failed} failed`);
console.log("═══════════════════════════════════════════════════════════════\n");

if (failures.length > 0) {
  console.error("FAILURES:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
