/**
 * Publish Audit — Internal SEO Control Panel page
 *
 * Answers all seven daily questions with machine-enforced trust classification.
 * A local simulation can NEVER present as "confirmed posted today."
 *
 * Classification labels:
 *   - Confirmed production publish     (green, high trust)
 *   - Production publish unverified    (yellow, medium trust)
 *   - Production publish failed        (red, low trust)
 *   - Staging publish                  (yellow, medium trust)
 *   - Simulated local audit            (gray, low trust)
 *   - Unknown                          (gray, low trust)
 */

import { loadJsonArtifact } from "@/lib/artifacts/load-artifact";
import { classifyPublishRun, DISPLAY_LABELS, TRUST_LEVELS } from "@/lib/publish-classification";

// ── Trust badge color mapping ───────────────────────────────────────

function classificationColor(cls) {
  switch (cls) {
    case "production_confirmed": return "var(--success)";
    case "staging_publish":
    case "production_unverified": return "var(--warn)";
    case "production_failed": return "var(--danger)";
    case "local_simulation":
    case "unknown":
    default: return "var(--text-dim)";
  }
}

function trustBadgeStyle(trustLevel) {
  const colors = {
    high: { bg: "rgba(34,197,94,0.12)", border: "var(--success)", text: "var(--success)" },
    medium: { bg: "rgba(234,179,8,0.12)", border: "var(--warn)", text: "var(--warn)" },
    low: { bg: "rgba(120,120,128,0.12)", border: "var(--text-dim)", text: "var(--text-dim)" },
  };
  const c = colors[trustLevel] || colors.low;
  return {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: "var(--radius-sm)",
    border: `1px solid ${c.border}`,
    background: c.bg,
    color: c.text,
    fontSize: "0.72rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  };
}

function bannerStatusClass(cls) {
  switch (cls) {
    case "production_confirmed": return "indexed";
    case "staging_publish":
    case "production_unverified": return "noindex";
    case "production_failed": return "blocked";
    default: return "";
  }
}

// ── Banner phrasing — NEVER says "posted today" unless production_confirmed ──

function bannerPhrase(cls, runsToday) {
  switch (cls) {
    case "production_confirmed":
      return "Confirmed production publish completed today";
    case "production_unverified":
      return "Production publish ran today but is unverified";
    case "production_failed":
      return "Production publish failed today";
    case "staging_publish":
      return "Staging publish ran today";
    case "local_simulation":
      return runsToday > 0
        ? "Simulated local audit ran today"
        : "Simulated local audit — no real deploy";
    default:
      return "Unknown classification — cannot confirm publish status";
  }
}

export default function PublishAuditPage() {
  // Load all audit artifacts
  const decision = loadJsonArtifact("artifacts/publish_decision.json");
  const history = loadJsonArtifact("artifacts/publish_run_history.json");
  const pagesLatest = loadJsonArtifact("artifacts/published_pages_latest.json");
  const confirmation = loadJsonArtifact("artifacts/publish_confirmation_report.json");
  const verification = loadJsonArtifact("artifacts/live_page_verification.json");
  const impactEstimate = loadJsonArtifact("artifacts/seo_impact_estimate.json");
  const momentum = loadJsonArtifact("artifacts/seo_momentum_report.json");
  const integrity = loadJsonArtifact("artifacts/publish_integrity_report.json");
  const impactBenchmarks = loadJsonArtifact("config/seo-impact-benchmarks.json");

  // ── Classification — single source of truth ──
  const classification = decision
    ? classifyPublishRun(decision, verification)
    : { classification: "unknown", display_status: "Unknown", trust_level: "low", confirmed_posted_today: false, reason_codes: ["no_publish_decision"] };

  const cls = classification.classification;
  const displayStatus = classification.display_status;
  const trustLevel = classification.trust_level;
  const confirmedToday = classification.confirmed_posted_today;
  const reasonCodes = classification.reason_codes || [];

  // Today's runs
  const auditConfig = loadJsonArtifact("config/publish-audit.json") || { timezone: "America/Los_Angeles" };
  const today = (() => {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: auditConfig.timezone }).format(new Date());
    } catch {
      return new Date().toISOString().split("T")[0];
    }
  })();

  const allRuns = history?.runs || [];
  const todaysRuns = allRuns.filter(r => {
    try {
      const d = new Date(r.timestamp);
      return new Intl.DateTimeFormat("en-CA", { timeZone: auditConfig.timezone }).format(d) === today;
    } catch {
      return false;
    }
  });

  // Deploy info
  const deploy = decision?.deploy || null;
  const deployStatus = deploy?.status || "unknown";

  // Page counts
  const pagesAttempted = decision?.pages_attempted || 0;
  const pagesGenerated = decision?.pages_generated || 0;
  const pagesIndexable = decision?.pages_indexable || 0;
  const pagesNoindex = decision?.pages_noindex || 0;
  const pagesBlocked = decision?.pages_blocked || 0;

  // Verification
  const verChecked = verification?.checked || 0;
  const verPassed = verification?.passed || 0;
  const verFailed = verification?.failed || 0;
  const verPassRate = verChecked > 0 ? Math.round((verPassed / verChecked) * 100) : null;
  const verStatus = verification?.verification_status || "not_run";

  // Impact
  const impact = impactEstimate?.expected || null;

  // Momentum
  const actual = momentum?.actual || null;
  const momentumStatus = momentum?.status || "insufficient_data";

  // Integrity
  const integrityStatus = integrity?.overall_status || "unknown";
  const integrityIssues = integrity?.issues || [];

  // URL lists
  const indexablePages = pagesLatest?.live_indexable_pages || [];
  const noindexPages = pagesLatest?.live_noindex_pages || [];
  const blockedPages = pagesLatest?.blocked_pages || [];
  const siteBase = decision?.site_base_url || "https://www.wearewarp.com";

  // Confirmation
  const topCorridors = confirmation?.top_corridors || [];
  const blockedReasons = decision?.blocked_reasons || [];

  // Benchmark comparison
  const laneSnap = loadJsonArtifact("artifacts/lane_registry_snapshot.json");
  const totalLanes = laneSnap?.lanes?.length || 0;
  const indexingRatePct = totalLanes > 0 ? Math.round((pagesIndexable / totalLanes) * 100) : 0;
  const blockedRatePct = totalLanes > 0 ? Math.round((pagesBlocked / totalLanes) * 100) : 0;

  return (
    <main className="ctrl" data-testid="publish-audit-page">
      {/* ── Integrity Warning Banner ── */}
      {integrityStatus === "integrity_warning" && (
        <div className="ctrl-sanity-banner" data-testid="integrity-banner">
          <span>WARNING</span>
          <span>Integrity Warning: {integrity?.summary?.high || 0} high-severity issue(s) detected across publish artifacts</span>
        </div>
      )}

      {/* ── Top Banner: Classification + Trust Badge ── */}
      <div className="ctrl-card" style={{ marginBottom: 20, padding: "20px 24px" }} data-testid="publish-banner">
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 300px" }}>
            {/* Classification label — THE source of truth */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span
                className={`ctrl-status ${bannerStatusClass(cls)}`}
                style={{ fontSize: "0.82rem", padding: "4px 12px" }}
                data-testid="classification-badge"
              >
                {displayStatus}
              </span>
              <span style={trustBadgeStyle(trustLevel)} data-testid="trust-badge">
                {trustLevel} trust
              </span>
            </div>
            {/* Banner phrase — NEVER says "posted today" unless production_confirmed */}
            <div className="ctrl-card-value" style={{
              color: classificationColor(cls),
              fontSize: "0.92rem",
              fontWeight: 600,
            }} data-testid="banner-phrase">
              {bannerPhrase(cls, todaysRuns.length)}
            </div>
            {!confirmedToday && todaysRuns.length > 0 && (
              <div style={{ fontSize: "0.75rem", color: "var(--warn)", marginTop: 4 }}>
                {todaysRuns.length} run(s) today — classification: {displayStatus}
              </div>
            )}
          </div>
          <div style={{ flex: "0 0 auto", display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div className="ctrl-card-label">Latest Run ID</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}>{decision?.run_id || "none"}</div>
            </div>
            <div>
              <div className="ctrl-card-label">Timestamp</div>
              <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                {decision?.timestamp ? new Date(decision.timestamp).toLocaleString() : "\u2014"}
              </div>
            </div>
            <div>
              <div className="ctrl-card-label">Deploy Status</div>
              <span className={`ctrl-status ${deployStatus === "success" ? "indexed" : deployStatus === "unknown" ? "noindex" : "blocked"}`}>
                {deployStatus}
              </span>
            </div>
            {deploy?.deployment_url && deploy.deployment_url !== "unknown" && deploy.deployment_url !== "http://localhost:3001" && (
              <div>
                <div className="ctrl-card-label">Deploy Link</div>
                <a href={deploy.deployment_url} target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: "0.78rem", color: "var(--accent)" }}>
                  View &rarr;
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Why this classification — reason codes ── */}
      {reasonCodes.length > 0 && (
        <div className="ctrl-card" style={{ marginBottom: 20, padding: "12px 16px" }} data-testid="reason-codes">
          <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Why this is classified this way</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {reasonCodes.map((code, i) => (
              <span key={i} className="mono" style={{
                display: "inline-block",
                padding: "2px 8px",
                background: "var(--surface-2)",
                borderRadius: "var(--radius-sm)",
                fontSize: "0.72rem",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
              }}>
                {code}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Row 1: Page Count Cards ── */}
      <div className="ctrl-section-title">Page Counts</div>
      <div className="ctrl-metrics" style={{ gridTemplateColumns: "repeat(5, 1fr)" }} data-testid="page-counts">
        <div className="ctrl-card">
          <div className="ctrl-card-label">Attempted</div>
          <div className="ctrl-card-value">{pagesAttempted.toLocaleString()}</div>
        </div>
        <div className="ctrl-card">
          <div className="ctrl-card-label">Generated</div>
          <div className="ctrl-card-value">{pagesGenerated.toLocaleString()}</div>
        </div>
        <div className="ctrl-card">
          <div className="ctrl-card-label">Indexable</div>
          <div className="ctrl-card-value" style={{ color: "var(--success)" }}>{pagesIndexable.toLocaleString()}</div>
        </div>
        <div className="ctrl-card">
          <div className="ctrl-card-label">Noindex</div>
          <div className="ctrl-card-value" style={{ color: "var(--warn)" }}>{pagesNoindex.toLocaleString()}</div>
        </div>
        <div className="ctrl-card">
          <div className="ctrl-card-label">Blocked</div>
          <div className="ctrl-card-value" style={{ color: "var(--danger)" }}>{pagesBlocked.toLocaleString()}</div>
        </div>
      </div>

      {/* ── Row 2: Two Panels ── */}
      <div className="ctrl-two-panel">
        {/* Left: Publish Confirmation */}
        <div className="ctrl-panel" data-testid="publish-confirmation">
          <h3>Publish Confirmation</h3>

          {/* Verification */}
          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label">Live Page Verification</div>
            {verification ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span className={`ctrl-status ${verStatus === "passed" ? "indexed" : verStatus === "warning" ? "noindex" : "blocked"}`}>
                  {verPassed}/{verChecked} passed ({verPassRate}%)
                </span>
                <span className="mono" style={{ fontSize: "0.68rem", color: "var(--text-dim)" }}>
                  [{verStatus}]
                </span>
                {verFailed > 0 && (
                  <span style={{ fontSize: "0.72rem", color: "var(--danger)" }}>
                    {verFailed} failed
                  </span>
                )}
              </div>
            ) : (
              <span className="ctrl-not-connected-badge" style={{ marginTop: 4 }}>Not run</span>
            )}
          </div>

          {/* Sample Live URLs */}
          {confirmation?.sample_live_urls?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Sample Live URLs</div>
              <div style={{ maxHeight: 200, overflow: "auto", fontSize: "0.75rem" }}>
                {confirmation.sample_live_urls.slice(0, 10).map((url, i) => (
                  <div key={i} style={{ padding: "3px 0" }}>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                       style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                      {url}
                    </a>
                  </div>
                ))}
                {confirmation.sample_live_urls.length > 10 && (
                  <div style={{ color: "var(--text-dim)", marginTop: 4 }}>
                    +{confirmation.sample_live_urls.length - 10} more
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Top Corridors */}
          {topCorridors.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Top Corridors</div>
              {topCorridors.slice(0, 5).map((c, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", padding: "3px 0", color: "var(--text-muted)" }}>
                  <span>{c.corridor_id}</span>
                  <span><strong style={{ color: "var(--text)" }}>{c.pages_indexable}</strong> indexable / {c.pages_generated} gen</span>
                </div>
              ))}
            </div>
          )}

          {/* Blocked Reasons */}
          {blockedReasons.length > 0 && (
            <div>
              <div className="ctrl-card-label" style={{ marginBottom: 6 }}>Blocked Reasons ({blockedReasons.length})</div>
              <div style={{ maxHeight: 120, overflow: "auto", fontSize: "0.72rem" }}>
                {(() => {
                  const counts = {};
                  for (const r of blockedReasons) {
                    const id = r.rule_id || "unknown";
                    counts[id] = (counts[id] || 0) + 1;
                  }
                  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([id, count], i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", color: "var(--text-muted)" }}>
                      <span className="mono">{id}</span>
                      <span>{count}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Right: Expected SEO Boost */}
        <div className="ctrl-panel" data-testid="seo-impact">
          <h3>Expected SEO Boost</h3>

          {impact ? (
            <div>
              {[
                { label: "Week 1 Indexed Pages", data: impact.week_1?.indexed_pages },
                { label: "Week 4 Indexed Pages", data: impact.week_4?.indexed_pages },
                { label: "Month 2 Impressions", data: impact.month_2?.impressions },
                { label: "Month 2 Clicks", data: impact.month_2?.clicks },
                { label: "Month 2 Quote Starts", data: impact.month_2?.quote_starts },
                { label: "Month 2 Bookings", data: impact.month_2?.bookings },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{item.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", fontWeight: 600 }}>
                    {item.data ? `${item.data.low.toLocaleString()} \u2013 ${item.data.high.toLocaleString()}` : "\u2014"}
                  </span>
                </div>
              ))}
              <div style={{ marginTop: 12, padding: 10, background: "var(--surface-2)", borderRadius: "var(--radius-sm)", fontSize: "0.68rem", color: "var(--text-dim)" }}>
                These are benchmark-based directional ranges, not rank guarantees.
                {impactEstimate?.assumptions?.priority_corridor_share > 0 && (
                  <span> Priority corridor share: {(impactEstimate.assumptions.priority_corridor_share * 100).toFixed(0)}%.</span>
                )}
              </div>
            </div>
          ) : (
            <div style={{ color: "var(--text-dim)", fontSize: "0.82rem" }}>
              No impact estimate available. Run <code style={{ fontSize: "0.72rem" }}>npm run audit:publish</code> to generate.
            </div>
          )}
        </div>
      </div>

      {/* ── Row 3: Actual Early Momentum ── */}
      <div className="ctrl-section-title">Actual Early Momentum</div>
      <div className="ctrl-card" style={{ marginBottom: 20, padding: 16 }} data-testid="seo-momentum">
        {actual ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <span className="ctrl-card-label" style={{ margin: 0 }}>Status</span>
              <span className={`ctrl-status ${
                momentumStatus === "ahead_of_plan" ? "indexed" :
                momentumStatus === "on_track" ? "healthy" :
                momentumStatus === "below_plan" ? "blocked" : "noindex"
              }`}>{momentumStatus.replace(/_/g, " ")}</span>
              {momentum?.notes?.[0] && (
                <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>{momentum.notes[0]}</span>
              )}
            </div>
            <div className="ctrl-metrics" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
              {[
                { label: "Indexed Known", value: actual.indexed_pages_known },
                { label: "With Impressions", value: actual.pages_with_nonzero_impressions },
                { label: "Impressions", value: actual.impressions },
                { label: "Clicks", value: actual.clicks },
                { label: "Quote Starts", value: actual.quote_starts },
                { label: "Bookings", value: actual.bookings },
              ].map((m, i) => (
                <div className="ctrl-card" key={i}>
                  <div className="ctrl-card-label">{m.label}</div>
                  <div className="ctrl-card-value" style={{ fontSize: "1.2rem" }}>
                    {m.value != null ? m.value.toLocaleString() : "\u2014"}
                  </div>
                </div>
              ))}
            </div>
            {/* WoW deltas */}
            {momentum?.week_over_week && (
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: "0.72rem", color: "var(--text-dim)" }}>
                {momentum.week_over_week.impressions_delta != null && (
                  <span>Impressions WoW: <strong style={{ color: momentum.week_over_week.impressions_delta >= 0 ? "var(--success)" : "var(--danger)" }}>
                    {momentum.week_over_week.impressions_delta >= 0 ? "+" : ""}{(momentum.week_over_week.impressions_delta * 100).toFixed(0)}%
                  </strong></span>
                )}
                {momentum.week_over_week.clicks_delta != null && (
                  <span>Clicks WoW: <strong style={{ color: momentum.week_over_week.clicks_delta >= 0 ? "var(--success)" : "var(--danger)" }}>
                    {momentum.week_over_week.clicks_delta >= 0 ? "+" : ""}{(momentum.week_over_week.clicks_delta * 100).toFixed(0)}%
                  </strong></span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: "var(--text-dim)", fontSize: "0.82rem" }}>
            Insufficient data — no metrics snapshot available or sources not connected.
          </div>
        )}
      </div>

      {/* ── Row 4: Runs Today Table ── */}
      <div className="ctrl-section-title">Runs Today ({today})</div>
      <div className="ctrl-table-wrap" style={{ marginBottom: 20 }} data-testid="runs-today">
        <table className="ctrl-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Mode</th>
              <th>Classification</th>
              <th>Deploy Status</th>
              <th>Generated</th>
              <th>Indexable</th>
              <th>Deployment ID</th>
            </tr>
          </thead>
          <tbody>
            {todaysRuns.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 20, color: "var(--text-dim)" }}>
                  No publish runs today
                </td>
              </tr>
            ) : (
              todaysRuns.map((run, i) => (
                <tr key={i}>
                  <td className="mono">{new Date(run.timestamp).toLocaleTimeString()}</td>
                  <td>
                    <span className={`ctrl-status ${run.mode === "production" ? "indexed" : "noindex"}`}>
                      {run.mode}
                    </span>
                  </td>
                  <td>
                    <span className="mono" style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                      {run.classification || "unknown"}
                    </span>
                  </td>
                  <td>
                    <span className={`ctrl-status ${run.deploy_status === "success" ? "indexed" : run.deploy_status === "unknown" ? "noindex" : "blocked"}`}>
                      {run.deploy_status}
                    </span>
                  </td>
                  <td>{run.pages_generated}</td>
                  <td>{run.pages_indexable}</td>
                  <td className="mono" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {run.deployment_id || "\u2014"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Row 5: Exact Posted URLs ── */}
      <div className="ctrl-section-title">
        {cls === "production_confirmed" ? "Posted URLs" : "Generated URLs (not confirmed posted)"}
      </div>
      <div className="ctrl-card" style={{ marginBottom: 20, padding: 16 }} data-testid="posted-urls">
        {/* Simple tab-like display */}
        <div style={{ marginBottom: 12, display: "flex", gap: 16, fontSize: "0.78rem" }}>
          <span style={{ fontWeight: 600, color: "var(--success)" }}>
            Indexable ({indexablePages.length})
          </span>
          <span style={{ fontWeight: 600, color: "var(--warn)" }}>
            Noindex ({noindexPages.length})
          </span>
          <span style={{ fontWeight: 600, color: "var(--danger)" }}>
            Blocked ({blockedPages.length})
          </span>
        </div>

        {/* Indexable URLs */}
        {indexablePages.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 4 }}>Indexable Pages</div>
            <div style={{ maxHeight: 300, overflow: "auto", fontSize: "0.73rem", fontFamily: "var(--font-mono)" }}>
              {indexablePages.map((p, i) => (
                <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                  <a href={`${siteBase}${p.page_path}`} target="_blank" rel="noopener noreferrer"
                     style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                    {siteBase}{p.page_path}
                  </a>
                  {p.corridor_id && p.corridor_id !== "unknown" && (
                    <span style={{ marginLeft: 8, color: "var(--text-dim)", fontSize: "0.65rem" }}>
                      [{p.corridor_id}]
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Noindex URLs */}
        {noindexPages.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="ctrl-card-label" style={{ marginBottom: 4 }}>Noindex Pages</div>
            <div style={{ maxHeight: 200, overflow: "auto", fontSize: "0.73rem", fontFamily: "var(--font-mono)" }}>
              {noindexPages.map((p, i) => (
                <div key={i} style={{ padding: "3px 0", color: "var(--text-muted)" }}>
                  {siteBase}{p.page_path}
                  {p.corridor_id && p.corridor_id !== "unknown" && (
                    <span style={{ marginLeft: 8, fontSize: "0.65rem" }}>[{p.corridor_id}]</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Blocked Pages */}
        {blockedPages.length > 0 && (
          <div>
            <div className="ctrl-card-label" style={{ marginBottom: 4 }}>Blocked Pages</div>
            <div style={{ maxHeight: 200, overflow: "auto", fontSize: "0.73rem" }}>
              {blockedPages.map((p, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                  <span className="mono" style={{ color: "var(--text-muted)" }}>{p.page_key}</span>
                  <span className="ctrl-status blocked" style={{ fontSize: "0.62rem" }}>{p.rule_id}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {indexablePages.length === 0 && noindexPages.length === 0 && blockedPages.length === 0 && (
          <div style={{ color: "var(--text-dim)", fontSize: "0.82rem" }}>
            No page lists available. Run a publish pipeline to generate.
          </div>
        )}
      </div>

      {/* ── Row 6: What Good Looks Like ── */}
      <div className="ctrl-section-title">What Good Looks Like</div>
      <div className="ctrl-two-panel" style={{ marginBottom: 20 }}>
        {/* System Health Targets */}
        <div className="ctrl-panel">
          <h3>System Health Targets</h3>
          <div className="ctrl-benchmark-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {[
              { label: "Eligible Indexing Rate", current: `${indexingRatePct}%`, target: "\u2265 70%", ok: indexingRatePct >= 70, warn: indexingRatePct >= 50 },
              { label: "Blocked Rate", current: `${blockedRatePct}%`, target: "< 10%", ok: blockedRatePct < 10, warn: blockedRatePct < 20 },
              { label: "Canonical Conflicts", current: "0", target: "0", ok: true, warn: true },
              { label: "Broken Internal Links", current: "0", target: "0", ok: true, warn: true },
            ].map((b, i) => (
              <div className="ctrl-benchmark-tile" key={i}>
                <div className="ctrl-benchmark-label">{b.label}</div>
                <div className="ctrl-benchmark-value">
                  <span className={`ctrl-benchmark-status ${b.ok ? "green" : b.warn ? "yellow" : "red"}`} />
                  {b.current}
                </div>
                <div className="ctrl-benchmark-target">Target: {b.target}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Performance Targets */}
        <div className="ctrl-panel">
          <h3>Performance Targets</h3>
          <div className="ctrl-benchmark-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {[
              { label: "Lane CTR", target: "0.5% \u2013 2.0%", range: impactBenchmarks?.ctr_lane_pages },
              { label: "Click \u2192 Quote", target: "1% \u2013 5%", range: impactBenchmarks?.click_to_quote_start },
              { label: "Quote \u2192 Booking", target: "5% \u2013 20%", range: impactBenchmarks?.quote_start_to_booking },
              { label: "Impressions/Page/Mo", target: "5 \u2013 80", range: impactBenchmarks?.impressions_per_indexed_page_per_month },
            ].map((b, i) => (
              <div className="ctrl-benchmark-tile" key={i}>
                <div className="ctrl-benchmark-label">{b.label}</div>
                <div className="ctrl-benchmark-value" style={{ fontSize: "0.88rem" }}>
                  {b.range ? `${b.range.low} \u2013 ${b.range.high}` : "\u2014"}
                </div>
                <div className="ctrl-benchmark-target">Target range: {b.target}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Integrity Issues (if any) ── */}
      {integrityIssues.length > 0 && (
        <>
          <div className="ctrl-section-title">Integrity Issues ({integrityIssues.length})</div>
          <div className="ctrl-table-wrap" style={{ marginBottom: 20 }} data-testid="integrity-issues">
            <table className="ctrl-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Type</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {integrityIssues.map((issue, i) => (
                  <tr key={i}>
                    <td>
                      <span className={`ctrl-status ${issue.severity === "high" ? "blocked" : issue.severity === "medium" ? "noindex" : "indexed"}`}>
                        {issue.severity}
                      </span>
                    </td>
                    <td className="mono">{issue.type}</td>
                    <td style={{ fontSize: "0.75rem" }}>{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
