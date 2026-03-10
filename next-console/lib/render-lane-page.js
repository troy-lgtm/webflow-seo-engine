/**
 * render-lane-page.js — Dedicated Lane Page Renderer
 *
 * The ONLY allowed rendering path for lane pages in the WARP SEO engine.
 * Takes canonical lane page data (from lane-page-schema.js::buildCanonicalLanePageData)
 * and produces deterministic HTML.
 *
 * Principles:
 *   - NEVER reads homepage blocks
 *   - NEVER injects tutorial/video sections
 *   - NEVER produces generic marketing content
 *   - Rendered HTML is predictable and deterministic for the same input
 *   - Section ordering is fixed and cannot vary
 *
 * NOTE: Must work in raw Node.js scripts (no @/ aliases). Pure ES module.
 *
 * @module render-lane-page
 */

// ── Constants ────────────────────────────────────────────────────────

const SITE_BASE = "https://www.wearewarp.com";
const QUOTE_URL = `${SITE_BASE}/quote`;

/**
 * CSS to hide generic Webflow template sections that must never appear
 * on dedicated lane pages. Targets Wistia embeds, "Book Freight Instantly"
 * CTAs, book-a-meeting CTAs, generic marketing sections, and their wrappers.
 *
 * Selectors are based on the live Webflow template audit (2026-03-07):
 *   - container-24: Wistia video wrapper
 *   - cta-bundle: "Book Freight Instantly" buttons (3 instances)
 *   - container-14: "Why Shippers Choose Warp" generic section
 *   - uui-page-padding-5: "Stop Paying for a Broken Freight System" CTA
 *
 * @type {string}
 */
export const WEBFLOW_TEMPLATE_HIDE_CSS = [
  /* Wistia video player and its template container */
  ".container-24 { display: none !important; }",
  "wistia-player { display: none !important; }",
  ".wistia_embed { display: none !important; }",
  "[data-wistia-id] { display: none !important; }",
  'iframe[src*="wistia"] { display: none !important; }',
  'iframe[src*="youtube"] { display: none !important; }',
  'iframe[src*="calendly"] { display: none !important; }',
  'iframe[src*="hubspot"] { display: none !important; }',
  /* Generic CTA bundles ("Book Freight Instantly" buttons) */
  ".cta-bundle { display: none !important; }",
  ".book-freight-section { display: none !important; }",
  ".book-freight-instantly { display: none !important; }",
  ".book-a-meeting-cta { display: none !important; }",
  /* Generic marketing sections */
  ".container-14 { display: none !important; }",   /* "Why Shippers Choose Warp" */
  ".uui-page-padding-5 { display: none !important; }", /* "Stop Paying..." CTA */
  ".how-it-works-section { display: none !important; }",
  ".newsletter-signup { display: none !important; }",
  ".video-section { display: none !important; }",
  ".template-hero-fallback { display: none !important; }",
  /* Injected SEO copy block from __warpSeoP2FooterV3 */
  "#warp-lane-seo-copy { display: none !important; }",
].join("\n");

/**
 * Full Lane Page Mode CSS — complete dark premium theme for dedicated lane pages.
 * Includes all hide rules PLUS dark theme overrides for nav, hero, body, comparison,
 * footer, scrollbar, and mobile responsive adjustments.
 *
 * This CSS is embedded in the faq-schema RichText field. When bound to a Rich Text
 * or Code Embed element in the Webflow template, it transforms the generic template
 * into the premium lane page experience without requiring JavaScript.
 *
 * For the JavaScript enhancement layer (hero map SVG, KPI chips, comparison rebuild),
 * deploy lane-page-mode.html to Site Settings > Custom Code > Footer.
 *
 * @type {string}
 */
export const LANE_PAGE_MODE_CSS = [
  /* ── Page-Level Dark Mode ───────────────────────────────────────── */
  "body { background: #0B0C0E !important; }",

  /* ── Hide Generic Template Sections ─────────────────────────────── */
  WEBFLOW_TEMPLATE_HIDE_CSS,

  /* ── Header / Nav — Dark Premium ────────────────────────────────── */
  ".uui-navbar07_component, .crossdocknav, .w-nav {",
  "  background: #0B0C0E !important;",
  "  border-bottom: 1px solid rgba(255,255,255,0.06) !important;",
  "}",
  ".uui-navbar07_component *, .crossdocknav * {",
  "  color: #F5F7FA !important;",
  "}",
  ".uui-navbar07_component a:hover, .crossdocknav a:hover {",
  "  color: #00ff33 !important;",
  "}",
  ".uui-navbar07_component .w-nav-brand img, .crossdocknav .w-nav-brand img {",
  "  filter: brightness(0) invert(1) !important;",
  "}",
  ".uui-navbar07_component .w-button, .crossdocknav .w-button {",
  "  background: #00ff33 !important;",
  "  color: #0B0C0E !important;",
  "  border: none !important;",
  "  font-weight: 700 !important;",
  "  border-radius: 8px !important;",
  "}",
  ".w-dropdown-list {",
  "  background: #121418 !important;",
  "  border: 1px solid rgba(255,255,255,0.08) !important;",
  "}",
  ".w-dropdown-link {",
  "  color: #C0C7D4 !important;",
  "}",
  ".w-dropdown-link:hover {",
  "  color: #00ff33 !important;",
  "  background: rgba(0,255,51,0.06) !important;",
  "}",

  /* ── Hero Section — Dark Premium Takeover ────────────────────────── */
  ".container-15 {",
  "  background: linear-gradient(180deg, #0B0C0E 0%, #121418 100%) !important;",
  "  padding: 80px 32px 48px !important;",
  "  color: #F5F7FA !important;",
  "  border-bottom: 1px solid rgba(255,255,255,0.06) !important;",
  "  position: relative !important;",
  "  overflow: hidden !important;",
  "}",
  ".container-15 h1 {",
  '  color: #F5F7FA !important;',
  '  font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, sans-serif !important;',
  "  font-size: clamp(1.6rem, 3.5vw, 2.6rem) !important;",
  "  font-weight: 700 !important;",
  "  line-height: 1.15 !important;",
  "  margin-bottom: 8px !important;",
  "}",
  ".container-15 p, .container-15 .text-size-large {",
  "  color: #C0C7D4 !important;",
  "  font-size: 16px !important;",
  "  line-height: 1.6 !important;",
  "  max-width: 640px !important;",
  "}",

  /* ── Main Content Area — Dark Theme ─────────────────────────────── */
  ".container-18, .container-13 {",
  "  background: #0B0C0E !important;",
  "  color: #F5F7FA !important;",
  "}",
  ".container-13 h1, .container-13 h2, .container-13 h3 {",
  "  color: #F5F7FA !important;",
  '  font-family: "Space Grotesk", -apple-system, sans-serif !important;',
  "}",
  ".container-13 p, .container-13 li {",
  "  color: #C0C7D4 !important;",
  "  line-height: 1.6 !important;",
  "}",
  ".container-13 a { color: #38BDF8 !important; }",
  ".container-13 a:hover { color: #00ff33 !important; }",
  /* body-content text block */
  ".text-block-19 {",
  "  color: #C0C7D4 !important;",
  "  font-size: 15px !important;",
  "  line-height: 1.7 !important;",
  "  max-width: 720px !important;",
  "}",

  /* ── Comparison Section — Dark Card ─────────────────────────────── */
  ".div-block-27 {",
  "  background: #121418 !important;",
  "  border: 1px solid rgba(255,255,255,0.06) !important;",
  "  border-radius: 12px !important;",
  "  padding: 32px !important;",
  "  margin: 32px 0 !important;",
  "  color: #F5F7FA !important;",
  "}",
  ".div-block-27 h2, .div-block-27 h3 {",
  "  color: #F5F7FA !important;",
  '  font-family: "Space Grotesk", -apple-system, sans-serif !important;',
  "  margin-bottom: 8px !important;",
  "}",

  /* ── Footer — Dark ──────────────────────────────────────────────── */
  ".section-3, footer, .uui-footer01_component {",
  "  background: #080A0C !important;",
  "  color: #8E97A6 !important;",
  "  border-top: 1px solid rgba(255,255,255,0.06) !important;",
  "}",
  ".section-3 a, footer a { color: #8E97A6 !important; }",
  ".section-3 a:hover, footer a:hover { color: #00ff33 !important; }",

  /* ── Custom scrollbar ───────────────────────────────────────────── */
  "::-webkit-scrollbar { width: 8px; }",
  "::-webkit-scrollbar-track { background: #121418; }",
  "::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }",
  "::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }",

  /* ── Mobile Responsive ──────────────────────────────────────────── */
  "@media (max-width: 768px) {",
  "  .container-15 { padding: 64px 20px 32px !important; }",
  "  .container-15 h1 { font-size: 1.5rem !important; }",
  "  .lane-kpi-chips { gap: 6px !important; }",
  "  .lane-cta-row { flex-direction: column !important; }",
  "  .lane-cta-row a { width: 100% !important; text-align: center !important; }",
  "  .div-block-27 { padding: 20px !important; }",
  "  .lane-comp-table td, .lane-comp-table th { padding: 8px 6px !important; font-size: 12px !important; }",
  "}",
].join("\n");

// ── Mode-Specific Comparison Points ──────────────────────────────────
// Each mode gets its own comparison set with dimensions relevant to that
// freight type. LTL compares pallet/consolidation workflows. FTL compares
// capacity/GPS/dispatch workflows. Cargo Van compares right-sizing/direct
// routing workflows. This ensures mode pages feel materially different.

/** LTL comparison: pallet-level, consolidation-focused dimensions. */
const LTL_COMPARISON_POINTS = [
  { metric: "Quote Speed", traditional: "2\u201324 hours via phone/email", warp: "Under 2 minutes, self-serve", icon_t: "\u260E", icon_w: "\u26A1" },
  { metric: "Pallet Tracking", traditional: "No pallet-level visibility", warp: "Real-time scan events at every milestone", icon_t: "\uD83D\uDCDE", icon_w: "\uD83D\uDCE1" },
  { metric: "Appointment Scheduling", traditional: "Manual phone coordination", warp: "Managed by WARP operations team", icon_t: "\uD83D\uDCCB", icon_w: "\u2714" },
  { metric: "Carrier Comparison", traditional: "Manual spreadsheets", warp: "Side-by-side dashboard with performance data", icon_t: "\uD83D\uDCCB", icon_w: "\uD83D\uDCCA" },
  { metric: "Booking", traditional: "Email chains, 30\u201360 min", warp: "One-click from quote to BOL", icon_t: "\u2709", icon_w: "\u2714" },
  { metric: "Consolidation", traditional: "Limited to single carrier network", warp: "Cross-dock consolidation with flexible routing", icon_t: "\uD83D\uDD04", icon_w: "\uD83C\uDFAF" },
  { metric: "Exception Handling", traditional: "Reactive, hours to discover", warp: "Proactive alerts within 30 minutes", icon_t: "\u23F3", icon_w: "\uD83D\uDEA8" },
  { metric: "Freight Class Pricing", traditional: "Opaque, accessorials added after quote", warp: "All-in rates with NMFC and accessorial breakdown", icon_t: "\u2753", icon_w: "\uD83D\uDCB2" },
  { metric: "Damage Risk", traditional: "Limited visibility until claim filed", warp: "Photo documentation at pickup with proactive alerts", icon_t: "\u26A0", icon_w: "\uD83D\uDEE1" },
];

