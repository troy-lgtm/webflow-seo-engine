/**
 * Site Fix Queue Tests
 *
 * Proves that:
 *   1. Constants are exported correctly
 *   2. generateItemId produces deterministic, sanitized IDs
 *   3. classifyPathType correctly identifies page types
 *   4. computeImpact returns correct scores for all combinations
 *   5. normalizeOrphans produces correct queue items
 *   6. normalizeLanesMissingAuthority produces correct queue items
 *   7. normalizeAuthorityMissingLanes produces correct queue items with family
 *   8. normalizeDuplicateTitles produces correct queue items
 *   9. normalizeWeakPages produces correct queue items
 *  10. sortByPriority ranks by severity → impact → id deterministically
 *  11. buildFixQueue assembles a complete queue from audit input
 *  12. buildFixQueue handles empty/missing audit gracefully
 *  13. Full pipeline is deterministic (same input → same output)
 *  14. Queue item structure matches spec (all required fields)
 *  15. Severity ordering is correct across issue types
 *  16. Priority scoring combines severity, confidence, and impact
 *  17. Edge cases: null inputs, empty arrays, missing fields
 *
 * Run: node tests/site-fix-queue.test.js
 */

import {
  ISSUE_TYPES,
  SEVERITY,
  ISSUE_SEVERITY_MAP,
  ISSUE_CONFIDENCE_MAP,
  PAGE_TYPE_IMPACT,
  generateItemId,
  classifyPathType,
  computeImpact,
  computePriorityScore,
  normalizeOrphans,
  normalizeLanesMissingAuthority,
  normalizeAuthorityMissingLanes,
  normalizeDuplicateTitles,
  normalizeWeakPages,
  sortByPriority,
  buildFixQueue,
} from "../lib/site-fix-queue.js";

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

