import { getLaneQualityData } from "@/lib/seo-dashboard-data";

function ClassificationCard({ label, count, total, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="ctrl-card" style={{ padding: 16, textAlign: "center" }}>
      <div className="ctrl-card-label">{label}</div>
      <div className="ctrl-card-value" style={{ color }}>{count}</div>
      <div style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>{pct}% of audited</div>
    </div>
  );
}

function GateFailureTable({ failures, ruleIds }) {
  const entries = Object.entries(failures).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return (
      <div className="ctrl-card" style={{ padding: 20, textAlign: "center" }}>
        <p style={{ color: "var(--text-dim)", fontSize: "0.82rem", margin: 0 }}>No gate failures recorded.</p>
      </div>
    );
  }
  return (
    <div className="ctrl-table-wrap">
      <table className="ctrl-table">
        <thead>
          <tr><th>Gate Rule</th><th>Description</th><th>Failures</th></tr>
        </thead>
        <tbody>
          {entries.map(([ruleId, count]) => (
            <tr key={ruleId}>
              <td><code className="mono">{ruleId}</code></td>
              <td style={{ fontSize: "0.75rem" }}>{ruleIds[ruleId] || "Unknown rule"}</td>
              <td><strong>{count}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageDetailTable({ pages }) {
  if (pages.length === 0) {
    return (
      <div className="ctrl-card" style={{ padding: 20, textAlign: "center" }}>
        <p style={{ color: "var(--text-dim)", fontSize: "0.82rem", margin: 0 }}>No validation data available. Run the audit and rebuild pipeline first.</p>
      </div>
    );
  }
  return (
    <div className="ctrl-table-wrap">
      <table className="ctrl-table" data-testid="lane-quality-pages">
        <thead>
          <tr>
            <th>Lane Slug</th>
            <th>Classification</th>
            <th>Quality</th>
            <th>Valid</th>
            <th>Issues</th>
          </tr>
        </thead>
        <tbody>
          {pages.map(p => (
            <tr key={p.slug}>
              <td className="mono" style={{ fontSize: "0.73rem" }}>{p.slug}</td>
              <td>
                <span className={`ctrl-status ${p.classification === "valid_lane_page" ? "indexed" : p.classification === "generic_template_page" ? "blocked" : "noindex"}`}>
                  {p.classification.replace(/_/g, " ")}
                </span>
              </td>
              <td>
                <span style={{
                  color: p.quality_score >= 80 ? "var(--success)"
                    : p.quality_score >= 65 ? "var(--accent)"
                    : p.quality_score >= 40 ? "var(--warn)" : "var(--danger)",
                  fontWeight: 600,
                }}>
                  {p.quality_score}
                </span>
              </td>
              <td>{p.valid ? <span style={{ color: "var(--success)" }}>PASS</span> : <span style={{ color: "var(--danger)" }}>FAIL</span>}</td>
              <td style={{ fontSize: "0.7rem", maxWidth: 300 }}>
                {p.failures.length > 0
                  ? p.failures.map(f => f.rule_id || f.message || "unknown").join(", ")
                  : p.banned_content_found.length > 0
                    ? `Banned: ${p.banned_content_found.slice(0, 3).join(", ")}`
                    : p.missing_sections.length > 0
                      ? `Missing: ${p.missing_sections.join(", ")}`
                      : "None"
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LaneQualityPage() {
  const data = getLaneQualityData();
  const cls = data.audit_summary.classifications;
  const totalAudited = data.audit_summary.total_audited;
  const vs = data.validation_summary;
  const dist = data.quality_distribution;

  const distTotal = (dist.excellent || 0) + (dist.good || 0) + (dist.fair || 0) + (dist.poor || 0);
  const pct = (v) => distTotal > 0 ? `${Math.max(2, (v / distTotal) * 100)}%` : "0%";

  return (
    <div data-testid="lane-quality">
      <div className="ctrl-header">
        <h1>Lane Page Quality</h1>
        <p>
          {data.published_page_count} published pages &middot; {totalAudited} audited &middot; Last run: {new Date(data.timestamp).toLocaleString()}
        </p>
      </div>

      {/* Row 1: Classification cards */}
      <div className="ctrl-metrics" data-testid="lane-quality-classifications">
        <ClassificationCard label="Valid Lane Pages" count={cls.valid_lane_page} total={totalAudited} color="var(--success)" />
        <ClassificationCard label="Generic Template" count={cls.generic_template_page} total={totalAudited} color="var(--danger)" />
        <ClassificationCard label="Fallback Content" count={cls.fallback_content_page} total={totalAudited} color="var(--warn)" />
        <ClassificationCard label="Thin Pages" count={cls.thin_lane_page} total={totalAudited} color="var(--warn)" />
        <ClassificationCard label="Banned Content" count={cls.banned_content_page} total={totalAudited} color="var(--danger)" />
      </div>

      {/* Row 2: Validation gate summary */}
      <div className="ctrl-io" data-testid="lane-quality-gates">
        <div className="ctrl-io-panel">
          <h3>Publish Gate Results <span className="tag input-tag">Validation</span></h3>
          <div className="ctrl-io-grid">
            <div className="ctrl-io-stat">
              <span className="ctrl-io-stat-label">Total Validated</span>
              <span className="ctrl-io-stat-value">{vs.total_validated}</span>
            </div>
            <div className="ctrl-io-stat">
              <span className="ctrl-io-stat-label">Passed</span>
              <span className="ctrl-io-stat-value" style={{ color: "var(--success)" }}>{vs.passed}</span>
            </div>
            <div className="ctrl-io-stat">
              <span className="ctrl-io-stat-label">Failed</span>
              <span className="ctrl-io-stat-value" style={{ color: vs.failed > 0 ? "var(--danger)" : "var(--text-dim)" }}>{vs.failed}</span>
            </div>
            <div className="ctrl-io-stat">
              <span className="ctrl-io-stat-label">Pass Rate</span>
              <span className="ctrl-io-stat-value">
                {vs.total_validated > 0 ? Math.round((vs.passed / vs.total_validated) * 100) : 0}%
              </span>
            </div>
          </div>
        </div>

        <div className="ctrl-io-panel">
          <h3>Quality Score Distribution <span className="tag output-tag">Scores</span></h3>
          {distTotal > 0 ? (
            <>
              <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 1, marginTop: 12 }}>
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
            </>
          ) : (
            <p style={{ color: "var(--text-dim)", fontSize: "0.82rem", marginTop: 12 }}>No quality scores yet. Run validation pipeline.</p>
          )}
        </div>
      </div>

      {/* Row 3: Gate failure breakdown */}
      <div className="ctrl-section" data-testid="lane-quality-gate-failures">
        <h2 className="ctrl-section-title">Gate Failure Breakdown</h2>
        <GateFailureTable failures={vs.gate_failures} ruleIds={data.gate_rule_ids} />
      </div>

      {/* Row 4: Per-page details */}
      <div className="ctrl-section" data-testid="lane-quality-details">
        <h2 className="ctrl-section-title">Per-Page Quality Details</h2>
        <PageDetailTable pages={data.pages} />
      </div>
    </div>
  );
}