/** FTL comparison: capacity, GPS, execution-control dimensions. */
const FTL_COMPARISON_POINTS = [
  { metric: "Capacity Access", traditional: "Multiple broker calls, no guarantee", warp: "Instant access to vetted carrier network", icon_t: "\uD83D\uDCDE", icon_w: "\u26A1" },
  { metric: "GPS Tracking", traditional: "Call carrier for location updates", warp: "Live GPS with geofenced arrival/departure alerts", icon_t: "\uD83D\uDCDE", icon_w: "\uD83D\uDCE1" },
  { metric: "Dispatch Speed", traditional: "Hours to confirm driver assignment", warp: "Automated dispatch with real-time confirmation", icon_t: "\u23F3", icon_w: "\u2714" },
  { metric: "Quote Speed", traditional: "2\u201324 hours via phone/email", warp: "Under 2 minutes, self-serve", icon_t: "\u260E", icon_w: "\u26A1" },
  { metric: "Execution Control", traditional: "Blind to driver ETA until arrival", warp: "Live ETA from dispatch through delivery", icon_t: "\uD83D\uDE9A", icon_w: "\uD83C\uDFAF" },
  { metric: "Detention Tracking", traditional: "Manual logs, disputed after the fact", warp: "Automated geofence-based detention detection", icon_t: "\uD83D\uDCCB", icon_w: "\uD83D\uDEA8" },
  { metric: "Booking", traditional: "Email chains with manual BOL creation", warp: "One-click from quote to digital BOL", icon_t: "\u2709", icon_w: "\u2714" },
  { metric: "Exception Handling", traditional: "Reactive, hours to discover", warp: "Proactive alerts within 30 minutes", icon_t: "\u23F3", icon_w: "\uD83D\uDEA8" },
  { metric: "Pricing Transparency", traditional: "Spot rates with hidden fees", warp: "All-in rates with fuel surcharge breakout", icon_t: "\u2753", icon_w: "\uD83D\uDCB2" },
];

/** Cargo Van / Box Truck comparison: right-sizing, direct routing dimensions. */
const CARGO_VAN_COMPARISON_POINTS = [
  { metric: "Vehicle Matching", traditional: "Limited to available fleet inventory", warp: "Right-sized vehicle based on load dimensions", icon_t: "\uD83D\uDE9A", icon_w: "\uD83C\uDFAF" },
  { metric: "Direct Routing", traditional: "Terminal stops, shared loads", warp: "Point-to-point, no terminal handling", icon_t: "\uD83D\uDD04", icon_w: "\u2714" },
  { metric: "Dispatch Speed", traditional: "Hours to find available vehicle", warp: "Instant matching from vetted network", icon_t: "\u23F3", icon_w: "\u26A1" },
  { metric: "Quote Speed", traditional: "Multiple calls for box truck quotes", warp: "Under 2 minutes, self-serve", icon_t: "\u260E", icon_w: "\u26A1" },
  { metric: "Right-Sized Pricing", traditional: "Pay for 53-ft trailer regardless of load", warp: "Pay only for the capacity you actually use", icon_t: "\u2753", icon_w: "\uD83D\uDCB2" },
  { metric: "Tracking", traditional: "Call driver for location updates", warp: "Real-time tracking from pickup to delivery", icon_t: "\uD83D\uDCDE", icon_w: "\uD83D\uDCE1" },
  { metric: "Booking", traditional: "Phone/email, manual coordination", warp: "One-click from quote to BOL", icon_t: "\u2709", icon_w: "\u2714" },
  { metric: "Exception Handling", traditional: "Reactive, hours to discover", warp: "Proactive alerts within 30 minutes", icon_t: "\u23F3", icon_w: "\uD83D\uDEA8" },
  { metric: "Flexibility", traditional: "Rigid scheduling, limited pickup windows", warp: "Flexible pickup and delivery windows", icon_t: "\uD83D\uDCCB", icon_w: "\uD83D\uDEE1" },
];

/** Backward-compatible alias — tests and older code reference COMPARISON_POINTS. */
const COMPARISON_POINTS = LTL_COMPARISON_POINTS;

/** Get the correct comparison point set for a given freight mode. */
function getComparisonPointsForMode(mode) {
  if (mode === "FTL") return FTL_COMPARISON_POINTS;
  if (mode === "Cargo Van / Box Truck") return CARGO_VAN_COMPARISON_POINTS;
  return LTL_COMPARISON_POINTS;
}

// ── Utilities ────────────────────────────────────────────────────────

/**
 * Escape HTML special characters to prevent XSS and ensure valid markup.
 * @param {string} s - Raw string to escape
 * @returns {string} HTML-safe string
 */
export function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** @param {number|*} n  @returns {string} */
function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : String(n ?? "N/A");
}

/** @param {string} location - e.g. "Dallas, TX"  @returns {string} city name */
function cityFrom(location) {
  return (location || "").split(",")[0].trim();
}

/** @param {string} location - e.g. "Dallas, TX"  @returns {string} state abbrev */
function stateFrom(location) {
  return (location || "").split(",")[1]?.trim() || "";
}

// ── Component Variation Engine ────────────────────────────────────────
// Deterministic, bounded variation tied to lane data for uniqueness at scale.
// Same lane always produces the same variation. No randomness.

/** Stable djb2 hash (same as lane-knowledge.js). */
function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Compute a lane variation profile — deterministic settings derived from
 * the lane slug that control visual and copy variation across pages.
 * @param {object} pageData
 * @returns {object} variation profile
 */
function computeVariation(pageData) {
  const slug = pageData.lane_slug || `${cityFrom(pageData.origin)}-to-${cityFrom(pageData.destination)}`;
  const hash = stableHash(slug);
  const dist = pageData.lane_stats?.estimated_distance_miles || 0;
  const mode = pageData.mode || "LTL";

  // Distance-based lane badge
  let badge = "regional";
  if (dist > 1200) badge = "long-haul";
  else if (dist > 800) badge = "interstate";
  else if (dist < 300) badge = "metro";

  // Deterministic KPI ordering variant (4 arrangements)
  const kpiVariant = hash % 4;

  // Comparison row ordering — first 5 always shown, last 4 shuffled by hash
  const extendedRowOrder = [5, 6, 7, 8]; // indices of the 4 new rows
  const sortedExtended = [...extendedRowOrder].sort((a, b) => {
    return ((hash + a * 7) % 13) - ((hash + b * 7) % 13);
  });

  // Section accent variant (which sections get green accent borders)
  const accentSections = hash % 3; // 0=hero+comparison, 1=hero+why-warp, 2=hero+pricing

  // Operational note variant
  const opNoteVariant = hash % 3; // picks from 3 operating note templates

  // Mode-specific badge icon
  const modeIcon = mode === "FTL" ? "\uD83D\uDE9A" : mode === "Cargo Van / Box Truck" ? "\uD83D\uDE90" : "\uD83D\uDCE6";

  return { badge, kpiVariant, sortedExtended, accentSections, opNoteVariant, modeIcon, hash };
}

// ── Digital Lane Map Hero ────────────────────────────────────────────

/**
 * Render the digital lane map hero — a premium, animated SVG-based
 * route visualization replacing the old video hero.
 *
 * Features:
 *   - Animated SVG route line between origin and destination nodes
 *   - KPI chips: miles, transit window, active carriers, tracking visibility
 *   - Dark premium Warp-compatible styling with inline CSS
 *   - No stock video, no generic hero, no placeholder media
 *   - Fully self-contained inline styles (Webflow CMS compatible)
 *
 * @param {object} pageData
 * @returns {string} HTML
 */
