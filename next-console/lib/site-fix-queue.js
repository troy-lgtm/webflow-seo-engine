/**
 * site-fix-queue.js — Fix Queue Engine for Live Site Crawl Audit
 *
 * Pure, deterministic functions that convert crawl audit issues into
 * a ranked list of actionable fix queue items. Each item includes:
 *   - issue_type, target_urls, severity, confidence
 *   - estimated_impact, suggested_action, rationale, evidence, source
 *
 * No I/O, no fetch calls. All functions are pure and testable.
 * The script (scripts/build-site-fix-queue.js) handles file I/O.
 *
 * @module site-fix-queue
 */

// ── Constants ────────────────────────────────────────────────────────

/** Issue type identifiers. */
export const ISSUE_TYPES = {
  ORPHAN_PAGE: "orphan_page",
  LANE_MISSING_AUTHORITY: "lane_missing_authority_links",
  AUTHORITY_MISSING_LANE: "authority_missing_lane_links",
  DUPLICATE_TITLE: "duplicate_title_group",
  WEAK_PAGE: "weak_page_candidate",
};

/** Severity levels (higher number = more severe). */
export const SEVERITY = {
  CRITICAL: { label: "critical", weight: 100 },
  HIGH: { label: "high", weight: 75 },
  MEDIUM: { label: "medium", weight: 50 },
  LOW: { label: "low", weight: 25 },
};

/** Base severity assigned to each issue type. */
export const ISSUE_SEVERITY_MAP = {
  [ISSUE_TYPES.ORPHAN_PAGE]: SEVERITY.CRITICAL,
  [ISSUE_TYPES.LANE_MISSING_AUTHORITY]: SEVERITY.HIGH,
  [ISSUE_TYPES.AUTHORITY_MISSING_LANE]: SEVERITY.HIGH,
  [ISSUE_TYPES.DUPLICATE_TITLE]: SEVERITY.MEDIUM,
  [ISSUE_TYPES.WEAK_PAGE]: SEVERITY.MEDIUM,
};

/** Confidence levels per issue type (how certain we are this is a real problem). */
export const ISSUE_CONFIDENCE_MAP = {
  [ISSUE_TYPES.ORPHAN_PAGE]: 0.95,
  [ISSUE_TYPES.LANE_MISSING_AUTHORITY]: 0.90,
  [ISSUE_TYPES.AUTHORITY_MISSING_LANE]: 0.90,
  [ISSUE_TYPES.DUPLICATE_TITLE]: 0.85,
  [ISSUE_TYPES.WEAK_PAGE]: 0.70,
};

/** Page type impact multipliers (lane pages are revenue-generating). */
export const PAGE_TYPE_IMPACT = {
  lane: 1.0,
  authority: 0.8,
  other: 0.4,
};

// ── Queue Item ID Generation ─────────────────────────────────────────

/**
 * Generate a deterministic queue item ID from issue type and target.
 *
 * @param {string} issueType - One of ISSUE_TYPES values
 * @param {string} target - Primary target identifier (path or title)
 * @returns {string} Deterministic ID
 */
export function generateItemId(issueType, target) {
  const sanitized = target
    .replace(/^\//, "")
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 60);
  return `${issueType}--${sanitized}`;
}

// ── Page Type Classification ─────────────────────────────────────────

/**
 * Classify a path into page type for impact scoring.
 *
 * @param {string} path - URL path
 * @returns {"lane"|"authority"|"other"}
 */
export function classifyPathType(path) {
  if (path.startsWith("/lanes/")) return "lane";
  if (path.startsWith("/solutions/") || path.startsWith("/network/") || path.startsWith("/equipment/")) return "authority";
  return "other";
}

// ── Issue Normalizers ────────────────────────────────────────────────

/**
 * Normalize orphan page issues into queue items.
 *
 * @param {object} orphanIssues - { count, paths }
 * @param {string} baseUrl - Site base URL
 * @returns {object[]} Queue items
 */
