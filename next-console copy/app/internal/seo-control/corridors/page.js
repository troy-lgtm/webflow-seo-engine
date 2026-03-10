import Link from "next/link";
import { getCorridorsData } from "@/lib/seo-dashboard-data";

function HealthBar({ corridor }) {
  const total = corridor.lanes_total || 1;
  const iPct = (corridor.lanes_indexed / total) * 100;
  const nPct = (corridor.lanes_noindexed / total) * 100;
  const bPct = (corridor.lanes_blocked / total) * 100;

  return (
    <div className="ctrl-health-bar">
      <div className="seg" style={{ width: `${iPct}%`, background: "var(--success)" }} />
      <div className="seg" style={{ width: `${nPct}%`, background: "var(--warn)" }} />
      <div className="seg" style={{ width: `${bPct}%`, background: "var(--danger)" }} />
    </div>
  );
}

function CorridorCard({ corridor }) {
  if (corridor.corridor_id === "other") return null;

  return (
    <Link
      href={`/internal/seo-control/corridors/${corridor.corridor_id}`}
      className="ctrl-corridor-card"
      data-testid={`corridor-card-${corridor.corridor_id}`}
    >
      <div className="ctrl-corridor-card-header">
        <div>
          <div className="ctrl-corridor-card-name">{corridor.corridor_name}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <span className={`ctrl-priority ${corridor.priority}`}>{corridor.priority}</span>
            <span className={`ctrl-status ${corridor.health}`}>{corridor.health}</span>
          </div>
        </div>
        <span style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>
          {corridor.indexing_rate}% indexed
        </span>
      </div>

      <HealthBar corridor={corridor} />

      <div className="ctrl-corridor-card-io">
        <div className="ctrl-corridor-card-section">
          <h4>Inputs</h4>
          <div className="ctrl-corridor-stat">
            <span>Lanes total</span>
            <strong>{corridor.lanes_total}</strong>
          </div>
          <div className="ctrl-corridor-stat">
            <span>Avg quality</span>
            <strong>{corridor.avg_quality_score}</strong>
          </div>
        </div>

        <div className="ctrl-corridor-card-section">
          <h4>Outputs</h4>
          <div className="ctrl-corridor-stat">
            <span>Indexed</span>
            <strong>{corridor.lanes_indexed}</strong>
          </div>
          <div className="ctrl-corridor-stat">
            <span>Impressions</span>
            <strong>{corridor.impressions.toLocaleString()}</strong>
          </div>
          <div className="ctrl-corridor-stat">
            <span>Clicks</span>
            <strong>{corridor.clicks}</strong>
          </div>
          <div className="ctrl-corridor-stat">
            <span>Quotes</span>
            <strong>{corridor.quote_starts}</strong>
          </div>
          <div className="ctrl-corridor-stat">
            <span>Bookings</span>
            <strong>{corridor.bookings}</strong>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function CorridorsPage() {
  const corridors = getCorridorsData();
  const real = corridors.filter(c => c.corridor_id !== "other");
  const other = corridors.find(c => c.corridor_id === "other");

  const healthy = real.filter(c => c.health === "healthy").length;
  const atRisk = real.filter(c => c.health === "at-risk").length;
  const broken = real.filter(c => c.health === "broken").length;

  return (
    <div data-testid="seo-corridors">
      <div className="ctrl-header">
        <h1>Corridors</h1>
        <p>
          {real.length} corridors &middot;{" "}
          <span style={{ color: "var(--success)" }}>{healthy} healthy</span> &middot;{" "}
          <span style={{ color: "var(--warn)" }}>{atRisk} at risk</span> &middot;{" "}
          <span style={{ color: "var(--danger)" }}>{broken} broken</span>
          {other && <> &middot; {other.lanes_total} unassigned lanes</>}
        </p>
      </div>

      <div className="ctrl-corridor-grid">
        {real
          .sort((a, b) => {
            const prio = { high: 0, medium: 1, low: 2 };
            return (prio[a.priority] || 3) - (prio[b.priority] || 3);
          })
          .map(c => (
            <CorridorCard key={c.corridor_id} corridor={c} />
          ))}
      </div>
    </div>
  );
}
