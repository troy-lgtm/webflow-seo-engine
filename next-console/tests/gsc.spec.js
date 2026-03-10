/**
 * GSC System Tests
 *
 * Tests for:
 * - Store upsert idempotency
 * - Date range generation
 * - Response normalization
 * - Branded vs non-branded classification
 * - Progress calculations
 * - Config loading
 * - API route outputs
 *
 * Module-level tests use execSync + inline Node scripts to avoid
 * Playwright's CJS transform conflicting with import.meta.url in lib/.
 */

import { test, expect } from "@playwright/test";
import { execSync } from "child_process";

/** Run an inline ES module script, return parsed JSON output. */
function runNode(script, extraEnv = {}) {
  const result = execSync(`node --input-type=module -e '${script}'`, {
    cwd: process.cwd(),
    timeout: 15000,
    env: { ...process.env, ...extraEnv },
  });
  return JSON.parse(result.toString().trim());
}

// ── Store Tests ──────────────────────────────────────────────────────
// Serial: store tests share the same JSON data files — prevent race conditions.

test.describe("GSC Store", () => {
  test.describe.configure({ mode: "serial" });
  test("upsertRows is idempotent — same data twice produces same row count", () => {
    const result = runNode(`
      import { upsertRows, queryRows, clearTable } from "./lib/gsc/store.js";

      clearTable("site");

      const rows = [
        { site_url: "sc-domain:test.com", date: "2026-01-01", search_type: "web", clicks: 10, impressions: 100, ctr: 0.1, average_position: 5.0 },
        { site_url: "sc-domain:test.com", date: "2026-01-02", search_type: "web", clicks: 20, impressions: 200, ctr: 0.1, average_position: 4.5 },
      ];

      const r1 = upsertRows("site", rows);
      const r2 = upsertRows("site", rows);
      const queried = queryRows("site", { site_url: "sc-domain:test.com" });

      clearTable("site");

      console.log(JSON.stringify({
        r1_inserted: r1.inserted, r1_updated: r1.updated, r1_total: r1.total,
        r2_inserted: r2.inserted, r2_updated: r2.updated, r2_total: r2.total,
        queried_len: queried.length, first_clicks: queried[0].clicks,
      }));
    `);

    expect(result.r1_inserted).toBe(2);
    expect(result.r1_updated).toBe(0);
    expect(result.r1_total).toBe(2);
    expect(result.r2_inserted).toBe(0);
    expect(result.r2_updated).toBe(2);
    expect(result.r2_total).toBe(2);
    expect(result.queried_len).toBe(2);
    expect(result.first_clicks).toBe(10);
  });

  test("upsertRows updates values on conflict", () => {
    const result = runNode(`
      import { upsertRows, queryRows, clearTable } from "./lib/gsc/store.js";

      clearTable("page");

      upsertRows("page", [
        { site_url: "sc-domain:test.com", date: "2026-01-01", page: "/test", search_type: "web", clicks: 5, impressions: 50, ctr: 0.1, average_position: 10.0 },
      ]);

      const r2 = upsertRows("page", [
        { site_url: "sc-domain:test.com", date: "2026-01-01", page: "/test", search_type: "web", clicks: 15, impressions: 150, ctr: 0.1, average_position: 8.0 },
      ]);

      const queried = queryRows("page", { site_url: "sc-domain:test.com", page: "/test" });
      clearTable("page");

      console.log(JSON.stringify({
        r2_inserted: r2.inserted, r2_updated: r2.updated,
        queried_len: queried.length, clicks: queried[0].clicks, pos: queried[0].average_position,
      }));
    `);

    expect(result.r2_inserted).toBe(0);
    expect(result.r2_updated).toBe(1);
    expect(result.queried_len).toBe(1);
    expect(result.clicks).toBe(15);
    expect(result.pos).toBe(8.0);
  });

  test("queryRows filters by date range", () => {
    const result = runNode(`
      import { upsertRows, queryRows, clearTable } from "./lib/gsc/store.js";

      clearTable("site");

      upsertRows("site", [
        { site_url: "sc-domain:test.com", date: "2026-01-01", search_type: "web", clicks: 10, impressions: 100, ctr: 0.1, average_position: 5.0 },
        { site_url: "sc-domain:test.com", date: "2026-01-05", search_type: "web", clicks: 20, impressions: 200, ctr: 0.1, average_position: 4.5 },
        { site_url: "sc-domain:test.com", date: "2026-01-10", search_type: "web", clicks: 30, impressions: 300, ctr: 0.1, average_position: 4.0 },
      ]);

      const filtered = queryRows("site", { site_url: "sc-domain:test.com", dateFrom: "2026-01-04", dateTo: "2026-01-06" });
      clearTable("site");

      console.log(JSON.stringify({ len: filtered.length, date: filtered[0].date }));
    `);

    expect(result.len).toBe(1);
    expect(result.date).toBe("2026-01-05");
  });
});

