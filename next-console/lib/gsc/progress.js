/**
 * SEO Progress Calculations
 *
 * Derived metrics and trend analysis built on top of the GSC data store.
 * All functions are pure — read from store, compute, return.
 *
 * Capabilities:
 * - Day/week/month over period changes
 * - Rolling averages (7d, 28d)
 * - Top gaining/losing pages and queries
 * - Rising impressions with flat clicks
 * - Position movers
 * - Newly appearing queries
 * - Branded vs non-branded splits
 * - Priority page tracking
 */

import { queryRows, getDistinctDates } from "./store.js";
import { loadGscConfig } from "./config.js";

// ── Date helpers ─────────────────────────────────────────────────────

function daysAgoStr(n, from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Site-level summaries ─────────────────────────────────────────────

/**
 * Get site summary comparing current period vs prior period.
 *
 * @param {string} siteUrl
 * @param {number} days - Period length (7, 28, 90)
 * @returns {{ current: object, prior: object, delta: object }}
 */
export function siteSummary(siteUrl, days = 7) {
  const endDate = today();
  const currentStart = daysAgoStr(days);
  const priorStart = daysAgoStr(days * 2);
  const priorEnd = daysAgoStr(days + 1);

  const current = aggregateMetrics(
    queryRows("site", { site_url: siteUrl, dateFrom: currentStart, dateTo: endDate })
  );
  const prior = aggregateMetrics(
    queryRows("site", { site_url: siteUrl, dateFrom: priorStart, dateTo: priorEnd })
  );

  return {
    period: `${days}d`,
    current,
    prior,
    delta: computeDelta(current, prior),
  };
}

/**
 * Rolling metrics for a site.
 */
export function siteRolling(siteUrl) {
  const endDate = today();
  const rows = queryRows("site", { site_url: siteUrl, dateFrom: daysAgoStr(90), dateTo: endDate });

  return {
    rolling_7d: aggregateMetrics(rows.filter(r => r.date >= daysAgoStr(7))),
    rolling_28d: aggregateMetrics(rows.filter(r => r.date >= daysAgoStr(28))),
    rolling_90d: aggregateMetrics(rows),
    daily: rows
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(r => ({
        date: r.date,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: r.ctr,
        average_position: r.average_position,
      })),
  };
}

// ── Page leaderboards ────────────────────────────────────────────────

/**
 * Top gaining/losing pages by clicks.
 */
export function pageLeaderboard(siteUrl, { days = 7, limit = 20 } = {}) {
  const endDate = today();
  const currentStart = daysAgoStr(days);
  const priorStart = daysAgoStr(days * 2);
  const priorEnd = daysAgoStr(days + 1);

  const currentRows = queryRows("page", { site_url: siteUrl, dateFrom: currentStart, dateTo: endDate });
  const priorRows = queryRows("page", { site_url: siteUrl, dateFrom: priorStart, dateTo: priorEnd });

  const currentByPage = groupBy(currentRows, "page");
  const priorByPage = groupBy(priorRows, "page");

  const allPages = new Set([...Object.keys(currentByPage), ...Object.keys(priorByPage)]);
  const scored = [];

  for (const page of allPages) {
    const curr = aggregateMetrics(currentByPage[page] || []);
    const prev = aggregateMetrics(priorByPage[page] || []);
    scored.push({
      page,
      current_clicks: curr.clicks,
      prior_clicks: prev.clicks,
      click_delta: curr.clicks - prev.clicks,
      current_impressions: curr.impressions,
      prior_impressions: prev.impressions,
      impression_delta: curr.impressions - prev.impressions,
      current_position: curr.average_position,
      prior_position: prev.average_position,
      position_delta: prev.average_position > 0 ? round(prev.average_position - curr.average_position, 2) : 0,
      current_ctr: curr.ctr,
      prior_ctr: prev.ctr,
    });
  }

  const sorted = scored.sort((a, b) => b.click_delta - a.click_delta);

  return {
    gaining: sorted.slice(0, limit),
    losing: sorted.slice(-limit).reverse(),
    total_pages: allPages.size,
  };
}

/**
 * Pages with rising impressions but flat/declining clicks.
 */
export function risingImpressionsFlatClicks(siteUrl, { days = 7, limit = 20 } = {}) {
  const lb = pageLeaderboard(siteUrl, { days, limit: 1000 });
  return lb.gaining
    .concat(lb.losing)
    .filter(p =>
      p.impression_delta > 10 &&
      p.click_delta <= 0 &&
      p.current_impressions > 20
    )
    .sort((a, b) => b.impression_delta - a.impression_delta)
    .slice(0, limit);
}

/**
 * Pages with improving average position.
 */
export function positionImprovers(siteUrl, { days = 7, limit = 20 } = {}) {
  const lb = pageLeaderboard(siteUrl, { days, limit: 1000 });
  return lb.gaining
    .concat(lb.losing)
    .filter(p => p.position_delta > 0 && p.current_impressions > 5)
    .sort((a, b) => b.position_delta - a.position_delta)
    .slice(0, limit);
}

/**
 * Pages with declining average position.
 */
export function positionDecliners(siteUrl, { days = 7, limit = 20 } = {}) {
  const lb = pageLeaderboard(siteUrl, { days, limit: 1000 });
  return lb.gaining
    .concat(lb.losing)
    .filter(p => p.position_delta < 0 && p.current_impressions > 5)
    .sort((a, b) => a.position_delta - b.position_delta)
    .slice(0, limit);
}

// ── Query leaderboards ───────────────────────────────────────────────

/**
 * Top gaining/losing queries by clicks.
 */
export function queryLeaderboard(siteUrl, { days = 7, limit = 20 } = {}) {
  const endDate = today();
  const currentStart = daysAgoStr(days);
  const priorStart = daysAgoStr(days * 2);
  const priorEnd = daysAgoStr(days + 1);

  const currentRows = queryRows("query", { site_url: siteUrl, dateFrom: currentStart, dateTo: endDate });
  const priorRows = queryRows("query", { site_url: siteUrl, dateFrom: priorStart, dateTo: priorEnd });

  const currentByQuery = groupBy(currentRows, "query");
  const priorByQuery = groupBy(priorRows, "query");

  const allQueries = new Set([...Object.keys(currentByQuery), ...Object.keys(priorByQuery)]);
  const scored = [];

  for (const query of allQueries) {
    const curr = aggregateMetrics(currentByQuery[query] || []);
    const prev = aggregateMetrics(priorByQuery[query] || []);
    scored.push({
      query,
      current_clicks: curr.clicks,
      prior_clicks: prev.clicks,
      click_delta: curr.clicks - prev.clicks,
      current_impressions: curr.impressions,
      impression_delta: curr.impressions - prev.impressions,
      current_position: curr.average_position,
      position_delta: prev.average_position > 0 ? round(prev.average_position - curr.average_position, 2) : 0,
    });
  }

  const sorted = scored.sort((a, b) => b.click_delta - a.click_delta);

  return {
    gaining: sorted.slice(0, limit),
    losing: sorted.slice(-limit).reverse(),
    total_queries: allQueries.size,
  };
}

/**
 * Queries that appeared in the last N days but NOT in the prior period.
 */
export function newQueries(siteUrl, { days = 7, limit = 50 } = {}) {
  const endDate = today();
  const currentStart = daysAgoStr(days);
  const priorStart = daysAgoStr(days * 2);
  const priorEnd = daysAgoStr(days + 1);

  const currentRows = queryRows("query", { site_url: siteUrl, dateFrom: currentStart, dateTo: endDate });
  const priorRows = queryRows("query", { site_url: siteUrl, dateFrom: priorStart, dateTo: priorEnd });

  const priorQueries = new Set(priorRows.map(r => r.query));
  const currentByQuery = groupBy(currentRows, "query");

  const newOnes = [];
  for (const [query, rows] of Object.entries(currentByQuery)) {
    if (!priorQueries.has(query)) {
      const agg = aggregateMetrics(rows);
      newOnes.push({ query, ...agg });
    }
  }

  return newOnes
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

// ── Branded vs non-branded ───────────────────────────────────────────

/**
 * Split query performance into branded and non-branded.
 */
export function brandedVsNonBranded(siteUrl, { days = 7 } = {}) {
  const config = loadGscConfig();
  const brandKeywords = (config.brand_keywords || ["warp", "wearewarp"]).map(k => k.toLowerCase());

  const endDate = today();
  const currentStart = daysAgoStr(days);
  const priorStart = daysAgoStr(days * 2);
  const priorEnd = daysAgoStr(days + 1);

  const currentRows = queryRows("query", { site_url: siteUrl, dateFrom: currentStart, dateTo: endDate });
  const priorRows = queryRows("query", { site_url: siteUrl, dateFrom: priorStart, dateTo: priorEnd });

  function isBranded(q) {
    const lower = (q || "").toLowerCase();
    return brandKeywords.some(bk => lower.includes(bk));
  }

  const curBranded = aggregateMetrics(currentRows.filter(r => isBranded(r.query)));
  const curNonBranded = aggregateMetrics(currentRows.filter(r => !isBranded(r.query)));
  const priBranded = aggregateMetrics(priorRows.filter(r => isBranded(r.query)));
  const priNonBranded = aggregateMetrics(priorRows.filter(r => !isBranded(r.query)));

  return {
    branded: {
      current: curBranded,
      prior: priBranded,
      delta: computeDelta(curBranded, priBranded),
    },
    non_branded: {
      current: curNonBranded,
      prior: priNonBranded,
      delta: computeDelta(curNonBranded, priNonBranded),
    },
  };
}

/**
 * Check if a query is branded.
 */
export function isBrandedQuery(query) {
  const config = loadGscConfig();
  const brandKeywords = (config.brand_keywords || ["warp", "wearewarp"]).map(k => k.toLowerCase());
  const lower = (query || "").toLowerCase();
  return brandKeywords.some(bk => lower.includes(bk));
}

// ── Priority pages ───────────────────────────────────────────────────

/**
 * Performance of priority/target pages.
 */
export function priorityPagePerformance(siteUrl, { days = 7 } = {}) {
  const config = loadGscConfig();
  const patterns = config.priority_page_patterns || [];

  if (patterns.length === 0) return { pages: [], patterns: [] };

  const endDate = today();
  const currentStart = daysAgoStr(days);
  const priorStart = daysAgoStr(days * 2);
  const priorEnd = daysAgoStr(days + 1);

  const currentRows = queryRows("page", { site_url: siteUrl, dateFrom: currentStart, dateTo: endDate });
  const priorRows = queryRows("page", { site_url: siteUrl, dateFrom: priorStart, dateTo: priorEnd });

  function matchesAnyPattern(pageUrl) {
    return patterns.some(p => pageUrl.includes(p));
  }

  const curMatched = currentRows.filter(r => matchesAnyPattern(r.page));
  const priMatched = priorRows.filter(r => matchesAnyPattern(r.page));

  // Aggregate by pattern
  const byPattern = {};
  for (const pattern of patterns) {
    const curPages = currentRows.filter(r => r.page.includes(pattern));
    const priPages = priorRows.filter(r => r.page.includes(pattern));
    const curr = aggregateMetrics(curPages);
    const prev = aggregateMetrics(priPages);
    byPattern[pattern] = {
      pattern,
      page_count: new Set(curPages.map(r => r.page)).size,
      current: curr,
      prior: prev,
      delta: computeDelta(curr, prev),
    };
  }

  // Overall
  const currTotal = aggregateMetrics(curMatched);
  const prevTotal = aggregateMetrics(priMatched);

  return {
    overall: {
      current: currTotal,
      prior: prevTotal,
      delta: computeDelta(currTotal, prevTotal),
    },
    by_pattern: byPattern,
    patterns,
  };
}

// ── Page/Query detail trends ─────────────────────────────────────────

/**
 * Daily trend for a specific page.
 */
export function pageDetailTrend(siteUrl, pageUrl, { days = 90 } = {}) {
  const endDate = today();
  const startDate = daysAgoStr(days);
  const rows = queryRows("page", { site_url: siteUrl, page: pageUrl, dateFrom: startDate, dateTo: endDate });

  return rows
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({
      date: r.date,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      average_position: r.average_position,
    }));
}

/**
 * Daily trend for a specific query.
 */
export function queryDetailTrend(siteUrl, query, { days = 90 } = {}) {
  const endDate = today();
  const startDate = daysAgoStr(days);
  const rows = queryRows("query", { site_url: siteUrl, query, dateFrom: startDate, dateTo: endDate });

  return rows
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({
      date: r.date,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      average_position: r.average_position,
    }));
}

