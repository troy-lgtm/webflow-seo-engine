#!/usr/bin/env node

/**
 * Audit Existing Lane Pages
 *
 * Reads data/published_pages.json and audits every published lane page by:
 *   1. Fetching the live HTML from https://www.wearewarp.com/lanes/{slug}
 *   2. Rebuilding the page data using inline lane intelligence (same as publish_next.js)
 *   3. Classifying the page via classifyExistingPage from lane-page-validator.js
 *   4. Writing a full audit report to artifacts/existing_lane_page_audit.json
 *
 * Flags:
 *   --offline    Skip live page fetching; validate only the locally-generated content
 *
 * Outputs:
 *   artifacts/existing_lane_page_audit.json — full audit report
 *
 * Exit codes:
 *   0 — audit completed
 *   1 — fatal error
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";
import { classifyExistingPage, runFullValidation } from "../lib/lane-page-validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

// --- Parse CLI flags ---
const args = process.argv.slice(2);
const OFFLINE = args.includes("--offline");

// --- Inline lane intelligence (same as publish_next.js — no @/ aliases) ---

const CITIES = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "cities.json"), "utf-8"));
const HUBS = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "hubs.json"), "utf-8"));
const ROAD_MULTIPLIER = 1.18;

const TRANSIT_BANDS = {
  LTL:    [[300,1,2],[600,2,3],[1000,3,4],[1500,4,5],[Infinity,5,7]],
  FTL:    [[400,1,1],[800,1,2],[1500,2,3],[2500,3,4],[Infinity,4,6]],
  "Cargo Van / Box Truck": [[300,1,2],[700,2,3],[1200,3,4],[2000,4,5],[Infinity,5,7]],
};

const RATE_PER_MILE = { LTL: [2.60, 5.20], FTL: [1.90, 3.60], "Cargo Van / Box Truck": [1.70, 3.40] };
const MIN_RATE = { LTL: 250, FTL: 600, "Cargo Van / Box Truck": 350 };
const ACCESSORIAL_PCT = { LTL: 0.20, FTL: 0.12, "Cargo Van / Box Truck": 0.15 };
const CARRIER_COUNT = { LTL: [4, 8], FTL: [10, 25], "Cargo Van / Box Truck": [3, 5] };

const EQUIPMENT_TYPES = {
  LTL: ["Dry Van", "Reefer (temp-controlled)"],
  FTL: ["Dry Van 53'", "Flatbed 48'", "Reefer 53'"],
  "Cargo Van / Box Truck": ["Cargo Van", "Box Truck 26'"],
};

const SEASONALITY = {
  "West Coast": "Peak volumes Aug\u2013Oct (produce season). Rate pressure Dec\u2013Jan.",
  "Pacific Northwest": "Steady volumes with produce season lift Jun\u2013Sep. Winter weather delays possible.",
  "Southwest": "Consistent year-round. Slight peak during holiday retail season Oct\u2013Dec.",
  "South Central": "Hurricane season Jun\u2013Nov can disrupt Gulf lanes. Peak retail Oct\u2013Dec.",
  "Midwest": "Winter weather impacts Dec\u2013Feb. Agricultural peaks Jul\u2013Oct.",
  "Southeast": "Hurricane risk Jun\u2013Nov. Consistent retail demand year-round.",
  "Northeast": "Congestion peaks around holidays. Winter weather Dec\u2013Mar.",
  "Mountain": "Winter weather impacts mountain passes Dec\u2013Mar. Steady otherwise.",
};

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function lookupCity(name) {
  const key = String(name || "").toLowerCase().trim();
  return CITIES[key] || null;
}

function nearestHubs(lat, lon, mode, count = 5) {
  return HUBS
    .filter((h) => h.modes.includes(mode))
    .map((h) => ({ ...h, dist: haversine(lat, lon, h.lat, h.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count)
    .map((h) => h.name);
}

function enrichLaneInline(page) {
  if (!page?.lane) return;
  const { origin, destination, mode } = page.lane;
  const rng = seededRng(stableHash(`${origin}|${destination}|${mode}`));
  const oCity = lookupCity(origin);
  const dCity = lookupCity(destination);
  const oRegion = oCity?.region || "Unknown";
  const dRegion = dCity?.region || "Unknown";

  const straight = (oCity && dCity) ? haversine(oCity.lat, oCity.lon, dCity.lat, dCity.lon) : 600;
  const roadMiles = Math.round(straight * ROAD_MULTIPLIER);

  // Transit
  const bands = TRANSIT_BANDS[mode] || TRANSIT_BANDS.LTL;
  let tMin = 3, tMax = 5;
  for (const [maxDist, bMin, bMax] of bands) {
    if (roadMiles <= maxDist) { tMin = bMin; tMax = bMax; break; }
  }

  // Rates
  const [rpmLow, rpmHigh] = RATE_PER_MILE[mode] || RATE_PER_MILE.LTL;
  const rateBase = rpmLow + rng() * (rpmHigh - rpmLow);
  const buf = ACCESSORIAL_PCT[mode] || 0.15;
  let rateLow = Math.round(rateBase * roadMiles * (1 - buf / 2));
  let rateHigh = Math.round(rateBase * roadMiles * (1 + buf));
  const floor = MIN_RATE[mode] || 250;
  rateLow = Math.max(floor, rateLow);
  rateHigh = Math.max(rateLow + 50, rateHigh);

  // Carrier count
  const [cBase, cRange] = CARRIER_COUNT[mode] || [4, 8];
  const carrierCount = cBase + Math.floor(rng() * cRange);

  // Cross-docks
  const oHubs = oCity ? nearestHubs(oCity.lat, oCity.lon, mode, 3) : [];
  const dHubs = dCity ? nearestHubs(dCity.lat, dCity.lon, mode, 2) : [];
  const crossDocks = [...new Set([...oHubs, ...dHubs])].slice(0, 5);

  const seasonality = SEASONALITY[oRegion] || SEASONALITY[dRegion] || "Contact for seasonal lane guidance.";
  const equipment = EQUIPMENT_TYPES[mode] || EQUIPMENT_TYPES.LTL;

  page.lane_stats = {
    estimated_distance_miles: roadMiles,
    estimated_transit_days_range: { min: tMin, max: tMax },
    estimated_rate_range_usd: { low: rateLow, high: rateHigh },
    common_equipment: equipment,
    seasonality_notes: seasonality,
    confidence: { transit: "modeled", rate: "modeled" },
    disclaimers: [
      "These are modeled estimates, not guaranteed quotes.",
      "Actual rates depend on freight details, accessorials, and current market conditions.",
    ],
  };

  page.network_proof = {
    estimated_carrier_count: carrierCount,
    nearest_cross_docks: crossDocks,
    service_notes: [
      "Real-time scan events at pickup, in-transit, and delivery",
      `Estimated ${tMin}\u2013${tMax} business day transit window`,
      mode === "LTL" ? "Pallet-level tracking with delivery appointment scheduling" : "GPS-equipped trailers with live ETA updates",
      "Exception alerts within 30 minutes of status change",
    ],
    origin_region: oRegion,
    destination_region: dRegion,
  };
}

// --- FAQ generation (same as publish_next.js) ---

const FAQ_TEMPLATES = {
  transit: (o, d, mode, stats) => ({
    q: `How long does ${mode} freight take from ${o} to ${d}?`,
    a: `Estimated transit for ${mode} freight on this ${stats.estimated_distance_miles}-mile lane is ${stats.estimated_transit_days_range.min}\u2013${stats.estimated_transit_days_range.max} business days. Actual transit depends on pickup schedule, carrier routing, and weather conditions.`,
  }),
  cost: (o, d, mode, stats) => ({
    q: `How much does ${mode} shipping from ${o} to ${d} cost?`,
    a: `Estimated ${mode} rates on this lane range from $${stats.estimated_rate_range_usd.low.toLocaleString()} to $${stats.estimated_rate_range_usd.high.toLocaleString()} depending on weight, freight class, pallet count, and seasonal demand. These are modeled estimates \u2014 get an exact quote by entering your shipment details.`,
  }),
  pilot: (o, d, mode) => ({
    q: `How fast can we launch a ${mode} pilot from ${o} to ${d}?`,
    a: `Most shipping teams can scope a single-lane pilot and begin quoting within days. Start with this corridor, measure quote speed and transit reliability, then expand based on results.`,
  }),
  tracking: (o, d, mode) => ({
    q: `How does WARP handle tracking on the ${o} to ${d} lane?`,
    a: `WARP provides real-time visibility with scan events at pickup, in-transit checkpoints, and delivery confirmation. Exception alerts fire within 30 minutes of any status change so you can resolve issues before they impact customers.`,
  }),
  equipment: (o, d, mode, stats) => ({
    q: `What equipment is available for ${mode} freight from ${o} to ${d}?`,
    a: `Common equipment on this lane includes ${stats.common_equipment.join(", ")}. Equipment availability varies by season and demand \u2014 WARP's carrier network provides multiple options for your freight profile.`,
  }),
  single_lane: (o, d) => ({
    q: `Can we start with just the ${o} to ${d} lane before expanding?`,
    a: `Yes. A single-lane rollout lets you validate WARP's performance on this specific corridor before committing to additional lanes. Most teams expand within weeks after seeing results.`,
  }),
  exceptions: (o, d, mode) => ({
    q: `How are shipping exceptions handled on this ${mode} lane?`,
    a: `WARP's platform detects exceptions automatically and escalates within minutes. You get proactive alerts for delays, appointment changes, and delivery issues \u2014 no more chasing carriers for updates.`,
  }),
  metrics: (o, d, mode) => ({
    q: `What metrics should we track on this ${mode} lane?`,
    a: `Focus on quote response time, on-time delivery rate, transit time consistency, exception frequency, and cost-per-shipment trends. These give you a clear go/no-go signal for scaling to more lanes.`,
  }),
};

function buildLaneFaqs(origin, destination, mode, laneStats) {
  const o = origin.split(",")[0].trim();
  const d = destination.split(",")[0].trim();
  const keys = ["transit", "cost", "pilot", "tracking", "equipment", "single_lane", "exceptions", "metrics"];
  const hash = stableHash(`${o}|${d}|${mode}`);
  const start = hash % keys.length;
  const selected = [];
  for (let i = 0; i < 5; i++) {
    selected.push(keys[(start + i) % keys.length]);
  }
  return selected.map((k) => FAQ_TEMPLATES[k](o, d, mode, laneStats));
}

// --- Content builders (same as publish_next.js) ---

function escHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function buildBodyContent(page) {
  const stats = page.lane_stats || {};
  const np = page.network_proof || {};
  const mode = page.lane?.mode || "LTL";
  const origin = page.lane?.origin || "";
  const destination = page.lane?.destination || "";
  const oCity = origin.split(",")[0].trim();
  const dCity = destination.split(",")[0].trim();
  const distance = stats.estimated_distance_miles || 0;
  const transitMin = stats.estimated_transit_days_range?.min || "2";
  const transitMax = stats.estimated_transit_days_range?.max || "5";

  const sections = [];

  // SECTION 1: Lane Overview
  sections.push(`<h2>${mode} Lane Overview: ${oCity} to ${dCity}</h2>`);
  sections.push(`<p>The ${oCity} to ${dCity} corridor is a ${distance.toLocaleString()}-mile ${mode} freight lane connecting ${origin} and ${destination}. Estimated transit on this route is ${transitMin}\u2013${transitMax} business days under standard conditions.</p>`);
  if (stats.common_equipment?.length) {
    sections.push(`<p>Common equipment types on this lane include ${stats.common_equipment.join(" and ")}. ${mode === "LTL" ? "Palletized freight with standard dock-height pickup and delivery is the primary use case." : ""}</p>`);
  }
  if (np.nearest_cross_docks?.length) {
    sections.push(`<p>Nearby cross-dock and terminal facilities serving this corridor: ${np.nearest_cross_docks.join(", ")}.</p>`);
  }
  if (stats.seasonality_notes) {
    sections.push(`<p>${stats.seasonality_notes}</p>`);
  }

  // SECTION 2: WARP Fit
  sections.push(`<h2>Why WARP Fits the ${oCity} to ${dCity} ${mode} Lane</h2>`);
  sections.push(`<p>WARP supports ${mode.toLowerCase()} freight on this corridor with ${np.estimated_carrier_count || "multiple"} active carriers, live tracking from pickup through delivery, and transparent per-shipment pricing. For shippers with recurring or appointment-driven freight on this route, WARP provides consistency that traditional broker models often lack.</p>`);
  sections.push(`<ul>`);
  sections.push(`<li><strong>Palletized freight fit</strong> \u2014 ${mode === "LTL" ? "Standard pallet positions with accurate dimensional billing and weight-based pricing" : "Full trailer capacity with predictable carrier allocation"}.</li>`);
  sections.push(`<li><strong>Appointment and scheduling</strong> \u2014 Dock-scheduled pickups and deliveries with appointment confirmation and arrival tracking.</li>`);
  sections.push(`<li><strong>Live visibility</strong> \u2014 ${(np.service_notes || [])[0] || "Real-time scan events at pickup, in-transit, and delivery"} so you know where freight is without calling anyone.</li>`);
  sections.push(`<li><strong>Carrier network depth</strong> \u2014 ${np.estimated_carrier_count || "Multiple"} carriers with established routes on the ${oCity}\u2013${dCity} corridor, scored on on-time performance and service quality.</li>`);
  if (mode === "LTL") {
    sections.push(`<li><strong>Per-pallet economics</strong> \u2014 Transparent per-pallet and per-shipment pricing without hidden accessorial markups. Recurring lanes see rate consistency over time.</li>`);
  }
  sections.push(`</ul>`);

  // SECTION 3: Operating Details
  sections.push(`<h2>Operating Details: ${oCity} to ${dCity} ${mode}</h2>`);
  sections.push(`<p>Key operational considerations for this ${distance.toLocaleString()}-mile lane:</p>`);
  sections.push(`<ul>`);
  sections.push(`<li><strong>Transit window</strong> \u2014 ${transitMin}\u2013${transitMax} business days. Actual transit depends on pickup schedule, carrier routing, and weather conditions.</li>`);
  if (mode === "LTL") {
    sections.push(`<li><strong>Shipment profile</strong> \u2014 Standard ${mode} dock-height pickup and delivery. Palletized freight up to 15,000 lbs. Non-standard requirements (liftgate, inside, residential) available as quoted accessorials.</li>`);
    sections.push(`<li><strong>Freight class considerations</strong> \u2014 NMFC classification directly impacts pricing. Higher-density freight typically receives more favorable rates on this lane.</li>`);
  }
  sections.push(`<li><strong>Appointment coordination</strong> \u2014 WARP handles pickup and delivery appointment scheduling. Dock windows are confirmed and tracked with real-time arrival notifications.</li>`);
  if (np.nearest_cross_docks?.length >= 2) {
    sections.push(`<li><strong>Cross-dock routing</strong> \u2014 Freight on this lane may transfer through ${np.nearest_cross_docks.slice(0, 2).join(" or ")} depending on carrier routing and service level. Direct and transfer options are compared automatically.</li>`);
  }
  sections.push(`<li><strong>Exception handling</strong> \u2014 ${(np.service_notes || [])[3] || "Proactive alerts for delays, appointment changes, and delivery issues"}. Exceptions escalate within minutes, not hours.</li>`);
  sections.push(`<li><strong>Service notes</strong> \u2014 ${(np.service_notes || [])[1] || `Dedicated support for the ${oCity} to ${dCity} corridor`}. Carrier performance data informs routing decisions on every shipment.</li>`);
  sections.push(`</ul>`);

  // SECTION 4: Pricing
  sections.push(`<h2>${mode} Pricing: ${oCity} to ${dCity}</h2>`);
  sections.push(`<p>Estimated ${mode} rates on this ${distance.toLocaleString()}-mile lane: <strong>$${(stats.estimated_rate_range_usd?.low || 500).toLocaleString()} \u2013 $${(stats.estimated_rate_range_usd?.high || 1500).toLocaleString()}</strong>.</p>`);
  sections.push(`<p>Key cost factors on this corridor:</p>`);
  sections.push(`<ul>`);
  sections.push(`<li><strong>Distance and linehaul</strong> \u2014 At ${distance.toLocaleString()} miles, per-mile linehaul is the primary cost component. Lane density and carrier availability influence base rates.</li>`);
  if (mode === "LTL") {
    sections.push(`<li><strong>Per-pallet pricing</strong> \u2014 Rates are calculated per pallet position. Consolidation with other shipments on this corridor can reduce per-unit cost.</li>`);
    sections.push(`<li><strong>Freight class impact</strong> \u2014 NMFC classification affects LTL pricing. Higher-density, lower-class freight receives more favorable rates.</li>`);
  }
  sections.push(`<li><strong>Recurring volume</strong> \u2014 Consistent volume on the ${oCity}\u2013${dCity} lane builds carrier familiarity and can stabilize rates over time.</li>`);
  sections.push(`<li><strong>Seasonal demand</strong> \u2014 ${stats.seasonality_notes || "Carrier capacity fluctuates with retail cycles, produce seasons, and weather patterns."}</li>`);
  sections.push(`<li><strong>Accessorials</strong> \u2014 Liftgate, inside delivery, residential pickup, limited-access, and other accessorials are quoted transparently as add-ons to the base rate.</li>`);
  sections.push(`</ul>`);
  sections.push(`<p><em>${(stats.disclaimers || [])[0] || "These are modeled estimates based on lane data, not guaranteed quotes. Enter your shipment details for an exact rate."}</em></p>`);

  // SECTION 5: Validate This Lane
  if (page.proof_section) {
    sections.push(`<h2>Validate This Lane</h2>`);
    sections.push(`<p>${page.proof_section}</p>`);
  }

  return sections.join("\n");
}

function buildFaqSchemaEmbed(page) {
  const faq = page.faq || [];
  const hideCSS = [
    "wistia-player,wistia-player:not(:defined),.w-embed wistia-player,.w-embed:has(wistia-player){display:none!important;padding:0!important;height:0!important;margin:0!important;overflow:hidden!important;}",
    'a[href*="customer.wearewarp.com/public/freight-quote"]{display:none!important;}',
    'a[href*="book-a-meeting"]{display:none!important;}',
    '.w-embed:has(wistia-player){height:0!important;padding:0!important;margin:0!important;overflow:hidden!important;}',
  ].join("");
  const faqSchema = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
  const faqHtml = faq.length > 0 ? ['<div style="margin:32px 0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">', '<h2 style="font-size:1.3rem;font-weight:700;margin-bottom:16px;color:inherit;">Frequently Asked Questions</h2>', ...faq.map((f) => `<details style="margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:12px;"><summary style="font-weight:600;cursor:pointer;font-size:0.95rem;">${escHtml(f.q)}</summary><p style="margin:8px 0 0;font-size:0.9rem;opacity:0.85;line-height:1.5;">${escHtml(f.a)}</p></details>`), '</div>'].join("") : "";
  return [`<style>${hideCSS}</style>`, `<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`, faqHtml].filter(Boolean).join("\n");
}

function buildBreadcrumbSchemaEmbed(page) {
  const schemas = [];
  if (page.schema_breadcrumb) schemas.push(`<script type="application/ld+json">${JSON.stringify(page.schema_breadcrumb)}</script>`);
  if (page.schema_service) schemas.push(`<script type="application/ld+json">${JSON.stringify(page.schema_service)}</script>`);
  if (page.schema_organization) schemas.push(`<script type="application/ld+json">${JSON.stringify(page.schema_organization)}</script>`);
  return schemas.join("\n");
}

// --- Build full page data from a published_pages.json entry ---

function buildPageFromEntry(entry) {
  const origin = `${entry.origin_city}, ${entry.origin_state}`;
  const destination = `${entry.destination_city}, ${entry.destination_state}`;
  const mode = entry.mode || "LTL";
  const oCity = entry.origin_city;
  const dCity = entry.destination_city;

  const modeProblems = {
    LTL: `LTL shippers on the ${oCity} to ${dCity} corridor struggle with inconsistent transit times, opaque pricing from legacy brokers, and fragmented visibility across multiple carriers. Most teams spend hours chasing quotes and tracking updates manually.`,
    FTL: `FTL shippers on the ${oCity} to ${dCity} lane face capacity volatility, rate uncertainty, and limited visibility into carrier performance. Securing reliable truck capacity requires multiple broker calls with no guarantee of service quality.`,
    "Cargo Van / Box Truck": `Mid-sized shippers moving freight from ${oCity} to ${dCity} fall between LTL and FTL \u2014 paying too much for either without a right-sized vehicle option. Cargo van and box truck service fills this gap but finding providers is difficult.`,
  };
  const modeSolutions = {
    LTL: `WARP provides instant ${mode} quotes on the ${oCity} to ${dCity} lane with real-time carrier comparison, one-click booking, and proactive exception management \u2014 replacing days of manual work with minutes of operational efficiency.`,
    FTL: `WARP delivers lane-level capacity intelligence, transparent rate comparison, and performance scoring for ${mode} operations from ${oCity} to ${dCity} \u2014 giving your team predictable access to quality carriers.`,
    "Cargo Van / Box Truck": `WARP's cargo van and box truck service provides right-sized vehicle options for the ${oCity} to ${dCity} corridor, delivering direct service with the right capacity at competitive pricing, with full visibility from pickup to delivery.`,
  };

  const page = {
    slug: entry.slug,
    canonical_path: `/${entry.slug}`,
    seo_title: entry.seo_title || `${origin} to ${destination} ${mode} Freight Quotes | WARP`,
    h1: entry.h1 || `${origin} to ${destination} ${mode} freight quotes`,
    meta_description: `Compare ${mode} freight rates from ${oCity} to ${dCity}. Get instant quotes, estimated transit times, and book freight in minutes with WARP.`,
    target_segment: entry.segment || "smb",
    lane: { origin, destination, mode },
    lane_stats: {},
    network_proof: {},
    problem_section: modeProblems[mode] || modeProblems.LTL,
    solution_section: modeSolutions[mode] || modeSolutions.LTL,
    cta_primary: "Book 15-min Fit Call",
    cta_secondary: "Get Instant Quote",
    cta_primary_url: "https://www.wearewarp.com/book",
    cta_secondary_url: "https://www.wearewarp.com/quote",
    contrast: {
      headline: `Why ${mode} shippers switch from brokers to WARP`,
      points: [
        { metric: "Quote speed", legacy: "2\u201324 hours via phone/email", warp: "Under 2 minutes, self-serve" },
        { metric: "Carrier comparison", legacy: "Manual spreadsheets", warp: "Side-by-side dashboard with performance data" },
        { metric: "Booking", legacy: "Email chains, 30\u201360 min", warp: "One-click from quote to BOL" },
        { metric: "Tracking", legacy: "Call carrier for updates", warp: "Real-time dashboard with exception alerts" },
        { metric: "Exception handling", legacy: "Reactive, hours to discover", warp: "Proactive alerts within 30 minutes" },
      ],
      bottom_line: `Shipping ${mode} from ${oCity} to ${dCity} with WARP eliminates the manual back-and-forth that costs logistics teams hours per shipment.`,
    },
  };

  enrichLaneInline(page);
  const stats = page.lane_stats;

  page.intro = `${mode} freight from ${origin} to ${destination} covers approximately ${stats.estimated_distance_miles.toLocaleString()} miles with estimated transit of ${stats.estimated_transit_days_range.min}\u2013${stats.estimated_transit_days_range.max} business days. WARP's carrier network on this corridor includes ${page.network_proof.estimated_carrier_count}+ providers with cross-dock facilities at ${page.network_proof.nearest_cross_docks.slice(0, 3).join(", ")}. Get instant lane-specific quotes, compare carriers, and book in minutes.`;

  page.proof_section = `Validate this lane with a controlled pilot: ${origin} to ${destination}. Track quote response time, transit predictability, and exception rate across ${page.network_proof.estimated_carrier_count} active carriers on this ${stats.estimated_distance_miles}-mile corridor. ${mode === "LTL" ? "Equipment includes " + stats.common_equipment.join(" and ") + "." : ""} Start with this single lane, measure results, and expand based on data.`;

  page.faq = buildLaneFaqs(origin, destination, mode, stats);

  page.schema_breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "WARP", item: "https://www.wearewarp.com" },
      { "@type": "ListItem", position: 2, name: `${mode} Freight`, item: `https://www.wearewarp.com/guides/${mode.toLowerCase()}` },
      { "@type": "ListItem", position: 3, name: `${oCity} to ${dCity}` },
    ],
  };
  page.schema_service = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: `${mode} Freight Service \u2014 ${oCity} to ${dCity}`,
    provider: { "@type": "Organization", name: "WARP", url: "https://www.wearewarp.com" },
    areaServed: [origin, destination],
    description: `${mode} freight shipping from ${origin} to ${destination} with instant quoting, carrier comparison, and real-time tracking.`,
  };
  page.schema_organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "WARP",
    url: "https://www.wearewarp.com",
    description: "Technology-driven freight logistics platform",
  };

  return page;
}

// --- Helpers ---

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Fetch a live lane page from wearewarp.com with error handling.
 * Returns { ok, status, html } or { ok: false, status, error }.
 */