function renderDigitalLaneMapHero(pageData) {
  const oCity = cityFrom(pageData.origin);
  const dCity = cityFrom(pageData.destination);
  const oState = stateFrom(pageData.origin);
  const dState = stateFrom(pageData.destination);
  const mode = pageData.mode || "LTL";
  const ls = pageData.lane_stats || {};
  const np = pageData.network_proof || {};
  const variation = computeVariation(pageData);

  const dist = ls.estimated_distance_miles || 0;
  const transitMin = ls.estimated_transit_days_range?.min || 0;
  const transitMax = ls.estimated_transit_days_range?.max || 0;
  const carrierCount = np.estimated_carrier_count || 0;

  // KPI chips data — order varies by lane hash for uniqueness
  const allKpis = [
    { label: "DISTANCE", value: `${fmt(dist)} mi`, accent: false },
    { label: "TRANSIT", value: `${transitMin}\u2013${transitMax} days`, accent: false },
    { label: "CARRIERS", value: `${carrierCount} active`, accent: true },
    { label: "TRACKING", value: "Real-time", accent: true },
  ];
  const kpiOrders = [
    [0, 1, 2, 3], // default
    [2, 0, 1, 3], // carriers first
    [0, 2, 1, 3], // distance, carriers, transit, tracking
    [3, 0, 1, 2], // tracking first
  ];
  const kpis = kpiOrders[variation.kpiVariant].map(i => allKpis[i]);

  const kpiChipsHtml = kpis.map(k => {
    const borderColor = k.accent ? "rgba(0,255,51,0.3)" : "rgba(255,255,255,0.08)";
    const textColor = k.accent ? "#00ff33" : "#C0C7D4";
    return `<div style="border:1px solid ${borderColor};border-radius:8px;padding:8px 14px;display:inline-flex;flex-direction:column;gap:2px;background:rgba(18,20,24,0.8);">
      <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#8E97A6;font-weight:600;">${escHtml(k.label)}</span>
      <span style="font-size:14px;font-weight:700;color:${textColor};font-family:'Space Grotesk',-apple-system,sans-serif;">${escHtml(k.value)}</span>
    </div>`;
  }).join("\n");

  // SVG digital lane map
  const svgMap = `<svg viewBox="0 0 600 140" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-height:140px;" aria-label="${escHtml(oCity)} to ${escHtml(dCity)} freight route visualization">
  <defs>
    <linearGradient id="routeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00ff33" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#38BDF8" stop-opacity="0.9"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="gridFade" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="white" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Grid background -->
  <line x1="0" y1="35" x2="600" y2="35" stroke="rgba(255,255,255,0.03)" stroke-width="0.5"/>
  <line x1="0" y1="70" x2="600" y2="70" stroke="rgba(255,255,255,0.03)" stroke-width="0.5"/>
  <line x1="0" y1="105" x2="600" y2="105" stroke="rgba(255,255,255,0.03)" stroke-width="0.5"/>
  <line x1="100" y1="0" x2="100" y2="140" stroke="rgba(255,255,255,0.02)" stroke-width="0.5"/>
  <line x1="200" y1="0" x2="200" y2="140" stroke="rgba(255,255,255,0.02)" stroke-width="0.5"/>
  <line x1="300" y1="0" x2="300" y2="140" stroke="rgba(255,255,255,0.02)" stroke-width="0.5"/>
  <line x1="400" y1="0" x2="400" y2="140" stroke="rgba(255,255,255,0.02)" stroke-width="0.5"/>
  <line x1="500" y1="0" x2="500" y2="140" stroke="rgba(255,255,255,0.02)" stroke-width="0.5"/>

  <!-- Network nodes (ambient) -->
  <circle cx="150" cy="40" r="2" fill="rgba(255,255,255,0.06)"/>
  <circle cx="250" cy="95" r="2" fill="rgba(255,255,255,0.06)"/>
  <circle cx="350" cy="50" r="2" fill="rgba(255,255,255,0.06)"/>
  <circle cx="450" cy="100" r="2" fill="rgba(255,255,255,0.06)"/>
  <circle cx="200" cy="110" r="1.5" fill="rgba(255,255,255,0.04)"/>
  <circle cx="400" cy="35" r="1.5" fill="rgba(255,255,255,0.04)"/>

  <!-- Route line (animated dash) -->
  <path d="M 70 70 C 180 45, 420 95, 530 70" stroke="url(#routeGrad)" stroke-width="2.5" fill="none" stroke-dasharray="8 4" filter="url(#glow)">
    <animate attributeName="stroke-dashoffset" values="24;0" dur="2s" repeatCount="indefinite"/>
  </path>

  <!-- Origin node -->
  <circle cx="70" cy="70" r="8" fill="#00ff33" opacity="0.15"/>
  <circle cx="70" cy="70" r="5" fill="#00ff33" filter="url(#glow)"/>
  <text x="70" y="100" text-anchor="middle" fill="#00ff33" font-size="11" font-weight="600" font-family="'Space Grotesk',-apple-system,sans-serif">${escHtml(oCity)}</text>
  <text x="70" y="113" text-anchor="middle" fill="#8E97A6" font-size="9" font-family="'Space Grotesk',-apple-system,sans-serif">${escHtml(oState)}</text>

  <!-- Destination node -->
  <circle cx="530" cy="70" r="8" fill="#38BDF8" opacity="0.15"/>
  <circle cx="530" cy="70" r="5" fill="#38BDF8" filter="url(#glow)"/>
  <text x="530" y="100" text-anchor="middle" fill="#38BDF8" font-size="11" font-weight="600" font-family="'Space Grotesk',-apple-system,sans-serif">${escHtml(dCity)}</text>
  <text x="530" y="113" text-anchor="middle" fill="#8E97A6" font-size="9" font-family="'Space Grotesk',-apple-system,sans-serif">${escHtml(dState)}</text>

  <!-- Midpoint distance label -->
  <rect x="260" y="52" width="80" height="22" rx="4" fill="rgba(18,20,24,0.85)" stroke="rgba(255,255,255,0.08)" stroke-width="0.5"/>
  <text x="300" y="67" text-anchor="middle" fill="#C0C7D4" font-size="10" font-weight="600" font-family="'JetBrains Mono',monospace">${fmt(dist)} mi</text>
</svg>`;

  const hero = pageData.hero || {};
  const primaryCta = hero.primary_cta || { label: "Get Instant Quote", url: QUOTE_URL };
  const secondaryCta = hero.secondary_cta || { label: "Book a Fit Call", url: `${SITE_BASE}/book` };

  return `<div style="background:linear-gradient(180deg,#0B0C0E 0%,#121418 100%);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:32px 28px;position:relative;overflow:hidden;">
  <!-- Ambient glow -->
  <div style="position:absolute;top:-40%;left:-10%;width:400px;height:400px;border-radius:50%;background:radial-gradient(circle,rgba(0,255,51,0.06) 0%,transparent 60%);pointer-events:none;"></div>
  <div style="position:absolute;bottom:-40%;right:-10%;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(56,189,248,0.04) 0%,transparent 60%);pointer-events:none;"></div>

  <div style="position:relative;z-index:1;">
    <!-- Overline -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
      <span style="border:1px solid rgba(0,255,51,0.4);border-radius:8px;padding:4px 10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#00ff33;font-size:11px;">${escHtml(mode)}</span>
      <span style="text-transform:uppercase;letter-spacing:0.18em;color:#8E97A6;font-size:11px;font-weight:500;">Freight Lane</span>
      <span style="border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:4px 10px;text-transform:uppercase;letter-spacing:0.12em;color:#8E97A6;font-size:10px;font-weight:500;">${escHtml(variation.modeIcon)} ${escHtml(variation.badge)}</span>
    </div>

    <!-- Headline -->
    <h1 style="margin:0 0 8px;font-size:clamp(1.4rem,2.8vw,2rem);font-weight:700;color:#F5F7FA;line-height:1.2;font-family:'Space Grotesk',-apple-system,sans-serif;">${escHtml(oCity)}, ${escHtml(oState)} to ${escHtml(dCity)}, ${escHtml(dState)}</h1>
    <p style="margin:0 0 20px;color:#C0C7D4;font-size:15px;line-height:1.5;">Ship ${escHtml(mode)} freight on a ${fmt(dist)}-mile corridor with ${transitMin}\u2013${transitMax} day transit, ${carrierCount} vetted carriers, and real-time visibility from pickup to delivery.</p>

    <!-- Digital Lane Map -->
    <div style="margin:0 0 20px;border:1px solid rgba(255,255,255,0.06);border-radius:12px;background:rgba(11,12,14,0.6);padding:12px 16px;">
      ${svgMap}
    </div>

    <!-- KPI Chips -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px;">
      ${kpiChipsHtml}
    </div>

    <!-- CTAs -->
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <a href="${escHtml(primaryCta.url)}" style="display:inline-flex;align-items:center;justify-content:center;padding:12px 24px;background:#00ff33;color:#080E0B;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;border:1px solid rgba(0,255,51,0.7);font-family:'Space Grotesk',-apple-system,sans-serif;">${escHtml(primaryCta.label)}</a>
      <a href="${escHtml(secondaryCta.url)}" style="display:inline-flex;align-items:center;justify-content:center;padding:12px 24px;background:transparent;color:#F5F7FA;border-radius:10px;font-size:15px;font-weight:600;text-decoration:none;border:1px solid rgba(255,255,255,0.12);font-family:'Space Grotesk',-apple-system,sans-serif;">${escHtml(secondaryCta.label)}</a>
    </div>
  </div>
</div>`;
}

// ── Section Renderers (fixed order, never varies) ────────────────────

/**
 * Section 1 — Lane Overview (PREVIEW PIPELINE ONLY).
 *
 * DRIFT GUARD: This renderer is INTENTIONALLY independent from the live
 * pipeline's "Why This Corridor Matters" section (faq-schema Section 2).
 *
 * - PREVIEW: Plain semantic HTML (bare <h2>, <p>) — for static export/preview.
 * - LIVE: Styled dark card with data-point bullets — for Webflow Rich Text.
 *
 * Both read from the SAME canonical data (pageData.lane_overview) but render
 * in different visual contexts. If you change the DATA MODEL, update BOTH.
 * If you change STYLING, update only the relevant renderer.
 *
 * @param {object} pageData
 * @returns {string} HTML
 */
function renderLaneOverview(pageData) {
  const lo = pageData.lane_overview;
  if (!lo) return "";
  const oCity = cityFrom(pageData.origin);
  const dCity = cityFrom(pageData.destination);
  return [
    `<h2>${escHtml(lo.heading)}: ${escHtml(oCity)} to ${escHtml(dCity)}</h2>`,
    `<p>${escHtml(lo.body)}</p>`,
  ].join("\n");
}

/**
 * Section 2 — How WARP Operates This Lane.
 * @param {object} pageData
 * @returns {string} HTML
 */
function renderWarpFit(pageData) {
  const wf = pageData.warp_fit_for_lane;
  if (!wf) return "";
  const sentences = (wf.body || "").match(/[^.!?]+[.!?]+/g) || [wf.body];
  const intro = (sentences[0] || "").trim();
  const bullets = sentences.slice(1).map((s) => s.trim()).filter(Boolean);
  const parts = [`<h2>${escHtml(wf.heading)}</h2>`, `<p>${escHtml(intro)}</p>`];
  if (bullets.length > 0) {
    parts.push("<ul>");
    for (const b of bullets) parts.push(`<li>${escHtml(b)}</li>`);
    parts.push("</ul>");
  }
  return parts.join("\n");
}

/**
 * Section 3 — Transit and Operating Details (PREVIEW PIPELINE ONLY).
 *
 * DRIFT GUARD: This renderer is INTENTIONALLY independent from the live
 * pipeline's operating details section (faq-schema Section 4).
 *
 * - PREVIEW: Plain semantic HTML (<h2>, <ul>, <li>) — for static export/preview.
 * - LIVE: Styled dark card with pricing sub-section bundled in — for Webflow.
 *
 * Both read from the SAME canonical data (pageData.operating_details) but the
 * live version also bundles pageData.pricing_and_commercial_framing into the
 * same card. If you change the DATA MODEL, update BOTH.
 *
 * @param {object} pageData
 * @returns {string} HTML
 */
function renderOperatingDetails(pageData) {
  const od = pageData.operating_details;
  if (!od) return "";
  const parts = [
    `<h2>${escHtml(od.heading)}</h2>`,
    `<p>Key operational parameters for this lane:</p>`,
    "<ul>",
  ];
  for (const item of od.items || []) parts.push(`<li>${escHtml(item)}</li>`);
  parts.push("</ul>");
  return parts.join("\n");
}

/**
 * Section 4 — Pricing & Rate Factors.
 * @param {object} pageData
 * @returns {string} HTML
 */
function renderPricing(pageData) {
  const pc = pageData.pricing_and_commercial_framing;
  if (!pc) return "";
  const sentences = (pc.body || "").match(/[^.!?]+[.!?]+/g) || [pc.body];
  const rateParagraph = (sentences[0] || "").trim();
  const costFactors = sentences.slice(1, -1).map((s) => s.trim()).filter(Boolean);
  const disclaimer = (sentences[sentences.length - 1] || "").trim();
  const parts = [`<h2>${escHtml(pc.heading)}</h2>`, `<p>${escHtml(rateParagraph)}</p>`];
  if (costFactors.length > 0) {
    parts.push("<ul>");
    for (const cf of costFactors) parts.push(`<li>${escHtml(cf)}</li>`);
    parts.push("</ul>");
  }
  if (disclaimer) parts.push(`<p><em>${escHtml(disclaimer)}</em></p>`);
  return parts.join("\n");
}

// ── Comparison Table — Shared Renderer ──────────────────────────────
//
// CANONICAL OWNER of the HTML comparison table.
//
// This is the SOLE function that generates comparison table HTML markup.
// All render paths (static export, faq-schema embed) MUST call this
// function instead of independently generating table HTML. The plain-text
// comparison fields (traditional-ltl, warp-ltl) are a SEPARATE format
// for the legacy div-block-27 (CSS-hidden) and use buildTraditionalLtl/
// buildWarpLtl instead — those are not HTML tables.
//
// ARCHITECTURE RULE: If you need comparison table HTML anywhere,
// call renderComparisonTableHtml(). Do NOT copy-paste table generation.

/**
 * Render comparison table HTML — the single canonical table renderer.
 * Generates the <table> element with row ordering tied to lane variation.
 *
 * @param {object} pageData - Canonical page data
 * @param {object} [styleOverrides] - Optional style overrides for embedding context
 * @param {string} [styleOverrides.h2Style] - H2 inline style
 * @param {string} [styleOverrides.pStyle] - P inline style
 * @param {string} [styleOverrides.tableMargin] - Table wrapper margin
 * @returns {string} HTML string containing heading + table
 */
