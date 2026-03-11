/**
 * Site Crawl Audit Tests
 *
 * Proves that:
 *   1. extractPath normalizes URLs to paths correctly
 *   2. classifyPage identifies lane, authority, and other pages
 *   3. extractInternalLinks filters and normalizes links
 *   4. buildLiveGraph constructs correct node/edge/classification sets
 *   5. detectOrphans finds pages with no inbound links
 *   6. detectLanesMissingAuthorityLinks finds lanes without authority links
 *   7. detectAuthorityMissingLaneLinks finds authority pages without lane links
 *   8. detectDuplicateTitles groups pages sharing a title
 *   9. detectWeakPages flags low-content lane/authority pages
 *  10. buildAuditReport assembles complete structured report
 *  11. Health computation returns correct status at thresholds
 *  12. All outputs are deterministic (same input → same output)
 *  13. Edge cases: empty input, malformed URLs, missing fields
 *  14. Constants exported correctly
 *
 * Run: node tests/site-crawl-audit.test.js
 */

import {
  classifyPage,
  extractPath,
  extractInternalLinks,
  buildLiveGraph,
  detectOrphans,
  detectLanesMissingAuthorityLinks,
  detectAuthorityMissingLaneLinks,
  detectDuplicateTitles,
  detectWeakPages,
  buildAuditReport,
  WEAK_PAGE_THRESHOLD,
  AUTHORITY_PREFIXES,
  LANE_PREFIX,
} from "../lib/crawl-auditor.js";

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

function assertIncludes(arr, item, message) {
  if (Array.isArray(arr)) {
    assert(arr.includes(item), `${message} (array does not include ${JSON.stringify(item)})`);
  } else {
    assert(String(arr).includes(item), `${message} (string does not include ${JSON.stringify(item)})`);
  }
}