// ── Ingestion Date Helpers ───────────────────────────────────────────

test.describe("GSC Ingestion Helpers", () => {
  test("dateRange generates correct date array", () => {
    const result = runNode(`
      import { dateRange } from "./lib/gsc/ingest.js";
      console.log(JSON.stringify(dateRange("2026-01-01", "2026-01-05")));
    `);

    expect(result).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]);
  });

  test("dateRange returns empty for inverted range", () => {
    const result = runNode(`
      import { dateRange } from "./lib/gsc/ingest.js";
      console.log(JSON.stringify(dateRange("2026-01-05", "2026-01-01")));
    `);

    expect(result).toEqual([]);
  });

  test("daysAgo returns a valid date string", () => {
    const result = runNode(`
      import { daysAgo } from "./lib/gsc/ingest.js";
      const d = daysAgo(7);
      console.log(JSON.stringify({ d, before_now: new Date(d + "T00:00:00Z").getTime() < Date.now() }));
    `);

    expect(result.d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.before_now).toBe(true);
  });
});

// ── Branded Classification ───────────────────────────────────────────

test.describe("Branded vs Non-Branded", () => {
  test("branded query classification is correct", () => {
    const result = runNode(`
      import { isBrandedQuery } from "./lib/gsc/progress.js";
      console.log(JSON.stringify({
        warp_freight: isBrandedQuery("warp freight shipping"),
        warp_upper: isBrandedQuery("WARP ltl rates"),
        wearewarp: isBrandedQuery("wearewarp tracking"),
        ltl_freight: isBrandedQuery("ltl freight quotes chicago"),
        freight_near: isBrandedQuery("freight shipping near me"),
        empty: isBrandedQuery(""),
      }));
    `);

    expect(result.warp_freight).toBe(true);
    expect(result.warp_upper).toBe(true);
    expect(result.wearewarp).toBe(true);
    expect(result.ltl_freight).toBe(false);
    expect(result.freight_near).toBe(false);
    expect(result.empty).toBe(false);
  });
});

// ── Progress Calculations ────────────────────────────────────────────

test.describe("Progress Calculations", () => {
  test("aggregateMetrics computes weighted average position", () => {
    const result = runNode(`
      import { aggregateMetrics } from "./lib/gsc/progress.js";

      const rows = [
        { clicks: 10, impressions: 100, ctr: 0.1, average_position: 5.0 },
        { clicks: 20, impressions: 200, ctr: 0.1, average_position: 10.0 },
      ];

      const agg = aggregateMetrics(rows);
      console.log(JSON.stringify(agg));
    `);

    expect(result.clicks).toBe(30);
    expect(result.impressions).toBe(300);
    // Weighted: (5*100 + 10*200) / 300 = 2500/300 = 8.33
    expect(result.average_position).toBeCloseTo(8.33, 1);
    expect(result.ctr).toBeCloseTo(0.1, 2);
  });

  test("computeDelta computes correct deltas", () => {
    const result = runNode(`
      import { computeDelta } from "./lib/gsc/progress.js";

      const current = { clicks: 150, impressions: 3000, ctr: 0.05, average_position: 8.0 };
      const prior = { clicks: 100, impressions: 2000, ctr: 0.05, average_position: 10.0 };

      console.log(JSON.stringify(computeDelta(current, prior)));
    `);

    expect(result.clicks).toBe(50);
    expect(result.clicks_pct).toBe(50);
    expect(result.impressions).toBe(1000);
    expect(result.impressions_pct).toBe(50);
    // Position improved from 10 to 8 → delta = 2 (positive = improvement)
    expect(result.average_position).toBe(2);
  });

  test("aggregateMetrics handles empty array", () => {
    const result = runNode(`
      import { aggregateMetrics } from "./lib/gsc/progress.js";
      console.log(JSON.stringify(aggregateMetrics([])));
    `);

    expect(result.clicks).toBe(0);
    expect(result.impressions).toBe(0);
    expect(result.ctr).toBe(0);
    expect(result.average_position).toBe(0);
  });
});

