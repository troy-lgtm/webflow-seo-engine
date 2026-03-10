import { getExperimentsData } from "@/lib/seo-dashboard-data";

function ExperimentCard({ experiment }) {
  const statusColor = {
    active: "var(--success)",
    planned: "var(--info)",
    completed: "var(--text-dim)",
    paused: "var(--warn)",
  }[experiment.status] || "var(--text-dim)";

  return (
    <div className="ctrl-experiment-card" data-testid={`experiment-${experiment.id}`}>
      <div className="ctrl-experiment-header">
        <div>
          <div className="ctrl-experiment-title">{experiment.name}</div>
          <div className="ctrl-experiment-scope">{experiment.scope}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{
            display: "inline-block", padding: "2px 8px", borderRadius: 10,
            fontSize: "0.66rem", fontWeight: 600, textTransform: "uppercase",
            background: `color-mix(in srgb, ${statusColor} 18%, transparent)`,
            color: statusColor,
          }}>
            {experiment.status}
          </span>
        </div>
      </div>

      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
        {experiment.description}
      </p>

      <div style={{ display: "flex", gap: 16, fontSize: "0.74rem", color: "var(--text-dim)", marginBottom: 12 }}>
        <span>Start: {experiment.start_date}</span>
        <span>Lanes: {experiment.affected_lanes}</span>
      </div>

      <div className="ctrl-experiment-metrics">
        <div className="ctrl-card" style={{ padding: 10, textAlign: "center" }}>
          <div style={{
            fontSize: "1rem", fontWeight: 700,
            color: experiment.metrics.indexing_lift?.startsWith("+") ? "var(--success)"
              : experiment.metrics.indexing_lift === "Pending" ? "var(--text-dim)" : "var(--text)",
          }}>
            {experiment.metrics.indexing_lift}
          </div>
          <div style={{ fontSize: "0.62rem", color: "var(--text-dim)", textTransform: "uppercase" }}>Indexing Lift</div>
        </div>
        <div className="ctrl-card" style={{ padding: 10, textAlign: "center" }}>
          <div style={{
            fontSize: "1rem", fontWeight: 700,
            color: experiment.metrics.traffic_lift?.startsWith("+") ? "var(--success)"
              : experiment.metrics.traffic_lift === "Pending" ? "var(--text-dim)" : "var(--text)",
          }}>
            {experiment.metrics.traffic_lift}
          </div>
          <div style={{ fontSize: "0.62rem", color: "var(--text-dim)", textTransform: "uppercase" }}>Traffic Lift</div>
        </div>
        <div className="ctrl-card" style={{ padding: 10, textAlign: "center" }}>
          <div style={{
            fontSize: "1rem", fontWeight: 700,
            color: experiment.metrics.conversion_lift?.startsWith("+") ? "var(--success)"
              : experiment.metrics.conversion_lift === "Pending" ? "var(--text-dim)" : "var(--text)",
          }}>
            {experiment.metrics.conversion_lift}
          </div>
          <div style={{ fontSize: "0.62rem", color: "var(--text-dim)", textTransform: "uppercase" }}>Conversion Lift</div>
        </div>
      </div>
    </div>
  );
}

export default function ExperimentsPage() {
  const experiments = getExperimentsData();
  const active = experiments.filter(e => e.status === "active");
  const planned = experiments.filter(e => e.status === "planned");
  const completed = experiments.filter(e => e.status === "completed");

  return (
    <div data-testid="seo-experiments">
      <div className="ctrl-header">
        <h1>Experiments</h1>
        <p>
          {experiments.length} experiments &middot;{" "}
          {active.length} active &middot;{" "}
          {planned.length} planned &middot;{" "}
          {completed.length} completed
        </p>
      </div>

      {active.length > 0 && (
        <div className="ctrl-section">
          <h2 className="ctrl-section-title">Active</h2>
          {active.map(e => <ExperimentCard key={e.id} experiment={e} />)}
        </div>
      )}

      {planned.length > 0 && (
        <div className="ctrl-section">
          <h2 className="ctrl-section-title">Planned</h2>
          {planned.map(e => <ExperimentCard key={e.id} experiment={e} />)}
        </div>
      )}

      {completed.length > 0 && (
        <div className="ctrl-section">
          <h2 className="ctrl-section-title">Completed</h2>
          {completed.map(e => <ExperimentCard key={e.id} experiment={e} />)}
        </div>
      )}

      <div className="ctrl-card" style={{ padding: 16, marginTop: 12, textAlign: "center" }}>
        <p style={{ color: "var(--text-dim)", fontSize: "0.78rem", margin: 0 }}>
          Add experiments to <code style={{ fontSize: "0.72rem" }}>artifacts/experiments.json</code> to track them here.
        </p>
      </div>
    </div>
  );
}
