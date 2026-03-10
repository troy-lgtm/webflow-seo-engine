import { getOverviewData, getBenchmarksData } from "@/lib/seo-dashboard-data";
import MetricMeta from "./components/MetricMeta";

function SourcesStrip({ sources }) {
  if (!sources) return null;
  const items = [
    { key: "gsc", label: "GSC", connected: sources.gsc?.connected },
    { key: "ga4", label: "GA4", connected: sources.ga4?.connected },
    { key: "portal", label: "Portal", connected: sources.portal?.connected },
  ];
  return (
    <div className="ctrl-sources-strip" data-testid="sources-strip">
      {items.map(s => (
        <span key={s.key} className="ctrl-source-chip">
          <span className={`ctrl-source-dot ${s.connected ? "connected" : "disconnected"}`} />
          {s.label}: {s.connected ? "Connected" : "Local stub"}
        </span>
      ))}
      {sources.placeholders?.enabled && (
        <span className="ctrl-placeholder-badge" style={{ marginLeft: 8 }}>Placeholders active</span>
      )}
    </div>
  );
}

function SanityBanner({ sanity }) {
  if (!sanity?.has_high) return null;
  return (
    <div className="ctrl-sanity-banner" data-testid="sanity-banner">
      <span>Metrics integrity issues detected ({sanity.summary.high} high, {sanity.summary.medium} medium)</span>
      <a href="/api/seo/health" target="_blank" rel="noopener">View report</a>
    </div>
  );
}