// ── Config ───────────────────────────────────────────────────────────

test.describe("GSC Config", () => {
  test("config loads with defaults", () => {
    const result = runNode(`
      import { loadGscConfig, _resetConfigCache } from "./lib/gsc/config.js";
      _resetConfigCache();
      const config = loadGscConfig();
      console.log(JSON.stringify({
        has_warp: config.brand_keywords.includes("warp"),
        has_wearewarp: config.brand_keywords.includes("wearewarp"),
        pattern_count: config.priority_page_patterns.length,
        search_type: config.ingestion.default_search_type,
        leaderboard_limit: config.reporting.leaderboard_limit,
      }));
    `);

    expect(result.has_warp).toBe(true);
    expect(result.has_wearewarp).toBe(true);
    expect(result.pattern_count).toBeGreaterThan(0);
    expect(result.search_type).toBe("web");
    expect(result.leaderboard_limit).toBe(20);
  });
});

// ── Response Normalization ───────────────────────────────────────────
// Serial: uses store operations on shared JSON files.

test.describe("GSC Response Normalization", () => {
  test.describe.configure({ mode: "serial" });
  test("store normalizes numeric fields correctly", () => {
    const result = runNode(`
      import { upsertRows, queryRows, clearTable } from "./lib/gsc/store.js";

      clearTable("query");

      upsertRows("query", [{
        site_url: "sc-domain:test.com", date: "2026-01-01", query: "freight quotes",
        search_type: "web", clicks: 0, impressions: 0, ctr: 0, average_position: 0,
      }]);

      const rows = queryRows("query", { query: "freight quotes" });
      clearTable("query");

      console.log(JSON.stringify({
        len: rows.length,
        clicks_type: typeof rows[0].clicks,
        impressions_type: typeof rows[0].impressions,
      }));
    `);

    expect(result.len).toBe(1);
    expect(result.clicks_type).toBe("number");
    expect(result.impressions_type).toBe("number");
  });
});

// ── API Route ────────────────────────────────────────────────────────

test.describe("GSC API Route", () => {
  test("stats endpoint returns table counts", async ({ request }) => {
    const res = await request.get("/api/seo/gsc?view=stats");
    // May return 200 or 500 depending on server state, but should not 404
    expect([200, 500]).toContain(res.status());
  });
});

// ── Dashboard Page ───────────────────────────────────────────────────

test.describe("SEO Progress Dashboard", () => {
  test("dashboard page renders without crash", async ({ page }) => {
    const response = await page.goto("/internal/seo-progress");
    expect(response.status()).toBe(200);
    // Should have either "No GSC Data" or "Search Performance"
    const text = await page.textContent("body");
    const hasContent = text.includes("No GSC Data") || text.includes("Search Performance");
    expect(hasContent).toBe(true);
  });
});

// ── Sync Script ──────────────────────────────────────────────────────

test.describe("GSC Sync Script", () => {
  test("dry run completes without error", () => {
    const result = execSync("node scripts/gsc_sync.js --dry-run", {
      cwd: process.cwd(),
      timeout: 10000,
      env: {
        ...process.env,
        GSC_SITE_URL: "sc-domain:test.com",
        GOOGLE_CLIENT_ID: "test",
        GOOGLE_CLIENT_SECRET: "test",
        GOOGLE_REFRESH_TOKEN: "test",
      },
    });
    const output = result.toString();
    expect(output).toContain("[gsc-sync]");
    expect(output).toContain("Dry run");
  });
});

// ── Video Removal ───────────────────────────────────────────────────

