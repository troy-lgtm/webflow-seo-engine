/**
 * MetricMeta — Source attribution footer for every metric tile.
 *
 * Shows: Source | Window | Last updated | Coverage
 * Also shows a "Placeholder" badge if the source is not connected.
 */

export default function MetricMeta({ source, connected, window, last_pulled_at, coverage }) {
  const srcLabel = source === "gsc" ? "GSC" : source === "ga4" ? "GA4" : source === "portal" ? "Portal" : source || "—";
  const windowLabel = window ? `${window.days}d` : "—";

  let coverageLabel = "—";
  if (coverage) {
    const num = coverage.pages_with_data ?? coverage.lanes_with_data ?? 0;
    const den = coverage.pages_total ?? coverage.lanes_total ?? 0;
    coverageLabel = `${num}/${den}`;
  }

  const updatedLabel = last_pulled_at
    ? new Date(last_pulled_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "Local stub";

  return (
    <div className="ctrl-metric-meta" data-testid="metric-meta">
      <span className="ctrl-meta-item" title="Data source">{srcLabel}</span>
      <span className="ctrl-meta-sep">/</span>
      <span className="ctrl-meta-item" title="Time window">{windowLabel}</span>
      <span className="ctrl-meta-sep">/</span>
      <span className="ctrl-meta-item" title="Last updated">{updatedLabel}</span>
      <span className="ctrl-meta-sep">/</span>
      <span className="ctrl-meta-item" title="Coverage">{coverageLabel}</span>
      {!connected && (
        <span className="ctrl-placeholder-badge" title="Source not connected — value may be from local stub data">Placeholder</span>
      )}
    </div>
  );
}

/**
 * AttributedValue — Renders a metric value or placeholder dash.
 *
 * If is_placeholder is true and verifiedOnly is true, shows "—" instead.
 * Always shows MetricMeta footer.
 */
export function AttributedValue({ attr, verifiedOnly = false, format, children }) {
  if (!attr || attr.value === null || attr.value === undefined) {
    return (
      <div className="ctrl-attributed">
        <span className="ctrl-attributed-value ctrl-attributed-missing">—</span>
        <span className="ctrl-not-connected-badge">Not connected</span>
      </div>
    );
  }

  const showPlaceholder = verifiedOnly && attr.is_placeholder;

  return (
    <div className="ctrl-attributed">
      <span className={`ctrl-attributed-value${showPlaceholder ? " ctrl-attributed-hidden" : ""}`}>
        {showPlaceholder ? "—" : (format ? format(attr.value) : (children || attr.value.toLocaleString()))}
      </span>
      <MetricMeta
        source={attr.source}
        connected={attr.connected}
        window={attr.window}
        last_pulled_at={attr.last_pulled_at}
        coverage={attr.coverage}
      />
    </div>
  );
}