function renderComparisonTableHtml(pageData, styleOverrides = {}) {
  const oCity = cityFrom(pageData.origin);
  const dCity = cityFrom(pageData.destination);
  const mode = pageData.mode || "LTL";
  const variation = computeVariation(pageData);
  const points = getComparisonPointsForMode(mode);

  // Core 5 rows always in order, then 4 extended rows in lane-varied order
  const orderedPoints = [
    ...points.slice(0, 5),
    ...variation.sortedExtended.map(i => points[i]),
  ];

  const compRows = orderedPoints.map(p =>
    `<tr>
      <td style="padding:8px 6px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;font-weight:600;color:#F5F7FA;vertical-align:top;word-break:break-word;">${escHtml(p.metric)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:12px;color:#8E97A6;vertical-align:top;line-height:1.45;word-break:break-word;">${escHtml(p.traditional)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:12px;color:#00ff33;vertical-align:top;line-height:1.45;font-weight:500;word-break:break-word;">${escHtml(p.warp)}</td>
    </tr>`
  ).join("\n");

  const h2Style = styleOverrides.h2Style || "";
  const pStyle = styleOverrides.pStyle || "";
  const margin = styleOverrides.tableMargin || "16px 0";

  const h2Open = h2Style ? `<h2 style="${h2Style}">` : "<h2>";
  const pOpen = pStyle ? `<p style="${pStyle}">` : "<p>";

  return `${h2Open}Traditional ${escHtml(mode)} vs WARP: ${escHtml(oCity)} to ${escHtml(dCity)}</h2>
${pOpen}How WARP compares to traditional freight processes on this corridor:</p>
<div style="overflow-x:auto;margin:${margin};">
<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-family:'Space Grotesk',-apple-system,sans-serif;">
  <colgroup><col style="width:30%"><col style="width:35%"><col style="width:35%"></colgroup>
  <thead>
    <tr>
      <th style="padding:8px 6px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#8E97A6;font-weight:600;border-bottom:2px solid rgba(255,255,255,0.08);"></th>
      <th style="padding:8px 6px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#8E97A6;font-weight:600;border-bottom:2px solid rgba(255,255,255,0.08);">Traditional</th>
      <th style="padding:8px 6px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#00ff33;font-weight:600;border-bottom:2px solid rgba(0,255,51,0.2);">WARP</th>
    </tr>
  </thead>
  <tbody>
    ${compRows}
  </tbody>
</table>
</div>`;
}

/**
 * Section 5 — Traditional LTL vs WARP (structured comparison table).
 * Route-specific, clean, error-free. Delegates to renderComparisonTableHtml()
 * — the canonical comparison table owner.
 * @param {object} pageData
 * @returns {string} HTML
 */
function renderComparison(pageData) {
  return renderComparisonTableHtml(pageData);
}

/**
 * Section 6 — Best-Fit Shipments for This Lane.
 * Answers "when is WARP a good fit" for AI search retrieval.
 * @param {object} pageData
 * @returns {string} HTML
 */
function renderBestFitShipments(pageData) {
  const bf = pageData.best_fit_shipments;
  if (!bf) return "";
  const parts = [`<h2>${escHtml(bf.heading)}</h2>`, `<p>${escHtml(bf.intro)}</p>`];
  if (bf.items && bf.items.length > 0) {
    parts.push("<ul>");
    for (const item of bf.items) parts.push(`<li>${escHtml(item)}</li>`);
    parts.push("</ul>");
  }
  if (bf.cta_text) parts.push(`<p><strong>${escHtml(bf.cta_text)}</strong></p>`);
  return parts.join("\n");
}

/**
 * Section 7 — Validate This Lane. Generated from lane_stats + network_proof.
 * @param {object} pageData
 * @returns {string} HTML
 */
function renderValidation(pageData) {
  const ls = pageData.lane_stats || {};
  const np = pageData.network_proof || {};
  const oCity = cityFrom(pageData.origin);
  const dCity = cityFrom(pageData.destination);
  const mode = pageData.mode || "LTL";
  const dist = ls.estimated_distance_miles || 0;
  const transitMin = ls.estimated_transit_days_range?.min || 0;
  const transitMax = ls.estimated_transit_days_range?.max || 0;
  const carrierCount = np.estimated_carrier_count || 0;
  const crossDocks = np.nearest_cross_docks || [];
  const equipment = (ls.common_equipment || []).join(", ") || mode;

  // Mode-specific pilot framing
  let pilotFocus;
  if (mode === "FTL") {
    pilotFocus = "Measure capacity availability, GPS tracking accuracy, dispatch confirmation speed, and detention management against your current FTL process.";
  } else if (mode === "Cargo Van / Box Truck") {
    pilotFocus = "Compare vehicle matching accuracy, direct routing speed, and per-shipment cost against traditional options for this freight profile.";
  } else {
    pilotFocus = "Track cross-dock routing efficiency, pallet-level visibility, local pickup speed with right-sized vehicles, and exception handling quality against your current LTL process.";
  }

  // Structured proof data points
  const proofItems = [];
  if (dist) proofItems.push(`<strong>${fmt(dist)}</strong> miles verified corridor distance`);
  if (transitMin && transitMax) proofItems.push(`<strong>${transitMin}\u2013${transitMax}</strong> business day transit window`);
  if (carrierCount) proofItems.push(`<strong>${carrierCount}</strong> vetted carriers active on this lane`);
  if (crossDocks.length > 0) proofItems.push(`Cross-dock access at <strong>${escHtml(crossDocks.slice(0, 2).join(" and "))}</strong>`);
  proofItems.push(`<strong>${escHtml(equipment)}</strong> equipment available`);

  const proofListHtml = proofItems.map(item =>
    `<div style="display:flex;align-items:flex-start;gap:8px;padding:4px 0;font-size:14px;color:#C0C7D4;line-height:1.5;">
      <span style="color:#00ff33;flex-shrink:0;">\u25CF</span>
      <span>${item}</span>
    </div>`
  ).join("\n");

  return `<div style="background:#121418;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:28px 24px;color:#F5F7FA;">
  <h2 style="margin:0 0 12px;font-size:1.3rem;font-weight:700;color:#F5F7FA;font-family:'Space Grotesk',-apple-system,sans-serif;">Validate This Lane</h2>
  <p style="margin:0 0 16px;font-size:15px;color:#C0C7D4;line-height:1.6;">Test the ${escHtml(oCity)} to ${escHtml(dCity)} ${escHtml(mode)} corridor with a controlled pilot. ${pilotFocus}</p>
  ${proofListHtml}
  <p style="margin:16px 0 0;font-size:14px;color:#C0C7D4;line-height:1.6;">Start with a single shipment to benchmark WARP on this lane before scaling volume.</p>
</div>`;
}

/**
 * Section 8 — Related Freight Pages. Internal cross-links for SEO.
 * @param {object} pageData
 * @returns {string} HTML
 */
function renderRelatedLinks(pageData) {
  const related = pageData.related_links || pageData.related || {};
  const parts = [`<h2>Related Freight Pages</h2>`];

  // Corridor hub link
  if (related.corridor_hub) {
    parts.push(`<p><strong>Corridor:</strong> <a href="${SITE_BASE}${escHtml(related.corridor_hub)}">View corridor hub page</a></p>`);
  }

  // Metro hub links
  const metroLinks = related.metro_links || [];
  if (metroLinks.length > 0) {
    parts.push(`<p><strong>Metro hubs:</strong> ${metroLinks.map(m =>
      `<a href="${SITE_BASE}${escHtml(m.url)}">${escHtml(m.label)}</a>`
    ).join(" \u00B7 ")}</p>`);
  }

  // Guide link
  if (related.guide_link) {
    const mode = pageData.mode || "LTL";
    parts.push(`<p><strong>Guide:</strong> <a href="${SITE_BASE}${escHtml(related.guide_link)}">${escHtml(mode)} Shipping Guide</a></p>`);
  }

  // Related lanes
  const lanes = related.related_lanes || [];
  if (lanes.length > 0) {
    parts.push(`<h3>Related Lanes</h3>`);
    parts.push(`<ul>${lanes.map(l =>
      `<li><a href="${l.url.startsWith("http") ? escHtml(l.url) : SITE_BASE + escHtml(l.url)}">${escHtml(l.label)}</a></li>`
    ).join("")}</ul>`);
  }

  // Only render if we have more than just the heading
  if (parts.length <= 1) return "";
  return parts.join("\n");
}

// ── Why Warp Reason Cards — Shared Renderer ─────────────────────────
//
// CANONICAL OWNER of the Why-Warp reason cards grid HTML.
//
// This is the SOLE function that generates Why-Warp reason card markup.
// All render paths (static export, faq-schema embed) MUST call this
// function instead of independently generating reason card HTML.
//
// ARCHITECTURE RULE: If you need Why-Warp reason cards anywhere,
// call renderWhyWarpReasonCardsHtml(). Do NOT copy-paste card generation.

/**
 * Render Why-Warp reason cards HTML — the single canonical renderer.
 * Generates the heading + grid of reason cards.
 *
 * @param {object} pageData - Canonical page data
 * @param {object} [styleOverrides] - Optional style overrides for embedding context
 * @param {string} [styleOverrides.h2Style] - H2 inline style
 * @param {string} [styleOverrides.h3Style] - H3 inline style for reason cards
 * @param {string} [styleOverrides.gridMinWidth] - Grid column minmax width (default "280px")
 * @param {string} [styleOverrides.gridMargin] - Grid wrapper margin (default "16px 0")
 * @returns {string} HTML string containing heading + reason cards grid
 */
function renderWhyWarpReasonCardsHtml(pageData, styleOverrides = {}) {
  const ww = pageData.why_warp;
  if (!ww || !ww.reasons?.length) return "";

  const h3Style = styleOverrides.h3Style
    || "margin:0 0 8px;font-size:16px;font-weight:700;color:#F5F7FA;font-family:'Space Grotesk',-apple-system,sans-serif;";
  const h2Style = styleOverrides.h2Style || "";
  const gridMinWidth = styleOverrides.gridMinWidth || "280px";
  const gridMargin = styleOverrides.gridMargin || "16px 0";

  const reasonCards = ww.reasons.map(r =>
    `<div style="border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:20px;background:rgba(18,20,24,0.4);">
      <h3 style="${h3Style}">${escHtml(r.heading)}</h3>
      <p style="margin:0;font-size:14px;color:#C0C7D4;line-height:1.6;">${escHtml(r.body)}</p>
    </div>`
  ).join("\n");

  const h2Open = h2Style ? `<h2 style="${h2Style}">` : "<h2>";

  return `${h2Open}${escHtml(ww.heading)}</h2>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${gridMinWidth},1fr));gap:16px;${gridMargin ? `margin:${gridMargin};` : ""}">
${reasonCards}
</div>`;
}

/**
 * Section 9 — Why Shippers Choose WARP (NEW).
 * Lane-specific proof points replacing the generic marketing section.
 * Delegates to renderWhyWarpReasonCardsHtml() — the canonical reason cards owner.
 * @param {object} pageData
 * @returns {string} HTML
 */
function renderWhyWarp(pageData) {
  return renderWhyWarpReasonCardsHtml(pageData);
}

/**
 * Section 10 — Final Conversion CTA (NEW).
 * High-intent conversion block positioned after all content sections.
 * @param {object} pageData
 * @returns {string} HTML
 */
