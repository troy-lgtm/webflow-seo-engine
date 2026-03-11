/**
 * crawl-auditor.js — Pure Audit Logic for Live Site Crawl
 *
 * Deterministic functions for:
 *   - Page classification (lane, authority, other)
 *   - Internal link extraction and normalization
 *   - Live link graph construction
 *   - Issue detection (orphans, missing links, duplicates, weak pages)
 *   - Audit report assembly
 *
 * No I/O, no fetch calls. All functions are pure and testable.
 * The script (scripts/site-crawl-audit.js) handles Cloudflare API interaction.
 *
 * @module crawl-auditor
 */

// ── Constants ────────────────────────────────────────────────────────

const BASE_URL = "https://www.wearewarp.com";

/** Minimum content length (chars) below which a page is flagged as weak. */
export const WEAK_PAGE_THRESHOLD = 500;

/** URL path prefixes for authority page families. */
export const AUTHORITY_PREFIXES = {
  solution: "/solutions/",
  concept: "/network/",
  equipment: "/equipment/",
};

/** URL path prefix for lane pages. */
export const LANE_PREFIX = "/lanes/";

// ── Page Classification ──────────────────────────────────────────────

/**
 * Classify a URL into page type.
 *
 * @param {string} url - Absolute or relative URL
 * @returns {{ type: "lane"|"authority"|"other", slug: string|null, family: string|null }}
 */
export function classifyPage(url) {
  const path = extractPath(url);

  // Lane pages: /lanes/{slug}
  if (path.startsWith(LANE_PREFIX)) {
    const slug = path.slice(LANE_PREFIX.length).replace(/\/$/, "");
    if (slug && !slug.includes("/")) {
      return { type: "lane", slug, family: null };
    }
  }

  // Authority pages: /solutions/{slug}, /network/{slug}, /equipment/{slug}
  for (const [family, prefix] of Object.entries(AUTHORITY_PREFIXES)) {
    if (path.startsWith(prefix)) {
      const slug = path.slice(prefix.length).replace(/\/$/, "");
      if (slug && !slug.includes("/")) {
        return { type: "authority", slug, family };
      }
    }
  }

  return { type: "other", slug: null, family: null };
}

/**
 * Extract the path from a URL, stripping protocol and host.
 * @param {string} url
 * @returns {string}
 */
export function extractPath(url) {
  if (!url) return "/";
  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return new URL(url).pathname;
    }
    // Already a path
    return url.startsWith("/") ? url : `/${url}`;
  } catch {
    return url.startsWith("/") ? url : `/${url}`;
  }
}

// ── Link Extraction ──────────────────────────────────────────────────

/**
 * Extract internal links from a crawled page's link list.
 * Normalizes all links to paths, filters to same-site only.
 *
 * @param {object} page - Crawled page object with `links` array
 * @param {string} [baseUrl] - Base URL for resolving relative links
 * @returns {string[]} Unique sorted array of internal paths
 */
export function extractInternalLinks(page, baseUrl = BASE_URL) {
  const rawLinks = page.links || [];
  const host = extractHost(baseUrl);
  const seen = new Set();

  for (const link of rawLinks) {
    const href = typeof link === "string" ? link : link.href || link.url || "";
    if (!href) continue;

    // Resolve to absolute
    let absolute;
    try {
      if (href.startsWith("http://") || href.startsWith("https://")) {
        absolute = new URL(href);
      } else if (href.startsWith("/")) {
        absolute = new URL(href, baseUrl);
      } else if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        continue;
      } else {
        absolute = new URL(href, baseUrl);
      }
    } catch {
      continue;
    }

    // Filter to same host
    if (absolute.hostname !== host) continue;

    // Normalize: strip trailing slash, query, hash
    let path = absolute.pathname.replace(/\/$/, "") || "/";
    seen.add(path);
  }

  return [...seen].sort();
}

/**
 * Extract hostname from a URL.
 * @param {string} url
 * @returns {string}
 */
function extractHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "www.wearewarp.com";
  }
}

// ── Live Graph Construction ──────────────────────────────────────────

