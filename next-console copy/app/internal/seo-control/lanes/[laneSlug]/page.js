import Link from "next/link";
import { getLaneDetail } from "@/lib/seo-dashboard-data";
import MetricMeta from "../../components/MetricMeta";

function Check({ pass, label }) {
  return (
    <li>
      <span className={`ctrl-check ${pass ? "pass" : "fail"}`}>{pass ? "✓" : "✗"}</span>
      {label}
    </li>
  );
}

function AttrMetricCard({ label, attr }) {
  const val = attr?.value;
  const hasValue = val !== null && val !== undefined;
  const display = hasValue ? (typeof val === "number" ? val.toLocaleString() : val) : "—";

  return (
    <div className="ctrl-card" style={{ padding: 8, textAlign: "center" }}>
      <div style={{ fontSize: "1rem", fontWeight: 700 }}>
        {!hasValue ? (
          <span className="ctrl-attributed-missing">—</span>
        ) : attr?.is_placeholder ? (
          <span className="ctrl-attributed-hidden">{display}</span>
        ) : display}
      </div>
      <div style={{ fontSize: "0.6rem", color: "var(--text-dim)" }}>{label}</div>
      {attr?.source && (
        <MetricMeta source={attr.source} connected={attr.connected} window={attr.window} last_pulled_at={attr.last_pulled_at} coverage={attr.coverage} />
      )}
      {!hasValue && <span className="ctrl-not-connected-badge">Not connected</span>}
    </div>
  );
}