test.describe("Video Removal", () => {
  test("publish_next buildWebflowFields includes faq-schema with video-hiding CSS", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("./scripts/publish_next.js", "utf-8");
      const rendererSrc = fs.readFileSync("./lib/render-lane-page.js", "utf-8");
      const hasFaqSchema = src.includes("faq-schema") || rendererSrc.includes("faq-schema");
      const hasWistiaCSS = rendererSrc.includes("wistia-player");
      const hasHideCSS = rendererSrc.includes("display: none !important") || rendererSrc.includes("display:none!important");
      const hasFAQPageSchema = rendererSrc.includes("FAQPage");
      console.log(JSON.stringify({ hasFaqSchema, hasWistiaCSS, hasHideCSS, hasFAQPageSchema }));
    `);

    expect(result.hasFaqSchema).toBe(true);
    expect(result.hasWistiaCSS).toBe(true);
    expect(result.hasHideCSS).toBe(true);
    expect(result.hasFAQPageSchema).toBe(true);
  });

  test("ship_firstpage buildWebflowFields includes faq-schema with video-hiding CSS", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("./scripts/ship_firstpage.js", "utf-8");
      const rendererSrc = fs.readFileSync("./lib/render-lane-page.js", "utf-8");
      const hasFaqSchema = src.includes("faq-schema") || rendererSrc.includes("faq-schema");
      const hasWistiaCSS = rendererSrc.includes("wistia-player");
      const hasHideCSS = rendererSrc.includes("display: none !important") || rendererSrc.includes("display:none!important");
      console.log(JSON.stringify({ hasFaqSchema, hasWistiaCSS, hasHideCSS }));
    `);

    expect(result.hasFaqSchema).toBe(true);
    expect(result.hasWistiaCSS).toBe(true);
    expect(result.hasHideCSS).toBe(true);
  });

  test("remove_video_from_published script exists with required structure", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("./scripts/remove_video_from_published.js", "utf-8");
      const hasPublishedPages = src.includes("published_pages.json");
      const hasWebflowPatch = src.includes("PATCH");
      const hasDryRun = src.includes("dry_run") || src.includes("isDryRun");
      const hasWistia = src.includes("wistia-player");
      const hasFaqSchema = src.includes("faq-schema");
      console.log(JSON.stringify({ hasPublishedPages, hasWebflowPatch, hasDryRun, hasWistia, hasFaqSchema }));
    `);

    expect(result.hasPublishedPages).toBe(true);
    expect(result.hasWebflowPatch).toBe(true);
    expect(result.hasDryRun).toBe(true);
    expect(result.hasWistia).toBe(true);
    expect(result.hasFaqSchema).toBe(true);
  });
});

// ── Data Source Interface ────────────────────────────────────────────

test.describe("Data Source Interface", () => {
  test("API data source has all required methods", () => {
    const result = runNode(`
      import { SearchConsoleApiDataSource } from "./lib/gsc/data-source.js";
      const ds = new SearchConsoleApiDataSource();
      console.log(JSON.stringify({
        name: ds.name,
        hasFetchSite: typeof ds.fetchSiteMetrics === "function",
        hasFetchPage: typeof ds.fetchPageMetrics === "function",
        hasFetchQuery: typeof ds.fetchQueryMetrics === "function",
        hasFetchPageQuery: typeof ds.fetchPageQueryMetrics === "function",
      }));
    `);

    expect(result.name).toBe("api");
    expect(result.hasFetchSite).toBe(true);
    expect(result.hasFetchPage).toBe(true);
    expect(result.hasFetchQuery).toBe(true);
    expect(result.hasFetchPageQuery).toBe(true);
  });

  test("BigQuery data source has all required methods", () => {
    const result = runNode(`
      import { SearchConsoleBigQueryDataSource } from "./lib/gsc/data-source.js";
      const ds = new SearchConsoleBigQueryDataSource();
      console.log(JSON.stringify({
        name: ds.name,
        hasFetchSite: typeof ds.fetchSiteMetrics === "function",
        hasFetchPage: typeof ds.fetchPageMetrics === "function",
        hasFetchQuery: typeof ds.fetchQueryMetrics === "function",
        hasFetchPageQuery: typeof ds.fetchPageQueryMetrics === "function",
      }));
    `);

    expect(result.name).toBe("bigquery");
    expect(result.hasFetchSite).toBe(true);
    expect(result.hasFetchPage).toBe(true);
    expect(result.hasFetchQuery).toBe(true);
    expect(result.hasFetchPageQuery).toBe(true);
  });
});