export function normalizeOrphans(orphanIssues, baseUrl) {
  if (!orphanIssues || !Array.isArray(orphanIssues.paths)) return [];

  return orphanIssues.paths.map(path => {
    const pageType = classifyPathType(path);
    return {
      id: generateItemId(ISSUE_TYPES.ORPHAN_PAGE, path),
      issue_type: ISSUE_TYPES.ORPHAN_PAGE,
      target_urls: [`${baseUrl}${path}`],
      severity: ISSUE_SEVERITY_MAP[ISSUE_TYPES.ORPHAN_PAGE].label,
      confidence: ISSUE_CONFIDENCE_MAP[ISSUE_TYPES.ORPHAN_PAGE],
      estimated_impact: computeImpact(ISSUE_TYPES.ORPHAN_PAGE, pageType, 1),
      suggested_action: `Add inbound links to ${path} from related pages (homepage, sibling pages, or parent category).`,
      rationale: `This ${pageType} page has zero inbound internal links. Search engines may not discover or properly index orphaned pages, reducing their ranking potential.`,
      evidence: { path, page_type: pageType, inbound_links: 0 },
      source: "site-crawl-audit",
    };
  });
}

/**
 * Normalize lane-missing-authority issues into queue items.
 *
 * @param {object} laneIssues - { count, paths }
 * @param {string} baseUrl
 * @returns {object[]}
 */
export function normalizeLanesMissingAuthority(laneIssues, baseUrl) {
  if (!laneIssues || !Array.isArray(laneIssues.paths)) return [];

  return laneIssues.paths.map(path => ({
    id: generateItemId(ISSUE_TYPES.LANE_MISSING_AUTHORITY, path),
    issue_type: ISSUE_TYPES.LANE_MISSING_AUTHORITY,
    target_urls: [`${baseUrl}${path}`],
    severity: ISSUE_SEVERITY_MAP[ISSUE_TYPES.LANE_MISSING_AUTHORITY].label,
    confidence: ISSUE_CONFIDENCE_MAP[ISSUE_TYPES.LANE_MISSING_AUTHORITY],
    estimated_impact: computeImpact(ISSUE_TYPES.LANE_MISSING_AUTHORITY, "lane", 1),
    suggested_action: `Add authority page links to ${path}. Regenerate with authority link injection enabled, or manually insert links to relevant /solutions/, /network/, or /equipment/ pages.`,
    rationale: `Lane page lacks outbound links to authority pages. Bidirectional lane↔authority linking strengthens topical relevance signals for both pages.`,
    evidence: { path, page_type: "lane", outbound_authority_links: 0 },
    source: "site-crawl-audit",
  }));
}

/**
 * Normalize authority-missing-lane issues into queue items.
 *
 * @param {object} authIssues - { count, paths }
 * @param {string} baseUrl
 * @returns {object[]}
 */
export function normalizeAuthorityMissingLanes(authIssues, baseUrl) {
  if (!authIssues || !Array.isArray(authIssues.paths)) return [];

  return authIssues.paths.map(path => {
    const family = path.startsWith("/solutions/") ? "solution"
      : path.startsWith("/network/") ? "concept"
      : path.startsWith("/equipment/") ? "equipment"
      : "unknown";
    return {
      id: generateItemId(ISSUE_TYPES.AUTHORITY_MISSING_LANE, path),
      issue_type: ISSUE_TYPES.AUTHORITY_MISSING_LANE,
      target_urls: [`${baseUrl}${path}`],
      severity: ISSUE_SEVERITY_MAP[ISSUE_TYPES.AUTHORITY_MISSING_LANE].label,
      confidence: ISSUE_CONFIDENCE_MAP[ISSUE_TYPES.AUTHORITY_MISSING_LANE],
      estimated_impact: computeImpact(ISSUE_TYPES.AUTHORITY_MISSING_LANE, "authority", 1),
      suggested_action: `Add lane page links to ${path}. Regenerate with associated lanes rendering enabled, or manually insert links to relevant /lanes/ pages.`,
      rationale: `Authority page (${family}) lacks outbound links to lane pages. Bidirectional authority↔lane linking distributes link equity and strengthens topical clusters.`,
      evidence: { path, page_type: "authority", family, outbound_lane_links: 0 },
      source: "site-crawl-audit",
    };
  });
}