/**
 * Build a live internal link graph from crawled pages.
 *
 * @param {object[]} pages - Array of crawled page objects
 * @param {string} [baseUrl] - Base URL
 * @returns {{
 *   nodes: Map<string, { url: string, path: string, type: string, slug: string|null, family: string|null, title: string, h1: string, canonical: string, contentLength: number }>,
 *   edges: Map<string, string[]>,
 *   lanePages: string[],
 *   authorityPages: string[],
 *   otherPages: string[]
 * }}
 */
export function buildLiveGraph(pages, baseUrl = BASE_URL) {
  const nodes = new Map();
  const edges = new Map();
  const lanePages = [];
  const authorityPages = [];
  const otherPages = [];

  for (const page of pages) {
    const url = page.url || "";
    const path = extractPath(url);
    const classification = classifyPage(url);
    const internalLinks = extractInternalLinks(page, baseUrl);

    const node = {
      url,
      path,
      type: classification.type,
      slug: classification.slug,
      family: classification.family,
      title: page.title || "",
      h1: page.h1 || page.heading || "",
      canonical: page.canonical || "",
      contentLength: page.contentLength || page.content_length || (page.text || "").length || 0,
    };

    nodes.set(path, node);
    edges.set(path, internalLinks);

    if (classification.type === "lane") lanePages.push(path);
    else if (classification.type === "authority") authorityPages.push(path);
    else otherPages.push(path);
  }

  // Sort for deterministic output
  lanePages.sort();
  authorityPages.sort();
  otherPages.sort();

  return { nodes, edges, lanePages, authorityPages, otherPages };
}

// ── Issue Detection ──────────────────────────────────────────────────

/**
 * Detect orphan pages — pages with no inbound links from other crawled pages.
 *
 * @param {{ nodes: Map, edges: Map }} graph - Live graph
 * @returns {string[]} Sorted array of orphan page paths
 */
export function detectOrphans(graph) {
  const { nodes, edges } = graph;
  const allPaths = new Set(nodes.keys());
  const linked = new Set();

  // Collect all paths that receive at least one inbound link
  for (const [sourcePath, targets] of edges) {
    for (const target of targets) {
      if (allPaths.has(target) && target !== sourcePath) {
        linked.add(target);
      }
    }
  }

  // Orphans = crawled pages that have no inbound links (excluding homepage)
  const orphans = [];
  for (const path of allPaths) {
    if (path === "/" || path === "") continue;
    if (!linked.has(path)) {
      orphans.push(path);
    }
  }

  return orphans.sort();
}

/**
 * Detect lane pages missing authority links.
 * A lane page should link to at least one authority page.
 *
 * @param {{ nodes: Map, edges: Map, lanePages: string[], authorityPages: string[] }} graph
 * @returns {string[]} Lane paths missing authority links
 */
export function detectLanesMissingAuthorityLinks(graph) {
  const { edges, lanePages, authorityPages } = graph;
  const authoritySet = new Set(authorityPages);
  const missing = [];

  for (const lanePath of lanePages) {
    const outbound = edges.get(lanePath) || [];
    const hasAuthorityLink = outbound.some(link => authoritySet.has(link));
    if (!hasAuthorityLink) {
      missing.push(lanePath);
    }
  }

  return missing.sort();
}

/**
 * Detect authority pages missing lane links.
 * An authority page should link to at least one lane page.
 *
 * @param {{ nodes: Map, edges: Map, lanePages: string[], authorityPages: string[] }} graph
 * @returns {string[]} Authority paths missing lane links
 */
export function detectAuthorityMissingLaneLinks(graph) {
  const { edges, lanePages, authorityPages } = graph;
  const laneSet = new Set(lanePages);
  const missing = [];

  for (const authPath of authorityPages) {
    const outbound = edges.get(authPath) || [];
    const hasLaneLink = outbound.some(link => laneSet.has(link));
    if (!hasLaneLink) {
      missing.push(authPath);
    }
  }

  return missing.sort();
}

/**
 * Detect duplicate titles across all crawled pages.
 *
 * @param {{ nodes: Map }} graph
 * @returns {Array<{ title: string, paths: string[] }>} Groups with 2+ pages sharing a title
 */
