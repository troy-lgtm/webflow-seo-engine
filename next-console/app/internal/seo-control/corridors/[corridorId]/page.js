import Link from "next/link";
import { getCorridorDetail, getCorridorsData } from "@/lib/seo-dashboard-data";

export async function generateStaticParams() {
  const corridors = getCorridorsData();
  return corridors
    .filter(c => c.corridor_id !== "other")
    .map(c => ({ corridorId: c.corridor_id }));
}

export default async function CorridorDetailPage({ params }) {
  const { corridorId } = await params;
  const detail = getCorridorDetail(corridorId);

  if (!detail) {
    return (
      <div>
        <Link href="/internal/seo-control/corridors" className="ctrl-back">← Corridors</Link>
        <h1 style={{ fontSize: "1.1rem" }}>Corridor not found</h1>
      </div>
    );
  }

  const { corridor, lanes } = detail;
  const indexed = lanes.filter(l => l.status === "indexed");
  const blocked = lanes.filter(l => l.status === "blocked");
  const noindexed = lanes.filter(l => l.status === "noindex");

  const funnelMax = Math.max(corridor.impressions || 1, 1);

  return (
    <div data-testid="seo-corridor-detail">
      <Link href="/internal/seo-control/corridors" className="ctrl-back">← Corridors</Link>

      <div className="ctrl-header">
        <h1>{corridor.corridor_name}</h1>
        <p>
          <span className={`ctrl-priority ${corridor.priority}`}>{corridor.priority}</span>
          {" "}
          <span className={`ctrl-status ${corridor.health}`}>{corridor.health}</span>
          {" · "}
          {corridor.indexing_rate}% indexed · {corridor.lanes_total} total lanes
        </p>
      </div>

      <div className="ctrl-two-panel">
        {/* Left: Inputs */}
        <div className="ctrl-panel">
          <h3>Corridor Inputs <span className="tag input-tag" style={{ fontSize: "0.58rem", padding: "1px 5px", borderRadius: 3, marginLeft: 6 }}>System</span></h3>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Origin Cluster</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(corridor.origin_cluster || []).map(c => (
                <span key={c} style={{
                  padding: "3px 8px", background: "var(--surface-3)", borderRadius: 4,
                  fontSize: "0.74rem", color: "var(--text-muted)"
                }}>{c}</span>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Destination Cluster</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {(corridor.destination_cluster || []).map(c => (
                <span key={c} style={{
                  padding: "3px 8px", background: "var(--surface-3)", borderRadius: 4,
                  fontSize: "0.74rem", color: "var(--text-muted)"
                }}>{c}</span>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Lane Inventory</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              <div className="ctrl-card" style={{ padding: 10, textAlign: "center" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--success)" }}>{indexed.length}</div>
                <div style={{ fontSize: "0.64rem", color: "var(--text-dim)" }}>Indexed</div>
              </div>
              <div className="ctrl-card" style={{ padding: 10, textAlign: "center" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--warn)" }}>{noindexed.length}</div>
                <div style={{ fontSize: "0.64rem", color: "var(--text-dim)" }}>Noindex</div>
              </div>
              <div className="ctrl-card" style={{ padding: 10, textAlign: "center" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--danger)" }}>{blocked.length}</div>
                <div style={{ fontSize: "0.64rem", color: "var(--text-dim)" }}>Blocked</div>
              </div>
            </div>
          </div>

          <div>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Demand Coverage</div>
            <div className="ctrl-score-bar">
              <div
                className="ctrl-score-bar-fill"
                style={{
                  width: `${lanes.length > 0 ? Math.round((lanes.filter(l => l.demand_signal).length / lanes.length) * 100) : 0}%`,
                  background: "var(--info)",
                }}
              />
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: 4 }}>
              {lanes.filter(l => l.demand_signal).length} of {lanes.length} lanes have demand signals
            </div>
          </div>
        </div>

        {/* Right: Outputs */}
        <div className="ctrl-panel">
          <h3>Corridor Outputs <span className="tag output-tag" style={{ fontSize: "0.58rem", padding: "1px 5px", borderRadius: 3, marginLeft: 6 }}>Performance</span></h3>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 8 }}>Traffic Funnel</div>
            <div className="ctrl-funnel">
              {[
                { label: "Impressions", value: corridor.impressions, color: "var(--info)" },
                { label: "Clicks", value: corridor.clicks, color: "var(--accent)" },
                { label: "Quote Starts", value: corridor.quote_starts, color: "var(--warn)" },
                { label: "Bookings", value: corridor.bookings, color: "var(--success)" },
              ].map((step, i) => (
                <div key={i} className="ctrl-funnel-step">
                  <div className="ctrl-funnel-label">{step.label}</div>
                  <div className="ctrl-funnel-bar" style={{
                    width: `${Math.max(4, (step.value / funnelMax) * 100)}%`,
                    background: step.color,
                  }} />
                  <div className="ctrl-funnel-value">{step.value.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Quality</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: "1.4rem", fontWeight: 700 }}>{corridor.avg_quality_score}</span>
              <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>avg quality score</span>
            </div>
            <div className="ctrl-score-bar" style={{ marginTop: 6 }}>
              <div
                className="ctrl-score-bar-fill"
                style={{
                  width: `${corridor.avg_quality_score}%`,
                  background: corridor.avg_quality_score >= 70 ? "var(--success)"
                    : corridor.avg_quality_score >= 50 ? "var(--warn)" : "var(--danger)",
                }}
              />
            </div>
          </div>

          <div>
            <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Corridor Explainer</div>
            <Link
              href={`/corridors/${corridor.corridor_id}/how-warp-runs-this-corridor`}
              style={{
                display: "inline-block", padding: "6px 12px", background: "var(--surface-3)",
                borderRadius: 6, fontSize: "0.78rem", color: "var(--accent)", textDecoration: "none",
              }}
            >
              View explainer page →
            </Link>
          </div>
        </div>
      </div>

      {/* Lane list */}
      <div className="ctrl-section">
        <h2 className="ctrl-section-title">Lanes in This Corridor ({lanes.length})</h2>
        <div className="ctrl-table-wrap">
          <table className="ctrl-table">
            <thead>
              <tr>
                <th>Lane</th>
                <th>Status</th>
                <th>Quality</th>
                <th>Demand</th>
                <th>Impressions</th>
                <th>Clicks</th>
                <th>Quotes</th>
              </tr>
            </thead>
            <tbody>
              {lanes.slice(0, 50).map(l => (
                <tr key={l.lane_slug}>
                  <td>
                    <Link
                      href={`/internal/seo-control/lanes/${l.lane_slug}`}
                      className="mono"
                      style={{ color: "var(--accent)", textDecoration: "none" }}
                    >
                      {l.lane_slug}
                    </Link>
                  </td>
                  <td><span className={`ctrl-status ${l.status}`}>{l.status}</span></td>
                  <td>{l.quality_score}</td>
                  <td>{l.demand_signal ? "✓" : "—"}</td>
                  <td>{l.gsc_impressions}</td>
                  <td>{l.gsc_clicks}</td>
                  <td>{l.quote_starts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