function renderFinalCta(pageData) {
  const fc = pageData.final_cta;
  if (!fc) return "";

  const trustHtml = (fc.trust_signals || []).map(s =>
    `<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#C0C7D4;">
      <span style="color:#00ff33;font-size:14px;">\u2714</span> ${escHtml(s)}
    </span>`
  ).join("\n");

  const primaryCta = fc.primary_cta || { label: "Get Instant Quote", url: QUOTE_URL };
  const secondaryCta = fc.secondary_cta || { label: "Talk to an Expert", url: `${SITE_BASE}/book` };

  return `<div style="background:linear-gradient(135deg,rgba(0,255,51,0.04) 0%,rgba(18,20,24,0.95) 40%);border:1px solid rgba(0,255,51,0.15);border-radius:16px;padding:32px 28px;margin:24px 0;text-align:center;">
  <h2 style="margin:0 0 12px;font-size:clamp(1.2rem,2.4vw,1.6rem);font-weight:700;color:#F5F7FA;font-family:'Space Grotesk',-apple-system,sans-serif;">${escHtml(fc.headline)}</h2>
  <p style="margin:0 0 20px;font-size:15px;color:#C0C7D4;line-height:1.6;max-width:600px;display:inline-block;">${escHtml(fc.body)}</p>
  <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:20px;">
    <a href="${escHtml(primaryCta.url)}" style="display:inline-flex;align-items:center;justify-content:center;padding:14px 28px;background:#00ff33;color:#080E0B;border-radius:10px;font-size:16px;font-weight:700;text-decoration:none;border:1px solid rgba(0,255,51,0.7);font-family:'Space Grotesk',-apple-system,sans-serif;">${escHtml(primaryCta.label)}</a>
    <a href="${escHtml(secondaryCta.url)}" style="display:inline-flex;align-items:center;justify-content:center;padding:14px 28px;background:transparent;color:#F5F7FA;border-radius:10px;font-size:16px;font-weight:600;text-decoration:none;border:1px solid rgba(255,255,255,0.15);font-family:'Space Grotesk',-apple-system,sans-serif;">${escHtml(secondaryCta.label)}</a>
  </div>
  <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
    ${trustHtml}
  </div>
</div>`;
}

// ── Body Renderer ────────────────────────────────────────────────────

/**
 * Render plain-text body content for a lane page (Webflow PlainText field).
 * Sections are referenced in fixed order. This plain-text version provides
 * a concise summary; the full HTML rendering is in renderLanePageHtml().
 *
 * @param {object} pageData - Canonical page data from buildCanonicalLanePageData
 * @returns {string} Plain text body content string for Webflow CMS
 */
export function renderLanePageBody(pageData) {
  // body-content is a Webflow PlainText field bound to Text Block 19.
  // PlainText fields entity-encode ALL HTML, so this MUST return clean plain
  // text — no HTML tags. Double line breaks (\n\n) create visual paragraph
  // separation in the rendered output.
  //
  // This is a BRIEF CLOSING SUMMARY. The primary content is carried by the
  // FAQ Schema Rich Text sections above (KPI strip, corridor, operations,
  // details grid, visibility, why WARP, FAQ, CTA). This field provides a
  // concise text-based overview for accessibility and SEO.
  const oCity = cityFrom(pageData.origin);
  const dCity = cityFrom(pageData.destination);
  const oState = stateFrom(pageData.origin);
  const dState = stateFrom(pageData.destination);
  const mode = pageData.mode || "LTL";
  const ls = pageData.lane_stats || {};
  const dist = ls.estimated_distance_miles || 0;
  const transit = ls.estimated_transit_days_range || {};
  const np = pageData.network_proof || {};
  const crossDocks = np.nearest_cross_docks || [];
  const carrierCount = np.estimated_carrier_count || 0;

  const paragraphs = [];

  // ── §1: Cross-dock routing summary ────────────────────────────────
  // Frame freight movement through WARP's cross-dock network model.
  const crossDockList = crossDocks.length > 0
    ? ` through cross-dock facilities at ${crossDocks.slice(0, 3).join(", ")}`
    : "";
  paragraphs.push(`WARP moves LTL freight from ${oCity}, ${oState} to ${dCity}, ${dState} — ${fmt(dist)} miles${crossDockList}. The routing model is origin pickup, cross-dock consolidation, linehaul between cross-docks, and final delivery. Local pickup and delivery may use cargo vans or box trucks before freight enters the cross-dock network, matching the right-sized vehicle to each segment. ${carrierCount} vetted carriers operate this corridor with ${transit.min}\u2013${transit.max} business day transit.`);

  // ── §2: Operational summary + CTA ─────────────────────────────────
  paragraphs.push(`Every shipment on this lane receives pallet-level tracking, managed appointment scheduling, and exception alerts within 30 minutes of any status change. WARP's operations team handles carrier coordination and resolution without requiring shipper follow-up. Get an instant LTL rate for the ${oCity} to ${dCity} lane at wearewarp.com/quote.`);

  return paragraphs.join("\n\n");
}

// ── Lane Intelligence Panel ──────────────────────────────────────────
/**
 * CANONICAL OWNER of structured lane KPI facts.
 *
 * This is the SOLE renderer for the KPI card grid (Lane Distance, Transit
 * Window, Active Carriers, Equipment, Cross-Docks, Tracking, Exception
 * Alerts, Delivery). No other renderer may generate this structured grid.
 *
 * Render a dedicated Lane Intelligence Panel — a compact KPI dashboard
 * that communicates the lane in seconds through structured operational
 * signals. Renders as a native CMS Rich Text field bound to its own
 * template element, placed directly under the hero.
 */
export function renderLaneIntelligencePanel(pageData) {
  const oCity = cityFrom(pageData.origin);
  const dCity = cityFrom(pageData.destination);
  const mode = pageData.mode || "LTL";
  const ls = pageData.lane_stats || {};
  const np = pageData.network_proof || {};
  const dist = ls.estimated_distance_miles || 0;
  const transitMin = ls.estimated_transit_days_range?.min || 0;
  const transitMax = ls.estimated_transit_days_range?.max || 0;
  const carrierCount = np.estimated_carrier_count || 0;
  const crossDocks = np.nearest_cross_docks || [];
  const equipment = (ls.common_equipment || []).join(", ") || mode;

  const CELL = "border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px 20px;background:rgba(18,20,24,0.4);";
  const LBL = "display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#8E97A6;font-weight:600;margin-bottom:4px;";
  const VAL = 'font-size:18px;font-weight:700;color:#F5F7FA;font-family:"Space Grotesk",-apple-system,sans-serif;';
  const VAL_G = 'font-size:18px;font-weight:700;color:#00ff33;font-family:"Space Grotesk",-apple-system,sans-serif;';

  const cells = [];
  if (dist) cells.push({ l: "Lane Distance", v: `${fmt(dist)} miles`, g: false });
  if (transitMin && transitMax) cells.push({ l: "Transit Window", v: `${transitMin}\u2013${transitMax} business days`, g: false });
  if (carrierCount) cells.push({ l: "Active Carriers", v: `${carrierCount} vetted`, g: true });
  if (equipment) cells.push({ l: "Equipment", v: equipment, g: false });
  if (crossDocks.length > 0) cells.push({ l: "Cross-Docks", v: crossDocks.slice(0, 3).join(", "), g: false });
  cells.push({ l: "Tracking", v: "Real-time milestone", g: true });
  cells.push({ l: "Exception Alerts", v: "Within 30 min", g: true });
  cells.push({ l: "Delivery", v: "Appointment-set", g: false });

  const gridHtml = cells.map(c =>
    `<div style="${CELL}"><span style="${LBL}">${escHtml(c.l)}</span><span style="${c.g ? VAL_G : VAL}">${escHtml(c.v)}</span></div>`
  ).join("\n");

  return `<div style="background:#121418;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:32px 28px;margin:0 0 28px;">
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;">
    ${gridHtml}
  </div>
  <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;">
    <a href="${QUOTE_URL}" style="display:inline-flex;align-items:center;padding:12px 24px;background:#00ff33;color:#080E0B;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;font-family:'Space Grotesk',-apple-system,sans-serif;">Get ${escHtml(mode)} Rate \u2192</a>
    <a href="${SITE_BASE}/book" style="display:inline-flex;align-items:center;padding:12px 24px;background:transparent;color:#F5F7FA;border:1px solid rgba(255,255,255,0.12);border-radius:10px;font-size:15px;font-weight:600;text-decoration:none;font-family:'Space Grotesk',-apple-system,sans-serif;">Talk to WARP</a>
  </div>
</div>`;
}

// ── Execution Flow Diagram ───────────────────────────────────────────
/**
 * Render a dedicated Freight Execution Flow Diagram — a step-by-step
 * visual explanation of how freight moves through WARP's LTL network
 * on this specific lane. Each stage shows the routing decision, vehicle,
 * and operational detail.
 *
 * Renders as a native CMS Rich Text field bound to its own template element.
 */
export function renderExecutionFlow(pageData) {
  const oCity = cityFrom(pageData.origin);
  const dCity = cityFrom(pageData.destination);
  const mode = pageData.mode || "LTL";
  const np = pageData.network_proof || {};
  const crossDocks = np.nearest_cross_docks || [];
  const ls = pageData.lane_stats || {};
  const dist = ls.estimated_distance_miles || 0;
  const transitMin = ls.estimated_transit_days_range?.min || 0;
  const transitMax = ls.estimated_transit_days_range?.max || 0;

  const H2 = 'margin:0 0 16px;font-size:clamp(1.2rem,2.4vw,1.6rem);font-weight:700;color:#F5F7FA;font-family:"Space Grotesk",-apple-system,sans-serif;line-height:1.25;';
  const P = "margin:0 0 20px;font-size:15px;color:#C0C7D4;line-height:1.7;";

  // Build 5-stage execution flow
  const stages = [];

  // Stage 1: Pickup
  stages.push({
    num: "1",
    label: "Origin Pickup",
    city: oCity,
    detail: "Cargo van, box truck, or trailer dispatched — right-sized to the shipment and pickup location.",
    accent: true,
  });

  // Stage 2: Origin Cross-Dock
  if (crossDocks.length > 0) {
    stages.push({
      num: "2",
      label: "Cross-Dock Consolidation",
      city: crossDocks[0],
      detail: `Freight consolidated and sorted for linehaul at ${escHtml(crossDocks[0])}. Pallets staged for optimized truck loading.`,
      accent: false,
    });
  } else {
    stages.push({
      num: "2",
      label: "Cross-Dock Consolidation",
      city: "Network facility",
      detail: "Freight consolidated and sorted for linehaul. Pallets staged for optimized truck loading.",
      accent: false,
    });
  }

  // Stage 3: Linehaul
  const distNote = dist ? ` across ${fmt(dist)} miles` : "";
  stages.push({
    num: "3",
    label: "Linehaul Movement",
    city: `${oCity} \u2192 ${dCity}`,
    detail: `Optimized routing between cross-docks${distNote}. Real-time tracking with milestone updates at every checkpoint.`,
    accent: false,
  });

  // Stage 4: Destination Cross-Dock
  if (crossDocks.length > 1) {
    stages.push({
      num: "4",
      label: "Destination Cross-Dock",
      city: crossDocks[crossDocks.length > 2 ? 1 : crossDocks.length - 1],
      detail: `De-consolidation and final-mile staging at ${escHtml(crossDocks[1] || crossDocks[0])}. Delivery scheduled with appointment coordination.`,
      accent: false,
    });
  } else {
    stages.push({
      num: "4",
      label: "Destination Cross-Dock",
      city: "Network facility",
      detail: "De-consolidation and final-mile staging. Delivery scheduled with appointment coordination.",
      accent: false,
    });
  }

  // Stage 5: Final Delivery
  stages.push({
    num: "5",
    label: "Final Delivery",
    city: dCity,
    detail: "Managed delivery with appointment scheduling, photo documentation, and real-time exception alerts within 30 minutes.",
    accent: true,
  });

  // Render stages as vertical timeline
  const stageHtml = stages.map((s, i) => {
    const isLast = i === stages.length - 1;
    const borderColor = s.accent ? "#00ff33" : "rgba(0,255,51,0.25)";
    const bgColor = s.accent ? "rgba(0,255,51,0.03)" : "transparent";
    const badgeBg = s.accent ? "#00ff33" : "rgba(255,255,255,0.08)";
    const badgeColor = s.accent ? "#0B0C0E" : "#C0C7D4";
    const borderBottom = isLast ? "border-radius:4px 4px 12px 12px;" : "";
    const borderTop = i === 0 ? "border-radius:12px 12px 4px 4px;" : "";

    return `<div style="display:flex;gap:16px;padding:18px 20px;border-left:3px solid ${borderColor};background:${bgColor};${borderTop}${borderBottom}">
      <div style="flex-shrink:0;width:32px;height:32px;border-radius:50%;background:${badgeBg};display:flex;align-items:center;justify-content:center;font-weight:700;color:${badgeColor};font-size:14px;font-family:'Space Grotesk',-apple-system,sans-serif;">${s.num}</div>
      <div>
        <div style="font-weight:700;color:#F5F7FA;font-size:15px;font-family:'Space Grotesk',-apple-system,sans-serif;margin-bottom:2px;">${escHtml(s.label)}</div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#8E97A6;font-weight:600;margin-bottom:6px;">${escHtml(s.city)}</div>
        <div style="font-size:13px;color:#C0C7D4;line-height:1.6;">${s.detail}</div>
      </div>
    </div>`;
  }).join("\n");

  const transitNote = (transitMin && transitMax)
    ? `<div style="margin-top:16px;padding:12px 16px;border:1px solid rgba(0,255,51,0.15);border-radius:8px;background:rgba(0,255,51,0.03);display:flex;align-items:center;gap:10px;">
        <span style="color:#00ff33;font-size:14px;font-weight:700;">\u23F1</span>
        <span style="font-size:13px;color:#C0C7D4;">End-to-end transit: <strong style="color:#F5F7FA;">${transitMin}\u2013${transitMax} business days</strong> with exception alerts within 30 minutes of any status change.</span>
      </div>`
    : "";

  return `<div style="background:#121418;border:1px solid rgba(0,255,51,0.08);border-radius:16px;padding:32px 28px;margin:0 0 28px;">
  <h2 style="${H2}">How Freight Moves: ${escHtml(oCity)} to ${escHtml(dCity)}</h2>
  <p style="${P}">WARP\u2019s cross-dock routing model for LTL freight on this ${fmt(dist)}-mile corridor:</p>
  <div style="display:flex;flex-direction:column;gap:2px;">
    ${stageHtml}
  </div>
  ${transitNote}
</div>`;
}

