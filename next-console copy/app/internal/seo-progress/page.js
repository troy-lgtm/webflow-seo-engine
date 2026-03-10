/**
 * Internal SEO Progress Dashboard
 *
 * Server-rendered page showing GSC-powered SEO performance metrics.
 * Follows the internal dashboard pattern from seo-control.
 * Dark theme, premium feel, mobile-friendly.
 */

import {
  siteSummary,
  pageLeaderboard,
  queryLeaderboard,
  priorityPagePerformance,
  brandedVsNonBranded,
  newQueries,
} from "@/lib/gsc/progress.js";
import { getTableStats } from "@/lib/gsc/store.js";

const SITE_URL = process.env.GSC_SITE_URL || "sc-domain:wearewarp.com";

function DeltaValue({ value, suffix = "", invert = false }) {
  if (value === 0 || value === undefined) return <span className="sp-delta sp-flat">—</span>;
  const positive = invert ? value < 0 : value > 0;
  const cls = positive ? "sp-up" : "sp-down";
  const arrow = positive ? "+" : "";
  return <span className={`sp-delta ${cls}`}>{arrow}{value}{suffix}</span>;
}

function SummaryCard({ label, value, delta, deltaPct, invert }) {
  return (
    <div className="sp-card" data-warp-section={`gsc-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <span className="sp-card-label">{label}</span>
      <span className="sp-card-value">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <div className="sp-card-delta-row">
        <DeltaValue value={delta} invert={invert} />
        {deltaPct !== undefined && deltaPct !== 0 && (
          <span className="sp-delta-pct">({deltaPct > 0 ? "+" : ""}{deltaPct}%)</span>
        )}
        <span className="sp-vs-label">vs prior</span>
      </div>
    </div>
  );
}

function PageRow({ item, rank }) {
  return (
    <tr>
      <td className="sp-rank">{rank}</td>
      <td className="sp-page-url" title={item.page}>
        {truncateUrl(item.page)}
      </td>
      <td className="sp-num">{item.current_clicks}</td>
      <td><DeltaValue value={item.click_delta} /></td>
      <td className="sp-num">{item.current_impressions.toLocaleString()}</td>
      <td><DeltaValue value={item.impression_delta} /></td>
      <td className="sp-num">{item.current_position > 0 ? item.current_position.toFixed(1) : "—"}</td>
      <td><DeltaValue value={item.position_delta} invert={false} /></td>
    </tr>
  );
}

function QueryRow({ item, rank }) {
  return (
    <tr>
      <td className="sp-rank">{rank}</td>
      <td className="sp-query-text">{item.query}</td>
      <td className="sp-num">{item.current_clicks}</td>
      <td><DeltaValue value={item.click_delta} /></td>
      <td className="sp-num">{item.current_impressions.toLocaleString()}</td>
      <td><DeltaValue value={item.impression_delta} /></td>
      <td className="sp-num">{item.current_position > 0 ? item.current_position.toFixed(1) : "—"}</td>
    </tr>
  );
}

function truncateUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return u.pathname.length > 45 ? u.pathname.slice(0, 42) + "..." : u.pathname;
  } catch {
    return url.length > 45 ? url.slice(0, 42) + "..." : url;
  }
}

export default function SeoProgressPage() {
  const stats = getTableStats();
  const hasData = stats.site > 0;

  if (!hasData) {
    return (
      <main className="shell" data-warp-page="seo-progress">
        <section className="surface hero">
          <div className="hero-row">
            <span className="brand-chip">SEO Progress</span>
          </div>
          <h1 className="title">No GSC Data Yet</h1>
          <p className="sub">
            Run <code className="pill" style={{ fontSize: "0.72rem" }}>npm run gsc:sync:yesterday</code> or{" "}
            <code className="pill" style={{ fontSize: "0.72rem" }}>npm run gsc:backfill:30d</code> to import data.
          </p>
          <p className="sub">
            See <code>docs/gsc-setup.md</code> for Google OAuth setup instructions.
          </p>
        </section>
      </main>
    );
  }

  const s7 = siteSummary(SITE_URL, 7);
  const s28 = siteSummary(SITE_URL, 28);
  const pages = pageLeaderboard(SITE_URL, { days: 7, limit: 20 });
  const queries = queryLeaderboard(SITE_URL, { days: 7, limit: 20 });
  const branded = brandedVsNonBranded(SITE_URL, { days: 7 });
  const priority = priorityPagePerformance(SITE_URL, { days: 7 });
  const newQ = newQueries(SITE_URL, { days: 7, limit: 10 });

  return (
    <main className="shell" data-warp-page="seo-progress">
      {/* Hero */}
      <section className="surface hero">
        <div className="hero-row">
          <span className="brand-chip">SEO Progress</span>
          <span className="overline">
            {stats.site} site · {stats.page} page · {stats.query} query rows
          </span>
        </div>
        <h1 className="title">Search Performance</h1>
        <p className="sub">Google Search Console metrics — is SEO working?</p>
      </section>

      {/* 7-day summary cards */}
      <section className="surface panel" data-warp-section="gsc-summary-7d">
        <h2>Last 7 Days vs Prior 7 Days</h2>
        <div className="grid-5" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <SummaryCard
            label="Clicks"
            value={s7.current.clicks}
            delta={s7.delta.clicks}
            deltaPct={s7.delta.clicks_pct}
          />
          <SummaryCard
            label="Impressions"
            value={s7.current.impressions}
            delta={s7.delta.impressions}
            deltaPct={s7.delta.impressions_pct}
          />
          <SummaryCard
            label="Avg CTR"
            value={(s7.current.ctr * 100).toFixed(2) + "%"}
            delta={parseFloat((s7.delta.ctr * 100).toFixed(2))}
            suffix="%"
          />
          <SummaryCard
            label="Avg Position"
            value={s7.current.average_position.toFixed(1)}
            delta={s7.delta.average_position}
            invert={false}
          />
        </div>
      </section>

      {/* 28-day comparison */}
      <section className="surface panel" data-warp-section="gsc-summary-28d">
        <h2>Last 28 Days vs Prior 28 Days</h2>
        <div className="grid-5" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <SummaryCard
            label="Clicks"
            value={s28.current.clicks}
            delta={s28.delta.clicks}
            deltaPct={s28.delta.clicks_pct}
          />
          <SummaryCard
            label="Impressions"
            value={s28.current.impressions}
            delta={s28.delta.impressions}
            deltaPct={s28.delta.impressions_pct}
          />
          <SummaryCard
            label="Avg CTR"
            value={(s28.current.ctr * 100).toFixed(2) + "%"}
            delta={parseFloat((s28.delta.ctr * 100).toFixed(2))}
            suffix="%"
          />
          <SummaryCard
            label="Avg Position"
            value={s28.current.average_position.toFixed(1)}
            delta={s28.delta.average_position}
            invert={false}
          />
        </div>
      </section>

      {/* Branded vs Non-branded */}
      <section className="surface panel" data-warp-section="gsc-branded">
        <h2>Branded vs Non-Branded (7d)</h2>
        <div className="grid-2">
          <div className="sp-brand-card">
            <span className="sp-brand-label">Branded</span>
            <span className="sp-brand-clicks">{branded.branded.current.clicks} clicks</span>
            <DeltaValue value={branded.branded.delta.clicks} />
            <span className="sp-brand-imp">{branded.branded.current.impressions.toLocaleString()} imp</span>
          </div>
          <div className="sp-brand-card">
            <span className="sp-brand-label">Non-Branded</span>
            <span className="sp-brand-clicks">{branded.non_branded.current.clicks} clicks</span>
            <DeltaValue value={branded.non_branded.delta.clicks} />
            <span className="sp-brand-imp">{branded.non_branded.current.impressions.toLocaleString()} imp</span>
          </div>
        </div>
      </section>

      {/* Priority Pages */}
      {priority.patterns.length > 0 && (
        <section className="surface panel" data-warp-section="gsc-priority">
          <h2>Priority Page Performance (7d)</h2>
          <div className="grid-3" style={{ gap: 8 }}>
            {Object.values(priority.by_pattern).map(pp => (
              <div key={pp.pattern} className="sp-priority-card">
                <span className="sp-priority-pattern">{pp.pattern}</span>
                <span className="sp-priority-pages">{pp.page_count} pages</span>
                <div className="sp-priority-metrics">
                  <span>{pp.current.clicks} clicks</span>
                  <DeltaValue value={pp.delta.clicks} />
                </div>
                <div className="sp-priority-metrics">
                  <span>{pp.current.impressions.toLocaleString()} imp</span>
                  <DeltaValue value={pp.delta.impressions} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Two-column: Pages + Queries */}
      <div className="two-col">
        {/* Top Gaining Pages */}
        <section className="surface panel" data-warp-section="gsc-pages-gaining">
          <h2>Top Gaining Pages (7d clicks)</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Page</th>
                  <th>Clicks</th>
                  <th>+/-</th>
                  <th>Imp</th>
                  <th>+/-</th>
                  <th>Pos</th>
                  <th>+/-</th>
                </tr>
              </thead>
              <tbody>
                {pages.gaining.slice(0, 20).map((item, i) => (
                  <PageRow key={item.page} item={item} rank={i + 1} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Top Gaining Queries */}
        <section className="surface panel" data-warp-section="gsc-queries-gaining">
          <h2>Top Gaining Queries (7d clicks)</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Query</th>
                  <th>Clicks</th>
                  <th>+/-</th>
                  <th>Imp</th>
                  <th>+/-</th>
                  <th>Pos</th>
                </tr>
              </thead>
              <tbody>
                {queries.gaining.slice(0, 20).map((item, i) => (
                  <QueryRow key={item.query} item={item} rank={i + 1} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Newly Appearing Queries */}
      {newQ.length > 0 && (
        <section className="surface panel" data-warp-section="gsc-new-queries">
          <h2>Newly Appearing Queries (7d)</h2>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {newQ.map(q => (
              <span key={q.query} className="pill" title={`${q.impressions} imp, ${q.clicks} clicks`}>
                {q.query} ({q.impressions} imp)
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Top Losing Pages */}
      <section className="surface panel" data-warp-section="gsc-pages-losing">
        <h2>Top Losing Pages (7d clicks)</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Page</th>
                <th>Clicks</th>
                <th>+/-</th>
                <th>Imp</th>
                <th>+/-</th>
                <th>Pos</th>
                <th>+/-</th>
              </tr>
            </thead>
            <tbody>
              {pages.losing.slice(0, 20).map((item, i) => (
                <PageRow key={item.page} item={item} rank={i + 1} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
