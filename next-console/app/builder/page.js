"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_BOOK_URL, DEFAULT_QUOTE_URL,
  buildCombos, generatePages, exportJson, exportCsv,
  makeLanePage, num, qaReady, publishChecks, isPublishReady,
  generateSuggestions, checkUniqueness, checkPageDuplicates
} from "@/lib/lane-engine";
import { attachLinks } from "@/lib/link-graph";
import { buildGraph } from "@/lib/graph-model";
import { parseGscCsv, parseGa4Csv, mapQueriesToLanes, generateCopyUpgrades, rankByMode, parseQuoteCsv, aggregateQuotes } from "@/lib/seo-feedback";
import { dashboardData, initialBuilderConfig } from "@/lib/dashboard-data";
import { DATA_BACKED_THRESHOLD } from "@/lib/estimate-config";
import { createPublishBatch, batchQualityScore } from "@/lib/publish-batch";
import { WAVE_DEFINITIONS, selectWaveLanes, wavePageCount, buildWaveManifest, waveQualityGate } from "@/lib/waves";
import { generateContrastBlock } from "@/lib/contrast-copy";
import { loadPublished, appendPublished, pageToPublishedEntry } from "@/lib/published-registry";
import { getRampSchedule, buildDropManifest } from "@/lib/ramp-schedule";

const STORAGE_QUEUE = "warp_next_queue_v1";
const STORAGE_MODE = "warp_next_mode_v1";
const STORAGE_GSC = "warp_gsc_data_v1";
const STORAGE_GA4 = "warp_ga4_data_v1";
const STORAGE_ESTIMATE_INPUTS = "warp_estimate_inputs_v1";
const STORAGE_QUOTE_FEEDBACK = "warp_quote_feedback_v1";
const STORAGE_QUOTE_HISTORY = "warp_quote_history_v1";
const STORAGE_IMPORTED_LANES = "warp_imported_lanes_v1";
const STORAGE_GEN_MODES = "warp_gen_modes_v1";
const STORAGE_GEN_SEGMENTS = "warp_gen_segments_v1";
const STORAGE_SELECTED_WAVE = "warp_selected_wave_v1";
const STORAGE_PUBLISHED = "warp_published_pages_v1";

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function openExternal(url, fallbackLabel) {
  try {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) { alert(`Popup blocked. ${fallbackLabel}: ${url}`); return false; }
    return true;
  } catch { alert(`${fallbackLabel}: ${url}`); return false; }
}

function FlowResult({ item }) {
  return (<li className={item.ok ? "good" : "warn"}>{item.ok ? "PASS" : "FAIL"}: {item.name}{item.detail ? ` - ${item.detail}` : ""}</li>);
}

function FlowDiagram({ page }) {
  if (!page?.lane) return null;
  const nodes = [
    { label: page.lane.origin, cls: "origin" },
    { label: "Lane Intelligence", cls: "" },
    { label: page.lane.destination, cls: "dest" },
    { label: "Quote + ETA", cls: "" },
    { label: "Book + Track", cls: "" }
  ];
  return (
    <div className="flow-diagram" data-warp-section="flow-diagram">
      {nodes.map((n, i) => (
        <span key={`${n.label}-${i}`} style={{ display: "contents" }}>
          {i > 0 && <span className="flow-arrow" />}
          <span className={`flow-node ${n.cls}`}>{n.label}</span>
        </span>
      ))}
    </div>
  );
}

function ConfidenceBadge({ level }) {
  const colors = { high: "var(--success)", medium: "var(--warn)", low: "var(--text-dim)" };
  return <span className="pill" style={{ background: colors[level] || colors.low, color: "#000", fontSize: "0.65rem", fontWeight: 600 }}>{level}</span>;
}

function UpgradeReadinessBadge({ page, quoteHistoryMap }) {
  if (!page?.lane) return null;
  const key = `${page.lane.origin}|${page.lane.destination}|${page.lane.mode}`.toLowerCase().replace(/[^a-z0-9|]+/g, " ").replace(/\s+/g, " ").trim();
  const history = quoteHistoryMap?.get?.(key);
  const isDataBacked = history && history.quote_count >= DATA_BACKED_THRESHOLD;
  return (
    <span
      className="pill"
      data-testid="upgrade-readiness-badge"
      style={{ background: isDataBacked ? "var(--success)" : "var(--surface-3)", color: isDataBacked ? "#000" : "var(--text-muted)", fontSize: "0.68rem", fontWeight: 600 }}
    >
      {isDataBacked ? "Data-backed estimate" : "Modeled estimate"}
    </span>
  );
}

function EstimateTransparency({ page }) {
  const stats = page?.lane_stats;
  if (!stats?.confidence) return null;
  const [open, setOpen] = useState(false);
  return (
    <section data-warp-section="estimate-transparency" data-testid="estimate-transparency">
      <p className="overline">Estimate Transparency</p>
      <div className="grid-3" style={{ marginTop: 6 }}>
        <div className="preview-card">
          <span className="k">Distance</span>
          <p className="v">{stats.estimated_distance_miles?.toLocaleString()} mi</p>
        </div>
        <div className="preview-card">
          <span className="k">{stats.transit_time_estimate_label || "Transit"} <ConfidenceBadge level={stats.confidence?.transit} /></span>
          <p className="v">{stats.estimated_transit_days_range?.min}-{stats.estimated_transit_days_range?.max} days</p>
        </div>
        <div className="preview-card">
          <span className="k">{stats.rate_estimate_label || "Rate"} <ConfidenceBadge level={stats.confidence?.rate} /></span>
          <p className="v">${stats.estimated_rate_range_usd?.low?.toLocaleString()}-${stats.estimated_rate_range_usd?.high?.toLocaleString()}</p>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <button
          className="btn ghost"
          style={{ fontSize: "0.74rem", padding: "4px 8px" }}
          data-testid="estimate-how-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide" : "How this is estimated"}
        </button>
        {open && (
          <div style={{ marginTop: 6 }} data-testid="estimate-assumptions">
            <ul className="sub" style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 3, fontSize: "0.76rem" }}>
              {(stats.assumptions || []).map((a, i) => <li key={`a-${i}`}>{a}</li>)}
            </ul>
          </div>
        )}
      </div>

      <div style={{ marginTop: 8, padding: "6px 8px", background: "var(--surface-3)", borderRadius: "var(--radius)", fontSize: "0.74rem", color: "var(--text-muted)" }} data-testid="estimate-disclaimer">
        {(stats.disclaimers || [])[0] || "These are modeled estimates, not guaranteed quotes."}
        {" "}<a href="https://www.wearewarp.com/quote" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Get an instant quote for real pricing.</a>
      </div>
    </section>
  );
}

function LaneStatsPanel({ page }) {
  const stats = page?.lane_stats;
  if (!stats) return null;
  return (
    <section data-warp-section="lane-stats" data-testid="lane-stats">
      <p className="overline">Lane Intelligence (estimates)</p>
      <div className="grid-2" style={{ marginTop: 6 }}>
        {stats.common_freight_class_range && <div className="preview-card"><span className="k">Freight Class</span><p className="v">{stats.common_freight_class_range.low} - {stats.common_freight_class_range.high}</p></div>}
        <div className="preview-card"><span className="k">Equipment</span><p className="v" style={{ fontSize: "0.78rem" }}>{stats.common_equipment?.join(", ")}</p></div>
      </div>
      <p className="sub" style={{ marginTop: 6, fontSize: "0.76rem" }}>{stats.seasonality_notes}</p>
    </section>
  );
}

function NetworkProofPanel({ page }) {
  const proof = page?.network_proof;
  if (!proof) return null;
  return (
    <section data-warp-section="network-proof" data-testid="network-proof">
      <p className="overline">Network Proof</p>
      <div className="grid-2" style={{ marginTop: 6 }}>
        <div className="preview-card"><span className="k">Carriers</span><p className="v">{proof.estimated_carrier_count} available</p></div>
        <div className="preview-card"><span className="k">Regions</span><p className="v" style={{ fontSize: "0.78rem" }}>{proof.origin_region} → {proof.destination_region}</p></div>
      </div>
      {proof.nearest_cross_docks?.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <span className="overline">Nearest Hubs</span>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            {proof.nearest_cross_docks.map((h) => (<span key={h} className="pill">{h}</span>))}
          </div>
        </div>
      )}
      {proof.service_notes?.length > 0 && (
        <ul className="sub" style={{ margin: "6px 0 0", paddingLeft: 16, display: "grid", gap: 3, fontSize: "0.76rem" }}>
          {proof.service_notes.map((n, i) => (<li key={`sn-${i}`}>{n}</li>))}
        </ul>
      )}
    </section>
  );
}