/**
 * Normalize duplicate title issues into queue items.
 *
 * @param {object} dupIssues - { count, groups: [{ title, paths }] }
 * @param {string} baseUrl
 * @returns {object[]}
 */
export function normalizeDuplicateTitles(dupIssues, baseUrl) {
  if (!dupIssues || !Array.isArray(dupIssues.groups)) return [];

  return dupIssues.groups.map(group => ({
    id: generateItemId(ISSUE_TYPES.DUPLICATE_TITLE, group.title),
    issue_type: ISSUE_TYPES.DUPLICATE_TITLE,
    target_urls: group.paths.map(p => `${baseUrl}${p}`),
    severity: ISSUE_SEVERITY_MAP[ISSUE_TYPES.DUPLICATE_TITLE].label,
    confidence: ISSUE_CONFIDENCE_MAP[ISSUE_TYPES.DUPLICATE_TITLE],
    estimated_impact: computeImpact(ISSUE_TYPES.DUPLICATE_TITLE, "lane", group.paths.length),
    suggested_action: `Differentiate titles for ${group.paths.length} pages sharing "${group.title}". Add unique origin/destination keywords or mode qualifiers to each page title.`,
    rationale: `${group.paths.length} pages share identical title "${group.title}". Duplicate titles cause keyword cannibalization and confuse search engines about which page to rank.`,
    evidence: { title: group.title, affected_paths: group.paths, duplicate_count: group.paths.length },
    source: "site-crawl-audit",
  }));
}

/**
 * Normalize weak page issues into queue items.
 *
 * @param {object} weakIssues - { count, threshold, pages: [{ path, type, contentLength }] }
 * @param {string} baseUrl
 * @returns {object[]}
 */
export function normalizeWeakPages(weakIssues, baseUrl) {
  if (!weakIssues || !Array.isArray(weakIssues.pages)) return [];

  const threshold = weakIssues.threshold || 500;

  return weakIssues.pages.map(page => ({
    id: generateItemId(ISSUE_TYPES.WEAK_PAGE, page.path),
    issue_type: ISSUE_TYPES.WEAK_PAGE,
    target_urls: [`${baseUrl}${page.path}`],
    severity: ISSUE_SEVERITY_MAP[ISSUE_TYPES.WEAK_PAGE].label,
    confidence: ISSUE_CONFIDENCE_MAP[ISSUE_TYPES.WEAK_PAGE],
    estimated_impact: computeImpact(ISSUE_TYPES.WEAK_PAGE, page.type, 1),
    suggested_action: `Expand content on ${page.path}. Current content is ${page.contentLength} chars, minimum threshold is ${threshold}. Regenerate page or add manual content to reach at least ${threshold} characters.`,
    rationale: `This ${page.type} page has only ${page.contentLength} characters of content (threshold: ${threshold}). Thin content pages rank poorly and may be considered low-quality by search engines.`,
    evidence: { path: page.path, page_type: page.type, content_length: page.contentLength, threshold },
    source: "site-crawl-audit",
  }));
}

// ── Impact Scoring ───────────────────────────────────────────────────

/**
 * Compute estimated impact score (0–100) for a queue item.
 * Combines issue severity weight, page type importance, and scale factor.
 *
 * @param {string} issueType - Issue type identifier
 * @param {string} pageType - "lane", "authority", or "other"
 * @param {number} affectedCount - Number of affected pages/instances
 * @returns {number} Impact score 0–100, rounded to 1 decimal
 */
export function computeImpact(issueType, pageType, affectedCount) {
  const severityWeight = (ISSUE_SEVERITY_MAP[issueType] || SEVERITY.LOW).weight;
  const pageMultiplier = PAGE_TYPE_IMPACT[pageType] || PAGE_TYPE_IMPACT.other;

  // Scale factor: more affected pages = slightly higher impact (diminishing returns)
  const scaleFactor = 1 + Math.log2(Math.max(1, affectedCount)) * 0.1;

  const raw = severityWeight * pageMultiplier * scaleFactor;

  // Normalize to 0–100 range (max possible is 100 * 1.0 * ~1.4 = 140, cap at 100)
  return Number(Math.min(100, raw).toFixed(1));
}