// ── Aggregate helpers ────────────────────────────────────────────────

function aggregateMetrics(rows) {
  if (!rows || rows.length === 0) {
    return { clicks: 0, impressions: 0, ctr: 0, average_position: 0, days: 0 };
  }

  const clicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
  const impressions = rows.reduce((s, r) => s + (r.impressions || 0), 0);
  const ctr = impressions > 0 ? round(clicks / impressions, 4) : 0;

  // Weighted average position (weighted by impressions)
  let weightedPos = 0;
  let totalWeight = 0;
  for (const r of rows) {
    if (r.average_position > 0 && r.impressions > 0) {
      weightedPos += r.average_position * r.impressions;
      totalWeight += r.impressions;
    }
  }
  const average_position = totalWeight > 0 ? round(weightedPos / totalWeight, 2) : 0;

  return { clicks, impressions, ctr, average_position, days: rows.length };
}

function computeDelta(current, prior) {
  return {
    clicks: current.clicks - prior.clicks,
    clicks_pct: prior.clicks > 0 ? round((current.clicks - prior.clicks) / prior.clicks * 100, 1) : 0,
    impressions: current.impressions - prior.impressions,
    impressions_pct: prior.impressions > 0 ? round((current.impressions - prior.impressions) / prior.impressions * 100, 1) : 0,
    ctr: round(current.ctr - prior.ctr, 4),
    average_position: prior.average_position > 0 ? round(prior.average_position - current.average_position, 2) : 0,
  };
}

function groupBy(rows, key) {
  const groups = {};
  for (const row of rows) {
    const k = row[key];
    if (!groups[k]) groups[k] = [];
    groups[k].push(row);
  }
  return groups;
}

function round(n, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

export { aggregateMetrics, computeDelta };