async function fetchLivePage(slug) {
  const url = `https://www.wearewarp.com/lanes/${slug}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "WARP-SEO-Audit/1.0 (internal audit tool)",
        "Accept": "text/html",
      },
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}`, html: null };
    }
    const html = await res.text();
    return { ok: true, status: res.status, html };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, html: null };
  }
}

// --- Main ---

async function main() {
  console.log("=== WARP Existing Lane Page Audit ===");
  console.log(`  Mode: ${OFFLINE ? "OFFLINE (local content only)" : "ONLINE (fetching live pages)"}`);
  console.log("");

  // Load published pages
  const publishedPath = path.join(ROOT, "data", "published_pages.json");
  if (!fs.existsSync(publishedPath)) {
    console.error("  ERROR: data/published_pages.json not found");
    process.exit(1);
  }
  const published = JSON.parse(fs.readFileSync(publishedPath, "utf-8"));
  const lanePages = published.filter((p) => p.slug && !p.dry_run);
  console.log(`  Found ${lanePages.length} published lane pages to audit.`);

  if (lanePages.length === 0) {
    console.log("  Nothing to audit.");
    process.exit(0);
  }

  // Summary counters
  const summary = {
    total: lanePages.length,
    valid_lane_pages: 0,
    generic_template_pages: 0,
    fallback_content_pages: 0,
    thin_lane_pages: 0,
    banned_content_pages: 0,
    fetch_errors: 0,
  };

  const pageResults = [];

  for (let i = 0; i < lanePages.length; i++) {
    const entry = lanePages[i];
    const { slug } = entry;
    const progress = `[${i + 1}/${lanePages.length}]`;

    console.log(`\n  ${progress} ${slug}`);

    try {
      // Step 1: Rebuild page data from published entry using inline lane intelligence
      const rebuiltPage = buildPageFromEntry(entry);
      const bodyHtml = buildBodyContent(rebuiltPage);
      const faqEmbed = buildFaqSchemaEmbed(rebuiltPage);
      const breadcrumbEmbed = buildBreadcrumbSchemaEmbed(rebuiltPage);

      let htmlToClassify;
      let fetchStatus = null;

      if (OFFLINE) {
        // Offline mode: classify based on locally-generated content only
        htmlToClassify = [bodyHtml, faqEmbed, breadcrumbEmbed].join("\n");
        console.log(`    OFFLINE: using rebuilt content (${htmlToClassify.length} chars)`);
      } else {
        // Online mode: fetch live page HTML
        const fetchResult = await fetchLivePage(slug);
        fetchStatus = fetchResult.status;

        if (!fetchResult.ok) {
          console.log(`    FETCH ERROR: ${fetchResult.error}`);
          summary.fetch_errors++;
          pageResults.push({
            lane_slug: slug,
            classification: "fetch_error",
            quality_score: 0,
            reasons: [`fetch failed: ${fetchResult.error}`],
            fetch_status: fetchResult.status,
          });
          // Rate limit even on errors
          await sleep(1000);
          continue;
        }

        htmlToClassify = fetchResult.html;
        console.log(`    Fetched: ${fetchResult.status} (${htmlToClassify.length} chars)`);

        // Rate limit: 1 request per second
        await sleep(1000);
      }

      // Step 2: Classify the page
      const classification = classifyExistingPage(htmlToClassify, rebuiltPage);
      const { classification: cls, reasons, quality_score } = classification;

      console.log(`    Classification: ${cls} (score: ${quality_score})`);
      if (reasons.length > 0) {
        console.log(`    Reasons: ${reasons.join("; ")}`);
      }

      // Update summary
      if (cls === "valid_lane_page") summary.valid_lane_pages++;
      else if (cls === "generic_template_page") summary.generic_template_pages++;
      else if (cls === "fallback_content_page") summary.fallback_content_pages++;
      else if (cls === "thin_lane_page") summary.thin_lane_pages++;
      else if (cls === "banned_content_page") summary.banned_content_pages++;

      const pageResult = {
        lane_slug: slug,
        classification: cls,
        quality_score,
        reasons,
      };
      if (fetchStatus !== null) {
        pageResult.fetch_status = fetchStatus;
      }
      pageResults.push(pageResult);

    } catch (err) {
      console.log(`    ERROR: ${err.message}`);
      pageResults.push({
        lane_slug: slug,
        classification: "error",
        quality_score: 0,
        reasons: [`processing error: ${err.message}`],
      });
    }
  }

  // --- Write audit report ---
  const report = {
    timestamp: new Date().toISOString(),
    mode: OFFLINE ? "offline" : "online",
    summary,
    pages: pageResults,
  };

  const artifactsDir = path.join(ROOT, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  const reportPath = path.join(artifactsDir, "existing_lane_page_audit.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // --- Print summary ---
  console.log("\n=== Audit Summary ===");
  console.log(`  Total pages:            ${summary.total}`);
  console.log(`  Valid lane pages:        ${summary.valid_lane_pages}`);
  console.log(`  Generic template pages:  ${summary.generic_template_pages}`);
  console.log(`  Fallback content pages:  ${summary.fallback_content_pages}`);
  console.log(`  Thin lane pages:         ${summary.thin_lane_pages}`);
  console.log(`  Banned content pages:    ${summary.banned_content_pages}`);
  if (!OFFLINE) {
    console.log(`  Fetch errors:            ${summary.fetch_errors}`);
  }
  console.log(`\n  Report: ${reportPath}`);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