function MetricCard({ label, value, delta, sparkData }) {
  const deltaClass = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const deltaText = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "—";
  return (
    <div className="ctrl-card" data-testid={`metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="ctrl-card-label">{label}</div>
      <div className="ctrl-card-value">{typeof value === "number" ? value.toLocaleString() : value}</div>
      <div className={`ctrl-card-delta ${deltaClass}`}>{deltaText} vs prev</div>
      {sparkData && (
        <div className="ctrl-card-spark">
          {sparkData.map((v, i) => (
            <div key={i} className="ctrl-card-spark-bar" style={{ height: `${Math.max(8, (v / Math.max(...sparkData)) * 100)}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

function AttributedStat({ label, attr }) {
  const val = attr?.value;
  const displayVal = (val === null || val === undefined) ? "—" : (typeof val === "number" ? val.toLocaleString() : val);
  const isPlaceholder = attr?.is_placeholder;

  return (
    <div className="ctrl-io-stat">
      <span className="ctrl-io-stat-label">{label}</span>
      <span className={`ctrl-io-stat-value${isPlaceholder ? " ctrl-attributed-hidden" : ""}`}>
        {isPlaceholder ? <>{displayVal} <span className="ctrl-placeholder-badge">Stub</span></> : displayVal}
      </span>
      {attr?.source && (
        <MetricMeta source={attr.source} connected={attr.connected} window={attr.window} last_pulled_at={attr.last_pulled_at} coverage={attr.coverage} />
      )}
    </div>
  );
}

function BlockedReasonsTable({ reasons }) {
  if (reasons.length === 0) {
    return (
      <div className="ctrl-card" style={{ padding: 20, textAlign: "center" }}>
        <p style={{ color: "var(--text-dim)", fontSize: "0.82rem", margin: 0 }}>No blocked pages in this run.</p>
      </div>
    );
  }
  return (
    <div className="ctrl-table-wrap">
      <table className="ctrl-table">
        <thead><tr><th>Rule ID</th><th>Count</th><th>Example Lanes</th></tr></thead>
        <tbody>
          {reasons.map((r, i) => (
            <tr key={i}>
              <td><code className="mono">{r.rule_id}</code></td>
              <td><strong>{r.count}</strong></td>
              <td className="mono" style={{ fontSize: "0.7rem" }}>{r.examples.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QualityDistribution({ dist }) {
  const total = (dist.excellent || 0) + (dist.good || 0) + (dist.fair || 0) + (dist.poor || 0);
  if (total === 0) return null;
  const pct = (v) => `${Math.max(2, (v / total) * 100)}%`;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="ctrl-card-label" style={{ marginBottom: 8 }}>Quality Distribution</div>
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 1 }}>
        <div style={{ width: pct(dist.excellent), background: "var(--success)", borderRadius: "4px 0 0 4px" }} title={`Excellent: ${dist.excellent}`} />
        <div style={{ width: pct(dist.good), background: "var(--accent)" }} title={`Good: ${dist.good}`} />
        <div style={{ width: pct(dist.fair), background: "var(--warn)" }} title={`Fair: ${dist.fair}`} />
        <div style={{ width: pct(dist.poor), background: "var(--danger)", borderRadius: "0 4px 4px 0" }} title={`Poor: ${dist.poor}`} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.66rem", color: "var(--text-dim)", marginTop: 4 }}>
        <span style={{ color: "var(--success)" }}>Excellent {dist.excellent}</span>
        <span style={{ color: "var(--accent)" }}>Good {dist.good}</span>
        <span style={{ color: "var(--warn)" }}>Fair {dist.fair}</span>
        <span style={{ color: "var(--danger)" }}>Poor {dist.poor}</span>
      </div>
    </div>
  );
}

function BenchmarkTile({ label, current, target, targetMax, min, max }) {
  let status = "green";
  if (target !== undefined) {
    if (current < target * 0.5) status = "red";
    else if (current < target) status = "yellow";
  }
  if (targetMax !== undefined) {
    if (current > targetMax * 2) status = "red";
    else if (current > targetMax) status = "yellow";
  }
  if (min !== undefined && max !== undefined) {
    if (current < min) status = "red";
    else if (current > max) status = "yellow";
  }

  let targetLabel;
  if (target !== undefined) targetLabel = `Target: ${target}${label.includes("%") || label.includes("Rate") ? "%" : "+"}`;
  else if (targetMax !== undefined) targetLabel = `Target: < ${targetMax}%`;
  else if (min !== undefined) targetLabel = `Range: ${min}% - ${max}%`;

  return (
    <div className="ctrl-benchmark-tile">
      <div className="ctrl-benchmark-label">{label}</div>
      <div className="ctrl-benchmark-value">
        <span className={`ctrl-benchmark-status ${status}`} />
        {typeof current === "number" ? current.toLocaleString() : current}
        {(label.includes("CTR") || label.includes("%") || label.includes("Rate") || label.includes("Booking") || label.includes("Quote")) ? "%" : ""}
      </div>
      {targetLabel && <div className="ctrl-benchmark-target">{targetLabel}</div>}
    </div>
  );
}

export default function OverviewPage() {
  const data = getOverviewData();
  const benchmarks = getBenchmarksData();
  const m = data.metrics;
  const o = data.outputs;

  const spark = (base) => Array.from({ length: 7 }, (_, i) => Math.max(0, base + Math.floor(Math.sin(i * 0.8) * base * 0.15)));

  return (
    <div data-testid="seo-overview">
      <div className="ctrl-header">
        <h1>Daily Scoreboard</h1>
        <p>
          Last run: {new Date(data.timestamp).toLocaleString()} &middot; Mode: {data.mode} &middot; Run: <code style={{ fontSize: "0.72rem" }}>{data.run_id}</code>
          {data.metrics_window && <> &middot; Window: {data.metrics_window.start} to {data.metrics_window.end} ({data.metrics_window.days}d)</>}
        </p>
      </div>

      <SourcesStrip sources={data.sources} />
      <SanityBanner sanity={data.sanity} />

      {/* Row 1: Core metric cards */}
      <div className="ctrl-metrics" data-testid="overview-metrics">
        <MetricCard label="Pages Attempted" value={m.pages_attempted} delta={0} sparkData={spark(m.pages_attempted)} />
        <MetricCard label="Pages Indexed" value={m.pages_indexed} delta={0} sparkData={spark(m.pages_indexed)} />
        <MetricCard label="Pages Blocked" value={m.pages_blocked} delta={0} sparkData={spark(m.pages_blocked)} />
        <MetricCard label="Pages Noindex" value={m.pages_noindexed} delta={0} sparkData={spark(m.pages_noindexed)} />
      </div>

      {/* Row 2: Input vs Output with attribution */}
      <div className="ctrl-io" data-testid="overview-io">
        <div className="ctrl-io-panel">
          <h3>Inputs <span className="tag input-tag">System</span></h3>
          <div className="ctrl-io-grid">
            <div className="ctrl-io-stat">
              <span className="ctrl-io-stat-label">Corridors Active</span>
              <span className="ctrl-io-stat-value">{data.inputs.corridors_active}</span>
            </div>
            <div className="ctrl-io-stat">
              <span className="ctrl-io-stat-label">Lanes in Scope</span>
              <span className="ctrl-io-stat-value">{data.inputs.lanes_in_scope.toLocaleString()}</span>
            </div>
            <div className="ctrl-io-stat">
              <span className="ctrl-io-stat-label">Lanes with Demand</span>
              <span className="ctrl-io-stat-value">{data.inputs.lanes_with_demand}</span>
            </div>
            <div className="ctrl-io-stat">
              <span className="ctrl-io-stat-label">Data Page Eligible</span>
              <span className="ctrl-io-stat-value">{data.inputs.lanes_data_eligible.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="ctrl-io-panel">
          <h3>Outputs <span className="tag output-tag">Performance</span></h3>
          <div className="ctrl-io-grid">
            <div className="ctrl-io-stat">
              <span className="ctrl-io-stat-label">Pages Generated</span>
              <span className="ctrl-io-stat-value">{o.pages_generated.toLocaleString()}</span>
            </div>
            <div className="ctrl-io-stat">
              <span className="ctrl-io-stat-label">Pages Indexed</span>
              <span className="ctrl-io-stat-value">{o.pages_indexed.toLocaleString()}</span>
            </div>
            <AttributedStat label="GSC Impressions" attr={o.gsc_impressions} />
            <AttributedStat label="Clicks" attr={o.gsc_clicks} />
            <AttributedStat label="Quote Starts" attr={o.quote_starts} />
            <AttributedStat label="Bookings" attr={o.bookings} />
          </div>
        </div>
      </div>

      {/* Row 3: Blocked reasons + quality */}
      <div className="ctrl-section" data-testid="overview-blocked">
        <h2 className="ctrl-section-title">Blocked Reasons</h2>
        <BlockedReasonsTable reasons={data.blockedReasons} />
        <QualityDistribution dist={data.quality_distribution} />
      </div>

      {/* Row 4: Benchmarks and Goals */}
      <div className="ctrl-section ctrl-benchmarks" data-testid="overview-benchmarks">
        <h2 className="ctrl-section-title">Benchmarks &amp; Goals</h2>

        <h4 style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)", margin: "16px 0 0" }}>System Health</h4>
        <div className="ctrl-benchmark-grid">
          <BenchmarkTile label="Canonical Conflicts" current={benchmarks.system_health.canonical_conflicts.current} target={benchmarks.system_health.canonical_conflicts.target} />
          <BenchmarkTile label="Broken Internal Links" current={benchmarks.system_health.broken_internal_links.current} target={benchmarks.system_health.broken_internal_links.target} />
          <BenchmarkTile label="Orphaned Pages" current={benchmarks.system_health.orphaned_pages.current} target={benchmarks.system_health.orphaned_pages.target} />
          <BenchmarkTile label="Eligible Indexing Rate" current={benchmarks.system_health.eligible_indexing_rate_pct.current} target={benchmarks.system_health.eligible_indexing_rate_pct.target} />
          <BenchmarkTile label="Blocked Rate (max)" current={benchmarks.system_health.blocked_rate_pct.current} targetMax={benchmarks.system_health.blocked_rate_pct.target_max} />
        </div>

        <h4 style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-dim)", margin: "20px 0 0" }}>Performance (SEO to Portal)</h4>
        {benchmarks.sources && !benchmarks.sources.gsc?.connected && (
          <p style={{ fontSize: "0.7rem", color: "var(--warn)", margin: "6px 0 0" }}>GSC not connected — performance metrics are from local stub data.</p>
        )}
        <div className="ctrl-benchmark-grid">
          <BenchmarkTile label="Pages w/ Impressions per Corridor" current={benchmarks.performance.pages_with_impressions_per_corridor.current} target={benchmarks.performance.pages_with_impressions_per_corridor.target} />
          <BenchmarkTile label="Lane Page CTR" current={benchmarks.performance.lane_page_ctr_pct.current} min={benchmarks.performance.lane_page_ctr_pct.min} max={benchmarks.performance.lane_page_ctr_pct.max} />
          <BenchmarkTile label="Click to Quote Start" current={benchmarks.performance.click_to_quote_pct.current} min={benchmarks.performance.click_to_quote_pct.min} max={benchmarks.performance.click_to_quote_pct.max} />
          <BenchmarkTile label="Quote Start to Booking" current={benchmarks.performance.quote_to_booking_pct.current} min={benchmarks.performance.quote_to_booking_pct.min} max={benchmarks.performance.quote_to_booking_pct.max} />
        </div>
      </div>
    </div>
  );
}