function InternalLinksPanel({ page }) {
  const lanes = page?.related_lanes;
  const guides = page?.related_guides;
  if (!lanes?.length && !guides?.length) return null;
  return (
    <section data-warp-section="internal-links" data-testid="internal-links">
      <p className="overline">Internal Links</p>
      {lanes?.length > 0 && (
        <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
          {lanes.slice(0, 6).map((l) => (
            <div key={l.href} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span className="pill" style={{ fontSize: "0.6rem" }}>{l.reason}</span>
              <span className="sub" style={{ fontSize: "0.76rem" }}>{l.text}</span>
            </div>
          ))}
        </div>
      )}
      {guides?.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
          {guides.slice(0, 6).map((g) => (
            <Link key={g.href} href={g.href} className="pill" style={{ textDecoration: "none" }}>{g.text}</Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ContrastPreview({ page }) {
  const contrast = page?.contrast;
  if (!contrast) return null;
  return (
    <section data-warp-section="contrast-block" data-testid="contrast-block">
      <p className="overline">{contrast.headline}</p>
      <table className="table" style={{ marginTop: 6, fontSize: "0.76rem" }}>
        <thead><tr><th>Metric</th><th>Legacy</th><th>WARP</th></tr></thead>
        <tbody>
          {contrast.points.map((p) => (
            <tr key={p.metric}>
              <td><strong>{p.metric}</strong></td>
              <td style={{ color: "var(--text-dim)" }}>{p.legacy}</td>
              <td style={{ color: "var(--success)" }}>{p.warp}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub" style={{ marginTop: 6, fontSize: "0.76rem" }}>{contrast.bottom_line}</p>
    </section>
  );
}

function IndexLinksPanel({ page }) {
  const indexes = page?.related_indexes;
  if (!indexes?.length) return null;
  return (
    <section data-warp-section="index-links" data-testid="index-links">
      <p className="overline">Freight References</p>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
        {indexes.map((idx) => (
          <Link key={idx.href} href={idx.href} className="pill" style={{ textDecoration: "none" }}>{idx.text}</Link>
        ))}
      </div>
    </section>
  );
}

function ToolPanel({ page }) {
  const tp = page?.tool_panel;
  const stats = page?.lane_stats;
  if (!tp || !stats) return null;
  return (
    <section data-warp-section="tool-panel" data-testid="tool-panel">
      <p className="overline">Freight Calculator</p>
      <div className="grid-3" style={{ marginTop: 6 }}>
        {tp.inputs.map((inp) => (
          <div key={inp.key} className="preview-card" style={{ padding: "6px 8px" }}>
            <span className="k" style={{ fontSize: "0.68rem" }}>{inp.label}</span>
            {inp.type === "select" ? (
              <select className="select" style={{ fontSize: "0.76rem", padding: "2px 4px" }} defaultValue={inp.default}>
                {inp.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input className="input" type="number" defaultValue={inp.default} min={inp.min} max={inp.max} style={{ fontSize: "0.76rem", padding: "2px 4px" }} />
            )}
          </div>
        ))}
      </div>
      <div className="grid-3" style={{ marginTop: 6 }}>
        <div className="preview-card"><span className="k">Est. Rate</span><p className="v">${stats.estimated_rate_range_usd?.low?.toLocaleString()}-${stats.estimated_rate_range_usd?.high?.toLocaleString()}</p></div>
        <div className="preview-card"><span className="k">Transit</span><p className="v">{stats.estimated_transit_days_range?.min}-{stats.estimated_transit_days_range?.max} days</p></div>
        <div className="preview-card"><span className="k">Confidence</span><p className="v"><ConfidenceBadge level={stats.confidence?.rate} /></p></div>
      </div>
      <button className="btn primary" style={{ width: "100%", marginTop: 6, fontSize: "0.8rem" }} onClick={() => window.open(tp.cta.url, "_blank")}>{tp.cta.text}</button>
    </section>
  );
}

function PublishChecksPanel({ page }) {
  const checks = publishChecks(page);
  if (!checks.length) return null;
  const passed = checks.filter((c) => c.pass).length;
  return (
    <div data-warp-section="publish-checks">
      <p className="sub" style={{ marginBottom: 6 }}>{passed}/{checks.length} checks passing</p>
      <ul className="check-list">
        {checks.map((c) => (
          <li key={c.name} className="check-item">
            <span className={`check-icon ${c.pass ? "pass" : "fail"}`}>{c.pass ? "\u2713" : "\u2717"}</span>
            <span style={{ color: c.pass ? "var(--text-muted)" : "var(--danger)" }}>{c.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SuggestionsPanel({ metricsInput, onMetricsChange }) {
  const suggestions = useMemo(() => generateSuggestions(metricsInput), [metricsInput]);
  return (
    <article className="surface panel" data-warp-section="self-learning">
      <h2>Self-Learning Suggestions</h2>
      <p className="sub">Enter conversion metrics to get optimization recommendations.</p>
      <div className="grid-2">
        <label className="label">CTA CTR %<input className="input" type="number" step="0.1" value={metricsInput.cta_ctr || ""} placeholder="e.g. 2.5" onChange={(e) => onMetricsChange("cta_ctr", e.target.value)} /></label>
        <label className="label">Bounce Rate %<input className="input" type="number" step="1" value={metricsInput.bounce_rate || ""} placeholder="e.g. 55" onChange={(e) => onMetricsChange("bounce_rate", e.target.value)} /></label>
        <label className="label">Quote Start %<input className="input" type="number" step="0.1" value={metricsInput.quote_start_rate || ""} placeholder="e.g. 1.2" onChange={(e) => onMetricsChange("quote_start_rate", e.target.value)} /></label>
        <label className="label">Avg Time (s)<input className="input" type="number" step="1" value={metricsInput.avg_time_on_page || ""} placeholder="e.g. 45" onChange={(e) => onMetricsChange("avg_time_on_page", e.target.value)} /></label>
      </div>
      <div className="stack" style={{ gap: 6, marginTop: 4 }}>
        {suggestions.map((s, i) => (
          <div key={`${s.impact}-${i}`} className="suggestion-item">
            <span className={`suggestion-impact ${s.impact}`}>{s.impact} impact</span>
            <p className="suggestion-text">{s.text}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

const FREIGHT_CLASS_OPTIONS = [
  { value: "", label: "Unknown (default 70)" },
  { value: "50", label: "50 — Clean Freight" },
  { value: "55", label: "55" },
  { value: "60", label: "60" },
  { value: "65", label: "65" },
  { value: "70", label: "70 — Average" },
  { value: "77.5", label: "77.5" },
  { value: "85", label: "85" },
  { value: "92.5", label: "92.5" },
  { value: "100", label: "100" },
  { value: "110", label: "110" },
  { value: "125", label: "125" },
  { value: "150", label: "150" },
  { value: "175", label: "175" },
  { value: "200", label: "200" },
  { value: "250", label: "250" },
  { value: "300", label: "300" },
  { value: "400", label: "400" },
  { value: "500", label: "500 — Low Density" }
];

export default function BuilderPage() {
  const [config, setConfig] = useState(initialBuilderConfig);
  const [combos, setCombos] = useState([]);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [status, setStatus] = useState("Ready. Click Generate Top Lanes.");
  const [flowResults, setFlowResults] = useState([]);
  const [convMetrics, setConvMetrics] = useState({});
  const [gscRaw, setGscRaw] = useState("");
  const [ga4Raw, setGa4Raw] = useState("");
  const [rankMode, setRankMode] = useState("strategic");
  const [uniquenessResults, setUniquenessResults] = useState([]);
  const [estimateInputs, setEstimateInputs] = useState({});
  const [quoteFeedbackRaw, setQuoteFeedbackRaw] = useState("");
  const [quoteHistoryMap, setQuoteHistoryMap] = useState(new Map());
  const [importedLanes, setImportedLanes] = useState([]);
  const [genModes, setGenModes] = useState(["LTL", "FTL", "Cargo Van / Box Truck"]);
  const [genSegments, setGenSegments] = useState(["smb", "midmarket"]);
  const [batchSize, setBatchSize] = useState(250);
  const [batches, setBatches] = useState([]);
  const [selectedWave, setSelectedWave] = useState("wave-1");
  const [waveGate, setWaveGate] = useState(null);
  const [publishedRegistry, setPublishedRegistry] = useState([]);
  const [duplicateCheck, setDuplicateCheck] = useState(null);
  const [dupOverride, setDupOverride] = useState(false);

  useEffect(() => {
    try { const q = localStorage.getItem(STORAGE_QUEUE); if (q) { const parsed = JSON.parse(q); if (Array.isArray(parsed)) { setQueue(parsed); if (parsed[0]) setCurrent(parsed[0]); } } } catch {}
    try { const m = localStorage.getItem(STORAGE_MODE); setAdvanced(m === "advanced"); } catch {}
    try { const g = localStorage.getItem(STORAGE_GSC); if (g) setGscRaw(g); } catch {}
    try { const g = localStorage.getItem(STORAGE_GA4); if (g) setGa4Raw(g); } catch {}
    try { const e = localStorage.getItem(STORAGE_ESTIMATE_INPUTS); if (e) setEstimateInputs(JSON.parse(e)); } catch {}
    try { const qf = localStorage.getItem(STORAGE_QUOTE_FEEDBACK); if (qf) setQuoteFeedbackRaw(qf); } catch {}
    try {
      const qh = localStorage.getItem(STORAGE_QUOTE_HISTORY);
      if (qh) { const obj = JSON.parse(qh); setQuoteHistoryMap(new Map(Object.entries(obj))); }
    } catch {}
    try { const il = localStorage.getItem(STORAGE_IMPORTED_LANES); if (il) setImportedLanes(JSON.parse(il)); } catch {}
    try { const gm = localStorage.getItem(STORAGE_GEN_MODES); if (gm) setGenModes(JSON.parse(gm)); } catch {}
    try { const gs = localStorage.getItem(STORAGE_GEN_SEGMENTS); if (gs) setGenSegments(JSON.parse(gs)); } catch {}
    try { const pub = localStorage.getItem(STORAGE_PUBLISHED); if (pub) setPublishedRegistry(JSON.parse(pub)); } catch {}
  }, []);

  useEffect(() => { try { localStorage.setItem(STORAGE_QUEUE, JSON.stringify(queue)); } catch {} }, [queue]);
  useEffect(() => { try { localStorage.setItem(STORAGE_MODE, advanced ? "advanced" : "easy"); } catch {} }, [advanced]);
  useEffect(() => { try { localStorage.setItem(STORAGE_GSC, gscRaw); } catch {} }, [gscRaw]);
  useEffect(() => { try { localStorage.setItem(STORAGE_GA4, ga4Raw); } catch {} }, [ga4Raw]);
  useEffect(() => { try { localStorage.setItem(STORAGE_ESTIMATE_INPUTS, JSON.stringify(estimateInputs)); } catch {} }, [estimateInputs]);
  useEffect(() => { try { localStorage.setItem(STORAGE_QUOTE_FEEDBACK, quoteFeedbackRaw); } catch {} }, [quoteFeedbackRaw]);
  useEffect(() => {
    try {
      const obj = Object.fromEntries(quoteHistoryMap);
      localStorage.setItem(STORAGE_QUOTE_HISTORY, JSON.stringify(obj));
    } catch {}
  }, [quoteHistoryMap]);
  useEffect(() => { try { localStorage.setItem(STORAGE_IMPORTED_LANES, JSON.stringify(importedLanes)); } catch {} }, [importedLanes]);
  useEffect(() => { try { localStorage.setItem(STORAGE_GEN_MODES, JSON.stringify(genModes)); } catch {} }, [genModes]);
  useEffect(() => { try { localStorage.setItem(STORAGE_GEN_SEGMENTS, JSON.stringify(genSegments)); } catch {} }, [genSegments]);

  const pipeline = dashboardData.pipeline;

  const gscData = useMemo(() => parseGscCsv(gscRaw), [gscRaw]);
  const ga4Data = useMemo(() => parseGa4Csv(ga4Raw), [ga4Raw]);
  const gscMap = useMemo(() => mapQueriesToLanes(gscData, queue), [gscData, queue]);

  const metrics = useMemo(() => {
    const qaCount = queue.filter((p) => qaReady(p)).length;
    const pubCount = queue.filter((p) => isPublishReady(p)).length;
    const estRevenue = queue.reduce((sum, p) => sum + num(p?.priority?.expected_monthly_revenue, 0), 0);
    return { combos: combos.length, queue: queue.length, qa: qaCount, publish: pubCount, revenue: estRevenue, published: pipeline.published };
  }, [combos, queue, pipeline.published]);

  const rankedQueue = useMemo(() => {
    if (rankMode !== "strategic" && (gscData.length || ga4Data.length)) {
      return rankByMode([...queue], rankMode, gscMap, ga4Data);
    }
    return [...queue].sort((a, b) => num(b?.priority?.expected_monthly_revenue, 0) - num(a?.priority?.expected_monthly_revenue, 0));
  }, [queue, rankMode, gscData, ga4Data, gscMap]);

  const graphMetrics = useMemo(() => buildGraph(queue).metrics, [queue]);

  const previewDesign = current?.design || config.design;

  const seoCopyUpgrades = useMemo(() => {
    if (!current?.slug) return [];
    const perf = gscMap.get(current.slug);
    return generateCopyUpgrades(current, perf);
  }, [current, gscMap]);

  const currentUniqueness = useMemo(() => {
    return uniquenessResults.find((r) => r.slug === current?.slug);
  }, [uniquenessResults, current]);

  // Build clean estimate inputs object (only non-empty values)
  const cleanEstimateInputs = useMemo(() => {
    const clean = {};
    if (estimateInputs.pallet_count) clean.pallet_count = num(estimateInputs.pallet_count, 0);
    if (estimateInputs.weight_lbs) clean.weight_lbs = num(estimateInputs.weight_lbs, 0);
    if (estimateInputs.freight_class) clean.freight_class = num(estimateInputs.freight_class, 0);
    return Object.keys(clean).length ? clean : undefined;
  }, [estimateInputs]);

  function mutateConfig(path, value) {
    setConfig((prev) => { const next = clone(prev); if (path.length === 1) next[path[0]] = value; if (path.length === 2) next[path[0]][path[1]] = value; return next; });
  }

  function addToQueue(pages) {
    setQueue((prev) => { const map = new Map(prev.map((p) => [p.slug, p])); pages.forEach((p) => map.set(p.slug, p)); return [...map.values()]; });
  }

  function updateEstimateInput(key, value) {
    setEstimateInputs((prev) => ({ ...prev, [key]: value }));
  }

  function processQuoteFeedback(csvText) {
    const rows = parseQuoteCsv(csvText);
    if (!rows.length) return;
    const aggregated = aggregateQuotes(rows);
    // Merge with existing history
    setQuoteHistoryMap((prev) => {
      const merged = new Map(prev);
      for (const [key, val] of aggregated) {
        const existing = merged.get(key);
        if (existing) {
          const allQuotes = [];
          // Reconstruct from existing stats + new
          for (let i = 0; i < existing.quote_count; i++) allQuotes.push(existing.median_quote);
          for (let i = 0; i < val.quote_count; i++) allQuotes.push(val.median_quote);
          const sorted = allQuotes.sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          merged.set(key, {
            quote_count: existing.quote_count + val.quote_count,
            min_quote: Math.min(existing.min_quote, val.min_quote),
            max_quote: Math.max(existing.max_quote, val.max_quote),
            median_quote: sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid],
            last_seen_date: val.last_seen_date
          });
        } else {
          merged.set(key, val);
        }
      }
      return merged;
    });
    setStatus(`Imported ${rows.length} quote rows across ${aggregated.size} lanes.`);
  }

  function parseLaneSeedCsv(text) {
    const lines = text.trim().split("\n").filter(Boolean);
    if (lines.length < 2) return [];
    const header = lines[0].toLowerCase().replace(/[^a-z0-9_,]/g, "");
    const cols = header.split(",");
    const oIdx = cols.findIndex((c) => c.includes("origin_city") || c === "origin");
    const osIdx = cols.findIndex((c) => c.includes("origin_state"));
    const dIdx = cols.findIndex((c) => c.includes("destination_city") || c === "destination");
    const dsIdx = cols.findIndex((c) => c.includes("destination_state"));
    const lsIdx = cols.findIndex((c) => c.includes("lane_set"));
    if (oIdx < 0 || dIdx < 0) return [];
    const lanes = [];
    const seen = new Set();
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      const origin = osIdx >= 0 ? `${parts[oIdx]}, ${parts[osIdx]}` : parts[oIdx];
      const dest = dsIdx >= 0 ? `${parts[dIdx]}, ${parts[dsIdx]}` : parts[dIdx];
      if (!origin || !dest) continue;
      const key = `${origin}|${dest}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lanes.push({ origin, destination: dest, lane_set: lsIdx >= 0 ? parts[lsIdx] : "tier1_core" });
    }
    return lanes;
  }

  function handleLaneImport(text) {
    const lanes = parseLaneSeedCsv(text);
    if (!lanes.length) { setStatus("No valid lanes found in CSV. Need origin_city and destination_city columns."); return; }
    setImportedLanes(lanes);
    const sets = {};
    lanes.forEach((l) => { sets[l.lane_set] = (sets[l.lane_set] || 0) + 1; });
    const summary = Object.entries(sets).map(([k, v]) => `${k}: ${v}`).join(", ");
    setStatus(`Imported ${lanes.length} unique city pairs. ${summary}`);
  }

  async function loadSeedFile() {
    try {
      const res = await fetch("/api/seed-lanes");
      const text = await res.text();
      handleLaneImport(text);
    } catch {
      setStatus("Failed to load seed file. Place warp_top_2000_lanes_seed.csv in data/ folder.");
    }
  }

  function generateFromImport() {
    if (!importedLanes.length) { setStatus("No imported lanes. Import a lane CSV first."); return; }
    const ws = Math.max(1, num(config.defaults.weekly_shipments, 18));
    const aqv = Math.max(100, num(config.defaults.avg_quote_value, 2200));
    const wr = Math.min(1, Math.max(0.01, num(config.defaults.win_rate, 0.22)));
    const sp = Math.min(10, Math.max(1, num(config.defaults.strategic_priority, 6)));
    const allPages = [];
    let rank = 0;
    importedLanes.forEach((lane) => {
      genModes.forEach((mode) => {
        genSegments.forEach((segment) => {
          rank++;
          const metrics = { weekly_shipments: ws, avg_quote_value: aqv, win_rate: wr, strategic_priority: sp };
          const expectedMonthly = ws * 4 * aqv * wr;
          const combo = {
            origin: lane.origin,
            destination: lane.destination,
            mode,
            segment,
            audience: config.audience || "Logistics teams",
            metrics,
            priority: { score: sp * 10, expected_monthly_revenue: expectedMonthly },
            rank,
            lane_set: lane.lane_set
          };
          const pg = makeLanePage(combo, config.design, cleanEstimateInputs);
          if (pg) allPages.push(pg);
        });
      });
    });
    if (!allPages.length) { setStatus("No pages generated from imports."); return; }
    const linked = attachLinks(allPages);
    addToQueue(linked);
    setCurrent(linked[0]);
    setUniquenessResults(checkUniqueness(linked));
    const newBatches = createPublishBatch(linked, batchSize);
    setBatches(newBatches);
    setStatus(`Generated ${linked.length} pages (${importedLanes.length} pairs × ${genModes.length} modes × ${genSegments.length} segments). ${newBatches.length} batches created.`);
  }

  function rebuildBatches() {
    if (!queue.length) { setStatus("Queue empty. Generate pages first."); return; }
    const newBatches = createPublishBatch(queue, batchSize);
    setBatches(newBatches);
    setStatus(`Created ${newBatches.length} batches of ~${batchSize} pages.`);
  }

  function exportBatch(batch) {
    exportJson(`batch-${batch.id}-${new Date().toISOString().slice(0, 10)}.json`, batch.pages);
    setStatus(`Exported batch ${batch.id} (${batch.pages.length} pages).`);
  }

  function exportAllBatches() {
    batches.forEach((b, i) => {
      setTimeout(() => exportJson(`batch-${b.id}-${new Date().toISOString().slice(0, 10)}.json`, b.pages), i * 200);
    });
    setStatus(`Exporting ${batches.length} batches...`);
  }

  function generateWavePages() {
    if (!importedLanes.length) { setStatus("Import lanes first (Lane Set Import panel)."); return; }
    const { wave, lanes } = selectWaveLanes(importedLanes, selectedWave);
    if (!wave) { setStatus("Unknown wave selected."); return; }
    const ws = Math.max(1, num(config.defaults.weekly_shipments, 18));
    const aqv = Math.max(100, num(config.defaults.avg_quote_value, 2200));
    const wr = Math.min(1, Math.max(0.01, num(config.defaults.win_rate, 0.22)));
    const sp = Math.min(10, Math.max(1, num(config.defaults.strategic_priority, 6)));
    const allPages = [];
    let rank = 0;
    lanes.forEach((lane) => {
      genModes.forEach((mode) => {
        genSegments.forEach((segment) => {
          rank++;
          const metrics = { weekly_shipments: ws, avg_quote_value: aqv, win_rate: wr, strategic_priority: sp };
          const combo = {
            origin: lane.origin, destination: lane.destination, mode, segment,
            audience: config.audience || "Logistics teams", metrics,
            priority: { score: sp * 10, expected_monthly_revenue: ws * 4 * aqv * wr },
            rank, lane_set: lane.lane_set
          };
          const pg = makeLanePage(combo, config.design, cleanEstimateInputs);
          if (pg) allPages.push(pg);
        });
      });
    });
    if (!allPages.length) { setStatus("No pages generated."); return; }
    const linked = attachLinks(allPages);
    addToQueue(linked);
    setCurrent(linked[0]);
    setUniquenessResults(checkUniqueness(linked));
    const gate = waveQualityGate(linked, selectedWave);
    setWaveGate(gate);
    const newBatches = createPublishBatch(linked, batchSize);
    setBatches(newBatches);
    setStatus(`${wave.label}: Generated ${linked.length} pages from ${lanes.length} pairs. Quality: ${gate.score}/100 (${gate.pass ? "PASS" : "BLOCKED"}).`);
  }

  function exportWaveManifest() {
    if (!queue.length) { setStatus("Queue empty."); return; }
    const manifest = buildWaveManifest(queue, selectedWave);
    if (!manifest) { setStatus("Could not build manifest."); return; }
    exportJson(`wave-manifest-${selectedWave}-${new Date().toISOString().slice(0, 10)}.json`, manifest);
    setStatus(`Exported ${manifest.wave_label} manifest (${manifest.page_count} pages).`);
  }

  function exportSpreadsheetTemplate() {
    const headers = ["origin", "destination", "pallets", "weight_lbs", "freight_class", "pickup_date"];
    const exampleRows = importedLanes.slice(0, 5).map((l) => [l.origin, l.destination, "4", "5000", "70", ""]);
    const csv = [headers.join(","), ...exampleRows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `warp-quote-template-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Exported spreadsheet template. Fill in and submit for real quotes.");
  }

  function runDuplicateCheck() {
    if (!queue.length) { setStatus("Queue empty. Generate pages first."); return; }
    const result = checkPageDuplicates(queue, publishedRegistry);
    setDuplicateCheck(result);
    if (result.blocked.length === 0) {
      setStatus(`Duplicate check passed — ${result.clean.length} pages clear.`);
    } else {
      setStatus(`Duplicate check: ${result.blocked.length} blocked, ${result.clean.length} clear.`);
    }
  }

  function exportWithDuplicateGate() {
    if (!queue.length) { setStatus("Queue empty."); return; }
    const result = checkPageDuplicates(queue, publishedRegistry);
    setDuplicateCheck(result);
    if (result.blocked.length > 0 && !dupOverride) {
      setStatus(`Export BLOCKED: ${result.blocked.length} duplicate(s) found. Enable override or remove duplicates.`);
      return;
    }
    const toExport = dupOverride ? queue : result.clean;
    exportJson(`safe-export-${new Date().toISOString().slice(0, 10)}.json`, toExport);
    setStatus(`Exported ${toExport.length} pages${dupOverride ? " (override enabled)" : ""}.`);
  }

  const rampSchedule = useMemo(() => getRampSchedule(), []);

  function exportDropManifest(dropIndex) {
    const drop = rampSchedule[dropIndex];
    if (!drop) return;
    const manifest = buildDropManifest(drop, queue, publishedRegistry);
    exportJson(`drop-manifest-week${drop.week}-${drop.date.slice(5, 10)}.json`, manifest);
    setStatus(`Exported ${drop.label} manifest: ${manifest.selected_count}/${manifest.target_count} pages.`);
  }

  function generateCombosAction({ quiet = false } = {}) {
    const built = buildCombos(config);
    setCombos(built);
    if (!quiet) setStatus(built.length ? `Generated ${built.length} lane combos.` : "No combos found. Add at least one origin and destination.");
    return built;
  }

  function generateTopAction({ quiet = false } = {}) {
    const built = combos.length ? combos : buildCombos(config);
    setCombos(built);
    const topN = Math.max(1, Math.floor(num(config.topN, 10)));
    const pages = generatePages(built, config.design, topN, cleanEstimateInputs, quoteHistoryMap);
    if (!pages.length) { if (!quiet) setStatus("No pages generated. Add lane inputs first."); return false; }
    setCurrent(pages[0]);
    addToQueue(pages);
    setUniquenessResults(checkUniqueness(pages));
    if (!quiet) setStatus(`Added ${pages.length} top-ranked pages to queue.`);
    return true;
  }

  function generateAllAction({ quiet = false } = {}) {
    const built = combos.length ? combos : buildCombos(config);
    setCombos(built);
    const pages = generatePages(built, config.design, undefined, cleanEstimateInputs, quoteHistoryMap);
    if (!pages.length) { if (!quiet) setStatus("No pages generated. Add lane inputs first."); return false; }
    setCurrent(pages[0]);
    addToQueue(pages);
    setUniquenessResults(checkUniqueness(pages));
    if (!quiet) setStatus(`Added all ${pages.length} pages to queue.`);
    return true;
  }

  function saveCurrentAction({ quiet = false } = {}) {
    if (!current) { if (!quiet) setStatus("No current page. Generate top lanes first."); return false; }
    addToQueue([current]);
    if (!quiet) setStatus(`Saved ${current.slug} to queue.`);
    return true;
  }

  function exportQueueAction({ quiet = false, simulate = false } = {}) {
    if (!queue.length) { if (!quiet) setStatus("Queue is empty. Save at least one page first."); return false; }
    if (!simulate) exportJson(`manual-lane-pages-${new Date().toISOString().slice(0, 10)}.json`, queue);
    if (!quiet) setStatus(simulate ? "Queue export simulation passed." : `Exported ${queue.length} pages.`);
    return true;
  }

  function exportCsvAction() {
    if (!queue.length) { setStatus("Queue is empty."); return; }
    exportCsv(`lane-manifest-${new Date().toISOString().slice(0, 10)}.csv`, queue);
    setStatus(`Exported CSV manifest for ${queue.length} pages.`);
  }

  async function copyImportCommandAction({ quiet = false, simulate = false } = {}) {
    const cmd = "bash ./scripts/import_manual_pages.sh /absolute/path/to/exported-queue.json";
    if (simulate) return true;
    try { await navigator.clipboard.writeText(cmd); if (!quiet) setStatus("Copied import command."); return true; }
    catch { window.prompt("Copy this import command:", cmd); if (!quiet) setStatus("Clipboard blocked. Command shown for manual copy."); return true; }
  }

  async function runFlowCheck() {
    const results = [];
    const run = async (name, fn) => {
      try { const out = await fn(); let ok = out !== false; if (Array.isArray(out) && out.length === 0) ok = false; results.push({ name, ok, detail: typeof out === "string" ? out : "" }); }
      catch (e) { results.push({ name, ok: false, detail: e?.message || "exception" }); }
    };
    const builtCombos = buildCombos(config);
    const topN = Math.max(1, Math.floor(num(config.topN, 10)));
    const topPages = builtCombos.slice(0, topN).map((c) => makeLanePage(c, config.design, cleanEstimateInputs));
    await run("Generate combos", () => builtCombos);
    await run("Generate top-ranked pages", () => topPages);
    await run("Save current page", () => topPages[0] || false);
    await run("Export queue (simulate)", () => (topPages.length ? true : false));
    await run("Copy import command (simulate)", () => copyImportCommandAction({ quiet: true, simulate: true }));
    await run("CTA book URL valid", () => Boolean((topPages[0]?.cta_primary_url || DEFAULT_BOOK_URL).startsWith("http")));
    await run("CTA quote URL valid", () => Boolean((topPages[0]?.cta_secondary_url || DEFAULT_QUOTE_URL).startsWith("http")));
    setFlowResults(results);
    const failed = results.filter((r) => !r.ok).length;
    setStatus(failed ? `Flow check found ${failed} issue(s).` : "Flow check passed all critical paths.");
  }

  function clearQueueAction() {
    if (!queue.length) { setStatus("Queue already empty."); return; }
    setQueue([]); setCurrent(null); setUniquenessResults([]); setStatus("Cleared queue.");
  }

  function updateCurrentField(field, value) {
    if (!current) return;
    setCurrent((prev) => ({ ...prev, [field]: value }));
  }

  function updateConvMetric(key, value) { setConvMetrics((prev) => ({ ...prev, [key]: value })); }

  return (
    <main className="shell" data-warp-page="builder">
      <section className="surface hero" data-warp-section="builder-hero">
        <div className="hero-row">
          <div>
            <p className="overline">Manual Lane Builder</p>
            <h1 className="title">WARP SEO + LLM Page Builder</h1>
            <p className="sub">Rank lanes, generate optimized pages, export for publishing.</p>
          </div>
          <div className="actions">
            <Link className="btn ghost" href="/" data-warp-event="nav-dashboard">Dashboard</Link>
            <button className="btn ghost" data-testid="toggle-advanced" data-warp-event="toggle-mode" onClick={() => setAdvanced((v) => !v)}>
              {advanced ? "Show Easy" : "Show Advanced"}
            </button>
          </div>
        </div>
      </section>

      <section className="surface panel" data-warp-section="easy-mode" data-warp-funnel="step-panel">
        <h2>Quick Start</h2>
        <div className="grid-3">
          <article className="metric" data-warp-funnel="step-1">
            <span className="metric-k">Step 1</span>
            <p className="metric-v" style={{ fontSize: "0.95rem" }}>Generate Lanes</p>
            <button className="btn primary" data-testid="generate-top-btn" data-warp-event="generate-top" onClick={() => generateTopAction()}>Generate</button>
          </article>
          <article className="metric" data-warp-funnel="step-2">
            <span className="metric-k">Step 2</span>
            <p className="metric-v" style={{ fontSize: "0.95rem" }}>Save Current</p>
            <button className="btn" data-testid="save-current-btn" data-warp-event="save-page" onClick={() => saveCurrentAction()}>Save</button>
          </article>
          <article className="metric" data-warp-funnel="step-3">
            <span className="metric-k">Step 3</span>
            <p className="metric-v" style={{ fontSize: "0.95rem" }}>Export Queue</p>
            <div className="actions">
              <button className="btn" data-testid="export-queue-btn" data-warp-event="export-json" onClick={() => exportQueueAction()}>Export</button>
              <button className="btn ghost" data-testid="export-csv-btn" data-warp-event="export-csv" onClick={exportCsvAction} style={{ fontSize: "0.78rem" }}>CSV</button>
            </div>
          </article>
        </div>
        <p className="sub" data-testid="status-text">{status}</p>
      </section>

      <section className="surface panel" data-warp-section="progress-metrics">
        <h2>Progress + Impact</h2>
        <div className="grid-5">
          <article className="metric"><span className="metric-k">Combos</span><p className="metric-v">{metrics.combos}</p></article>
          <article className="metric"><span className="metric-k">Queue</span><p className="metric-v">{metrics.queue}</p></article>
          <article className="metric"><span className="metric-k">QA Ready</span><p className="metric-v">{metrics.qa}/{metrics.queue || 0}</p></article>
          <article className="metric"><span className="metric-k">Publish Ready</span><p className="metric-v">{metrics.publish}/{metrics.queue || 0}</p></article>
          <article className="metric"><span className="metric-k">Est. Monthly</span><p className="metric-v">${Math.round(metrics.revenue).toLocaleString()}</p></article>
        </div>
      </section>

      <section className="builder-layout">
        <aside className={`stack ${advanced ? "show" : "kid-hide"}`}>
          <article className="surface panel">
            <h2>Lane Inputs</h2>
            <label className="label">Origins (one per line)<textarea className="textarea" value={config.origins} onChange={(e) => mutateConfig(["origins"], e.target.value)} /></label>
            <label className="label">Destinations (one per line)<textarea className="textarea" value={config.destinations} onChange={(e) => mutateConfig(["destinations"], e.target.value)} /></label>
            <div className="grid-2">
              <label className="label">Mode<select className="select" value={config.mode} onChange={(e) => mutateConfig(["mode"], e.target.value)}><option value="LTL">LTL</option><option value="FTL">FTL</option><option value="Cargo Van / Box Truck">Cargo Van / Box Truck</option></select></label>
              <label className="label">Segment<select className="select" value={config.segment} onChange={(e) => mutateConfig(["segment"], e.target.value)}><option value="smb">SMB</option><option value="enterprise">Enterprise</option><option value="midmarket">Midmarket</option></select></label>
            </div>
            <label className="label">Audience<input className="input" value={config.audience} onChange={(e) => mutateConfig(["audience"], e.target.value)} /></label>
            <div className="actions">
              <button className="btn" data-testid="generate-combos-btn" onClick={() => generateCombosAction()}>Generate Combos</button>
              <button className="btn" data-testid="generate-all-btn" data-warp-event="generate-all" onClick={() => generateAllAction()}>Generate All</button>
            </div>
          </article>

          <article className="surface panel" data-testid="estimate-inputs-panel">
            <h2>Estimate Inputs</h2>
            <p className="sub">Optional. Fill these to improve estimate accuracy for generated pages.</p>
            <div className="grid-2">
              <label className="label">Pallet Count<input className="input" type="number" min="1" max="30" data-testid="est-pallet-count" value={estimateInputs.pallet_count || ""} placeholder="e.g. 4" onChange={(e) => updateEstimateInput("pallet_count", e.target.value)} /></label>
              <label className="label">Total Weight (lbs)<input className="input" type="number" min="1" data-testid="est-weight" value={estimateInputs.weight_lbs || ""} placeholder="e.g. 5000" onChange={(e) => updateEstimateInput("weight_lbs", e.target.value)} /></label>
            </div>
            <label className="label">Freight Class
              <select className="select" data-testid="est-freight-class" value={estimateInputs.freight_class || ""} onChange={(e) => updateEstimateInput("freight_class", e.target.value)}>
                {FREIGHT_CLASS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <div className="grid-2">
              <label className="label">Pickup Window<input className="input" type="text" data-testid="est-pickup" value={estimateInputs.pickup_window || ""} placeholder="e.g. Mon-Fri 8a-5p" onChange={(e) => updateEstimateInput("pickup_window", e.target.value)} /></label>
              <label className="label">Delivery Window<input className="input" type="text" data-testid="est-delivery" value={estimateInputs.delivery_window || ""} placeholder="e.g. Next-day AM" onChange={(e) => updateEstimateInput("delivery_window", e.target.value)} /></label>
            </div>
          </article>

          <article className="surface panel">
            <h2>Ranking Controls</h2>
            <label className="label">Rank Mode
              <select className="select" data-testid="rank-mode" value={rankMode} onChange={(e) => setRankMode(e.target.value)}>
                <option value="strategic">Strategic Weights</option>
                <option value="performance">Live Performance Data</option>
                <option value="blended">Blended</option>
              </select>
            </label>
            <label className="label">Top N<input className="input" type="number" value={config.topN} onChange={(e) => mutateConfig(["topN"], num(e.target.value, 10))} /></label>
            <div className="grid-2">
              <label className="label">Shipments<input className="input" type="number" value={config.defaults.weekly_shipments} onChange={(e) => mutateConfig(["defaults", "weekly_shipments"], num(e.target.value, 18))} /></label>
              <label className="label">Quote Value<input className="input" type="number" value={config.defaults.avg_quote_value} onChange={(e) => mutateConfig(["defaults", "avg_quote_value"], num(e.target.value, 2200))} /></label>
              <label className="label">Win Rate<input className="input" type="number" step="0.01" value={config.defaults.win_rate} onChange={(e) => mutateConfig(["defaults", "win_rate"], num(e.target.value, 0.22))} /></label>
              <label className="label">Strategic<input className="input" type="number" value={config.defaults.strategic_priority} onChange={(e) => mutateConfig(["defaults", "strategic_priority"], num(e.target.value, 6))} /></label>
            </div>
            <label className="label">Lane Metrics CSV<textarea className="textarea" value={config.metricsCsv} onChange={(e) => mutateConfig(["metricsCsv"], e.target.value)} /></label>
          </article>

          <article className="surface panel" data-testid="gsc-ga4-panel">
            <h2>GSC + GA4 Import</h2>
            <p className="sub">Paste CSV exports to enable performance-based ranking and copy upgrade suggestions.</p>
            <label className="label">Google Search Console CSV
              <textarea className="textarea" data-testid="gsc-input" placeholder="query,page,clicks,impressions,ctr,position" value={gscRaw} onChange={(e) => setGscRaw(e.target.value)} />
            </label>
            <p className="sub" style={{ fontSize: "0.72rem" }}>{gscData.length} rows parsed</p>
            <label className="label">GA4 CSV
              <textarea className="textarea" data-testid="ga4-input" placeholder="page_path,sessions,conversions,conversion_rate" value={ga4Raw} onChange={(e) => setGa4Raw(e.target.value)} />
            </label>
            <p className="sub" style={{ fontSize: "0.72rem" }}>{ga4Data.length} rows parsed</p>
          </article>

          <article className="surface panel" data-testid="quote-feedback-panel">
            <h2>Quote Feedback</h2>
            <p className="sub">Paste CSV of quote results to tighten rate estimates and increase confidence.</p>
            <label className="label">Quote CSV
              <textarea className="textarea" data-testid="quote-feedback-input" placeholder="origin,destination,mode,quote_amount" value={quoteFeedbackRaw} onChange={(e) => setQuoteFeedbackRaw(e.target.value)} />
            </label>
            <button className="btn" data-testid="import-quotes-btn" onClick={() => processQuoteFeedback(quoteFeedbackRaw)} style={{ marginTop: 4 }}>Import Quotes</button>
            <p className="sub" style={{ fontSize: "0.72rem", marginTop: 4 }}>{quoteHistoryMap.size} lanes with quote history</p>
          </article>

          <article className="surface panel" data-testid="lane-import-panel">
            <h2>Lane Set Import</h2>
            <p className="sub">Import city-pair lanes from CSV. Each pair generates pages across selected modes and segments.</p>
            <label className="label">Paste Lane CSV
              <textarea className="textarea" data-testid="lane-csv-input" placeholder="origin_city,origin_state,destination_city,destination_state,lane_set" onChange={(e) => handleLaneImport(e.target.value)} />
            </label>
            <div className="actions" style={{ marginTop: 4 }}>
              <label className="btn ghost" style={{ cursor: "pointer" }}>
                Upload CSV
                <input type="file" accept=".csv" style={{ display: "none" }} data-testid="lane-csv-upload" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => handleLaneImport(ev.target.result);
                  reader.readAsText(file);
                }} />
              </label>
              <button className="btn ghost" data-testid="load-seed-btn" onClick={loadSeedFile}>Load Seed File</button>
            </div>
            {importedLanes.length > 0 && (
              <div style={{ marginTop: 8, padding: "6px 8px", background: "var(--surface-3)", borderRadius: "var(--radius)", fontSize: "0.76rem" }} data-testid="import-summary">
                <strong>{importedLanes.length}</strong> city pairs imported
                {(() => {
                  const sets = {};
                  importedLanes.forEach((l) => { sets[l.lane_set] = (sets[l.lane_set] || 0) + 1; });
                  return Object.entries(sets).map(([k, v]) => <span key={k} className="pill" style={{ marginLeft: 4 }}>{k}: {v}</span>);
                })()}
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <p className="overline">Generation Modes</p>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {["LTL", "FTL", "Cargo Van / Box Truck"].map((m) => (
                  <label key={m} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: "0.82rem" }}>
                    <input type="checkbox" data-testid={`mode-${m}`} checked={genModes.includes(m)} onChange={(e) => {
                      setGenModes((prev) => e.target.checked ? [...prev, m] : prev.filter((x) => x !== m));
                    }} />
                    {m}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 8 }}>
              <p className="overline">Target Segments</p>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {["smb", "midmarket", "enterprise"].map((s) => (
                  <label key={s} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: "0.82rem" }}>
                    <input type="checkbox" data-testid={`segment-${s}`} checked={genSegments.includes(s)} onChange={(e) => {
                      setGenSegments((prev) => e.target.checked ? [...prev, s] : prev.filter((x) => x !== s));
                    }} />
                    {s}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 8, padding: "6px 8px", background: "var(--surface-2)", borderRadius: "var(--radius)", fontSize: "0.76rem" }} data-testid="gen-preview">
              Queue preview: <strong>{importedLanes.length * genModes.length * genSegments.length}</strong> pages ({importedLanes.length} pairs × {genModes.length} modes × {genSegments.length} segments)
            </div>

            <button className="btn primary" data-testid="generate-from-import" onClick={generateFromImport} style={{ marginTop: 8, width: "100%" }}>
              Generate {importedLanes.length * genModes.length * genSegments.length} Pages from Import
            </button>
          </article>

          <article className="surface panel" data-testid="publish-batches-panel">
            <h2>Publish Batches</h2>
            <p className="sub">Split queue into safe publish batches with quality scoring.</p>
            <div className="grid-2" style={{ marginTop: 4 }}>
              <label className="label">Batch Size
                <input className="input" type="number" data-testid="batch-size" min="50" max="500" step="50" value={batchSize} onChange={(e) => setBatchSize(Math.max(50, Math.min(500, Number(e.target.value) || 250)))} />
              </label>
              <div style={{ display: "flex", alignItems: "flex-end" }}>
                <button className="btn" data-testid="rebuild-batches" onClick={rebuildBatches} style={{ width: "100%" }}>Build Batches</button>
              </div>
            </div>
            {batches.length > 0 && (
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                {batches.map((b) => {
                  const qResult = batchQualityScore(b, queue);
                  const score = qResult.score;
                  const safe = qResult.safe;
                  return (
                    <div key={b.id} style={{ padding: "8px", background: "var(--surface-3)", borderRadius: "var(--radius)", borderLeft: `3px solid ${safe ? "var(--success)" : "var(--danger)"}` }} data-testid={`batch-${b.id}`}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>{b.id}</span>
                        <span className="pill" style={{ background: safe ? "var(--success)" : "var(--danger)", color: "#000", fontSize: "0.65rem" }}>
                          {score}/100 {safe ? "SAFE" : "UNSAFE"}
                        </span>
                      </div>
                      <p className="sub" style={{ fontSize: "0.72rem", marginTop: 2 }}>{b.pages.length} pages</p>
                      {b.summary && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                          {Object.entries(b.summary.mode_distribution || {}).map(([m, c]) => <span key={m} className="pill" style={{ fontSize: "0.6rem" }}>{m}: {c}</span>)}
                          {Object.entries(b.summary.segment_distribution || {}).map(([s, c]) => <span key={s} className="pill" style={{ fontSize: "0.6rem" }}>{s}: {c}</span>)}
                        </div>
                      )}
                      <button className="btn ghost" style={{ marginTop: 4, fontSize: "0.74rem" }} onClick={() => exportBatch(b)} disabled={!safe}>
                        {safe ? "Export Batch" : "Fix quality first"}
                      </button>
                    </div>
                  );
                })}
                <button className="btn" data-testid="export-all-batches" onClick={exportAllBatches} style={{ marginTop: 4 }}>Export All Safe Batches</button>
              </div>
            )}
          </article>

          <article className="surface panel" data-testid="wave-publish-panel">
            <h2>Publish Waves</h2>
            <p className="sub">Controlled wave-based publishing for crawl budget management.</p>
            <label className="label">Select Wave
              <select className="select" data-testid="wave-select" value={selectedWave} onChange={(e) => { setSelectedWave(e.target.value); setWaveGate(null); }}>
                {WAVE_DEFINITIONS.map((w) => (
                  <option key={w.id} value={w.id}>{w.label} ({w.lane_pair_limit.toLocaleString()} pairs)</option>
                ))}
              </select>
            </label>
            {(() => {
              const wave = WAVE_DEFINITIONS.find((w) => w.id === selectedWave);
              if (!wave) return null;
              const pairCount = Math.min(importedLanes.length, wave.lane_pair_limit);
              const pageCount = wavePageCount(pairCount, genModes, genSegments);
              return (
                <div style={{ marginTop: 6 }}>
                  <p className="sub" style={{ fontSize: "0.76rem" }}>{wave.description}</p>
                  <div className="grid-2" style={{ marginTop: 6 }}>
                    <div className="preview-card"><span className="k">Lane Pairs</span><p className="v">{pairCount.toLocaleString()} / {wave.lane_pair_limit.toLocaleString()}</p></div>
                    <div className="preview-card"><span className="k">Pages</span><p className="v">{pageCount.toLocaleString()}</p></div>
                  </div>
                  <p className="sub" style={{ fontSize: "0.72rem", marginTop: 4 }}>{wave.crawl_budget_notes}</p>
                </div>
              );
            })()}
            <div className="actions" style={{ marginTop: 8 }}>
              <button className="btn primary" data-testid="generate-wave" onClick={generateWavePages}>Generate Wave</button>
              <button className="btn ghost" data-testid="export-wave-manifest" onClick={exportWaveManifest}>Export Manifest</button>
            </div>
            {waveGate && (
              <div style={{ marginTop: 8, padding: "6px 8px", background: "var(--surface-3)", borderRadius: "var(--radius)", borderLeft: `3px solid ${waveGate.pass ? "var(--success)" : "var(--danger)"}` }} data-testid="wave-gate-result">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: "0.82rem" }}>Quality Gate</strong>
                  <span className="pill" style={{ background: waveGate.pass ? "var(--success)" : "var(--danger)", color: "#000", fontSize: "0.65rem" }}>
                    {waveGate.score}/{waveGate.threshold} {waveGate.pass ? "PASS" : "BLOCKED"}
                  </span>
                </div>
                {waveGate.issues.length > 0 && (
                  <ul className="sub" style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: "0.72rem" }}>
                    {waveGate.issues.map((iss, i) => <li key={`wi-${i}`} style={{ color: "var(--danger)" }}>{iss}</li>)}
                  </ul>
                )}
              </div>
            )}
          </article>

          <article className="surface panel" data-testid="spreadsheet-workflow-panel">
            <h2>Spreadsheet Workflow</h2>
            <p className="sub">Export a Google Sheets-friendly template for bulk quoting.</p>
            <button className="btn" data-testid="export-spreadsheet" onClick={exportSpreadsheetTemplate} style={{ marginTop: 4 }}>Export Quote Template CSV</button>
            <p className="sub" style={{ fontSize: "0.72rem", marginTop: 6 }}>Fill in pallets, weight, class, and pickup date. Submit to wearewarp.com/quote for real-time pricing.</p>
          </article>

          <article className="surface panel" data-testid="duplicate-check-panel">
            <h2>Duplicate Check</h2>
            <p className="sub">Verify pages against published registry before export.</p>
            <div className="actions" style={{ marginTop: 4 }}>
              <button className="btn" data-testid="run-dup-check" onClick={runDuplicateCheck}>Check Duplicates</button>
              <button className="btn primary" data-testid="safe-export" onClick={exportWithDuplicateGate}>Safe Export</button>
            </div>
            <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: "0.78rem", marginTop: 6 }}>
              <input type="checkbox" data-testid="dup-override" checked={dupOverride} onChange={(e) => setDupOverride(e.target.checked)} />
              Override duplicate block
            </label>
            {duplicateCheck && (
              <div style={{ marginTop: 8, padding: "6px 8px", background: "var(--surface-3)", borderRadius: "var(--radius)", borderLeft: `3px solid ${duplicateCheck.blocked.length === 0 ? "var(--success)" : "var(--danger)"}` }} data-testid="dup-result">
                <p style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                  {duplicateCheck.blocked.length === 0 ? "No duplicates found" : `${duplicateCheck.blocked.length} duplicate(s) blocked`}
                </p>
                <p className="sub" style={{ fontSize: "0.72rem" }}>{duplicateCheck.clean.length} pages clear for export</p>
                {duplicateCheck.blocked.length > 0 && (
                  <ul className="sub" style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: "0.72rem" }}>
                    {duplicateCheck.blocked.slice(0, 10).map((b, i) => (
                      <li key={`dup-${i}`} style={{ color: "var(--danger)" }}>
                        {b.page.slug}: {b.duplicates.map((d) => d.reason).join(", ")} → {b.duplicates[0]?.existing_canonical}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <p className="sub" style={{ fontSize: "0.72rem", marginTop: 6 }}>{publishedRegistry.length} pages in published registry</p>
          </article>

          <article className="surface panel" data-testid="ramp-schedule-panel">
            <h2>Ramp Schedule</h2>
            <p className="sub">Prescribed publish drops. Generate manifests for each date.</p>
            <table className="table" style={{ fontSize: "0.76rem", marginTop: 6 }} data-testid="ramp-table">
              <thead>
                <tr><th>Date</th><th>Drop</th><th>Pages</th><th>Cumulative</th><th></th></tr>
              </thead>
              <tbody>
                {rampSchedule.map((drop, i) => (
                  <tr key={`drop-${i}`}>
                    <td style={{ fontSize: "0.72rem" }}>{drop.date.slice(5, 10)}</td>
                    <td>{drop.label}</td>
                    <td>{drop.pages}</td>
                    <td>{drop.cumulative}</td>
                    <td>
                      <button className="btn ghost" style={{ fontSize: "0.68rem", padding: "2px 6px" }} data-testid={`export-drop-${i}`} onClick={() => exportDropManifest(i)}>
                        Export
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>

          <article className="surface panel">
            <h2>Flow Check</h2>
            <div className="actions">
              <button className="btn" data-testid="run-flow-check" onClick={runFlowCheck}>Run Flow Check</button>
              <button className="btn ghost" data-testid="clear-flow-check" onClick={() => setFlowResults([])}>Clear</button>
              <button className="btn ghost danger" data-testid="clear-queue" onClick={clearQueueAction}>Clear Queue</button>
            </div>
            <ul className="sub" data-testid="flow-results" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
              {flowResults.length === 0 ? <li>Not run</li> : flowResults.map((item, i) => <FlowResult item={item} key={`${item.name}-${i}`} />)}
            </ul>
          </article>
        </aside>

        <section className="stack">
          <article className="surface panel" data-warp-section="preview">
            <h2>Live Preview</h2>
            <div className="preview" style={{ ["--accent"]: previewDesign.accent, ["--surface-1"]: previewDesign.surface1, ["--surface-2"]: previewDesign.surface2, ["--border"]: previewDesign.border, ["--radius"]: `${previewDesign.radius}px` }}>
              <section className="preview-hero" data-warp-section="preview-hero">
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="pill">{current?.priority?.rank ? `#${current.priority.rank}` : "#1"} {current?.target_segment || config.segment} lane page</span>
                  <UpgradeReadinessBadge page={current} quoteHistoryMap={quoteHistoryMap} />
                </div>
                <h3 className="preview-h" data-testid="preview-h1">{current?.h1 || "Generate top lanes to begin"}</h3>
                <p className="preview-p">{current?.intro || "Run Step 1 to create ranked lane pages, then edit and export."}</p>
                <div className="actions">
                  <button className="btn" data-testid="preview-book" data-warp-event="cta-book" data-warp-funnel="convert" onClick={() => openExternal(current?.cta_primary_url || DEFAULT_BOOK_URL, "Book URL")}>{current?.cta_primary || "Book 15-min Fit Call"}</button>
                  <button className="btn primary" data-testid="preview-quote" data-warp-event="cta-quote" data-warp-funnel="convert" onClick={() => openExternal(current?.cta_secondary_url || DEFAULT_QUOTE_URL, "Quote URL")}>{current?.cta_secondary || "Get Instant Quote"}</button>
                </div>
              </section>

              <section className="preview-cards" data-warp-section="value-cards">
                {(current?.visual_cards || []).slice(0, 3).map((card, idx) => (
                  <article className="preview-card" key={`${card.label}-${idx}`}><span className="k">{card.label}</span><p className="v">{card.value}</p><p className="d">{card.insight}</p></article>
                ))}
              </section>

              {current?.lane && <FlowDiagram page={current} />}
              <EstimateTransparency page={current} />
              <LaneStatsPanel page={current} />
              <NetworkProofPanel page={current} />

              {current?.faq && current.faq.length > 0 && (
                <section className="stack" style={{ gap: 6 }} data-warp-section="faq-preview">
                  <p className="overline">FAQ Preview ({current.faq.length} entries)</p>
                  {current.faq.slice(0, 3).map((f, i) => (<div className="faq-item" key={`faq-${i}`}><p className="faq-q">{f.q}</p><p className="faq-a">{f.a}</p></div>))}
                </section>
              )}

              <ContrastPreview page={current} />
              <InternalLinksPanel page={current} />
              <IndexLinksPanel page={current} />
              <ToolPanel page={current} />
            </div>
          </article>

          {advanced && (
            <>
              {currentUniqueness && !currentUniqueness.unique && (
                <article className="surface panel" data-warp-section="uniqueness-warnings" data-testid="uniqueness-warnings" style={{ borderColor: "color-mix(in srgb, var(--warn) 50%, transparent)" }}>
                  <h2 style={{ color: "var(--warn)" }}>Content Uniqueness Warnings</h2>
                  {currentUniqueness.warnings.map((w, i) => (
                    <div key={`uw-${i}`} className="suggestion-item">
                      <span className="suggestion-impact medium">{w.field}</span>
                      <p className="suggestion-text">{w.issue}</p>
                    </div>
                  ))}
                </article>
              )}

              {seoCopyUpgrades.length > 0 && (
                <article className="surface panel" data-warp-section="seo-copy-upgrades">
                  <h2>SEO Copy Upgrades (from GSC data)</h2>
                  <div className="stack" style={{ gap: 6 }}>
                    {seoCopyUpgrades.map((s, i) => (
                      <div key={`seo-${i}`} className="suggestion-item">
                        <span className={`suggestion-impact ${s.priority}`}>{s.priority}</span>
                        <p className="suggestion-text">{s.text}</p>
                      </div>
                    ))}
                  </div>
                </article>
              )}

              <article className="surface panel" data-warp-section="page-editor">
                <h2>Edit Current Page</h2>
                <label className="label">Slug<input className="input" value={current?.slug || ""} onChange={(e) => updateCurrentField("slug", e.target.value)} /></label>
                <label className="label">SEO Title<input className="input" value={current?.seo_title || ""} onChange={(e) => updateCurrentField("seo_title", e.target.value)} /></label>
                <label className="label">Meta Description<textarea className="textarea" value={current?.meta_description || ""} onChange={(e) => updateCurrentField("meta_description", e.target.value)} /></label>
                <label className="label">H1<input className="input" value={current?.h1 || ""} onChange={(e) => updateCurrentField("h1", e.target.value)} /></label>
                <label className="label">Intro<textarea className="textarea" value={current?.intro || ""} onChange={(e) => updateCurrentField("intro", e.target.value)} /></label>
                <label className="label">Proof Section<textarea className="textarea" value={current?.proof_section || ""} onChange={(e) => updateCurrentField("proof_section", e.target.value)} /></label>
                <div className="actions">
                  <button className="btn" data-testid="advanced-save-current" data-warp-event="advanced-save" onClick={() => saveCurrentAction()}>Save Current</button>
                  <button className="btn" data-testid="advanced-export-queue" data-warp-event="advanced-export" onClick={() => exportQueueAction()}>Export JSON</button>
                  <button className="btn" data-testid="export-csv-advanced" data-warp-event="export-csv" onClick={exportCsvAction}>Export CSV</button>
                  <button className="btn ghost" data-testid="copy-import-command" onClick={() => copyImportCommandAction()}>Copy Import Cmd</button>
                </div>
              </article>

              <article className="surface panel" data-warp-section="publish-readiness">
                <h2>Publish Readiness</h2>
                <PublishChecksPanel page={current} />
              </article>

              <article className="surface panel" data-warp-section="queue-table">
                <h2>Queue + Ranked Impact ({rankMode})</h2>
                <table className="table">
                  <thead><tr><th>Rank</th><th>Lane</th><th>Segment</th><th>Est. Monthly</th><th>Publish</th></tr></thead>
                  <tbody>
                    {rankedQueue.length === 0 ? (
                      <tr><td colSpan={5} style={{ color: "var(--text-dim)" }}>Queue empty</td></tr>
                    ) : rankedQueue.slice(0, 20).map((row) => (
                      <tr key={row.slug}>
                        <td><span className="pill">#{row.priority?.rank || "-"}</span></td>
                        <td><button className="list-item" data-testid={`queue-select-${row.slug}`} style={{ border: 0, padding: 0 }} onClick={() => setCurrent(row)}>{(row.lane?.origin || "Origin")} &rarr; {(row.lane?.destination || "Destination")}</button></td>
                        <td>{row.target_segment}</td>
                        <td>${Math.round(num(row.priority?.expected_monthly_revenue, 0)).toLocaleString()}</td>
                        <td className={isPublishReady(row) ? "good" : "warn"}>{isPublishReady(row) ? "Ready" : "Needs work"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </article>

              <SuggestionsPanel metricsInput={convMetrics} onMetricsChange={updateConvMetric} />

              <article className="surface panel" data-warp-section="graph-metrics">
                <h2>Knowledge Graph</h2>
                <div className="grid-3">
                  <div className="metric" style={{ minHeight: "auto" }}><span className="metric-k">Nodes</span><p className="metric-v" style={{ fontSize: "1rem" }}>{graphMetrics.total_nodes}</p></div>
                  <div className="metric" style={{ minHeight: "auto" }}><span className="metric-k">Edges</span><p className="metric-v" style={{ fontSize: "1rem" }}>{graphMetrics.total_edges}</p></div>
                  <div className="metric" style={{ minHeight: "auto" }}><span className="metric-k">Lanes</span><p className="metric-v" style={{ fontSize: "1rem" }}>{graphMetrics.total_lanes}</p></div>
                </div>
                {graphMetrics.top_hubs.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {graphMetrics.top_hubs.map((h) => (<span key={h.city} className="pill">{h.city} ({h.connections})</span>))}
                  </div>
                )}
              </article>

              <article className="surface panel" data-warp-section="json-output">
                <h2>Current JSON</h2>
                <div className="code">{JSON.stringify(current || {}, null, 2)}</div>
              </article>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