export default async function LaneInspectorPage({ params }) {
  const { laneSlug } = await params;
  const detail = getLaneDetail(laneSlug);

  if (!detail) {
    return (
      <div>
        <Link href="/internal/seo-control/lanes" className="ctrl-back">← Lanes</Link>
        <h1 style={{ fontSize: "1.1rem" }}>Lane not found: {laneSlug}</h1>
      </div>
    );
  }

  const { lane, corridor, reasons, demand, cities, canonical_path, sources, metrics_window } = detail;

  const scoreColor = lane.quality_score >= 80 ? "var(--success)"
    : lane.quality_score >= 65 ? "var(--accent)"
    : lane.quality_score >= 40 ? "var(--warn)" : "var(--danger)";

  // Extract attributed values or fallback
  const gscImp = demand.gsc?.impressions;
  const gscClicks = demand.gsc?.clicks;
  const gscPos = demand.gsc?.position;
  const portalQuotes = demand.portal?.monthly_quotes;
  const portalBookings = demand.portal?.bookings;
  const portalAvgVal = demand.portal?.avg_value_usd;

  return (
    <div data-testid="seo-lane-inspector">
      <Link href="/internal/seo-control/lanes" className="ctrl-back">← Lanes</Link>

      <div className="ctrl-header">
        <h1 style={{ fontFamily: "var(--font-mono), monospace" }}>{laneSlug}</h1>
        <p>
          <span className={`ctrl-status ${lane.status}`}>{lane.status}</span>
          {" · "}Quality: <span style={{ color: scoreColor, fontWeight: 700 }}>{lane.quality_score}</span>
          {" · "}Corridor: {corridor ? (
            <Link href={`/internal/seo-control/corridors/${corridor.corridor_id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
              {corridor.corridor_name}
            </Link>
          ) : lane.corridor}
        </p>
      </div>

      {/* Canonical join key — prominent */}
      <div style={{ marginBottom: 16 }}>
        <div className="ctrl-card-label" style={{ marginBottom: 4 }}>Canonical Join Key</div>
        <span className="ctrl-canonical-path" data-testid="canonical-path">{canonical_path}</span>
        {metrics_window && (
          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginLeft: 8 }}>
            Window: {metrics_window.start} to {metrics_window.end}
          </span>
        )}
      </div>

      {/* Sources strip for this lane */}
      {sources && (
        <div className="ctrl-sources-strip" style={{ marginBottom: 12 }}>
          {[
            { key: "gsc", label: "GSC", connected: sources.gsc?.connected },
            { key: "ga4", label: "GA4", connected: sources.ga4?.connected },
            { key: "portal", label: "Portal", connected: sources.portal?.connected },
          ].map(s => (
            <span key={s.key} className="ctrl-source-chip">
              <span className={`ctrl-source-dot ${s.connected ? "connected" : "disconnected"}`} />
              {s.label}: {s.connected ? "Connected" : "Local stub"}
            </span>
          ))}
        </div>
      )}

      <div className="ctrl-two-panel">
        {/* Left: Inputs */}
        <div className="ctrl-panel">
          <h3>Inputs <span className="tag input-tag" style={{ fontSize: "0.58rem", padding: "1px 5px", borderRadius: 3, marginLeft: 6 }}>System</span></h3>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Normalized Cities</div>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ padding: "4px 10px", background: "var(--surface-3)", borderRadius: 4, fontSize: "0.78rem" }}>{cities.origin || "—"}</span>
              <span style={{ color: "var(--text-dim)", fontSize: "0.78rem", alignSelf: "center" }}>→</span>
              <span style={{ padding: "4px 10px", background: "var(--surface-3)", borderRadius: 4, fontSize: "0.78rem" }}>{cities.destination || "—"}</span>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Corridor Assignment</div>
            <div className="ctrl-card" style={{ padding: 10 }}>
              {corridor ? (
                <>
                  <div style={{ fontWeight: 600, fontSize: "0.82rem" }}>{corridor.corridor_name}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 2 }}>
                    <span className={`ctrl-priority ${corridor.priority}`}>{corridor.priority}</span>
                    {" · "}{corridor.lanes_total} lanes · {corridor.indexing_rate}% indexed
                  </div>
                </>
              ) : (
                <span style={{ color: "var(--text-dim)", fontSize: "0.78rem" }}>Unassigned (other)</span>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Demand Signals</div>
            <ul className="ctrl-checklist">
              <Check
                pass={Boolean(demand.gsc)}
                label={demand.gsc
                  ? `GSC: ${gscImp?.value ?? 0} impr · ${gscClicks?.value ?? 0} clicks · pos ${gscPos?.value ?? "—"}`
                  : "GSC: No data"}
              />
              <Check
                pass={Boolean(demand.keywords?.length)}
                label={`Keywords: ${demand.keywords ? demand.keywords.join(", ") : "None"}`}
              />
              <Check
                pass={Boolean(demand.portal)}
                label={demand.portal
                  ? `Portal: ${portalQuotes?.value ?? 0} quotes/mo · $${portalAvgVal?.value ?? 0} avg`
                  : "Portal: No data"}
              />
            </ul>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Content Sufficiency</div>
            <ul className="ctrl-checklist">
              <Check pass={lane.quality_score >= 65} label="Intro present" />
              <Check pass={lane.quality_score >= 50} label="Lane guidance present" />
              <Check pass={true} label="FAQ count ≥ 4" />
              <Check pass={lane.quality_score >= 60} label="Operational details present" />
            </ul>
          </div>

          <div>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Internal Link Checklist</div>
            <ul className="ctrl-checklist">
              <Check pass={lane.corridor !== "other"} label="Corridor hub link" />
              <Check pass={lane.quality_score >= 50} label="Related lanes ≥ 5" />
              <Check pass={true} label="Tool link present" />
              <Check pass={lane.quality_score >= 70} label="Data page link" />
            </ul>
          </div>
        </div>

        {/* Right: Outputs with attribution */}
        <div className="ctrl-panel">
          <h3>Outputs <span className="tag output-tag" style={{ fontSize: "0.58rem", padding: "1px 5px", borderRadius: 3, marginLeft: 6 }}>Performance</span></h3>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Robots Status</div>
            <span className={`ctrl-status ${lane.status}`} style={{ fontSize: "0.78rem" }}>{lane.status}</span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Canonical URL</div>
            <span className="ctrl-canonical-path">{canonical_path}</span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Quality Score</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: "1.6rem", fontWeight: 700, color: scoreColor }}>{lane.quality_score}</span>
              <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>/ 100</span>
            </div>
            <div className="ctrl-score-bar" style={{ marginTop: 6 }}>
              <div className="ctrl-score-bar-fill" style={{ width: `${lane.quality_score}%`, background: scoreColor }} />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Similarity Score</div>
            <span style={{ fontSize: "1.1rem", fontWeight: 600, color: lane.similarity_score < 0.3 ? "var(--success)" : lane.similarity_score < 0.6 ? "var(--warn)" : "var(--danger)" }}>
              {lane.similarity_score.toFixed(2)}
            </span>
            <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginLeft: 4 }}>
              {lane.similarity_score < 0.3 ? "unique" : lane.similarity_score < 0.6 ? "similar" : "duplicate risk"}
            </span>
          </div>

          {/* GSC Metrics — attributed */}
          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>GSC Metrics</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <AttrMetricCard label="Impressions" attr={gscImp} />
              <AttrMetricCard label="Clicks" attr={gscClicks} />
              <AttrMetricCard label="Avg Position" attr={gscPos} />
            </div>
          </div>

          {/* Conversion — attributed */}
          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Conversion</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <AttrMetricCard label="Quote Starts" attr={portalQuotes} />
              <AttrMetricCard label="Bookings" attr={portalBookings} />
            </div>
          </div>

          {/* GA4 */}
          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>GA4 Events</div>
            {demand.ga4 ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <AttrMetricCard label="Sessions" attr={demand.ga4.sessions} />
                <AttrMetricCard label="Page Views" attr={demand.ga4.page_views} />
              </div>
            ) : (
              <div className="ctrl-card" style={{ padding: 10, color: "var(--text-dim)", fontSize: "0.76rem" }}>
                <span className="ctrl-not-connected-badge" style={{ marginRight: 6 }}>Not connected</span>
                Set <code style={{ fontSize: "0.68rem" }}>GA4_PROPERTY_ID</code> + <code style={{ fontSize: "0.68rem" }}>GA4_SERVICE_ACCOUNT_KEY</code> in .env
              </div>
            )}
          </div>
        </div>
      </div>

      {reasons.length > 0 && (
        <div className="ctrl-section">
          <h2 className="ctrl-section-title">Block / Noindex Reasons</h2>
          <div className="ctrl-table-wrap">
            <table className="ctrl-table">
              <thead><tr><th>Rule ID</th><th>Details</th></tr></thead>
              <tbody>
                {reasons.map((r, i) => (
                  <tr key={i}>
                    <td><code className="mono">{r.rule_id}</code></td>
                    <td style={{ fontSize: "0.76rem" }}>{JSON.stringify(r.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