// ── Priority Scoring & Sorting ───────────────────────────────────────

/**
 * Compute a composite priority score for sorting.
 * Higher = more urgent.
 *
 * @param {object} item - Queue item
 * @returns {number}
 */
export function computePriorityScore(item) {
  const severityWeight = (ISSUE_SEVERITY_MAP[item.issue_type] || SEVERITY.LOW).weight;
  return severityWeight * item.confidence * (item.estimated_impact / 100);
}

/**
 * Sort queue items by priority: severity desc → impact desc → id asc.
 * Deterministic: same input always produces same output.
 *
 * @param {object[]} items - Unsorted queue items
 * @returns {object[]} Sorted queue items with priority_rank added
 */
export function sortByPriority(items) {
  const scored = items.map(item => ({
    ...item,
    _priority_score: computePriorityScore(item),
  }));

  scored.sort((a, b) => {
    // Primary: priority score descending
    if (a._priority_score !== b._priority_score) {
      return b._priority_score - a._priority_score;
    }
    // Secondary: estimated impact descending
    if (a.estimated_impact !== b.estimated_impact) {
      return b.estimated_impact - a.estimated_impact;
    }
    // Tertiary: id ascending (deterministic tiebreaker)
    return a.id.localeCompare(b.id);
  });

  // Add rank, remove internal score
  return scored.map((item, idx) => {
    const { _priority_score, ...rest } = item;
    return { ...rest, priority_rank: idx + 1 };
  });
}

// ── Full Queue Builder ───────────────────────────────────────────────

/**
 * Build a complete fix queue from a crawl audit report.
 * Deterministic: same audit input always produces same queue output.
 *
 * @param {object} auditReport - Full crawl audit report (from site-crawl-audit.json)
 * @returns {object} Fix queue artifact
 */
export function buildFixQueue(auditReport) {
  if (!auditReport || !auditReport.issues) {
    return buildEmptyQueue(auditReport);
  }

  const baseUrl = auditReport.crawl?.base_url || "https://www.wearewarp.com";
  const issues = auditReport.issues;

  // Normalize all issue types into queue items
  const allItems = [
    ...normalizeOrphans(issues.orphan_pages, baseUrl),
    ...normalizeLanesMissingAuthority(issues.lanes_missing_authority_links, baseUrl),
    ...normalizeAuthorityMissingLanes(issues.authority_missing_lane_links, baseUrl),
    ...normalizeDuplicateTitles(issues.duplicate_titles, baseUrl),
    ...normalizeWeakPages(issues.weak_pages, baseUrl),
  ];

  // Sort and rank
  const rankedItems = sortByPriority(allItems);

  // Build severity summary
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of rankedItems) {
    severityCounts[item.severity] = (severityCounts[item.severity] || 0) + 1;
  }

  // Build issue type summary
  const typeCounts = {};
  for (const item of rankedItems) {
    typeCounts[item.issue_type] = (typeCounts[item.issue_type] || 0) + 1;
  }

  return {
    _version: "1.0.0",
    _generated_by: "build-site-fix-queue.js",

    metadata: {
      source_audit: auditReport.crawl?.timestamp || null,
      base_url: baseUrl,
      pages_audited: auditReport.inventory?.total || 0,
      audit_health: auditReport.summary?.health || "unknown",
      total_issues_in_audit: auditReport.summary?.total_issues || 0,
    },

    summary: {
      total_queue_items: rankedItems.length,
      by_severity: severityCounts,
      by_type: typeCounts,
    },

    queue: rankedItems,
  };
}

/**
 * Build an empty queue result for missing/invalid audit input.
 *
 * @param {object} [auditReport]
 * @returns {object}
 */
function buildEmptyQueue(auditReport) {
  return {
    _version: "1.0.0",
    _generated_by: "build-site-fix-queue.js",
    metadata: {
      source_audit: auditReport?.crawl?.timestamp || null,
      base_url: auditReport?.crawl?.base_url || "https://www.wearewarp.com",
      pages_audited: 0,
      audit_health: "unknown",
      total_issues_in_audit: 0,
    },
    summary: {
      total_queue_items: 0,
      by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
      by_type: {},
    },
    queue: [],
  };
}
