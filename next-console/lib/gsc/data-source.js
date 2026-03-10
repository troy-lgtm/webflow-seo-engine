/**
 * GSC Data Source Interface
 *
 * Abstraction layer to swap between API-ingested JSON tables
 * and BigQuery bulk export later. Currently implements the
 * SearchConsoleApiDataSource backed by local JSON store.
 *
 * Interface contract:
 *   fetchSiteMetrics(siteUrl, dateFrom, dateTo)
 *   fetchPageMetrics(siteUrl, dateFrom, dateTo)
 *   fetchQueryMetrics(siteUrl, dateFrom, dateTo)
 *   fetchPageQueryMetrics(siteUrl, dateFrom, dateTo)
 */

import { queryRows } from "./store.js";

// ── API Data Source (JSON file-backed) ───────────────────────────────

export class SearchConsoleApiDataSource {
  constructor() {
    this.name = "api";
    this.description = "Local JSON store populated via GSC API ingestion";
  }

  async fetchSiteMetrics(siteUrl, dateFrom, dateTo) {
    return queryRows("site", { site_url: siteUrl, dateFrom, dateTo });
  }

  async fetchPageMetrics(siteUrl, dateFrom, dateTo) {
    return queryRows("page", { site_url: siteUrl, dateFrom, dateTo });
  }

  async fetchQueryMetrics(siteUrl, dateFrom, dateTo) {
    return queryRows("query", { site_url: siteUrl, dateFrom, dateTo });
  }

  async fetchPageQueryMetrics(siteUrl, dateFrom, dateTo) {
    return queryRows("page_query", { site_url: siteUrl, dateFrom, dateTo });
  }
}

// ── BigQuery Data Source (scaffold) ──────────────────────────────────

export class SearchConsoleBigQueryDataSource {
  constructor() {
    this.name = "bigquery";
    this.description = "BigQuery bulk export of Search Console data";
    this.projectId = process.env.BIGQUERY_PROJECT_ID || null;
    this.dataset = process.env.BIGQUERY_DATASET || null;
  }

  _checkConfig() {
    if (!this.projectId || !this.dataset) {
      throw new Error(
        "[gsc-bigquery] BigQuery not configured.\n" +
        "  Set BIGQUERY_PROJECT_ID and BIGQUERY_DATASET env vars.\n" +
        "  See docs/gsc-setup.md for BigQuery bulk export setup."
      );
    }
  }

  async fetchSiteMetrics(siteUrl, dateFrom, dateTo) {
    this._checkConfig();
    // TODO: Implement BigQuery query
    // SELECT data_date as date, SUM(clicks) as clicks, SUM(impressions) as impressions,
    //   SAFE_DIVIDE(SUM(clicks), SUM(impressions)) as ctr,
    //   AVG(average_position) as average_position
    // FROM `{project}.{dataset}.searchdata_site_impression`
    // WHERE data_date BETWEEN @dateFrom AND @dateTo
    // GROUP BY data_date ORDER BY data_date
    throw new Error("[gsc-bigquery] Not implemented. Use API data source for now.");
  }

  async fetchPageMetrics(siteUrl, dateFrom, dateTo) {
    this._checkConfig();
    throw new Error("[gsc-bigquery] Not implemented. Use API data source for now.");
  }

  async fetchQueryMetrics(siteUrl, dateFrom, dateTo) {
    this._checkConfig();
    throw new Error("[gsc-bigquery] Not implemented. Use API data source for now.");
  }

  async fetchPageQueryMetrics(siteUrl, dateFrom, dateTo) {
    this._checkConfig();
    throw new Error("[gsc-bigquery] Not implemented. Use API data source for now.");
  }
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Get the configured data source.
 * Returns BigQuery source if configured, otherwise API source.
 */
export function getDataSource() {
  if (process.env.BIGQUERY_PROJECT_ID && process.env.BIGQUERY_DATASET) {
    return new SearchConsoleBigQueryDataSource();
  }
  return new SearchConsoleApiDataSource();
}