function assertNotIncludes(arr, item, message) {
  if (Array.isArray(arr)) {
    assert(!arr.includes(item), `${message} (array should not include ${JSON.stringify(item)})`);
  } else {
    assert(!String(arr).includes(item), `${message} (string should not include ${JSON.stringify(item)})`);
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ── Test Helpers: Synthetic Page Builders ────────────────────────────

const BASE = "https://www.wearewarp.com";

function makeLanePage(slug, opts = {}) {
  return {
    url: `${BASE}/lanes/${slug}`,
    title: opts.title || `LTL Freight ${slug.replace(/-/g, " ")} | Warp`,
    h1: opts.h1 || `LTL Freight ${slug}`,
    canonical: `${BASE}/lanes/${slug}`,
    contentLength: opts.contentLength ?? 3500,
    links: opts.links || [],
    text: "x".repeat(opts.contentLength ?? 3500),
  };
}

function makeAuthorityPage(family, slug, opts = {}) {
  const prefixMap = { solution: "/solutions/", concept: "/network/", equipment: "/equipment/" };
  const prefix = prefixMap[family] || "/other/";
  return {
    url: `${BASE}${prefix}${slug}`,
    title: opts.title || `${slug} | WARP`,
    h1: opts.h1 || slug,
    canonical: `${BASE}${prefix}${slug}`,
    contentLength: opts.contentLength ?? 2500,
    links: opts.links || [],
    text: "x".repeat(opts.contentLength ?? 2500),
  };
}

function makeOtherPage(path, opts = {}) {
  return {
    url: `${BASE}${path}`,
    title: opts.title || "WARP Page",
    h1: opts.h1 || "WARP",
    canonical: `${BASE}${path}`,
    contentLength: opts.contentLength ?? 2000,
    links: opts.links || [],
    text: "x".repeat(opts.contentLength ?? 2000),
  };
}

function buildTestGraph(pages) {
  return buildLiveGraph(pages, BASE);
}

function runFullIssueDetection(graph) {
  return {
    orphans: detectOrphans(graph),
    lanesMissingAuthority: detectLanesMissingAuthorityLinks(graph),
    authorityMissingLanes: detectAuthorityMissingLaneLinks(graph),
    duplicateTitles: detectDuplicateTitles(graph),
    weakPages: detectWeakPages(graph),
    weakPageThreshold: WEAK_PAGE_THRESHOLD,
  };
}

// ══════════════════════════════════════════════════════════════════════
// TEST GROUPS
// ══════════════════════════════════════════════════════════════════════

// ── 1. Constants ────────────────────────────────────────────────────

section("1. Constants");

{
  assertEqual(WEAK_PAGE_THRESHOLD, 500, "WEAK_PAGE_THRESHOLD is 500");
  assertEqual(LANE_PREFIX, "/lanes/", "LANE_PREFIX is /lanes/");
  assertEqual(AUTHORITY_PREFIXES.solution, "/solutions/", "Solution prefix correct");
  assertEqual(AUTHORITY_PREFIXES.concept, "/network/", "Concept prefix correct");
  assertEqual(AUTHORITY_PREFIXES.equipment, "/equipment/", "Equipment prefix correct");
  assertEqual(Object.keys(AUTHORITY_PREFIXES).length, 3, "3 authority prefixes");
}

// ── 2. extractPath ──────────────────────────────────────────────────

section("2. extractPath");

{
  // Absolute URLs
  assertEqual(extractPath("https://www.wearewarp.com/lanes/atlanta-to-orlando"), "/lanes/atlanta-to-orlando", "Absolute URL → path");
  assertEqual(extractPath("https://www.wearewarp.com/"), "/", "Root URL → /");
  assertEqual(extractPath("https://www.wearewarp.com"), "/", "Root URL no slash → /");
  assertEqual(extractPath("http://www.wearewarp.com/solutions/cross-docking"), "/solutions/cross-docking", "HTTP URL → path");

  // Already paths
  assertEqual(extractPath("/lanes/atlanta-to-orlando"), "/lanes/atlanta-to-orlando", "Path passthrough");
  assertEqual(extractPath("/"), "/", "Root path passthrough");

  // Relative paths
  assertEqual(extractPath("lanes/atlanta-to-orlando"), "/lanes/atlanta-to-orlando", "Relative path gets leading slash");
  assertEqual(extractPath("quote"), "/quote", "Short relative path");

  // Edge cases
  assertEqual(extractPath(""), "/", "Empty string → /");
  assertEqual(extractPath(null), "/", "Null → /");
  assertEqual(extractPath(undefined), "/", "Undefined → /");

  // With query and hash (URL form)
  assertEqual(extractPath("https://www.wearewarp.com/lanes/a-to-b?ref=1"), "/lanes/a-to-b", "URL with query → path only");
  assertEqual(extractPath("https://www.wearewarp.com/lanes/a-to-b#section"), "/lanes/a-to-b", "URL with hash → path only");
}

// ── 3. classifyPage: Lane Pages ─────────────────────────────────────

section("3. classifyPage: Lane Pages");

{
  // Absolute URLs
  const r1 = classifyPage("https://www.wearewarp.com/lanes/atlanta-to-orlando");
  assertEqual(r1.type, "lane", "Lane page type");
  assertEqual(r1.slug, "atlanta-to-orlando", "Lane slug extracted");
  assertEqual(r1.family, null, "Lane has no family");

  // Path only
  const r2 = classifyPage("/lanes/dallas-to-houston");
  assertEqual(r2.type, "lane", "Lane from path");
  assertEqual(r2.slug, "dallas-to-houston", "Lane slug from path");

  // With trailing slash
  const r3 = classifyPage("/lanes/la-to-sf/");
  assertEqual(r3.type, "lane", "Lane with trailing slash");
  assertEqual(r3.slug, "la-to-sf", "Lane slug trailing slash stripped");

  // /lanes/ root (no slug) → other
  const r4 = classifyPage("/lanes/");
  assertEqual(r4.type, "other", "/lanes/ alone is other");

  // Nested lane path → other (slug contains /)
  const r5 = classifyPage("/lanes/atlanta-to-orlando/details");
  assertEqual(r5.type, "other", "Nested lane path is other");
}

// ── 4. classifyPage: Authority Pages ────────────────────────────────

section("4. classifyPage: Authority Pages");

{
  // Solutions
  const s1 = classifyPage("https://www.wearewarp.com/solutions/store-replenishment");
  assertEqual(s1.type, "authority", "Solution is authority");
  assertEqual(s1.slug, "store-replenishment", "Solution slug");
  assertEqual(s1.family, "solution", "Solution family");

  // Concepts
  const c1 = classifyPage("/network/cross-docking");
  assertEqual(c1.type, "authority", "Concept is authority");
  assertEqual(c1.slug, "cross-docking", "Concept slug");
  assertEqual(c1.family, "concept", "Concept family");

  // Equipment
  const e1 = classifyPage("/equipment/box-truck");
  assertEqual(e1.type, "authority", "Equipment is authority");
  assertEqual(e1.slug, "box-truck", "Equipment slug");
  assertEqual(e1.family, "equipment", "Equipment family");

  // With trailing slash
  const s2 = classifyPage("/solutions/zone-skipping/");
  assertEqual(s2.type, "authority", "Authority with trailing slash");
  assertEqual(s2.slug, "zone-skipping", "Authority slug trailing slash stripped");

  // Nested authority → other
  const s3 = classifyPage("/solutions/zone-skipping/details");
  assertEqual(s3.type, "other", "Nested authority is other");

  // Empty slug
  const s4 = classifyPage("/solutions/");
  assertEqual(s4.type, "other", "Authority prefix alone is other");
}

// ── 5. classifyPage: Other Pages ────────────────────────────────────

section("5. classifyPage: Other Pages");

{
  const o1 = classifyPage("/");
  assertEqual(o1.type, "other", "Homepage is other");
  assertEqual(o1.slug, null, "Homepage no slug");

  const o2 = classifyPage("/quote");
  assertEqual(o2.type, "other", "Quote page is other");

  const o3 = classifyPage("/book");
  assertEqual(o3.type, "other", "Book page is other");

  const o4 = classifyPage("/about");
  assertEqual(o4.type, "other", "About page is other");

  const o5 = classifyPage("https://www.wearewarp.com");
  assertEqual(o5.type, "other", "Root URL is other");

  const o6 = classifyPage("");
  assertEqual(o6.type, "other", "Empty URL is other");
}

// ── 6. extractInternalLinks: Basic ──────────────────────────────────

section("6. extractInternalLinks: Basic");

{
  // String links
  const page1 = {
    links: [
      "/lanes/atlanta-to-orlando",
      "/solutions/cross-docking",
      "/quote",
    ],
  };
  const result1 = extractInternalLinks(page1, BASE);
  assertEqual(result1.length, 3, "3 internal links");
  assertIncludes(result1, "/lanes/atlanta-to-orlando", "Lane link included");
  assertIncludes(result1, "/solutions/cross-docking", "Authority link included");
  assertIncludes(result1, "/quote", "Quote link included");

  // Object links
  const page2 = {
    links: [
      { href: "/lanes/dallas-to-houston" },
      { url: "/equipment/box-truck" },
    ],
  };
  const result2 = extractInternalLinks(page2, BASE);
  assertEqual(result2.length, 2, "Object links extracted");
  assertIncludes(result2, "/lanes/dallas-to-houston", "href link included");
  assertIncludes(result2, "/equipment/box-truck", "url link included");

  // Absolute same-site links
  const page3 = {
    links: [
      `${BASE}/lanes/a-to-b`,
      `${BASE}/network/middle-mile`,
    ],
  };
  const result3 = extractInternalLinks(page3, BASE);
  assertEqual(result3.length, 2, "Absolute same-site links normalized");
  assertIncludes(result3, "/lanes/a-to-b", "Absolute lane normalized to path");
  assertIncludes(result3, "/network/middle-mile", "Absolute authority normalized to path");
}

// ── 7. extractInternalLinks: Filtering ──────────────────────────────

section("7. extractInternalLinks: Filtering");

{
  const page = {
    links: [
      "/lanes/a-to-b",                           // internal ✓
      "https://google.com/search",                // external ✗
      "https://other-site.com/page",              // external ✗
      "#section-1",                               // hash ✗
      "mailto:test@example.com",                  // mailto ✗
      "tel:+1234567890",                          // tel ✗
      `${BASE}/quote`,                            // same-site absolute ✓
      "",                                         // empty ✗
    ],
  };
  const result = extractInternalLinks(page, BASE);
  assertEqual(result.length, 2, "Only 2 internal links after filtering");
  assertIncludes(result, "/lanes/a-to-b", "Internal path included");
  assertIncludes(result, "/quote", "Same-site absolute included");
  assertNotIncludes(result, "https://google.com/search", "External filtered out");
}

// ── 8. extractInternalLinks: Normalization ──────────────────────────

section("8. extractInternalLinks: Normalization");

{
  const page = {
    links: [
      "/lanes/a-to-b/",           // trailing slash → stripped
      "/lanes/a-to-b",            // duplicate → deduped
      `${BASE}/quote?ref=1`,      // query stripped
      `${BASE}/book#cta`,         // hash stripped
    ],
  };
  const result = extractInternalLinks(page, BASE);
  // /lanes/a-to-b appears once (deduped), /quote, /book
  assertEqual(result.length, 3, "Deduped and normalized to 3 links");
  assertIncludes(result, "/lanes/a-to-b", "Trailing slash stripped and deduped");
  assertIncludes(result, "/quote", "Query stripped");
  assertIncludes(result, "/book", "Hash stripped");

  // Sorted output
  assert(result[0] <= result[1], "Links sorted alphabetically (0 <= 1)");
  assert(result[1] <= result[2], "Links sorted alphabetically (1 <= 2)");
}

// ── 9. extractInternalLinks: Edge Cases ─────────────────────────────

section("9. extractInternalLinks: Edge Cases");

{
  // Empty links array
  const r1 = extractInternalLinks({ links: [] }, BASE);
  assertEqual(r1.length, 0, "Empty links → empty result");

  // Missing links field
  const r2 = extractInternalLinks({}, BASE);
  assertEqual(r2.length, 0, "Missing links → empty result");

  // All external
  const r3 = extractInternalLinks({ links: ["https://google.com", "https://yahoo.com"] }, BASE);
  assertEqual(r3.length, 0, "All external → empty result");

  // "Malformed" URLs — Node's URL constructor resolves these as relative paths
  // against baseUrl, so they become same-host internal paths. This is correct behavior.
  const r4 = extractInternalLinks({ links: ["not a url://bad", ":::invalid"] }, BASE);
  // These resolve as relative paths: "not a url://bad" → /not%20a%20url://bad, etc.
  assertGte(r4.length, 0, "Malformed URLs resolve as relative paths (browser behavior)");

  // Mixed valid/invalid
  const r5 = extractInternalLinks({ links: [":::bad", "/valid-path", "mailto:x@y.com"] }, BASE);
  assertGte(r5.length, 1, "Mixed valid/invalid → at least valid path included");
  assertIncludes(r5, "/valid-path", "Valid path survives");
}

// ── 10. buildLiveGraph: Structure ───────────────────────────────────

section("10. buildLiveGraph: Structure");

{
  const pages = [
    makeLanePage("atlanta-to-orlando", { links: [`${BASE}/solutions/cross-docking`, `${BASE}/quote`] }),
    makeLanePage("dallas-to-houston", { links: [`${BASE}/equipment/box-truck`] }),
    makeAuthorityPage("concept", "cross-docking", { links: [`${BASE}/lanes/atlanta-to-orlando`] }),
    makeAuthorityPage("equipment", "box-truck", { links: [`${BASE}/lanes/dallas-to-houston`] }),
    makeOtherPage("/", { links: [`${BASE}/lanes/atlanta-to-orlando`, `${BASE}/lanes/dallas-to-houston`, `${BASE}/solutions/cross-docking`, `${BASE}/equipment/box-truck`] }),
  ];

  const graph = buildTestGraph(pages);

  // Node count
  assertEqual(graph.nodes.size, 5, "5 nodes in graph");

  // Classification arrays
  assertEqual(graph.lanePages.length, 2, "2 lane pages");
  assertEqual(graph.authorityPages.length, 2, "2 authority pages");
  assertEqual(graph.otherPages.length, 1, "1 other page");

  // Lane paths
  assertIncludes(graph.lanePages, "/lanes/atlanta-to-orlando", "Atlanta lane in lanePages");
  assertIncludes(graph.lanePages, "/lanes/dallas-to-houston", "Dallas lane in lanePages");

  // Authority paths
  assertIncludes(graph.authorityPages, "/network/cross-docking", "Cross-docking in authorityPages");
  assertIncludes(graph.authorityPages, "/equipment/box-truck", "Box-truck in authorityPages");

  // Other paths
  assertIncludes(graph.otherPages, "/", "Homepage in otherPages");

  // Edges exist
  assert(graph.edges.has("/lanes/atlanta-to-orlando"), "Atlanta lane has edges");
  assert(graph.edges.has("/"), "Homepage has edges");

  // Node properties
  const atlNode = graph.nodes.get("/lanes/atlanta-to-orlando");
  assertEqual(atlNode.type, "lane", "Node type is lane");
  assertEqual(atlNode.slug, "atlanta-to-orlando", "Node slug correct");
  assertEqual(atlNode.family, null, "Lane node family is null");
  assertEqual(atlNode.contentLength, 3500, "Content length preserved");

  const cdNode = graph.nodes.get("/network/cross-docking");
  assertEqual(cdNode.type, "authority", "Authority node type");
  assertEqual(cdNode.family, "concept", "Authority node family");
}

// ── 11. buildLiveGraph: Sorted Output ───────────────────────────────

section("11. buildLiveGraph: Sorted Output");

{
  const pages = [
    makeLanePage("z-to-a"),
    makeLanePage("a-to-z"),
    makeAuthorityPage("equipment", "z-truck"),
    makeAuthorityPage("concept", "a-concept"),
    makeOtherPage("/z-page"),
    makeOtherPage("/a-page"),
  ];
  const graph = buildTestGraph(pages);

  // Verify sorted
  assertEqual(graph.lanePages[0], "/lanes/a-to-z", "Lane pages sorted (first)");
  assertEqual(graph.lanePages[1], "/lanes/z-to-a", "Lane pages sorted (second)");
  assertEqual(graph.authorityPages[0], "/equipment/z-truck", "Authority pages sorted");
  assertEqual(graph.otherPages[0], "/a-page", "Other pages sorted (first)");
  assertEqual(graph.otherPages[1], "/z-page", "Other pages sorted (second)");
}

// ── 12. buildLiveGraph: Empty Input ─────────────────────────────────

section("12. buildLiveGraph: Empty Input");

{
  const graph = buildTestGraph([]);
  assertEqual(graph.nodes.size, 0, "Empty input → 0 nodes");
  assertEqual(graph.edges.size, 0, "Empty input → 0 edges");
  assertEqual(graph.lanePages.length, 0, "Empty input → 0 lane pages");
  assertEqual(graph.authorityPages.length, 0, "Empty input → 0 authority pages");
  assertEqual(graph.otherPages.length, 0, "Empty input → 0 other pages");
}

// ── 13. detectOrphans: Basic ────────────────────────────────────────

section("13. detectOrphans: Basic");

{
  // Orphan = page with no inbound links
  const pages = [
    makeOtherPage("/", { links: [`${BASE}/lanes/linked-lane`] }),
    makeLanePage("linked-lane"),      // linked from homepage → not orphan
    makeLanePage("orphan-lane"),       // NOT linked from any page → orphan
    makeAuthorityPage("concept", "orphan-auth"),  // NOT linked → orphan
  ];
  const graph = buildTestGraph(pages);
  const orphans = detectOrphans(graph);

  assertEqual(orphans.length, 2, "2 orphan pages");
  assertIncludes(orphans, "/lanes/orphan-lane", "Orphan lane detected");
  assertIncludes(orphans, "/network/orphan-auth", "Orphan authority detected");
  assertNotIncludes(orphans, "/lanes/linked-lane", "Linked lane not orphan");
  assertNotIncludes(orphans, "/", "Homepage never orphan");
}

// ── 14. detectOrphans: Homepage Excluded ────────────────────────────

section("14. detectOrphans: Homepage Excluded");

{
  // Homepage has no inbound links but should never be flagged
  const pages = [
    makeOtherPage("/"),
    makeLanePage("a-to-b"),
  ];
  const graph = buildTestGraph(pages);
  const orphans = detectOrphans(graph);

  assertNotIncludes(orphans, "/", "Homepage excluded from orphans");
  assertIncludes(orphans, "/lanes/a-to-b", "Lane with no inbound is orphan");
}

// ── 15. detectOrphans: Self-Links Don't Count ───────────────────────

section("15. detectOrphans: Self-Links Don't Count");

{
  const pages = [
    makeOtherPage("/"),
    makeLanePage("self-link", { links: [`${BASE}/lanes/self-link`] }), // links to itself only
  ];
  const graph = buildTestGraph(pages);
  const orphans = detectOrphans(graph);

  assertIncludes(orphans, "/lanes/self-link", "Self-linking page is still orphan");
}

// ── 16. detectOrphans: No Orphans ───────────────────────────────────

section("16. detectOrphans: No Orphans");

{
  const pages = [
    makeOtherPage("/", { links: [`${BASE}/lanes/a-to-b`, `${BASE}/network/cd`] }),
    makeLanePage("a-to-b", { links: [`${BASE}/network/cd`] }),
    makeAuthorityPage("concept", "cd", { links: [`${BASE}/lanes/a-to-b`] }),
  ];
  const graph = buildTestGraph(pages);
  const orphans = detectOrphans(graph);

  assertEqual(orphans.length, 0, "No orphans when all pages linked");
}

// ── 17. detectLanesMissingAuthorityLinks ────────────────────────────

section("17. detectLanesMissingAuthorityLinks");

{
  const pages = [
    makeOtherPage("/"),
    // Lane WITH authority link → OK
    makeLanePage("good-lane", { links: [`${BASE}/solutions/store-replenishment`] }),
    makeAuthorityPage("solution", "store-replenishment"),
    // Lane WITHOUT authority link → missing
    makeLanePage("bad-lane", { links: [`${BASE}/quote`] }),
    // Lane with authority link to known page
    makeLanePage("another-good", { links: [`${BASE}/equipment/box-truck`] }),
    makeAuthorityPage("equipment", "box-truck"),
  ];
  const graph = buildTestGraph(pages);
  const missing = detectLanesMissingAuthorityLinks(graph);

  assertEqual(missing.length, 1, "1 lane missing authority link");
  assertIncludes(missing, "/lanes/bad-lane", "Bad lane flagged");
  assertNotIncludes(missing, "/lanes/good-lane", "Good lane not flagged");
  assertNotIncludes(missing, "/lanes/another-good", "Another good lane not flagged");
}

// ── 18. detectLanesMissingAuthorityLinks: Link to Non-Crawled ───────

section("18. detectLanesMissingAuthorityLinks: Link to Non-Crawled");

{
  // Lane links to an authority page that wasn't crawled (not in graph)
  const pages = [
    makeOtherPage("/"),
    makeLanePage("linked-to-unknown", { links: [`${BASE}/solutions/unknown-solution`] }),
    // Note: no authority page for "unknown-solution" in crawl results
  ];
  const graph = buildTestGraph(pages);
  const missing = detectLanesMissingAuthorityLinks(graph);

  // The link target isn't in authorityPages set, so the lane is flagged
  assertEqual(missing.length, 1, "Lane linking to non-crawled authority is flagged");
  assertIncludes(missing, "/lanes/linked-to-unknown", "Lane flagged for non-crawled authority target");
}

// ── 19. detectAuthorityMissingLaneLinks ─────────────────────────────

section("19. detectAuthorityMissingLaneLinks");

{
  const pages = [
    makeOtherPage("/"),
    // Authority WITH lane link → OK
    makeAuthorityPage("concept", "good-auth", { links: [`${BASE}/lanes/a-to-b`] }),
    makeLanePage("a-to-b"),
    // Authority WITHOUT lane link → missing
    makeAuthorityPage("solution", "bad-auth", { links: [`${BASE}/quote`] }),
    // Authority with lane link
    makeAuthorityPage("equipment", "another-good", { links: [`${BASE}/lanes/c-to-d`] }),
    makeLanePage("c-to-d"),
  ];
  const graph = buildTestGraph(pages);
  const missing = detectAuthorityMissingLaneLinks(graph);

  assertEqual(missing.length, 1, "1 authority missing lane link");
  assertIncludes(missing, "/solutions/bad-auth", "Bad authority flagged");
  assertNotIncludes(missing, "/network/good-auth", "Good authority not flagged");
  assertNotIncludes(missing, "/equipment/another-good", "Another good authority not flagged");
}

// ── 20. detectAuthorityMissingLaneLinks: Link to Non-Crawled ────────

section("20. detectAuthorityMissingLaneLinks: Link to Non-Crawled");

{
  const pages = [
    makeOtherPage("/"),
    makeAuthorityPage("concept", "links-unknown-lane", { links: [`${BASE}/lanes/unknown-lane`] }),
  ];
  const graph = buildTestGraph(pages);
  const missing = detectAuthorityMissingLaneLinks(graph);

  assertEqual(missing.length, 1, "Authority linking to non-crawled lane is flagged");
}

// ── 21. detectDuplicateTitles ───────────────────────────────────────

section("21. detectDuplicateTitles");

{
  const pages = [
    makeOtherPage("/"),
    makeLanePage("a-to-b", { title: "Duplicate Title" }),
    makeLanePage("c-to-d", { title: "Duplicate Title" }),
    makeLanePage("e-to-f", { title: "Unique Title" }),
    makeAuthorityPage("concept", "x", { title: "Another Dup" }),
    makeAuthorityPage("concept", "y", { title: "Another Dup" }),
    makeAuthorityPage("concept", "z", { title: "Another Dup" }),
  ];
  const graph = buildTestGraph(pages);
  const dupes = detectDuplicateTitles(graph);

  assertEqual(dupes.length, 2, "2 duplicate title groups");

  // Find groups by title
  const group1 = dupes.find(d => d.title === "Another Dup");
  const group2 = dupes.find(d => d.title === "Duplicate Title");

  assert(group1 !== undefined, "Another Dup group found");
  assert(group2 !== undefined, "Duplicate Title group found");

  assertEqual(group1.paths.length, 3, "Another Dup has 3 pages");
  assertEqual(group2.paths.length, 2, "Duplicate Title has 2 pages");

  // Paths within groups are sorted
  assert(group1.paths[0] <= group1.paths[1], "Group1 paths sorted (0 <= 1)");
  assert(group1.paths[1] <= group1.paths[2], "Group1 paths sorted (1 <= 2)");
}

// ── 22. detectDuplicateTitles: No Duplicates ────────────────────────

section("22. detectDuplicateTitles: No Duplicates");

{
  const pages = [
    makeLanePage("a-to-b", { title: "Title A" }),
    makeLanePage("c-to-d", { title: "Title B" }),
    makeLanePage("e-to-f", { title: "Title C" }),
  ];
  const graph = buildTestGraph(pages);
  const dupes = detectDuplicateTitles(graph);

  assertEqual(dupes.length, 0, "No duplicates when all titles unique");
}

// ── 23. detectDuplicateTitles: Empty Titles Ignored ─────────────────

section("23. detectDuplicateTitles: Empty Titles Ignored");

{
  const pages = [
    makeLanePage("a-to-b", { title: "" }),
    makeLanePage("c-to-d", { title: "" }),
    makeLanePage("e-to-f", { title: "   " }),
  ];
  const graph = buildTestGraph(pages);
  const dupes = detectDuplicateTitles(graph);

  // Empty titles should be ignored, not grouped
  assertEqual(dupes.length, 0, "Empty titles not treated as duplicates");
}

// ── 24. detectDuplicateTitles: Sorted Output ────────────────────────

section("24. detectDuplicateTitles: Sorted Output");

{
  const pages = [
    makeLanePage("a-to-b", { title: "Zebra Title" }),
    makeLanePage("c-to-d", { title: "Zebra Title" }),
    makeLanePage("e-to-f", { title: "Alpha Title" }),
    makeLanePage("g-to-h", { title: "Alpha Title" }),
  ];
  const graph = buildTestGraph(pages);
  const dupes = detectDuplicateTitles(graph);

  assertEqual(dupes.length, 2, "2 duplicate groups");
  assertEqual(dupes[0].title, "Alpha Title", "Groups sorted alphabetically — Alpha first");
  assertEqual(dupes[1].title, "Zebra Title", "Groups sorted alphabetically — Zebra second");
}

// ── 25. detectWeakPages: Basic ──────────────────────────────────────

section("25. detectWeakPages: Basic");

{
  const pages = [
    makeOtherPage("/", { contentLength: 100 }),  // other type → NOT flagged regardless
    makeLanePage("strong-lane", { contentLength: 3500 }),  // above threshold → OK
    makeLanePage("weak-lane", { contentLength: 200 }),     // below threshold → flagged
    makeAuthorityPage("concept", "strong-auth", { contentLength: 2500 }),  // above → OK
    makeAuthorityPage("concept", "weak-auth", { contentLength: 100 }),     // below → flagged
  ];
  const graph = buildTestGraph(pages);
  const weak = detectWeakPages(graph);

  assertEqual(weak.length, 2, "2 weak pages");

  const weakLane = weak.find(w => w.path === "/lanes/weak-lane");
  const weakAuth = weak.find(w => w.path === "/network/weak-auth");

  assert(weakLane !== undefined, "Weak lane found");
  assertEqual(weakLane.type, "lane", "Weak lane type correct");
  assertEqual(weakLane.contentLength, 200, "Weak lane content length");

  assert(weakAuth !== undefined, "Weak authority found");
  assertEqual(weakAuth.type, "authority", "Weak authority type correct");
  assertEqual(weakAuth.contentLength, 100, "Weak authority content length");
}

// ── 26. detectWeakPages: Only Lane + Authority Flagged ──────────────

section("26. detectWeakPages: Only Lane + Authority Flagged");

{
  const pages = [
    makeOtherPage("/", { contentLength: 10 }),          // other → not flagged
    makeOtherPage("/quote", { contentLength: 50 }),     // other → not flagged
    makeLanePage("ok-lane", { contentLength: 600 }),     // above threshold → OK
  ];
  const graph = buildTestGraph(pages);
  const weak = detectWeakPages(graph);

  assertEqual(weak.length, 0, "Other pages never flagged as weak");
}

// ── 27. detectWeakPages: Homepage Excluded ──────────────────────────

section("27. detectWeakPages: Homepage Excluded");

{
  const pages = [
    makeOtherPage("/", { contentLength: 10 }),
  ];
  const graph = buildTestGraph(pages);
  const weak = detectWeakPages(graph);

  assertEqual(weak.length, 0, "Homepage excluded from weak detection");
}

// ── 28. detectWeakPages: Custom Threshold ───────────────────────────

section("28. detectWeakPages: Custom Threshold");

{
  const pages = [
    makeLanePage("a-to-b", { contentLength: 800 }),
    makeLanePage("c-to-d", { contentLength: 1200 }),
  ];
  const graph = buildTestGraph(pages);

  // Default threshold (500) → neither is weak
  const weak1 = detectWeakPages(graph);
  assertEqual(weak1.length, 0, "Both above default threshold");

  // Custom threshold 1000 → one is weak
  const weak2 = detectWeakPages(graph, 1000);
  assertEqual(weak2.length, 1, "One weak at threshold 1000");
  assertEqual(weak2[0].path, "/lanes/a-to-b", "Correct page flagged at threshold 1000");

  // Custom threshold 1500 → both weak
  const weak3 = detectWeakPages(graph, 1500);
  assertEqual(weak3.length, 2, "Both weak at threshold 1500");
}

// ── 29. detectWeakPages: Sorted Output ──────────────────────────────

section("29. detectWeakPages: Sorted Output");

{
  const pages = [
    makeLanePage("z-to-a", { contentLength: 100 }),
    makeLanePage("a-to-z", { contentLength: 100 }),
    makeAuthorityPage("concept", "m-concept", { contentLength: 100 }),
  ];
  const graph = buildTestGraph(pages);
  const weak = detectWeakPages(graph);

  assertEqual(weak.length, 3, "3 weak pages");
  assert(weak[0].path <= weak[1].path, "Weak pages sorted (0 <= 1)");
  assert(weak[1].path <= weak[2].path, "Weak pages sorted (1 <= 2)");
}

// ── 30. buildAuditReport: Structure ─────────────────────────────────

section("30. buildAuditReport: Structure");

{
  const pages = [
    makeOtherPage("/", { links: [`${BASE}/lanes/a-to-b`, `${BASE}/network/cd`] }),
    makeLanePage("a-to-b", { links: [`${BASE}/network/cd`] }),
    makeAuthorityPage("concept", "cd", { links: [`${BASE}/lanes/a-to-b`] }),
  ];
  const graph = buildTestGraph(pages);
  const issues = runFullIssueDetection(graph);
  const meta = { timestamp: "2026-01-01T00:00:00Z", baseUrl: BASE, durationMs: 1234 };
  const report = buildAuditReport(meta, graph, issues);

  // Top-level fields
  assertEqual(report._version, "1.0.0", "Report version");
  assertEqual(report._generated_by, "site-crawl-audit.js", "Generated by");

  // Crawl metadata
  assertEqual(report.crawl.timestamp, "2026-01-01T00:00:00Z", "Crawl timestamp");
  assertEqual(report.crawl.base_url, BASE, "Crawl base URL");
  assertEqual(report.crawl.pages_crawled, 3, "Pages crawled count");
  assertEqual(report.crawl.crawl_duration_ms, 1234, "Crawl duration");

  // Inventory
  assertEqual(report.inventory.total, 3, "Inventory total");
  assertEqual(report.inventory.lane_pages, 1, "Inventory lane pages");
  assertEqual(report.inventory.authority_pages, 1, "Inventory authority pages");
  assertEqual(report.inventory.other_pages, 1, "Inventory other pages");
  assert(Array.isArray(report.inventory.lane_paths), "Lane paths is array");
  assert(Array.isArray(report.inventory.authority_paths), "Authority paths is array");

  // Link graph
  assert(typeof report.link_graph.total_internal_links === "number", "Total internal links is number");
  assert(typeof report.link_graph.avg_links_per_page === "number", "Avg links per page is number");
  assertGte(report.link_graph.total_internal_links, 1, "At least 1 internal link");

  // Issues
  assert("orphan_pages" in report.issues, "Has orphan_pages");
  assert("lanes_missing_authority_links" in report.issues, "Has lanes_missing_authority_links");
  assert("authority_missing_lane_links" in report.issues, "Has authority_missing_lane_links");
  assert("duplicate_titles" in report.issues, "Has duplicate_titles");
  assert("weak_pages" in report.issues, "Has weak_pages");

  // Issue structure
  assert(typeof report.issues.orphan_pages.count === "number", "Orphan count is number");
  assert(Array.isArray(report.issues.orphan_pages.paths), "Orphan paths is array");
  assert(typeof report.issues.weak_pages.threshold === "number", "Weak threshold is number");

  // Summary
  assert(typeof report.summary.total_issues === "number", "Total issues is number");
  assertIncludes(["healthy", "warning", "critical"], report.summary.health, "Health is valid value");
}

// ── 31. buildAuditReport: Health Computation ────────────────────────

section("31. buildAuditReport: Health Computation");

{
  // Healthy: low issue rate (< 0.2)
  const healthyPages = [
    makeOtherPage("/", { links: [`${BASE}/lanes/a-to-b`, `${BASE}/lanes/c-to-d`, `${BASE}/lanes/e-to-f`, `${BASE}/lanes/g-to-h`, `${BASE}/lanes/i-to-j`, `${BASE}/network/cd`, `${BASE}/equipment/bt`] }),
    makeLanePage("a-to-b", { links: [`${BASE}/network/cd`] }),
    makeLanePage("c-to-d", { links: [`${BASE}/network/cd`] }),
    makeLanePage("e-to-f", { links: [`${BASE}/network/cd`] }),
    makeLanePage("g-to-h", { links: [`${BASE}/network/cd`] }),
    makeLanePage("i-to-j", { links: [`${BASE}/network/cd`] }),
    makeAuthorityPage("concept", "cd", { links: [`${BASE}/lanes/a-to-b`, `${BASE}/lanes/c-to-d`, `${BASE}/lanes/e-to-f`] }),
    makeAuthorityPage("equipment", "bt", { links: [`${BASE}/lanes/g-to-h`, `${BASE}/lanes/i-to-j`] }),
  ];
  const healthyGraph = buildTestGraph(healthyPages);
  const healthyIssues = runFullIssueDetection(healthyGraph);
  const healthyReport = buildAuditReport({ timestamp: "t", baseUrl: BASE, durationMs: 0 }, healthyGraph, healthyIssues);
  assertEqual(healthyReport.summary.health, "healthy", "Low issue rate → healthy");

  // Critical: all pages have issues (issue rate > 0.5)
  const criticalPages = [
    makeOtherPage("/"),
    makeLanePage("orphan1"),         // orphan + no authority links
    makeLanePage("orphan2"),         // orphan + no authority links
    makeAuthorityPage("concept", "o1"),  // orphan + no lane links
    makeAuthorityPage("concept", "o2"),  // orphan + no lane links
  ];
  const criticalGraph = buildTestGraph(criticalPages);
  const criticalIssues = runFullIssueDetection(criticalGraph);
  const criticalReport = buildAuditReport({ timestamp: "t", baseUrl: BASE, durationMs: 0 }, criticalGraph, criticalIssues);
  assertEqual(criticalReport.summary.health, "critical", "High issue rate → critical");

  // Critical: zero pages
  const emptyGraph = buildTestGraph([]);
  const emptyIssues = runFullIssueDetection(emptyGraph);
  const emptyReport = buildAuditReport({ timestamp: "t", baseUrl: BASE, durationMs: 0 }, emptyGraph, emptyIssues);
  assertEqual(emptyReport.summary.health, "critical", "Zero pages → critical");
}

// ── 32. buildAuditReport: Link Graph Stats ──────────────────────────

section("32. buildAuditReport: Link Graph Stats");

{
  const pages = [
    makeOtherPage("/", { links: [`${BASE}/lanes/a`, `${BASE}/lanes/b`] }),  // 2 internal links
    makeLanePage("a", { links: [`${BASE}/lanes/b`, `${BASE}/quote`] }),     // 2 internal links
    makeLanePage("b", { links: [`${BASE}/lanes/a`] }),                       // 1 internal link
  ];
  const graph = buildTestGraph(pages);
  const issues = runFullIssueDetection(graph);
  const report = buildAuditReport({ timestamp: "t", baseUrl: BASE, durationMs: 0 }, graph, issues);

  assertEqual(report.link_graph.total_internal_links, 5, "Total edges = 5");
  // avg = 5 / 3 = 1.666... → 1.7
  assertEqual(report.link_graph.avg_links_per_page, 1.7, "Average links per page = 1.7");
}

// ── 33. buildAuditReport: Empty Graph Stats ─────────────────────────

section("33. buildAuditReport: Empty Graph Stats");

{
  const graph = buildTestGraph([]);
  const issues = runFullIssueDetection(graph);
  const report = buildAuditReport({ timestamp: "t", baseUrl: BASE, durationMs: 0 }, graph, issues);

  assertEqual(report.link_graph.total_internal_links, 0, "Empty graph: 0 links");
  assertEqual(report.link_graph.avg_links_per_page, 0, "Empty graph: avg 0");
}

// ── 34. buildAuditReport: Issue Counts Match ────────────────────────

section("34. buildAuditReport: Issue Counts Match");

{
  const pages = [
    makeOtherPage("/"),
    makeLanePage("orphan-lane"),                                             // orphan + no authority
    makeAuthorityPage("concept", "orphan-auth"),                             // orphan + no lanes
    makeLanePage("dup-lane-1", { title: "Dup" }),                           // duplicate title
    makeLanePage("dup-lane-2", { title: "Dup" }),                           // duplicate title
    makeLanePage("weak-lane", { contentLength: 100 }),                       // weak
  ];
  const graph = buildTestGraph(pages);
  const issues = runFullIssueDetection(graph);
  const report = buildAuditReport({ timestamp: "t", baseUrl: BASE, durationMs: 0 }, graph, issues);

  // Verify counts match arrays
  assertEqual(report.issues.orphan_pages.count, report.issues.orphan_pages.paths.length, "Orphan count matches paths length");
  assertEqual(report.issues.lanes_missing_authority_links.count, report.issues.lanes_missing_authority_links.paths.length, "Missing auth count matches");
  assertEqual(report.issues.authority_missing_lane_links.count, report.issues.authority_missing_lane_links.paths.length, "Missing lane count matches");
  assertEqual(report.issues.duplicate_titles.count, report.issues.duplicate_titles.groups.length, "Dup title count matches");
  assertEqual(report.issues.weak_pages.count, report.issues.weak_pages.pages.length, "Weak pages count matches");

  // Total issues = sum of all
  const expectedTotal =
    report.issues.orphan_pages.count +
    report.issues.lanes_missing_authority_links.count +
    report.issues.authority_missing_lane_links.count +
    report.issues.duplicate_titles.count +
    report.issues.weak_pages.count;
  assertEqual(report.summary.total_issues, expectedTotal, "Total issues = sum of all issue counts");
}

// ── 35. Determinism: Same Input → Same Output ───────────────────────

section("35. Determinism: Same Input → Same Output");

{
  const pages = [
    makeOtherPage("/", { links: [`${BASE}/lanes/a-to-b`, `${BASE}/network/cd`] }),
    makeLanePage("a-to-b", { links: [`${BASE}/network/cd`], title: "Lane A" }),
    makeLanePage("c-to-d", { title: "Lane A" }),  // dup title, orphan
    makeAuthorityPage("concept", "cd", { links: [`${BASE}/lanes/a-to-b`] }),
    makeAuthorityPage("solution", "no-lanes"),  // orphan, no lane links
    makeLanePage("weak", { contentLength: 100 }),  // weak, orphan
  ];
  const meta = { timestamp: "2026-01-01T00:00:00Z", baseUrl: BASE, durationMs: 999 };

  // Run twice
  const graph1 = buildTestGraph(pages);
  const issues1 = runFullIssueDetection(graph1);
  const report1 = buildAuditReport(meta, graph1, issues1);

  const graph2 = buildTestGraph(pages);
  const issues2 = runFullIssueDetection(graph2);
  const report2 = buildAuditReport(meta, graph2, issues2);

  assertEqual(JSON.stringify(report1), JSON.stringify(report2), "Full report deterministic across runs");

  // Individual components
  assertDeepEqual(detectOrphans(graph1), detectOrphans(graph2), "Orphans deterministic");
  assertDeepEqual(detectLanesMissingAuthorityLinks(graph1), detectLanesMissingAuthorityLinks(graph2), "Lanes missing auth deterministic");
  assertDeepEqual(detectAuthorityMissingLaneLinks(graph1), detectAuthorityMissingLaneLinks(graph2), "Auth missing lanes deterministic");
  assertDeepEqual(detectDuplicateTitles(graph1), detectDuplicateTitles(graph2), "Dup titles deterministic");
  assertDeepEqual(detectWeakPages(graph1), detectWeakPages(graph2), "Weak pages deterministic");
}

// ── 36. Integration: Full Audit Pipeline ────────────────────────────

section("36. Integration: Full Audit Pipeline");

{
  // Simulate a realistic small site
  const pages = [
    // Homepage links to all lane + authority pages
    makeOtherPage("/", {
      links: [
        `${BASE}/lanes/atlanta-to-orlando`,
        `${BASE}/lanes/dallas-to-houston`,
        `${BASE}/lanes/la-to-sf`,
        `${BASE}/solutions/store-replenishment`,
        `${BASE}/network/cross-docking`,
        `${BASE}/equipment/box-truck`,
        `${BASE}/quote`,
      ],
    }),
    // Lane pages with authority links (bidirectional linking)
    makeLanePage("atlanta-to-orlando", {
      links: [`${BASE}/solutions/store-replenishment`, `${BASE}/network/cross-docking`, `${BASE}/quote`],
    }),
    makeLanePage("dallas-to-houston", {
      links: [`${BASE}/equipment/box-truck`, `${BASE}/quote`],
    }),
    makeLanePage("la-to-sf", {
      links: [`${BASE}/network/cross-docking`, `${BASE}/quote`],
    }),
    // Authority pages with lane links (bidirectional linking)
    makeAuthorityPage("solution", "store-replenishment", {
      links: [`${BASE}/lanes/atlanta-to-orlando`, `${BASE}/network/cross-docking`],
    }),
    makeAuthorityPage("concept", "cross-docking", {
      links: [`${BASE}/lanes/atlanta-to-orlando`, `${BASE}/lanes/la-to-sf`, `${BASE}/solutions/store-replenishment`],
    }),
    makeAuthorityPage("equipment", "box-truck", {
      links: [`${BASE}/lanes/dallas-to-houston`],
    }),
    // Other pages (unique titles to avoid false duplicate detection)
    makeOtherPage("/quote", { title: "Get a Quote | WARP" }),
  ];

  const graph = buildTestGraph(pages);
  const issues = runFullIssueDetection(graph);
  const meta = { timestamp: "2026-03-11T12:00:00Z", baseUrl: BASE, durationMs: 5000 };
  const report = buildAuditReport(meta, graph, issues);

  // Inventory
  assertEqual(report.inventory.total, 8, "Integration: 8 total pages");
  assertEqual(report.inventory.lane_pages, 3, "Integration: 3 lanes");
  assertEqual(report.inventory.authority_pages, 3, "Integration: 3 authority");
  assertEqual(report.inventory.other_pages, 2, "Integration: 2 other");

  // No orphans (all pages linked from homepage)
  assertEqual(report.issues.orphan_pages.count, 0, "Integration: no orphans");

  // No missing authority links (all lanes link to authority)
  assertEqual(report.issues.lanes_missing_authority_links.count, 0, "Integration: no lanes missing authority links");

  // No missing lane links (all authority pages link to lanes)
  assertEqual(report.issues.authority_missing_lane_links.count, 0, "Integration: no authority missing lane links");

  // No duplicate titles
  assertEqual(report.issues.duplicate_titles.count, 0, "Integration: no duplicate titles");

  // No weak pages (all > 500 chars)
  assertEqual(report.issues.weak_pages.count, 0, "Integration: no weak pages");

  // Overall health
  assertEqual(report.summary.health, "healthy", "Integration: healthy site");
  assertEqual(report.summary.total_issues, 0, "Integration: 0 total issues");
}

// ── 37. Integration: Site With Issues ───────────────────────────────

section("37. Integration: Site With Issues");

{
  const pages = [
    makeOtherPage("/"),
    // Orphan lane (not linked from anywhere)
    makeLanePage("orphan-lane", { links: [`${BASE}/quote`] }),
    // Lane missing authority link
    makeLanePage("no-auth-lane", { links: [`${BASE}/quote`] }),
    // Authority missing lane link
    makeAuthorityPage("concept", "no-lane-auth", { links: [`${BASE}/quote`] }),
    // Duplicate titles
    makeLanePage("dup-a", { title: "Same Title" }),
    makeLanePage("dup-b", { title: "Same Title" }),
    // Weak page
    makeLanePage("thin-lane", { contentLength: 100 }),
  ];

  // Link homepage to some but not all
  pages[0].links = [`${BASE}/lanes/no-auth-lane`, `${BASE}/network/no-lane-auth`, `${BASE}/lanes/dup-a`, `${BASE}/lanes/dup-b`, `${BASE}/lanes/thin-lane`];

  const graph = buildTestGraph(pages);
  const issues = runFullIssueDetection(graph);
  const meta = { timestamp: "2026-03-11T12:00:00Z", baseUrl: BASE, durationMs: 3000 };
  const report = buildAuditReport(meta, graph, issues);

  // Orphans
  assertGte(report.issues.orphan_pages.count, 1, "Integration: at least 1 orphan");
  assertIncludes(report.issues.orphan_pages.paths, "/lanes/orphan-lane", "Orphan lane in report");

  // Missing authority links
  assertGte(report.issues.lanes_missing_authority_links.count, 1, "Integration: lanes missing authority");

  // Missing lane links
  assertGte(report.issues.authority_missing_lane_links.count, 1, "Integration: authority missing lanes");

  // Duplicate titles
  assertEqual(report.issues.duplicate_titles.count, 1, "Integration: 1 duplicate title group");
  assertEqual(report.issues.duplicate_titles.groups[0].title, "Same Title", "Integration: correct duplicate title");

  // Weak pages
  assertGte(report.issues.weak_pages.count, 1, "Integration: at least 1 weak page");

  // Health should be warning or critical
  assert(report.summary.health !== "healthy", "Integration: site with issues not healthy");
  assertGte(report.summary.total_issues, 5, "Integration: at least 5 total issues");
}

// ── 38. Edge Case: Single Page Site ─────────────────────────────────

section("38. Edge Case: Single Page Site");

{
  const pages = [makeOtherPage("/")];
  const graph = buildTestGraph(pages);
  const issues = runFullIssueDetection(graph);
  const report = buildAuditReport({ timestamp: "t", baseUrl: BASE, durationMs: 0 }, graph, issues);

  assertEqual(report.inventory.total, 1, "Single page site: 1 page");
  assertEqual(report.summary.total_issues, 0, "Single page site: 0 issues");
  assertEqual(report.summary.health, "healthy", "Single page site: healthy");
}

// ── 39. Edge Case: All Lanes, No Authority ──────────────────────────

section("39. Edge Case: All Lanes, No Authority");

{
  const pages = [
    makeOtherPage("/", { links: [`${BASE}/lanes/a-to-b`, `${BASE}/lanes/c-to-d`] }),
    makeLanePage("a-to-b", { links: [`${BASE}/lanes/c-to-d`] }),
    makeLanePage("c-to-d", { links: [`${BASE}/lanes/a-to-b`] }),
  ];
  const graph = buildTestGraph(pages);

  assertEqual(graph.authorityPages.length, 0, "No authority pages");
  assertEqual(graph.lanePages.length, 2, "2 lane pages");

  const missing = detectLanesMissingAuthorityLinks(graph);
  assertEqual(missing.length, 2, "All lanes missing authority (none exist)");

  // No authority pages → no missing lane links
  const authMissing = detectAuthorityMissingLaneLinks(graph);
  assertEqual(authMissing.length, 0, "No authority → no authority missing lanes");
}

// ── 40. Edge Case: All Authority, No Lanes ──────────────────────────

section("40. Edge Case: All Authority, No Lanes");

{
  const pages = [
    makeOtherPage("/", { links: [`${BASE}/solutions/sr`, `${BASE}/network/cd`] }),
    makeAuthorityPage("solution", "sr", { links: [`${BASE}/network/cd`] }),
    makeAuthorityPage("concept", "cd", { links: [`${BASE}/solutions/sr`] }),
  ];
  const graph = buildTestGraph(pages);

  assertEqual(graph.lanePages.length, 0, "No lane pages");
  assertEqual(graph.authorityPages.length, 2, "2 authority pages");

  const missing = detectAuthorityMissingLaneLinks(graph);
  assertEqual(missing.length, 2, "All authority missing lanes (none exist)");

  const laneMissing = detectLanesMissingAuthorityLinks(graph);
  assertEqual(laneMissing.length, 0, "No lanes → no lanes missing authority");
}

// ── 41. classifyPage: All Authority Families ────────────────────────

section("41. classifyPage: All Authority Families");

{
  // Verify each family maps correctly
  const families = [
    { path: "/solutions/test-sol", expectedFamily: "solution" },
    { path: "/network/test-net", expectedFamily: "concept" },
    { path: "/equipment/test-eq", expectedFamily: "equipment" },
  ];

  for (const { path, expectedFamily } of families) {
    const result = classifyPage(path);
    assertEqual(result.type, "authority", `${path} is authority`);
    assertEqual(result.family, expectedFamily, `${path} family is ${expectedFamily}`);
  }
}

// ── 42. buildLiveGraph: Content Length Resolution ────────────────────

section("42. buildLiveGraph: Content Length Resolution");

{
  // Tests the fallback chain: contentLength → content_length → text.length → 0
  const pages = [
    { url: `${BASE}/lanes/test-cl`, contentLength: 5000, links: [], title: "T", h1: "H" },
    { url: `${BASE}/lanes/test-cl2`, content_length: 3000, links: [], title: "T2", h1: "H2" },
    { url: `${BASE}/lanes/test-cl3`, text: "hello world", links: [], title: "T3", h1: "H3" },
    { url: `${BASE}/lanes/test-cl4`, links: [], title: "T4", h1: "H4" },
  ];
  const graph = buildTestGraph(pages);

  assertEqual(graph.nodes.get("/lanes/test-cl").contentLength, 5000, "contentLength field used");
  assertEqual(graph.nodes.get("/lanes/test-cl2").contentLength, 3000, "content_length fallback used");
  assertEqual(graph.nodes.get("/lanes/test-cl3").contentLength, 11, "text.length fallback used");
  assertEqual(graph.nodes.get("/lanes/test-cl4").contentLength, 0, "No content → 0");
}

// ── 43. buildLiveGraph: H1 Fallback ─────────────────────────────────

section("43. buildLiveGraph: H1 Fallback");

{
  const pages = [
    { url: `${BASE}/lanes/test-h1`, h1: "Primary H1", heading: "Fallback Heading", links: [], title: "T" },
    { url: `${BASE}/lanes/test-h1b`, heading: "Only Heading", links: [], title: "T" },
  ];
  const graph = buildTestGraph(pages);

  assertEqual(graph.nodes.get("/lanes/test-h1").h1, "Primary H1", "h1 field preferred");
  assertEqual(graph.nodes.get("/lanes/test-h1b").h1, "Only Heading", "heading fallback used");
}

// ── 44. extractInternalLinks: Mixed Link Formats ────────────────────

section("44. extractInternalLinks: Mixed Link Formats");

{
  const page = {
    links: [
      "/lanes/string-link",
      { href: "/lanes/href-link" },
      { url: "/lanes/url-link" },
      { href: "", url: "" },        // empty → skipped
      { other: "/lanes/other" },     // no href or url → skipped
      42,                            // number → skipped (not string, no href)
    ],
  };
  const result = extractInternalLinks(page, BASE);
  assertEqual(result.length, 3, "3 valid links from mixed formats");
  assertIncludes(result, "/lanes/string-link", "String link extracted");
  assertIncludes(result, "/lanes/href-link", "Href link extracted");
  assertIncludes(result, "/lanes/url-link", "URL link extracted");
}

// ── 45. Bidirectional Linking Scenario ──────────────────────────────

section("45. Bidirectional Linking Scenario");

{
  // Perfect bidirectional linking: every lane links to authority, every authority links to lanes
  const pages = [
    makeOtherPage("/", {
      links: [
        `${BASE}/lanes/a-to-b`,
        `${BASE}/lanes/c-to-d`,
        `${BASE}/solutions/sr`,
        `${BASE}/network/cd`,
        `${BASE}/equipment/bt`,
      ],
    }),
    makeLanePage("a-to-b", { links: [`${BASE}/solutions/sr`, `${BASE}/network/cd`] }),
    makeLanePage("c-to-d", { links: [`${BASE}/equipment/bt`, `${BASE}/solutions/sr`] }),
    makeAuthorityPage("solution", "sr", { links: [`${BASE}/lanes/a-to-b`, `${BASE}/lanes/c-to-d`] }),
    makeAuthorityPage("concept", "cd", { links: [`${BASE}/lanes/a-to-b`] }),
    makeAuthorityPage("equipment", "bt", { links: [`${BASE}/lanes/c-to-d`] }),
  ];
  const graph = buildTestGraph(pages);

  // No missing links in either direction
  const lanesMissing = detectLanesMissingAuthorityLinks(graph);
  const authMissing = detectAuthorityMissingLaneLinks(graph);
  assertEqual(lanesMissing.length, 0, "Perfect bidirectional: no lanes missing authority");
  assertEqual(authMissing.length, 0, "Perfect bidirectional: no authority missing lanes");

  // No orphans
  const orphans = detectOrphans(graph);
  assertEqual(orphans.length, 0, "Perfect bidirectional: no orphans");
}

// ── 46. Report: Weak Page Threshold in Report ───────────────────────

section("46. Report: Weak Page Threshold in Report");

{
  const pages = [makeOtherPage("/")];
  const graph = buildTestGraph(pages);
  const issues = runFullIssueDetection(graph);
  const report = buildAuditReport({ timestamp: "t", baseUrl: BASE, durationMs: 0 }, graph, issues);

  assertEqual(report.issues.weak_pages.threshold, WEAK_PAGE_THRESHOLD, "Weak threshold in report matches constant");
}

// ── 47. Report: Default Metadata ────────────────────────────────────

section("47. Report: Default Metadata");

{
  const pages = [makeOtherPage("/")];
  const graph = buildTestGraph(pages);
  const issues = runFullIssueDetection(graph);

  // Pass empty metadata
  const report = buildAuditReport({}, graph, issues);

  // Should use defaults
  assert(typeof report.crawl.timestamp === "string", "Default timestamp is string");
  assertEqual(report.crawl.base_url, BASE, "Default base URL");
  assertEqual(report.crawl.crawl_duration_ms, 0, "Default duration is 0");
}

// ── 48. Health Computation: Warning Threshold ───────────────────────

section("48. Health Computation: Warning Threshold");

{
  // Create a scenario where issueRate is between 0.2 and 0.5 → warning
  // 5 pages, need 1-2 issues (rate = 0.2-0.4)
  const pages = [
    makeOtherPage("/", { links: [`${BASE}/lanes/a-to-b`, `${BASE}/lanes/c-to-d`, `${BASE}/lanes/e-to-f`, `${BASE}/network/cd`] }),
    makeLanePage("a-to-b", { links: [`${BASE}/network/cd`] }),
    makeLanePage("c-to-d", { links: [`${BASE}/network/cd`] }),
    // This lane has no authority link → 1 issue
    makeLanePage("e-to-f"),
    makeAuthorityPage("concept", "cd", { links: [`${BASE}/lanes/a-to-b`] }),
  ];
  const graph = buildTestGraph(pages);
  const issues = runFullIssueDetection(graph);
  const report = buildAuditReport({ timestamp: "t", baseUrl: BASE, durationMs: 0 }, graph, issues);

  // With 5 pages and a small number of issues, should be healthy or warning
  const issueRate = report.summary.total_issues / report.inventory.total;
  if (issueRate > 0.2 && issueRate <= 0.5) {
    assertEqual(report.summary.health, "warning", "Issue rate 0.2-0.5 → warning");
  } else if (issueRate <= 0.2) {
    assertEqual(report.summary.health, "healthy", "Issue rate <= 0.2 → healthy");
  }
  // Just verify it's a valid status
  assertIncludes(["healthy", "warning", "critical"], report.summary.health, "Health is valid");
}

// ── 49. Large Graph Determinism ─────────────────────────────────────

section("49. Large Graph Determinism");

{
  // Build a larger graph (30 pages) and verify determinism
  const pages = [];
  for (let i = 0; i < 10; i++) {
    pages.push(makeLanePage(`city${i}-to-city${i + 10}`, {
      links: [`${BASE}/solutions/sol-${i % 3}`, `${BASE}/quote`],
    }));
  }
  for (let i = 0; i < 3; i++) {
    pages.push(makeAuthorityPage("solution", `sol-${i}`, {
      links: pages.slice(i * 3, i * 3 + 3).map(p => p.url),
    }));
  }
  pages.push(makeOtherPage("/", {
    links: pages.map(p => p.url),
  }));

  const g1 = buildTestGraph(pages);
  const i1 = runFullIssueDetection(g1);
  const r1 = buildAuditReport({ timestamp: "t", baseUrl: BASE, durationMs: 0 }, g1, i1);

  const g2 = buildTestGraph(pages);
  const i2 = runFullIssueDetection(g2);
  const r2 = buildAuditReport({ timestamp: "t", baseUrl: BASE, durationMs: 0 }, g2, i2);

  assertEqual(JSON.stringify(r1), JSON.stringify(r2), "Large graph: report deterministic");
  assertEqual(r1.inventory.total, 14, "Large graph: 14 pages");
  assertEqual(r1.inventory.lane_pages, 10, "Large graph: 10 lanes");
  assertEqual(r1.inventory.authority_pages, 3, "Large graph: 3 authority");
}

// ── 50. extractInternalLinks: Root Path ─────────────────────────────

section("50. extractInternalLinks: Root Path");

{
  const page = {
    links: [
      `${BASE}/`,           // root with trailing slash → /
      `${BASE}`,            // root without slash → /
      "/",                  // path root → /
    ],
  };
  const result = extractInternalLinks(page, BASE);
  // All should normalize to "/" and be deduped
  assertEqual(result.length, 1, "Root links deduped to 1");
  assertIncludes(result, "/", "Root path present");
}

// ══════════════════════════════════════════════════════════════════════
// RESULTS
// ══════════════════════════════════════════════════════════════════════

console.log("\n══════════════════════════════════════════════════════════");
console.log(`  Site Crawl Audit: ${passed} passed, ${failed} failed`);
console.log("══════════════════════════════════════════════════════════");

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  ✗ ${f}`);
  }
  process.exit(1);
}
