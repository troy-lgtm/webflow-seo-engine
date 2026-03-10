import Link from "next/link";
import { dashboardData } from "@/lib/dashboard-data";
import { buildGraph } from "@/lib/graph-model";

function MetricCard({ label, value, description }) {
  return (
    <article className="metric" data-warp-section="metric" data-warp-metric={label.toLowerCase().replace(/\s+/g, "-")}>
      <span className="metric-k">{label}</span>
      <p className="metric-v">{value}</p>
      <span className="sub" style={{ fontSize: "0.74rem" }}>{description}</span>
    </article>
  );
}

function PipelineBar({ pipeline }) {
  const total = Math.max(1, pipeline.keywords + pipeline.generated + pipeline.approved + pipeline.optimized + pipeline.published);
  const pct = (v) => `${Math.max(2, (v / total) * 100)}%`;
  return (
    <div className="pipeline-bar" data-warp-section="pipeline-progress" style={{ marginTop: 4 }}>
      <div className="seg" style={{ width: pct(pipeline.keywords), background: "var(--info)" }} title={`Keywords: ${pipeline.keywords}`} />
      <div className="seg" style={{ width: pct(pipeline.generated), background: "var(--text-dim)" }} title={`Generated: ${pipeline.generated}`} />
      <div className="seg" style={{ width: pct(pipeline.approved), background: "var(--warn)" }} title={`Approved: ${pipeline.approved}`} />
      <div className="seg" style={{ width: pct(pipeline.optimized), background: "var(--accent)" }} title={`Optimized: ${pipeline.optimized}`} />
      <div className="seg" style={{ width: pct(pipeline.published), background: "var(--success)" }} title={`Published: ${pipeline.published}`} />
    </div>
  );
}

function GraphHealth() {
  const seedPages = dashboardData.recent_pages.map((rp) => {
    const parts = rp.slug.split("-to-");
    if (parts.length < 2) return null;
    const modeMatch = rp.slug.match(/(ltl|ftl|shared)$/i);
    return {
      slug: rp.slug,
      lane: { origin: parts[0].replace(/-/g, " "), destination: parts[1]?.replace(/-(ltl|ftl|shared)$/i, "").replace(/-/g, " "), mode: modeMatch?.[1]?.toUpperCase() || "LTL" },
      target_segment: rp.target_segment,
      network_proof: { origin_region: "Unknown", destination_region: "Unknown" }
    };
  }).filter(Boolean);
  const graph = buildGraph(seedPages);
  const m = graph.metrics;

  return (
    <article className="surface panel" data-warp-section="graph-health" data-testid="graph-health">
      <h2>Knowledge Graph Health</h2>
      <div className="grid-3">
        <div className="metric" style={{ minHeight: "auto" }}>
          <span className="metric-k">Nodes</span>
          <p className="metric-v" style={{ fontSize: "1.1rem" }}>{m.total_nodes}</p>
        </div>
        <div className="metric" style={{ minHeight: "auto" }}>
          <span className="metric-k">Edges</span>
          <p className="metric-v" style={{ fontSize: "1.1rem" }}>{m.total_edges}</p>
        </div>
        <div className="metric" style={{ minHeight: "auto" }}>
          <span className="metric-k">Lanes</span>
          <p className="metric-v" style={{ fontSize: "1.1rem" }}>{m.total_lanes}</p>
        </div>
      </div>
      {m.top_hubs.length > 0 && (
        <div>
          <p className="overline" style={{ marginBottom: 4 }}>Top Hubs</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {m.top_hubs.map((h) => (
              <span key={h.city} className="pill">{h.city} ({h.connections})</span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export default function HomePage() {
  const p = dashboardData.pipeline;

  return (
    <main className="shell" data-warp-page="dashboard">
      <section className="surface hero" data-warp-section="hero">
        <div className="hero-row">
          <div>
            <span className="brand-chip">WARP</span>
            <p className="overline" style={{ marginTop: 8 }}>Operator Console</p>
            <h1 className="title">WARP SEO Engine Dashboard</h1>
          </div>
          <div className="actions">
            <Link className="btn" href="/builder" data-warp-event="nav-builder" data-warp-funnel="start">Open Builder</Link>
            <a className="btn" href="https://www.wearewarp.com/book" target="_blank" rel="noreferrer" data-warp-event="book-call" data-warp-funnel="convert">Book 15-min Fit Call</a>
            <a className="btn primary" href="https://www.wearewarp.com/quote" target="_blank" rel="noreferrer" data-warp-event="get-quote" data-warp-funnel="convert">Get Instant Quote</a>
          </div>
        </div>
        <p className="sub">Goal: {dashboardData.goals.north_star}</p>
      </section>

      <section data-warp-section="pipeline-metrics">
        <div className="grid-5">
          <MetricCard label="Keywords" value={p.keywords} description="Target keyword rows" />
          <MetricCard label="Generated" value={p.generated} description="Draft pages produced" />
          <MetricCard label="Approved" value={p.approved} description="QA-passing pages" />
          <MetricCard label="Optimized" value={p.optimized} description="Self-learning edits" />
          <MetricCard label="Published" value={p.published} description="Live pages" />
        </div>
        <PipelineBar pipeline={p} />
      </section>

      <section className="two-col">
        <article className="surface panel" data-warp-section="backlog">
          <h2>Top Optimization Backlog</h2>
          <table className="table">
            <thead><tr><th>Slug</th><th>Priority</th><th>Friction</th><th>Conv.</th><th>Top Hypothesis</th></tr></thead>
            <tbody>
              {dashboardData.top_backlog.map((row) => (
                <tr key={row.slug}>
                  <td><span className="pill">{row.slug}</span></td>
                  <td className={row.priority_score > 0 ? "warn" : "good"}>{row.priority_score.toFixed(1)}</td>
                  <td>{row.friction_score.toFixed(1)}</td>
                  <td>{row.conversion_score.toFixed(0)}</td>
                  <td style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{row.hypotheses?.[0] || "No hypothesis"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <div className="stack">
          <GraphHealth />
          <article className="surface panel" data-warp-section="goals">
            <h2>Engine Goals</h2>
            <ul className="sub" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
              {dashboardData.goals.primary_kpis.map((kpi) => (<li key={kpi}>{kpi}</li>))}
            </ul>
            <p style={{ margin: 0, fontSize: "0.72rem", color: "var(--text-dim)" }}>Guardrail: {dashboardData.goals.guardrail}</p>
          </article>
          <article className="surface panel" data-warp-section="recent-pages">
            <h2>Recent Pages</h2>
            <table className="table">
              <thead><tr><th>Slug</th><th>Segment</th><th>Title</th></tr></thead>
              <tbody>
                {dashboardData.recent_pages.map((row) => (
                  <tr key={`${row.slug}-${row.seo_title}`}>
                    <td><span className="pill">{row.slug}</span></td>
                    <td>{row.target_segment}</td>
                    <td style={{ fontSize: "0.8rem" }}>{row.seo_title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        </div>
      </section>
    </main>
  );
}