function assertDeepEqual(actual, expected, message) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`
  );
}

function assertGte(actual, min, message) {
  assert(actual >= min, `${message} (expected >= ${min}, got ${actual})`);
}

function assertLte(actual, max, message) {
  assert(actual <= max, `${message} (expected <= ${max}, got ${actual})`);
}

function assertIncludes(str, substr, message) {
  assert(String(str).includes(substr), `${message} (expected to include ${JSON.stringify(substr)})`);
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ── Test Data Helpers ───────────────────────────────────────────────

const BASE = "https://www.wearewarp.com";

function makeAuditReport(overrides = {}) {
  return {
    _version: "1.0.0",
    _generated_by: "site-crawl-audit.js",
    crawl: {
      timestamp: "2026-01-01T00:00:00Z",
      base_url: BASE,
      pages_crawled: 10,
      crawl_duration_ms: 100,
    },
    inventory: {
      total: 10,
      lane_pages: 3,
      authority_pages: 5,
      other_pages: 2,
      lane_paths: ["/lanes/a-to-b", "/lanes/c-to-d", "/lanes/e-to-f"],
      authority_paths: ["/solutions/sr", "/network/cd", "/equipment/bt", "/network/mm", "/solutions/zs"],
    },
    link_graph: { total_internal_links: 50, avg_links_per_page: 5 },
    issues: {
      orphan_pages: { count: 0, paths: [] },
      lanes_missing_authority_links: { count: 0, paths: [] },
      authority_missing_lane_links: { count: 0, paths: [] },
      duplicate_titles: { count: 0, groups: [] },
      weak_pages: { count: 0, threshold: 500, pages: [] },
    },
    summary: { total_issues: 0, health: "healthy" },
    ...overrides,
  };
}

const REQUIRED_ITEM_FIELDS = [
  "id", "issue_type", "target_urls", "severity", "confidence",
  "estimated_impact", "suggested_action", "rationale", "evidence", "source",
];

function assertValidQueueItem(item, label) {
  for (const field of REQUIRED_ITEM_FIELDS) {
    assert(field in item, `${label}: has required field "${field}"`);
  }
  assert(typeof item.id === "string" && item.id.length > 0, `${label}: id is non-empty string`);
  assert(Array.isArray(item.target_urls) && item.target_urls.length > 0, `${label}: target_urls is non-empty array`);
  assert(typeof item.severity === "string", `${label}: severity is string`);
  assert(typeof item.confidence === "number" && item.confidence >= 0 && item.confidence <= 1, `${label}: confidence is 0-1`);
  assert(typeof item.estimated_impact === "number" && item.estimated_impact >= 0, `${label}: estimated_impact >= 0`);
  assert(typeof item.suggested_action === "string" && item.suggested_action.length > 0, `${label}: suggested_action non-empty`);
  assert(typeof item.rationale === "string" && item.rationale.length > 0, `${label}: rationale non-empty`);
  assert(typeof item.evidence === "object" && item.evidence !== null, `${label}: evidence is object`);
  assertEqual(item.source, "site-crawl-audit", `${label}: source is site-crawl-audit`);
}

// ══════════════════════════════════════════════════════════════════════
// TEST GROUPS
// ══════════════════════════════════════════════════════════════════════

// ── 1. Constants ────────────────────────────────────────────────────

section("1. Constants");

{
  // Issue types
  assertEqual(ISSUE_TYPES.ORPHAN_PAGE, "orphan_page", "ORPHAN_PAGE type");
  assertEqual(ISSUE_TYPES.LANE_MISSING_AUTHORITY, "lane_missing_authority_links", "LANE_MISSING_AUTHORITY type");
  assertEqual(ISSUE_TYPES.AUTHORITY_MISSING_LANE, "authority_missing_lane_links", "AUTHORITY_MISSING_LANE type");
  assertEqual(ISSUE_TYPES.DUPLICATE_TITLE, "duplicate_title_group", "DUPLICATE_TITLE type");
  assertEqual(ISSUE_TYPES.WEAK_PAGE, "weak_page_candidate", "WEAK_PAGE type");

  // Severity weights
  assertEqual(SEVERITY.CRITICAL.weight, 100, "Critical weight 100");
  assertEqual(SEVERITY.HIGH.weight, 75, "High weight 75");
  assertEqual(SEVERITY.MEDIUM.weight, 50, "Medium weight 50");
  assertEqual(SEVERITY.LOW.weight, 25, "Low weight 25");

  // Severity mapping
  assertEqual(ISSUE_SEVERITY_MAP[ISSUE_TYPES.ORPHAN_PAGE].label, "critical", "Orphan severity is critical");
  assertEqual(ISSUE_SEVERITY_MAP[ISSUE_TYPES.LANE_MISSING_AUTHORITY].label, "high", "Lane missing auth severity is high");
  assertEqual(ISSUE_SEVERITY_MAP[ISSUE_TYPES.AUTHORITY_MISSING_LANE].label, "high", "Auth missing lane severity is high");
  assertEqual(ISSUE_SEVERITY_MAP[ISSUE_TYPES.DUPLICATE_TITLE].label, "medium", "Dup title severity is medium");
  assertEqual(ISSUE_SEVERITY_MAP[ISSUE_TYPES.WEAK_PAGE].label, "medium", "Weak page severity is medium");

  // Confidence
  assertGte(ISSUE_CONFIDENCE_MAP[ISSUE_TYPES.ORPHAN_PAGE], 0.9, "Orphan confidence >= 0.9");
  assertGte(ISSUE_CONFIDENCE_MAP[ISSUE_TYPES.LANE_MISSING_AUTHORITY], 0.8, "Lane missing auth confidence >= 0.8");

  // Page type impact
  assertEqual(PAGE_TYPE_IMPACT.lane, 1.0, "Lane impact multiplier 1.0");
  assertGte(PAGE_TYPE_IMPACT.authority, 0.5, "Authority impact >= 0.5");
  assertLte(PAGE_TYPE_IMPACT.other, 0.5, "Other impact <= 0.5");
}

// ── 2. generateItemId ───────────────────────────────────────────────

section("2. generateItemId");

{
  // Basic
  const id1 = generateItemId("orphan_page", "/lanes/atlanta-to-orlando");
  assertEqual(id1, "orphan_page--lanes-atlanta-to-orlando", "Basic ID generation");

  // Deterministic
  const id2 = generateItemId("orphan_page", "/lanes/atlanta-to-orlando");
  assertEqual(id1, id2, "ID generation is deterministic");

  // Different inputs → different IDs
  const id3 = generateItemId("orphan_page", "/lanes/dallas-to-houston");
  assert(id1 !== id3, "Different targets → different IDs");

  // Different issue types → different IDs
  const id4 = generateItemId("weak_page_candidate", "/lanes/atlanta-to-orlando");
  assert(id1 !== id4, "Different issue types → different IDs");

  // Special characters sanitized
  const id5 = generateItemId("duplicate_title_group", "LTL Freight Atlanta | WARP");
  assertIncludes(id5, "duplicate_title_group--", "Dup title ID has prefix");
  assert(!id5.includes(" "), "No spaces in ID");
  assert(!id5.includes("|"), "No pipes in ID");

  // Lowercase
  const id6 = generateItemId("orphan_page", "/Lanes/ATLANTA");
  assertEqual(id6, "orphan_page--lanes-atlanta", "ID is lowercase");
}

// ── 3. classifyPathType ─────────────────────────────────────────────

section("3. classifyPathType");

{
  assertEqual(classifyPathType("/lanes/a-to-b"), "lane", "Lane path");
  assertEqual(classifyPathType("/solutions/store-replenishment"), "authority", "Solution path");
  assertEqual(classifyPathType("/network/cross-docking"), "authority", "Network path");
  assertEqual(classifyPathType("/equipment/box-truck"), "authority", "Equipment path");
  assertEqual(classifyPathType("/"), "other", "Root path");
  assertEqual(classifyPathType("/quote"), "other", "Quote path");
  assertEqual(classifyPathType("/book"), "other", "Book path");
  assertEqual(classifyPathType("/about"), "other", "About path");
}

// ── 4. computeImpact ────────────────────────────────────────────────

section("4. computeImpact");

{
  // Orphan lane (critical × lane × 1 page)
  const orphanLane = computeImpact(ISSUE_TYPES.ORPHAN_PAGE, "lane", 1);
  assertGte(orphanLane, 90, "Orphan lane impact >= 90");
  assertLte(orphanLane, 100, "Orphan lane impact <= 100");

  // Orphan authority (critical × authority)
  const orphanAuth = computeImpact(ISSUE_TYPES.ORPHAN_PAGE, "authority", 1);
  assert(orphanAuth < orphanLane, "Orphan authority < orphan lane (lower multiplier)");

  // Lane missing authority (high × lane)
  const laneMissing = computeImpact(ISSUE_TYPES.LANE_MISSING_AUTHORITY, "lane", 1);
  assert(laneMissing < orphanLane, "Lane missing < orphan (lower severity)");
  assertGte(laneMissing, 50, "Lane missing impact >= 50");

  // Weak page (medium × lane)
  const weakLane = computeImpact(ISSUE_TYPES.WEAK_PAGE, "lane", 1);
  assert(weakLane < laneMissing, "Weak page < lane missing (lower severity)");

  // Scale factor: more pages = slightly higher impact
  const dup2 = computeImpact(ISSUE_TYPES.DUPLICATE_TITLE, "lane", 2);
  const dup5 = computeImpact(ISSUE_TYPES.DUPLICATE_TITLE, "lane", 5);
  const dup1 = computeImpact(ISSUE_TYPES.DUPLICATE_TITLE, "lane", 1);
  assert(dup2 > dup1, "2 duplicates > 1 duplicate impact");
  assert(dup5 > dup2, "5 duplicates > 2 duplicates impact");

  // Impact always in 0–100 range
  const extreme = computeImpact(ISSUE_TYPES.ORPHAN_PAGE, "lane", 1000);
  assertLte(extreme, 100, "Impact capped at 100");
  assertGte(extreme, 0, "Impact >= 0");

  // Deterministic
  const a = computeImpact(ISSUE_TYPES.ORPHAN_PAGE, "lane", 3);
  const b = computeImpact(ISSUE_TYPES.ORPHAN_PAGE, "lane", 3);
  assertEqual(a, b, "computeImpact is deterministic");
}

// ── 5. normalizeOrphans ─────────────────────────────────────────────

section("5. normalizeOrphans");

{
  const issues = { count: 2, paths: ["/lanes/orphan-lane", "/network/orphan-auth"] };
  const items = normalizeOrphans(issues, BASE);

  assertEqual(items.length, 2, "2 orphan items");

  // Validate first item
  assertValidQueueItem(items[0], "orphan[0]");
  assertEqual(items[0].issue_type, ISSUE_TYPES.ORPHAN_PAGE, "orphan issue type");
  assertEqual(items[0].severity, "critical", "orphan severity is critical");
  assertEqual(items[0].target_urls[0], `${BASE}/lanes/orphan-lane`, "orphan target URL");
  assertGte(items[0].confidence, 0.9, "orphan confidence >= 0.9");
  assertEqual(items[0].evidence.page_type, "lane", "orphan lane page type in evidence");

  // Second item
  assertEqual(items[1].evidence.page_type, "authority", "orphan authority page type in evidence");

  // Empty input
  assertEqual(normalizeOrphans({ count: 0, paths: [] }, BASE).length, 0, "Empty orphans → empty");
  assertEqual(normalizeOrphans(null, BASE).length, 0, "Null orphans → empty");
  assertEqual(normalizeOrphans(undefined, BASE).length, 0, "Undefined orphans → empty");
}

// ── 6. normalizeLanesMissingAuthority ───────────────────────────────

section("6. normalizeLanesMissingAuthority");

{
  const issues = { count: 2, paths: ["/lanes/a-to-b", "/lanes/c-to-d"] };
  const items = normalizeLanesMissingAuthority(issues, BASE);

  assertEqual(items.length, 2, "2 lane missing authority items");
  assertValidQueueItem(items[0], "laneMissing[0]");
  assertEqual(items[0].issue_type, ISSUE_TYPES.LANE_MISSING_AUTHORITY, "lane missing auth type");
  assertEqual(items[0].severity, "high", "lane missing auth severity");
  assertIncludes(items[0].suggested_action, "/lanes/a-to-b", "Action mentions target path");
  assertEqual(items[0].evidence.outbound_authority_links, 0, "Evidence shows 0 outbound auth links");

  // Empty
  assertEqual(normalizeLanesMissingAuthority(null, BASE).length, 0, "Null → empty");
}

// ── 7. normalizeAuthorityMissingLanes ───────────────────────────────

section("7. normalizeAuthorityMissingLanes");

{
  const issues = {
    count: 3,
    paths: ["/solutions/sr", "/network/cd", "/equipment/bt"],
  };
  const items = normalizeAuthorityMissingLanes(issues, BASE);

  assertEqual(items.length, 3, "3 authority missing lane items");

  // Family classification in evidence
  assertEqual(items[0].evidence.family, "solution", "Solution family");
  assertEqual(items[1].evidence.family, "concept", "Concept family");
  assertEqual(items[2].evidence.family, "equipment", "Equipment family");

  // All valid
  for (let i = 0; i < items.length; i++) {
    assertValidQueueItem(items[i], `authMissing[${i}]`);
    assertEqual(items[i].issue_type, ISSUE_TYPES.AUTHORITY_MISSING_LANE, `authMissing[${i}] type`);
    assertEqual(items[i].severity, "high", `authMissing[${i}] severity`);
  }

  // Empty
  assertEqual(normalizeAuthorityMissingLanes(null, BASE).length, 0, "Null → empty");
}

// ── 8. normalizeDuplicateTitles ─────────────────────────────────────

section("8. normalizeDuplicateTitles");

{
  const issues = {
    count: 2,
    groups: [
      { title: "Dup Title A", paths: ["/lanes/a-to-b", "/lanes/c-to-d"] },
      { title: "Dup Title B", paths: ["/lanes/e-to-f", "/lanes/g-to-h", "/lanes/i-to-j"] },
    ],
  };
  const items = normalizeDuplicateTitles(issues, BASE);

  assertEqual(items.length, 2, "2 duplicate title items");
  assertValidQueueItem(items[0], "dup[0]");
  assertEqual(items[0].issue_type, ISSUE_TYPES.DUPLICATE_TITLE, "dup title type");
  assertEqual(items[0].severity, "medium", "dup title severity");
  assertEqual(items[0].target_urls.length, 2, "dup[0] has 2 target URLs");
  assertEqual(items[1].target_urls.length, 3, "dup[1] has 3 target URLs");
  assertEqual(items[0].evidence.duplicate_count, 2, "dup[0] evidence count 2");
  assertEqual(items[1].evidence.duplicate_count, 3, "dup[1] evidence count 3");
  assertIncludes(items[0].evidence.title, "Dup Title A", "dup[0] title in evidence");

  // Impact: more duplicates = higher impact
  assert(items[1].estimated_impact >= items[0].estimated_impact, "More duplicates → higher impact");

  // Empty
  assertEqual(normalizeDuplicateTitles(null, BASE).length, 0, "Null → empty");
  assertEqual(normalizeDuplicateTitles({ count: 0, groups: [] }, BASE).length, 0, "Empty groups → empty");
}

// ── 9. normalizeWeakPages ───────────────────────────────────────────

section("9. normalizeWeakPages");

{
  const issues = {
    count: 2,
    threshold: 500,
    pages: [
      { path: "/lanes/weak-lane", type: "lane", contentLength: 200 },
      { path: "/network/weak-auth", type: "authority", contentLength: 100 },
    ],
  };
  const items = normalizeWeakPages(issues, BASE);

  assertEqual(items.length, 2, "2 weak page items");
  assertValidQueueItem(items[0], "weak[0]");
  assertEqual(items[0].issue_type, ISSUE_TYPES.WEAK_PAGE, "weak page type");
  assertEqual(items[0].severity, "medium", "weak page severity");
  assertEqual(items[0].evidence.content_length, 200, "weak[0] content length in evidence");
  assertEqual(items[0].evidence.threshold, 500, "weak[0] threshold in evidence");
  assertIncludes(items[0].suggested_action, "200", "Action mentions actual content length");
  assertIncludes(items[0].suggested_action, "500", "Action mentions threshold");

  // Empty
  assertEqual(normalizeWeakPages(null, BASE).length, 0, "Null → empty");
}

// ── 10. sortByPriority: Basic Ordering ──────────────────────────────

section("10. sortByPriority: Basic Ordering");

{
  // Create items with different severities
  const items = [
    ...normalizeWeakPages({
      count: 1, threshold: 500,
      pages: [{ path: "/lanes/weak", type: "lane", contentLength: 100 }],
    }, BASE),
    ...normalizeOrphans({ count: 1, paths: ["/lanes/orphan"] }, BASE),
    ...normalizeLanesMissingAuthority({ count: 1, paths: ["/lanes/no-auth"] }, BASE),
  ];

  const sorted = sortByPriority(items);

  assertEqual(sorted.length, 3, "3 sorted items");

  // Orphan (critical) should be first
  assertEqual(sorted[0].issue_type, ISSUE_TYPES.ORPHAN_PAGE, "Critical orphan ranked first");
  assertEqual(sorted[0].priority_rank, 1, "Orphan is rank 1");

  // Lane missing auth (high) should be second
  assertEqual(sorted[1].issue_type, ISSUE_TYPES.LANE_MISSING_AUTHORITY, "High severity ranked second");
  assertEqual(sorted[1].priority_rank, 2, "Lane missing is rank 2");

  // Weak page (medium) should be last
  assertEqual(sorted[2].issue_type, ISSUE_TYPES.WEAK_PAGE, "Medium severity ranked last");
  assertEqual(sorted[2].priority_rank, 3, "Weak page is rank 3");

  // All have priority_rank
  for (const item of sorted) {
    assert("priority_rank" in item, `Item has priority_rank`);
    assert(typeof item.priority_rank === "number", "priority_rank is number");
  }
}

// ── 11. sortByPriority: Deterministic Tiebreaker ────────────────────

section("11. sortByPriority: Deterministic Tiebreaker");

{
  // Two items with same severity (both high)
  const items = [
    ...normalizeAuthorityMissingLanes({ count: 1, paths: ["/network/z-auth"] }, BASE),
    ...normalizeAuthorityMissingLanes({ count: 1, paths: ["/network/a-auth"] }, BASE),
  ];

  const sorted1 = sortByPriority(items);
  const sorted2 = sortByPriority(items);

  // Same order both times
  assertEqual(sorted1[0].id, sorted2[0].id, "Tiebreaker: first item same across runs");
  assertEqual(sorted1[1].id, sorted2[1].id, "Tiebreaker: second item same across runs");

  // IDs sorted alphabetically when severity/impact match
  assert(sorted1[0].id < sorted1[1].id, "Alphabetical tiebreaker: a-auth before z-auth");
}

// ── 12. sortByPriority: Empty Input ─────────────────────────────────

section("12. sortByPriority: Empty Input");

{
  const sorted = sortByPriority([]);
  assertEqual(sorted.length, 0, "Empty input → empty output");
}

// ── 13. computePriorityScore ────────────────────────────────────────

section("13. computePriorityScore");

{
  const orphan = normalizeOrphans({ count: 1, paths: ["/lanes/x"] }, BASE)[0];
  const laneMissing = normalizeLanesMissingAuthority({ count: 1, paths: ["/lanes/y"] }, BASE)[0];
  const weak = normalizeWeakPages({ count: 1, threshold: 500, pages: [{ path: "/lanes/z", type: "lane", contentLength: 100 }] }, BASE)[0];

  const orphanScore = computePriorityScore(orphan);
  const laneScore = computePriorityScore(laneMissing);
  const weakScore = computePriorityScore(weak);

  assert(orphanScore > laneScore, "Orphan priority > lane missing priority");
  assert(laneScore > weakScore, "Lane missing priority > weak page priority");
  assert(orphanScore > 0, "Priority score > 0");
}

// ── 14. buildFixQueue: Full Pipeline ────────────────────────────────

section("14. buildFixQueue: Full Pipeline");

{
  const audit = makeAuditReport({
    issues: {
      orphan_pages: { count: 1, paths: ["/lanes/orphan"] },
      lanes_missing_authority_links: { count: 2, paths: ["/lanes/a-to-b", "/lanes/c-to-d"] },
      authority_missing_lane_links: { count: 1, paths: ["/solutions/sr"] },
      duplicate_titles: { count: 1, groups: [{ title: "Dup", paths: ["/lanes/x", "/lanes/y"] }] },
      weak_pages: { count: 1, threshold: 500, pages: [{ path: "/lanes/thin", type: "lane", contentLength: 100 }] },
    },
    summary: { total_issues: 6, health: "critical" },
  });

  const queue = buildFixQueue(audit);

  // Top-level structure
  assertEqual(queue._version, "1.0.0", "Queue version");
  assertEqual(queue._generated_by, "build-site-fix-queue.js", "Generated by");

  // Metadata
  assertEqual(queue.metadata.source_audit, "2026-01-01T00:00:00Z", "Source audit timestamp");
  assertEqual(queue.metadata.base_url, BASE, "Base URL");
  assertEqual(queue.metadata.audit_health, "critical", "Audit health");

  // Summary
  assertEqual(queue.summary.total_queue_items, 6, "6 total queue items");
  assertEqual(queue.summary.by_severity.critical, 1, "1 critical item");
  assertEqual(queue.summary.by_severity.high, 3, "3 high items");
  assertEqual(queue.summary.by_severity.medium, 2, "2 medium items");

  // Queue items
  assertEqual(queue.queue.length, 6, "6 items in queue");

  // First item should be the orphan (critical severity)
  assertEqual(queue.queue[0].issue_type, ISSUE_TYPES.ORPHAN_PAGE, "First item is orphan");
  assertEqual(queue.queue[0].priority_rank, 1, "Orphan is rank 1");

  // All items valid
  for (let i = 0; i < queue.queue.length; i++) {
    assertValidQueueItem(queue.queue[i], `queue[${i}]`);
    assertEqual(queue.queue[i].priority_rank, i + 1, `queue[${i}] rank is ${i + 1}`);
  }

  // Type counts
  assertEqual(queue.summary.by_type[ISSUE_TYPES.ORPHAN_PAGE], 1, "1 orphan in type counts");
  assertEqual(queue.summary.by_type[ISSUE_TYPES.LANE_MISSING_AUTHORITY], 2, "2 lane missing in type counts");
}

// ── 15. buildFixQueue: Empty Audit ──────────────────────────────────

section("15. buildFixQueue: Empty Audit");

{
  const audit = makeAuditReport();  // No issues
  const queue = buildFixQueue(audit);

  assertEqual(queue.summary.total_queue_items, 0, "No issues → empty queue");
  assertEqual(queue.queue.length, 0, "Empty queue array");
  assertEqual(queue.summary.by_severity.critical, 0, "0 critical");
  assertEqual(queue.summary.by_severity.high, 0, "0 high");
}

// ── 16. buildFixQueue: Null/Missing Input ───────────────────────────

section("16. buildFixQueue: Null/Missing Input");

{
  const q1 = buildFixQueue(null);
  assertEqual(q1.summary.total_queue_items, 0, "Null audit → empty queue");
  assertEqual(q1._version, "1.0.0", "Null audit still has version");

  const q2 = buildFixQueue({});
  assertEqual(q2.summary.total_queue_items, 0, "Empty obj → empty queue");

  const q3 = buildFixQueue({ issues: null });
  assertEqual(q3.summary.total_queue_items, 0, "Null issues → empty queue");
}

// ── 17. buildFixQueue: Determinism ──────────────────────────────────

section("17. buildFixQueue: Determinism");

{
  const audit = makeAuditReport({
    issues: {
      orphan_pages: { count: 2, paths: ["/lanes/z-orphan", "/lanes/a-orphan"] },
      lanes_missing_authority_links: { count: 2, paths: ["/lanes/z-lane", "/lanes/a-lane"] },
      authority_missing_lane_links: { count: 3, paths: ["/solutions/z-sol", "/network/a-net", "/equipment/m-eq"] },
      duplicate_titles: { count: 1, groups: [{ title: "Dup", paths: ["/lanes/x", "/lanes/y", "/lanes/z"] }] },
      weak_pages: { count: 2, threshold: 500, pages: [
        { path: "/lanes/z-weak", type: "lane", contentLength: 100 },
        { path: "/lanes/a-weak", type: "lane", contentLength: 200 },
      ]},
    },
    summary: { total_issues: 10, health: "critical" },
  });

  const q1 = buildFixQueue(audit);
  const q2 = buildFixQueue(audit);

  assertEqual(JSON.stringify(q1), JSON.stringify(q2), "Full queue deterministic across runs");

  // Check individual item IDs match
  for (let i = 0; i < q1.queue.length; i++) {
    assertEqual(q1.queue[i].id, q2.queue[i].id, `Item ${i} ID deterministic`);
    assertEqual(q1.queue[i].priority_rank, q2.queue[i].priority_rank, `Item ${i} rank deterministic`);
  }
}

// ── 18. Severity Ordering Across Types ──────────────────────────────

section("18. Severity Ordering Across Types");

{
  const audit = makeAuditReport({
    issues: {
      orphan_pages: { count: 1, paths: ["/lanes/orphan"] },
      lanes_missing_authority_links: { count: 1, paths: ["/lanes/no-auth"] },
      authority_missing_lane_links: { count: 1, paths: ["/solutions/no-lane"] },
      duplicate_titles: { count: 1, groups: [{ title: "Dup", paths: ["/lanes/a", "/lanes/b"] }] },
      weak_pages: { count: 1, threshold: 500, pages: [{ path: "/lanes/weak", type: "lane", contentLength: 100 }] },
    },
    summary: { total_issues: 5, health: "critical" },
  });

  const queue = buildFixQueue(audit);
  const items = queue.queue;

  // First: critical (orphan)
  assertEqual(items[0].severity, "critical", "Rank 1 is critical");

  // Then: high (lane missing auth, authority missing lane)
  const highItems = items.filter(i => i.severity === "high");
  const mediumItems = items.filter(i => i.severity === "medium");

  assert(highItems.length > 0, "At least 1 high severity item");
  assert(mediumItems.length > 0, "At least 1 medium severity item");

  // All high items come before medium items
  const lastHighRank = Math.max(...highItems.map(i => i.priority_rank));
  const firstMediumRank = Math.min(...mediumItems.map(i => i.priority_rank));
  assert(lastHighRank < firstMediumRank, "All high-severity items ranked before medium");
}

// ── 19. Queue Item IDs Unique ───────────────────────────────────────

section("19. Queue Item IDs Unique");

{
  const audit = makeAuditReport({
    issues: {
      orphan_pages: { count: 2, paths: ["/lanes/a-to-b", "/lanes/c-to-d"] },
      lanes_missing_authority_links: { count: 2, paths: ["/lanes/a-to-b", "/lanes/e-to-f"] },
      authority_missing_lane_links: { count: 2, paths: ["/solutions/sr", "/network/cd"] },
      duplicate_titles: { count: 1, groups: [{ title: "T", paths: ["/lanes/x", "/lanes/y"] }] },
      weak_pages: { count: 1, threshold: 500, pages: [{ path: "/lanes/w", type: "lane", contentLength: 50 }] },
    },
    summary: { total_issues: 8, health: "critical" },
  });

  const queue = buildFixQueue(audit);
  const ids = queue.queue.map(i => i.id);
  const uniqueIds = new Set(ids);

  assertEqual(uniqueIds.size, ids.length, "All queue item IDs are unique");
}

// ── 20. Integration: Real Audit Artifact Shape ──────────────────────

section("20. Integration: Real Audit Artifact Shape");

{
  // Use the exact structure from the actual site-crawl-audit.json
  const realAudit = {
    _version: "1.0.0",
    _generated_by: "site-crawl-audit.js",
    crawl: {
      timestamp: "2026-03-11T10:54:12.493Z",
      base_url: "https://www.wearewarp.com",
      pages_crawled: 15,
      crawl_duration_ms: 3,
    },
    inventory: {
      total: 15,
      lane_pages: 1,
      authority_pages: 13,
      other_pages: 1,
      lane_paths: ["/lanes/chicago-to-dallas"],
      authority_paths: [
        "/equipment/53-foot-trailer", "/equipment/box-truck", "/equipment/cargo-van",
        "/network/cross-docking", "/network/flexible-routing", "/network/middle-mile",
        "/network/predictable-pricing", "/network/right-sized-assets", "/network/scan-level-visibility",
        "/solutions/pool-distribution", "/solutions/store-replenishment",
        "/solutions/vendor-consolidation", "/solutions/zone-skipping",
      ],
    },
    link_graph: { total_internal_links: 231, avg_links_per_page: 15.4 },
    issues: {
      orphan_pages: { count: 0, paths: [] },
      lanes_missing_authority_links: { count: 1, paths: ["/lanes/chicago-to-dallas"] },
      authority_missing_lane_links: {
        count: 13,
        paths: [
          "/equipment/53-foot-trailer", "/equipment/box-truck", "/equipment/cargo-van",
          "/network/cross-docking", "/network/flexible-routing", "/network/middle-mile",
          "/network/predictable-pricing", "/network/right-sized-assets", "/network/scan-level-visibility",
          "/solutions/pool-distribution", "/solutions/store-replenishment",
          "/solutions/vendor-consolidation", "/solutions/zone-skipping",
        ],
      },
      duplicate_titles: { count: 0, groups: [] },
      weak_pages: { count: 0, threshold: 500, pages: [] },
    },
    summary: { total_issues: 14, health: "critical" },
  };

  const queue = buildFixQueue(realAudit);

  assertEqual(queue.summary.total_queue_items, 14, "Real audit: 14 queue items");
  assertEqual(queue.summary.by_severity.high, 14, "Real audit: all 14 are high severity");
  assertEqual(queue.summary.by_type[ISSUE_TYPES.LANE_MISSING_AUTHORITY], 1, "Real audit: 1 lane missing auth");
  assertEqual(queue.summary.by_type[ISSUE_TYPES.AUTHORITY_MISSING_LANE], 13, "Real audit: 13 authority missing lanes");
  assertEqual(queue.metadata.pages_audited, 15, "Real audit: 15 pages audited");

  // All items valid
  for (const item of queue.queue) {
    assertValidQueueItem(item, `real-${item.id}`);
  }

  // All target URLs are absolute
  for (const item of queue.queue) {
    for (const url of item.target_urls) {
      assert(url.startsWith("https://"), `URL is absolute: ${url}`);
    }
  }
}

// ── 21. Impact: Lane vs Authority vs Other ──────────────────────────

section("21. Impact: Lane vs Authority vs Other");

{
  const laneImpact = computeImpact(ISSUE_TYPES.ORPHAN_PAGE, "lane", 1);
  const authImpact = computeImpact(ISSUE_TYPES.ORPHAN_PAGE, "authority", 1);
  const otherImpact = computeImpact(ISSUE_TYPES.ORPHAN_PAGE, "other", 1);

  assert(laneImpact > authImpact, "Lane impact > authority impact (same issue)");
  assert(authImpact > otherImpact, "Authority impact > other impact (same issue)");
}

// ── 22. Duplicate Title: Multi-page Impact Scaling ──────────────────

section("22. Duplicate Title: Multi-page Impact Scaling");

{
  const dup2 = normalizeDuplicateTitles({
    count: 1, groups: [{ title: "T", paths: ["/lanes/a", "/lanes/b"] }],
  }, BASE);
  const dup10 = normalizeDuplicateTitles({
    count: 1, groups: [{ title: "T", paths: ["/lanes/a", "/lanes/b", "/lanes/c", "/lanes/d", "/lanes/e", "/lanes/f", "/lanes/g", "/lanes/h", "/lanes/i", "/lanes/j"] }],
  }, BASE);

  assert(dup10[0].estimated_impact > dup2[0].estimated_impact, "10-page dup > 2-page dup impact");
}

// ── 23. Authority Family Detection ──────────────────────────────────

section("23. Authority Family Detection");

{
  const items = normalizeAuthorityMissingLanes({
    count: 4,
    paths: ["/solutions/x", "/network/y", "/equipment/z", "/other/w"],
  }, BASE);

  assertEqual(items[0].evidence.family, "solution", "solutions/ → solution family");
  assertEqual(items[1].evidence.family, "concept", "network/ → concept family");
  assertEqual(items[2].evidence.family, "equipment", "equipment/ → equipment family");
  assertEqual(items[3].evidence.family, "unknown", "other/ → unknown family");
}

// ── 24. Queue Artifact Shape ────────────────────────────────────────

section("24. Queue Artifact Shape");

{
  const audit = makeAuditReport({
    issues: {
      orphan_pages: { count: 1, paths: ["/lanes/x"] },
      lanes_missing_authority_links: { count: 0, paths: [] },
      authority_missing_lane_links: { count: 0, paths: [] },
      duplicate_titles: { count: 0, groups: [] },
      weak_pages: { count: 0, threshold: 500, pages: [] },
    },
    summary: { total_issues: 1, health: "warning" },
  });

  const queue = buildFixQueue(audit);

  // Required top-level keys
  assert("_version" in queue, "Has _version");
  assert("_generated_by" in queue, "Has _generated_by");
  assert("metadata" in queue, "Has metadata");
  assert("summary" in queue, "Has summary");
  assert("queue" in queue, "Has queue");

  // Metadata keys
  assert("source_audit" in queue.metadata, "metadata has source_audit");
  assert("base_url" in queue.metadata, "metadata has base_url");
  assert("pages_audited" in queue.metadata, "metadata has pages_audited");
  assert("audit_health" in queue.metadata, "metadata has audit_health");

  // Summary keys
  assert("total_queue_items" in queue.summary, "summary has total_queue_items");
  assert("by_severity" in queue.summary, "summary has by_severity");
  assert("by_type" in queue.summary, "summary has by_type");

  // Severity counts include all levels
  assert("critical" in queue.summary.by_severity, "by_severity has critical");
  assert("high" in queue.summary.by_severity, "by_severity has high");
  assert("medium" in queue.summary.by_severity, "by_severity has medium");
  assert("low" in queue.summary.by_severity, "by_severity has low");
}

// ── 25. Large Queue Determinism ─────────────────────────────────────

section("25. Large Queue Determinism");

{
  // Build a large audit with many issues
  const paths = [];
  for (let i = 0; i < 20; i++) paths.push(`/lanes/lane-${String(i).padStart(3, "0")}`);
  const authPaths = [];
  for (let i = 0; i < 10; i++) authPaths.push(`/network/concept-${String(i).padStart(3, "0")}`);

  const audit = makeAuditReport({
    issues: {
      orphan_pages: { count: 5, paths: paths.slice(0, 5) },
      lanes_missing_authority_links: { count: 10, paths: paths.slice(5, 15) },
      authority_missing_lane_links: { count: 10, paths: authPaths },
      duplicate_titles: { count: 2, groups: [
        { title: "Dup A", paths: paths.slice(15, 18) },
        { title: "Dup B", paths: paths.slice(18, 20) },
      ]},
      weak_pages: { count: 3, threshold: 500, pages: [
        { path: "/lanes/weak-1", type: "lane", contentLength: 100 },
        { path: "/lanes/weak-2", type: "lane", contentLength: 200 },
        { path: "/network/weak-3", type: "authority", contentLength: 50 },
      ]},
    },
    summary: { total_issues: 30, health: "critical" },
  });

  const q1 = buildFixQueue(audit);
  const q2 = buildFixQueue(audit);

  assertEqual(q1.summary.total_queue_items, 30, "Large queue: 30 items");
  assertEqual(JSON.stringify(q1), JSON.stringify(q2), "Large queue: deterministic");

  // Verify ranking is monotonic
  for (let i = 0; i < q1.queue.length - 1; i++) {
    assert(q1.queue[i].priority_rank < q1.queue[i + 1].priority_rank, `Rank ${i} < rank ${i+1}`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// RESULTS
// ══════════════════════════════════════════════════════════════════════

console.log("\n══════════════════════════════════════════════════════════");
console.log(`  Site Fix Queue: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════════════════════");

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  ✗ ${f}`);
  }
  process.exit(1);
}