export function detectDuplicateTitles(graph) {
  const titleMap = new Map();

  for (const [path, node] of graph.nodes) {
    const title = (node.title || "").trim();
    if (!title) continue;
    if (!titleMap.has(title)) titleMap.set(title, []);
    titleMap.get(title).push(path);
  }

  const duplicates = [];
  for (const [title, paths] of titleMap) {
    if (paths.length >= 2) {
      duplicates.push({ title, paths: paths.sort() });
    }
  }

  return duplicates.sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Detect suspiciously weak pages — pages with very low content length.
 *
 * @param {{ nodes: Map }} graph
 * @param {number} [threshold] - Minimum content length in chars
 * @returns {Array<{ path: string, type: string, contentLength: number }>}
 */
export function detectWeakPages(graph, threshold = WEAK_PAGE_THRESHOLD) {
  const weak = [];

  for (const [path, node] of graph.nodes) {
    if (path === "/" || path === "") continue;
    if (node.type === "other") continue; // Only flag lane + authority pages
    if (node.contentLength < threshold) {
      weak.push({
        path,
        type: node.type,
        contentLength: node.contentLength,
      });
    }
  }

  return weak.sort((a, b) => a.path.localeCompare(b.path));
}

// ── Audit Report Assembly ────────────────────────────────────────────

/**
 * Build a structured audit report from crawl results and detected issues.
 * Output is fully deterministic — same input always produces same report.
 *
 * @param {object} crawlMeta - Crawl metadata (timestamp, page count, etc.)
 * @param {object} graph - Live graph from buildLiveGraph()
 * @param {object} issues - Detected issues
 * @returns {object} Structured audit report
 */
export function buildAuditReport(crawlMeta, graph, issues) {
  const { nodes, edges, lanePages, authorityPages, otherPages } = graph;

  // Compute edge statistics
  let totalEdges = 0;
  for (const targets of edges.values()) {
    totalEdges += targets.length;
  }

  return {
    _version: "1.0.0",
    _generated_by: "site-crawl-audit.js",

    // ── Crawl Metadata ─────────────────────────────────────────
    crawl: {
      timestamp: crawlMeta.timestamp || new Date().toISOString(),
      base_url: crawlMeta.baseUrl || BASE_URL,
      pages_crawled: nodes.size,
      crawl_duration_ms: crawlMeta.durationMs || 0,
    },

    // ── Page Inventory ─────────────────────────────────────────
    inventory: {
      total: nodes.size,
      lane_pages: lanePages.length,
      authority_pages: authorityPages.length,
      other_pages: otherPages.length,
      lane_paths: lanePages,
      authority_paths: authorityPages,
    },

    // ── Link Graph Summary ─────────────────────────────────────
    link_graph: {
      total_internal_links: totalEdges,
      avg_links_per_page: nodes.size > 0
        ? Number((totalEdges / nodes.size).toFixed(1))
        : 0,
    },

    // ── Issues ─────────────────────────────────────────────────
    issues: {
      orphan_pages: {
        count: issues.orphans.length,
        paths: issues.orphans,
      },
      lanes_missing_authority_links: {
        count: issues.lanesMissingAuthority.length,
        paths: issues.lanesMissingAuthority,
      },
      authority_missing_lane_links: {
        count: issues.authorityMissingLanes.length,
        paths: issues.authorityMissingLanes,
      },
      duplicate_titles: {
        count: issues.duplicateTitles.length,
        groups: issues.duplicateTitles,
      },
      weak_pages: {
        count: issues.weakPages.length,
        threshold: issues.weakPageThreshold || WEAK_PAGE_THRESHOLD,
        pages: issues.weakPages,
      },
    },

    // ── Summary ────────────────────────────────────────────────
    summary: {
      total_issues:
        issues.orphans.length +
        issues.lanesMissingAuthority.length +
        issues.authorityMissingLanes.length +
        issues.duplicateTitles.length +
        issues.weakPages.length,
      health: computeHealth(issues, nodes.size),
    },
  };
}

/**
 * Compute a health status based on issue counts.
 * @param {object} issues
 * @param {number} totalPages
 * @returns {"healthy"|"warning"|"critical"}
 */
function computeHealth(issues, totalPages) {
  const totalIssues =
    issues.orphans.length +
    issues.lanesMissingAuthority.length +
    issues.authorityMissingLanes.length +
    issues.duplicateTitles.length +
    issues.weakPages.length;

  if (totalPages === 0) return "critical";
  const issueRate = totalIssues / totalPages;
  if (issueRate > 0.5) return "critical";
  if (issueRate > 0.2) return "warning";
  return "healthy";
}