/**
 * Render the full HTML for a lane page (13 sections in controlled order).
 * Used for static export, preview, and non-Webflow rendering.
 * NOT suitable for Webflow body-content (which is PlainText).
 *
 * Section order (matches user spec):
 *   1. Header (template-owned)
 *   2. Lane Map Hero (digital SVG route + KPIs + lane badge)
 *   3. Lane Overview
 *   4. How WARP Runs This Lane
 *   5. Transit and Operating Details
 *   6. Pricing Factors
 *   7. Traditional vs WARP (9-dimension comparison table)
 *   8. Best-Fit Shipments
 *   9. Validate with Pilot
 *  10. Related Freight Pages
 *  11. Why Shippers Choose WARP (NEW)
 *  12. Final Conversion Section (NEW)
 *  13. Footer (template-owned)
 *
 * @param {object} pageData - Canonical page data from buildCanonicalLanePageData
 * @returns {string} Full HTML body string
 */
export function renderLanePageHtml(pageData) {
  return [
    renderDigitalLaneMapHero(pageData),   // 2. Hero
    renderLaneOverview(pageData),          // 3. Lane Overview
    renderWarpFit(pageData),              // 4. How WARP Runs This Lane
    renderOperatingDetails(pageData),      // 5. Transit & Operating Details
    renderPricing(pageData),              // 6. Pricing Factors
    renderComparison(pageData),            // 7. Traditional vs WARP
    renderBestFitShipments(pageData),      // 8. Best-Fit Shipments
    renderValidation(pageData),           // 9. Validate with Pilot
    renderRelatedLinks(pageData),          // 10. Related Freight Pages
    renderWhyWarp(pageData),              // 11. Why Shippers Choose WARP
    renderFinalCta(pageData),             // 12. Final Conversion CTA
  ].filter(Boolean).join("\n\n");
}

// ── Inline Helpers (embedded in body-content) ────────────────────────

/**
 * Render FAQ HTML (<details>/<summary>) for inline embedding in body-content.
 * This is separate from the JSON-LD schema — it provides the visible FAQ section.
 *
 * DRIFT GUARD: This renderer is INTENTIONALLY independent from the live
 * pipeline's FAQ section (faq-schema Section 7).
 *
 * - PREVIEW: Native <details>/<summary> accordion — for static export/preview.
 * - LIVE: Styled alternating-color card blocks — for Webflow premium theme.
 *
 * Both read from the SAME canonical data (pageData.lane_specific_faqs).
 * The QUESTIONS AND ANSWERS must be identical; only the PRESENTATION differs.
 * If you change FAQ data, update the data source (lane-page-schema.js), not
 * these renderers.
 */
function renderInlineFaqHtml(pageData) {
  const faqs = pageData.lane_specific_faqs || [];
  if (faqs.length === 0) return "";
  const items = faqs.map(f =>
    `<details>\n<summary>${escHtml(f.question)}</summary>\n<p>${escHtml(f.answer)}</p>\n</details>`
  ).join("\n");
  return `<h2>Frequently Asked Questions</h2>\n${items}`;
}

// ── Lane Schema Objects — Shared Builder ─────────────────────────────
//
// CANONICAL OWNER of structured data schema objects for lane pages.
//
// This is the SOLE function that builds the JSON-LD schema objects
// (BreadcrumbList, Service, Organization, FAQPage) for a lane page.
// All render paths (renderBreadcrumbSchemaEmbed, renderInlineSchemas)
// MUST call this function instead of independently constructing schemas.
//
// ARCHITECTURE RULE: If you need lane page schema objects anywhere,
// call buildLaneSchemaObjects(). Do NOT duplicate schema construction.

/**
 * Build the canonical JSON-LD schema objects for a lane page.
 * Returns plain objects — callers are responsible for serialization.
 *
 * @param {object} pageData - Canonical page data from buildCanonicalLanePageData
 * @returns {{ breadcrumb: object, service: object, org: object, faqPage: object|null }}
 */
function buildLaneSchemaObjects(pageData) {
  const oCity = cityFrom(pageData.origin);
  const dCity = cityFrom(pageData.destination);
  const mode = pageData.mode || "LTL";
  const canonicalUrl = `${SITE_BASE}${pageData.canonical_path || ""}`;
  const modeGuideUrl = `${SITE_BASE}/guides/${mode.toLowerCase()}`;
  const related = pageData.related_links || pageData.related || {};

  // BreadcrumbList: WARP > Mode Guide > [Corridor] > Lane Page
  const breadItems = [
    { "@type": "ListItem", position: 1, name: "WARP", item: SITE_BASE },
    { "@type": "ListItem", position: 2, name: `${mode} Freight`, item: modeGuideUrl },
  ];
  let pos = 3;
  if (related.corridor_hub) {
    breadItems.push({ "@type": "ListItem", position: pos++, name: pageData.corridor_name || "Corridor", item: `${SITE_BASE}${related.corridor_hub}` });
  }
  breadItems.push({ "@type": "ListItem", position: pos, name: `${oCity} to ${dCity}`, item: canonicalUrl });

  const breadcrumb = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: breadItems,
  };

  // Service
  const service = {
    "@context": "https://schema.org", "@type": "Service",
    name: `${mode} Freight Service \u2014 ${oCity} to ${dCity}`,
    provider: { "@type": "Organization", name: "WARP" },
    areaServed: [pageData.origin, pageData.destination],
    description: `${mode} freight shipping service from ${oCity} to ${dCity} with lane-specific quoting and performance tracking.`,
  };

  // Organization
  const org = {
    "@context": "https://schema.org", "@type": "Organization",
    name: "WARP", url: SITE_BASE,
    description: "Technology-driven freight logistics platform",
  };

  // FAQPage
  const faqs = pageData.lane_specific_faqs || [];
  const faqPage = faqs.length > 0 ? {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(f => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  } : null;

  return { breadcrumb, service, org, faqPage };
}

/**
 * Render JSON-LD structured data schemas for inline embedding in body-content.
 * Delegates to buildLaneSchemaObjects() for schema construction.
 * Includes FAQPage, BreadcrumbList, Service, and Organization schemas.
 * Placed at the end of body-content so they don't interfere with visible layout.
 */
function renderInlineSchemas(pageData) {
  const { breadcrumb, service, org, faqPage } = buildLaneSchemaObjects(pageData);
  const parts = [];

  if (faqPage) {
    parts.push(`<script type="application/ld+json">${JSON.stringify(faqPage)}</script>`);
  }
  parts.push(`<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>`);
  parts.push(`<script type="application/ld+json">${JSON.stringify(service)}</script>`);
  parts.push(`<script type="application/ld+json">${JSON.stringify(org)}</script>`);

  return parts.join("\n");
}

// ── FAQ Schema Embed ─────────────────────────────────────────────────

/**
 * Render the faq-schema rich content embed — the primary content vehicle for
 * lane pages in Webflow. Contains all visible content sections with full inline
 * styles for the dark premium theme, plus FAQPage JSON-LD structured data.
 *
 * Sections (in order):
 *   1. CSS — LANE_PAGE_MODE_CSS for template-level dark theme
 *   2. Why This Corridor Matters — lane overview with key data points
 *   3. [DEDICATED] Freight Execution Flow — dedicated component, NOT in this embed
 *   4. Operating Details — PROSE bullets + pricing (NO KPI card grid)
 *   5. Shipment Visibility & Network Proof — proof points + best-fit
 *   6. Why Shippers Choose WARP — reason cards grid
 *   7. FAQ — styled Q&A blocks
 *   8. Final CTA — gradient conversion block with trust signals
 *   9. FAQPage JSON-LD structured data
 *
 * ARCHITECTURE RULES:
 * - KPI card grid is EXCLUSIVELY owned by renderLaneIntelligencePanel()
 * - Freight Execution Flow is EXCLUSIVELY owned by renderExecutionFlow()
 * - This function renders PROSE ONLY for operating details (no structured cards)
 * - Comparison table HTML is generated by renderComparisonTableHtml() (shared)
 *   — this embed CALLS that function, it does NOT independently generate table HTML
 * - Legacy plain-text comparison (traditional-ltl, warp-ltl) is a SEPARATE format
 *   for div-block-27 (CSS-hidden) — NOT an HTML table
 *
 * Every element uses full inline styles so content renders correctly
 * regardless of whether <style> tags are preserved by Webflow Rich Text.
 *
 * @param {object} pageData - Canonical page data from buildCanonicalLanePageData
 * @returns {string} Rich HTML string for the faq-schema CMS field
 */
