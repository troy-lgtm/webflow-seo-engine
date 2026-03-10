/**
 * GSC Ingestion Jobs
 *
 * Four ingestion levels:
 *   1. Site daily metrics — date dimension only, aggregated to site level
 *   2. Page daily metrics — date + page dimensions
 *   3. Query daily metrics — date + query dimensions
 *   4. Page-query daily metrics — date + page + query dimensions
 *
 * All writes are idempotent upserts. Supports single day, date range,
 * and backfill operations. Resumable — can re-run safely.
 */

import { queryAllRows, getSiteUrl } from "./client.js";
import { upsertRows } from "./store.js";

// ── Date helpers ─────────────────────────────────────────────────────

/**
 * Generate array of YYYY-MM-DD strings between start and end (inclusive).
 */
export function dateRange(startDate, endDate) {
  const dates = [];
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");

  if (start > end) return dates;

  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Get a date N days ago as YYYY-MM-DD.
 */
export function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Get yesterday's date as YYYY-MM-DD.
 */
export function yesterday() {
  return daysAgo(1);
}

// ── Ingestion jobs ───────────────────────────────────────────────────

/**
 * Ingest site-level daily metrics.
 * Dimensions: [date]
 * Aggregates all pages/queries into a single row per date.
 */
export async function ingestSiteMetrics({ startDate, endDate, searchType = "web" }) {
  const siteUrl = getSiteUrl();
  console.log(`[gsc-ingest] Site metrics: ${startDate} → ${endDate}`);

  const result = await queryAllRows({
    siteUrl,
    startDate,
    endDate,
    dimensions: ["date"],
    searchType,
  });

  const rows = result.rows.map(r => ({
    site_url: siteUrl,
    date: r.date,
    search_type: searchType,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    average_position: r.position,
  }));

  const stats = upsertRows("site", rows);
  console.log(`[gsc-ingest] Site metrics: ${stats.inserted} inserted, ${stats.updated} updated`);
  return stats;
}

/**
 * Ingest page-level daily metrics.
 * Dimensions: [date, page]
 */
export async function ingestPageMetrics({ startDate, endDate, searchType = "web" }) {
  const siteUrl = getSiteUrl();
  console.log(`[gsc-ingest] Page metrics: ${startDate} → ${endDate}`);

  const result = await queryAllRows({
    siteUrl,
    startDate,
    endDate,
    dimensions: ["date", "page"],
    searchType,
  });

  const rows = result.rows.map(r => ({
    site_url: siteUrl,
    date: r.date,
    page: r.page,
    search_type: searchType,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    average_position: r.position,
  }));

  const stats = upsertRows("page", rows);
  console.log(`[gsc-ingest] Page metrics: ${stats.inserted} inserted, ${stats.updated} updated (${rows.length} rows from API)`);
  return stats;
}

/**
 * Ingest query-level daily metrics.
 * Dimensions: [date, query]
 */
export async function ingestQueryMetrics({ startDate, endDate, searchType = "web" }) {
  const siteUrl = getSiteUrl();
  console.log(`[gsc-ingest] Query metrics: ${startDate} → ${endDate}`);

  const result = await queryAllRows({
    siteUrl,
    startDate,
    endDate,
    dimensions: ["date", "query"],
    searchType,
  });

  const rows = result.rows.map(r => ({
    site_url: siteUrl,
    date: r.date,
    query: r.query,
    search_type: searchType,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    average_position: r.position,
  }));

  const stats = upsertRows("query", rows);
  console.log(`[gsc-ingest] Query metrics: ${stats.inserted} inserted, ${stats.updated} updated (${rows.length} rows from API)`);
  return stats;
}

/**
 * Ingest page-query level daily metrics.
 * Dimensions: [date, page, query]
 * Note: This can produce large result sets. Consider shorter date ranges.
 */
export async function ingestPageQueryMetrics({ startDate, endDate, searchType = "web" }) {
  const siteUrl = getSiteUrl();
  console.log(`[gsc-ingest] Page-query metrics: ${startDate} → ${endDate}`);

  const result = await queryAllRows({
    siteUrl,
    startDate,
    endDate,
    dimensions: ["date", "page", "query"],
    searchType,
  });

  const rows = result.rows.map(r => ({
    site_url: siteUrl,
    date: r.date,
    page: r.page,
    query: r.query,
    search_type: searchType,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    average_position: r.position,
  }));

  const stats = upsertRows("page_query", rows);
  console.log(`[gsc-ingest] Page-query metrics: ${stats.inserted} inserted, ${stats.updated} updated (${rows.length} rows from API)`);
  return stats;
}

// ── Combined ingestion ───────────────────────────────────────────────

/**
 * Run all four ingestion levels for a date range.
 * Processes day by day for page-query to avoid hitting row limits.
 */
export async function ingestAll({ startDate, endDate, searchType = "web", skipPageQuery = false }) {
  console.log(`[gsc-ingest] Full ingestion: ${startDate} → ${endDate}`);
  const results = {};

  // Site and query can handle ranges efficiently
  results.site = await ingestSiteMetrics({ startDate, endDate, searchType });
  results.page = await ingestPageMetrics({ startDate, endDate, searchType });
  results.query = await ingestQueryMetrics({ startDate, endDate, searchType });

  // Page-query is the heaviest — process day by day
  if (!skipPageQuery) {
    const dates = dateRange(startDate, endDate);
    let totalInserted = 0;
    let totalUpdated = 0;

    for (const date of dates) {
      const stats = await ingestPageQueryMetrics({ startDate: date, endDate: date, searchType });
      totalInserted += stats.inserted;
      totalUpdated += stats.updated;
    }

    results.page_query = { inserted: totalInserted, updated: totalUpdated };
  }

  console.log("[gsc-ingest] Full ingestion complete", results);
  return results;
}

/**
 * Ingest yesterday's data (daily cron job).
 */
export async function ingestYesterday({ searchType = "web", skipPageQuery = false } = {}) {
  const date = yesterday();
  return ingestAll({ startDate: date, endDate: date, searchType, skipPageQuery });
}

/**
 * Backfill last N days.
 */
export async function backfill(days, { searchType = "web", skipPageQuery = false } = {}) {
  const endDate = yesterday();
  const startDate = daysAgo(days);
  return ingestAll({ startDate, endDate, searchType, skipPageQuery });
}