export function renderFaqSchemaEmbed(pageData) {
  const oCity = cityFrom(pageData.origin);
  const dCity = cityFrom(pageData.destination);
  const oState = stateFrom(pageData.origin);
  const dState = stateFrom(pageData.destination);
  const mode = pageData.mode || "LTL";
  const ls = pageData.lane_stats || {};
  const np = pageData.network_proof || {};
  const dist = ls.estimated_distance_miles || 0;
  const transitMin = ls.estimated_transit_days_range?.min || 0;
  const transitMax = ls.estimated_transit_days_range?.max || 0;
  const carrierCount = np.estimated_carrier_count || 0;
  const crossDocks = np.nearest_cross_docks || [];
  const equipment = (ls.common_equipment || []).join(", ") || mode;

  // Inline style tokens — dark premium theme
  const CARD = "background:#121418;border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:32px 28px;margin:0 0 28px;";
  const CARD_ACCENT = "background:#121418;border:1px solid rgba(0,255,51,0.12);border-radius:16px;padding:32px 28px;margin:0 0 28px;";
  const H2 = 'margin:0 0 16px;font-size:clamp(1.2rem,2.4vw,1.6rem);font-weight:700;color:#F5F7FA;font-family:"Space Grotesk",-apple-system,sans-serif;line-height:1.25;';
  const H3 = 'margin:0 0 8px;font-size:16px;font-weight:700;color:#F5F7FA;font-family:"Space Grotesk",-apple-system,sans-serif;';
  const P = "margin:0 0 16px;font-size:15px;color:#C0C7D4;line-height:1.7;";
  // NOTE: GRID_CELL, LABEL, VAL, VAL_GREEN constants were removed.
  // KPI card grid rendering is EXCLUSIVELY owned by renderLaneIntelligencePanel().
  // This function must NEVER render structured KPI cards. Prose only.
  const CHECK = "color:#00ff33;margin-right:8px;";
  const BULLET = "margin:0 0 10px;font-size:14px;color:#C0C7D4;line-height:1.6;list-style:none;padding-left:0;";

  const parts = [];

  // NOTE: CSS is delivered by lane-page-mode.html (site-level custom code).
  // We do NOT embed <style> tags here — Webflow Rich Text strips them.
  // All sections below use full inline styles as the primary styling mechanism.

  // ── Section 1: Lane Intelligence Panel — NOW A DEDICATED COMPONENT ──
  // Removed from faq-schema. Content lives in its own CMS field
  // (lane-intelligence-panel) bound to a dedicated .lane-intel-rt element.

  // ── Section 2: Why This Corridor Matters ────────────────────────────
  // DRIFT GUARD: Preview pipeline has renderLaneOverview() (plain HTML).
  // Both share pageData.lane_overview data. If DATA changes, update both.
  {
    const lo = pageData.lane_overview;
    if (lo) {
      const bullets = [];
      if (dist) bullets.push(`${fmt(dist)}-mile corridor connecting ${escHtml(np.origin_region || "origin")} and ${escHtml(np.destination_region || "destination")} regions`);
      if (transitMin && transitMax) bullets.push(`${transitMin}\u2013${transitMax} business day standard transit for ${escHtml(mode)} service`);
      if (carrierCount) bullets.push(`${carrierCount} vetted carriers with ${escHtml(equipment)} capacity`);
      if (crossDocks.length > 0) bullets.push(`Cross-dock access at ${escHtml(crossDocks.slice(0, 3).join(", "))}`);
      if (ls.seasonality_notes) bullets.push(escHtml(ls.seasonality_notes));

      const bulletHtml = bullets.map(b =>
        `<li style="${BULLET}"><span style="${CHECK}">\u25B8</span> ${b}</li>`
      ).join("\n");

      parts.push(`<div style="${CARD}">
  <h2 style="${H2}">Why the ${escHtml(oCity)} to ${escHtml(dCity)} Corridor Matters</h2>
  <p style="${P}">${escHtml(lo.body)}</p>
  ${bullets.length > 0 ? `<ul style="margin:0;padding:0;list-style:none;">\n${bulletHtml}\n</ul>` : ""}
</div>`);
    }
  }

  // ── Section 3: Freight Execution Flow — NOW A DEDICATED COMPONENT ──
  // Removed from faq-schema. Content lives in its own CMS field
  // (execution-flow) bound to a dedicated .exec-flow-rt element.

  // ── Section 4: Mode-Specific Operating Detail (PROSE ONLY) ─────────
  // NOTE: Structured KPI card grid is EXCLUSIVELY owned by the dedicated
  // Lane Intelligence Panel (renderLaneIntelligencePanel). This section
  // renders operating details as PROSE BULLET ITEMS to avoid duplication.
  // See: ARCHITECTURE RULE — KPI facts have ONE canonical render owner.
  //
  // DRIFT GUARD: Preview pipeline has renderOperatingDetails() (plain HTML)
  // and renderPricing() (separate section). This live version bundles both
  // into one card. Both share pageData.operating_details and
  // pageData.pricing_and_commercial_framing data.
  {
    const od = pageData.operating_details;
    const odItems = od?.items || [];

    const odBullets = odItems.map(item =>
      `<li style="${BULLET}"><span style="${CHECK}">\u25B8</span> ${escHtml(item)}</li>`
    ).join("\n");

    // Pricing sub-section
    const pc = pageData.pricing_and_commercial_framing;
    let pricingHtml = "";
    if (pc) {
      pricingHtml = `<div style="margin-top:24px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.06);">
      <h3 style="${H3}">${escHtml(pc.heading)}</h3>
      <p style="margin:0;font-size:14px;color:#C0C7D4;line-height:1.7;">${escHtml(pc.body)}</p>
    </div>`;
    }

    parts.push(`<div style="${CARD}">
  <h2 style="${H2}">${escHtml(od?.heading || `Transit and Operating Details`)}</h2>
  ${odBullets.length > 0 ? `<ul style="margin:0;padding:0;list-style:none;">\n${odBullets}\n</ul>` : ""}
  ${pricingHtml}
</div>`);
  }

  // ── Section 5: Shipment Visibility & Network Proof ──────────────────
  {
    const proofPoints = [];
    if (dist) proofPoints.push(`${fmt(dist)}-mile verified corridor`);
    if (transitMin && transitMax) proofPoints.push(`${transitMin}\u2013${transitMax} day transit window`);
    if (carrierCount) proofPoints.push(`${carrierCount} vetted carriers active`);
    if (crossDocks.length > 0) proofPoints.push(`Cross-dock infrastructure at ${crossDocks.slice(0, 2).join(" and ")}`);
    proofPoints.push("Real-time tracking with scan events at every milestone");
    proofPoints.push("Exception alerts within 30 minutes of status changes");
    proofPoints.push("Delivery appointment scheduling managed by WARP operations");

    const proofHtml = proofPoints.map(pp =>
      `<div style="display:flex;align-items:flex-start;gap:10px;padding:6px 0;">
        <span style="color:#00ff33;font-size:14px;line-height:1.4;flex-shrink:0;">\u25CF</span>
        <span style="font-size:14px;color:#C0C7D4;line-height:1.5;">${escHtml(pp)}</span>
      </div>`
    ).join("\n");

    // Best-fit sub-section
    const bf = pageData.best_fit_shipments;
    let bfHtml = "";
    if (bf && bf.items?.length > 0) {
      const bfItems = bf.items.map(item =>
        `<li style="${BULLET}"><span style="${CHECK}">\u25B8</span> ${escHtml(item)}</li>`
      ).join("\n");
      bfHtml = `<div style="margin-top:24px;padding-top:24px;border-top:1px solid rgba(255,255,255,0.06);">
      <h3 style="${H3}">${escHtml(bf.heading)}</h3>
      <p style="${P}">${escHtml(bf.intro)}</p>
      <ul style="margin:0;padding:0;list-style:none;">\n${bfItems}\n</ul>
    </div>`;
    }

    parts.push(`<div style="${CARD}">
  <h2 style="${H2}">Shipment Visibility and Network Proof</h2>
  <p style="${P}">Operational proof points for the ${escHtml(oCity)} to ${escHtml(dCity)} ${escHtml(mode)} lane:</p>
  ${proofHtml}
  ${bfHtml}
</div>`);
  }

  // ── Section 6: Why Shippers Choose WARP ─────────────────────────────
  // DELEGATES to renderWhyWarpReasonCardsHtml() — the SOLE canonical owner
  // of Why-Warp reason card HTML generation. This section wraps the shared
  // renderer output in a dark card container for faq-schema styling.
  {
    const whyWarpHtml = renderWhyWarpReasonCardsHtml(pageData, {
      h2Style: H2,
      h3Style: H3,
      gridMinWidth: "260px",
      gridMargin: "",
    });
    if (whyWarpHtml) {
      parts.push(`<div style="${CARD}">\n${whyWarpHtml}\n</div>`);
    }
  }

  // ── Section 7: Frequently Asked Questions ───────────────────────────
  {
    const faqs = pageData.lane_specific_faqs || [];
    if (faqs.length > 0) {
      const faqItems = faqs.map((f, i) =>
        `<div style="border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:20px 24px;margin:0 0 10px;background:${i % 2 === 0 ? "rgba(18,20,24,0.4)" : "rgba(18,20,24,0.6)"};">
          <h3 style="margin:0 0 10px;font-size:15px;font-weight:600;color:#F5F7FA;font-family:'Space Grotesk',-apple-system,sans-serif;">${escHtml(f.question)}</h3>
          <p style="margin:0;font-size:14px;color:#C0C7D4;line-height:1.7;">${escHtml(f.answer)}</p>
        </div>`
      ).join("\n");

      parts.push(`<div style="${CARD}">
  <h2 style="${H2}">Frequently Asked Questions: ${escHtml(oCity)} to ${escHtml(dCity)} ${escHtml(mode)}</h2>
  ${faqItems}
</div>`);
    }
  }

  // ── Section 8: Final CTA ────────────────────────────────────────────
  {
    const ctaHtml = renderFinalCta(pageData);
    if (ctaHtml) parts.push(ctaHtml);
  }

  // ── Section 9: Comparison Table (Traditional vs WARP) ────────────────
  // DELEGATES to renderComparisonTableHtml() — the SOLE canonical owner
  // of comparison table HTML generation. This section wraps the shared
  // renderer output in a dark card container for faq-schema styling.
  //
  // NOTE: The legacy div-block-27 plain-text comparison (traditional-ltl,
  // warp-ltl fields) is a SEPARATE format. It remains populated for
  // backward compatibility but div-block-27 is CSS-hidden.
  {
    const compTableHtml = renderComparisonTableHtml(pageData, {
      h2Style: H2,
      pStyle: P,
      tableMargin: "0",
    });
    parts.push(`<div style="${CARD}">\n${compTableHtml}\n</div>`);
  }

  // NOTE: FAQPage JSON-LD has been moved to renderBreadcrumbSchemaEmbed()
  // so it's not stripped by Webflow Rich Text rendering. breadcrumb-schema
  // is bound to a Code Embed element which preserves <script> tags.

  // ── ARCHITECTURE GUARD: KPI card grid must NEVER appear in this embed ──
  // The Lane Intelligence Panel (renderLaneIntelligencePanel) is the SOLE
  // owner of structured KPI card facts. If KPI grid patterns leak back into
  // this embed, it means someone reintroduced duplicate generation.
  const allSections = parts.filter(Boolean).join("\n\n");
  const KPI_CARD_LABELS = ["Lane Distance", "Transit Window", "Active Carriers"];
  const kpiGridPattern = /grid-template-columns:repeat\(auto-fit,minmax\(1[68]0px/;
  for (const label of KPI_CARD_LABELS) {
    // Only flag if the label appears in a KPI card context (inside a styled grid cell)
    // Prose mentions like "Lane distance: 474 miles" are fine.
    const cardPattern = new RegExp(`<div[^>]*border-radius:12px;padding:16px[^>]*>[^<]*${label}`);
    if (cardPattern.test(allSections)) {
      console.error(`[ARCHITECTURE VIOLATION] KPI card "${label}" found inside faq-schema embed. ` +
        `KPI cards are exclusively owned by renderLaneIntelligencePanel(). ` +
        `Remove the card grid from renderFaqSchemaEmbed() Section 4.`);
    }
  }
  if (kpiGridPattern.test(allSections)) {
    console.error(`[ARCHITECTURE VIOLATION] KPI grid layout pattern found inside faq-schema embed. ` +
      `Structured KPI grids belong in renderLaneIntelligencePanel() only.`);
  }

  // ── ARCHITECTURE GUARD: Structural section count ──────────────────
  // faq-schema currently holds 7 structural sections (corridor overview,
  // operating details, visibility/proof, why-warp reasons, FAQ, CTA,
  // comparison). If the count grows beyond 7, someone is adding structural
  // content that should be a dedicated component or CMS field instead.
  const sectionCount = parts.filter(Boolean).length;
  if (sectionCount > 7) {
    console.error(`[ARCHITECTURE WARNING] faq-schema embed contains ${sectionCount} structural sections ` +
      `(expected ≤7). New structural content should be a dedicated CMS field, not added to faq-schema. ` +
      `Current sections: corridor overview, operating details, visibility/proof, why-warp, FAQ, CTA, comparison.`);
  }

  // ── ARCHITECTURE GUARD: No duplicate comparison table generation ──
  // The comparison table HTML must be generated by renderComparisonTableHtml()
  // only. If someone independently generates a comparison table in this
  // embed (copy-pasting table/tr/td generation), flag it.
  const compTableCount = (allSections.match(/Traditional.*?vs WARP/g) || []).length;
  if (compTableCount > 1) {
    console.error(`[ARCHITECTURE VIOLATION] Multiple comparison tables found in faq-schema embed ` +
      `(found ${compTableCount}). Comparison HTML must be generated by renderComparisonTableHtml() only.`);
  }

  // Wrap all sections in an outer container for visual continuity
  return `<div style="background:#0B0C0E;padding:24px 0;margin:32px 0 0;">
${allSections}
</div>`;
}

// ── Breadcrumb Schema Embed ──────────────────────────────────────────

/**
 * Render the breadcrumb-schema code embed with BreadcrumbList, Service,
 * Organization, and FAQPage JSON-LD. Delegates to buildLaneSchemaObjects()
 * — the canonical schema data builder — for schema construction.
 *
 * Breadcrumb: WARP -> mode guide -> [corridor] -> lane page.
 *
 * @param {object} pageData - Canonical page data
 * @returns {string} Code embed HTML string
 */
export function renderBreadcrumbSchemaEmbed(pageData) {
  const { breadcrumb, service, org, faqPage } = buildLaneSchemaObjects(pageData);

  const scripts = [
    `<script type="application/ld+json">${JSON.stringify(breadcrumb, null, 2)}</script>`,
    `<script type="application/ld+json">${JSON.stringify(service, null, 2)}</script>`,
    `<script type="application/ld+json">${JSON.stringify(org, null, 2)}</script>`,
  ];

  if (faqPage) {
    scripts.push(`<script type="application/ld+json">${JSON.stringify(faqPage)}</script>`);
  }

  return scripts.join("\n");
}

// ── Webflow Field Mapper ─────────────────────────────────────────────

// ── Legacy Comparison Fields ─────────────────────────────────────────
//
// LEGACY FIELD STATUS:
//
// | Field            | Status                    | Template Element | Notes                          |
// |------------------|---------------------------|------------------|--------------------------------|
// | traditional-ltl  | LEGACY — REQUIRED         | div-block-27     | CSS-hidden; Webflow template   |
// |                  |                           |                  | still binds this field.         |
// | warp-ltl         | LEGACY — REQUIRED         | div-block-27     | CSS-hidden; same as above.     |
// | div-block-27     | DEPRECATED WITH GUARD     | (self)           | CSS display:none via           |
// |                  |                           |                  | LANE_PAGE_MODE_CSS. Template   |
// |                  |                           |                  | element exists but is hidden.  |
//
// RETIREMENT SAFETY:
// - These fields produce PLAIN TEXT (not HTML). They feed div-block-27.
// - div-block-27 is hidden by `.div-block-27 { display: none !important; }`
//   in the site-level custom code (LANE_PAGE_MODE_CSS).
// - The comparison HTML table is now the canonical display, rendered by
//   renderComparisonTableHtml() and placed in faq-schema Section 9.
// - DO NOT remove these fields until div-block-27 is removed from the
//   Webflow template in Designer. If the template element is removed,
//   these fields can be dropped from WEBFLOW_SCHEMA_FIELDS.
// - Tests verify these fields remain populated (section-ownership.test.js).

/** @param {string} [mode="LTL"] @returns {string} Traditional comparison text (mode-specific) */
function buildTraditionalLtl(mode) {
  return getComparisonPointsForMode(mode).map((p) => `${p.metric}: ${p.traditional}`).join("\n");
}

/** @param {string} [mode="LTL"] @returns {string} WARP comparison text (mode-specific) */
function buildWarpLtl(mode) {
  return getComparisonPointsForMode(mode).map((p) => `${p.metric}: ${p.warp}`).join("\n");
}

/**
 * Map canonical page data to the Webflow CMS field payload.
 * Returns an object with all required Webflow fields.
 *
 * PIPELINE OWNERSHIP TABLE — LIVE (this function) vs PREVIEW (renderLanePageHtml):
 *
 * | Section              | Live Owner                       | Preview Owner              | Shared Renderer?                |
 * |----------------------|----------------------------------|----------------------------|---------------------------------|
 * | KPI Panel            | renderLaneIntelligencePanel()     | N/A                        | Live only (dedicated)           |
 * | Execution Flow       | renderExecutionFlow()             | N/A                        | Live only (dedicated)           |
 * | Corridor Matters     | faq-schema Sec 2                 | renderLaneOverview()        | No — intentionally independent  |
 * | Operating Details    | faq-schema Sec 4                 | renderOperatingDetails()   | No — intentionally independent  |
 * | Pricing              | faq-schema Sec 4 sub             | renderPricing()            | No — bundled differently        |
 * | Visibility/Proof     | faq-schema Sec 5                 | N/A standalone             | Live only                       |
 * | Best-Fit             | faq-schema Sec 5 sub             | renderBestFitShipments()   | No — bundled differently        |
 * | Why Warp             | faq-schema Sec 6                 | renderWhyWarp()            | YES → renderWhyWarpReasonCards  |
 * | FAQ Visible          | faq-schema Sec 7                 | renderInlineFaqHtml()      | No — intentionally different    |
 * | Final CTA            | faq-schema Sec 8                 | renderFinalCta()           | YES → renderFinalCta()          |
 * | Comparison HTML      | faq-schema Sec 9                 | renderComparison()         | YES → renderComparisonTableHtml |
 * | Comparison legacy    | buildTraditionalLtl/buildWarpLtl | N/A                        | Legacy — required, CSS-hidden   |
 * | Proof/Pilot          | renderValidation()               | renderValidation()         | YES → renderValidation()        |
 * | Body Content         | renderLanePageBody() (text)      | renderLanePageHtml() (HTML)| Different purpose               |
 * | JSON-LD Schemas      | renderBreadcrumbSchemaEmbed()     | renderInlineSchemas()      | YES → buildLaneSchemaObjects()  |
 * | How WARP Operates    | N/A                              | renderWarpFit()            | Preview only                    |
 * | Related Links        | N/A                              | renderRelatedLinks()       | Preview only                    |
 *
 * @param {object} pageData - Canonical page data from buildCanonicalLanePageData
 * @returns {object} Webflow CMS field payload
 */
export function renderWebflowFields(pageData) {
  const hero = pageData.hero || {};
  const cta = pageData.lane_relevant_cta || {};
  const canonicalUrl = `${SITE_BASE}${pageData.canonical_path || ""}`;
  const oCity = cityFrom(pageData.origin);
  const dCity = cityFrom(pageData.destination);
  const oState = stateFrom(pageData.origin);
  const dState = stateFrom(pageData.destination);
  const ls = pageData.lane_stats || pageData.operating_details || {};
  const dist = ls.estimated_distance_miles || ls.items?.[0]?.match?.(/[\d,]+/)?.[0] || "";
  const transitRange = ls.estimated_transit_days_range || {};
  const carrierCount = pageData.network_proof?.estimated_carrier_count
    || ls.carrier_count || "";
  const variation = computeVariation(pageData);

  return {
    // ── Identity ───────────────────────────────────────────────────
    name: `${oCity} to ${dCity} ${pageData.mode || "LTL"}`,
    slug: pageData.lane_slug || "",
    "origin-city": oCity,
    "destination-city": dCity,
    origin: pageData.origin || "",
    destination: pageData.destination || "",
    mode: pageData.mode || "LTL",
    segment: pageData.segment || "smb",

    // ── SEO ────────────────────────────────────────────────────────
    "seo-title": pageData.page_title || "",
    "seo-meta-description": pageData.meta_description || "",
    "canonical-url": canonicalUrl,
    address: canonicalUrl,

    // ── Hero ────────────────────────────────────────────────────────
    "hero-headline": hero.headline || "",
    subheadline: hero.subhead || "",
    "hero-kpi-distance": dist ? `${fmt(dist)} mi` : "",
    "hero-kpi-transit": (transitRange.min && transitRange.max)
      ? `${transitRange.min}–${transitRange.max} days` : "",
    "hero-kpi-carriers": carrierCount ? `${carrierCount} active` : "",
    "hero-visual-type": "lane-map",
    "hero-map-origin": `${oCity}, ${oState}`,
    "hero-map-destination": `${dCity}, ${dState}`,

    // ── Body Content ───────────────────────────────────────────────
    "body-content": renderLanePageBody(pageData),

    // ── Comparison (mode-specific) ──────────────────────────────────
    "traditional-ltl": buildTraditionalLtl(pageData.mode),
    "warp-ltl": buildWarpLtl(pageData.mode),

    // ── Proof / Pilot ──────────────────────────────────────────────
    "proof-section": renderValidation(pageData),

    // ── CTAs ────────────────────────────────────────────────────────
    "cta-primary-text": hero.primary_cta?.label || cta.primary_cta?.label || "Get Instant Quote",
    "cta-primary-url": hero.primary_cta?.url || cta.primary_cta?.url || QUOTE_URL,
    "cta-secondary-text": hero.secondary_cta?.label || "Book a Fit Call",
    "cta-secondary-url": hero.secondary_cta?.url || `${SITE_BASE}/book`,

    // ── Dedicated Content Sections (Rich Text) ────────────────────
    "lane-intelligence-panel": renderLaneIntelligencePanel(pageData),
    "execution-flow": renderExecutionFlow(pageData),

    // ── Structured Data (code embeds) ──────────────────────────────
    "faq-schema": renderFaqSchemaEmbed(pageData),
    "breadcrumb-schema": renderBreadcrumbSchemaEmbed(pageData),

    // ── Template Flags ─────────────────────────────────────────────
    "hero-video-enabled": false,
    "hero-map-enabled": true,
    "lane-mode-enabled": true,
    "index-page": true,
    "lane-badge": variation.badge,
  };
}
