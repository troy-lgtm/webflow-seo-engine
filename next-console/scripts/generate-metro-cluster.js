#!/usr/bin/env node
/**
 * Generate Metro Cluster — produces ~200 lane pages from 20 metro pairs.
 *
 * Usage:
 *   node scripts/generate-metro-cluster.js                 # full 200 pages
 *   node scripts/generate-metro-cluster.js --dry-run       # 10 pages only
 *   node scripts/generate-metro-cluster.js --limit 50      # custom limit
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

// ---------------------------------------------------------------------------
// Inline helpers (scripts can't use @/ aliases)
// ---------------------------------------------------------------------------

/** djb2 stable hash — same input always produces the same integer. */
function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Seeded PRNG (linear congruential) — deterministic sequence from a seed integer. */
function seededRng(seed) {
  let s = (seed | 0) || 1;
  return function next() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Haversine distance in statute miles between two lat/lon points. */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Extract just the city name from "City, ST" format. */
function cityName(fullCity) {
  return String(fullCity || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Convert "City, ST" to a URL-safe slug fragment: "city-name" */
function slugify(fullCity) {
  return cityName(fullCity).replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// 20 Metro Cities with lat/lon/region
// ---------------------------------------------------------------------------
const METROS = [
  { city: "Los Angeles, CA",     lat: 34.05,  lon: -118.24, region: "West Coast" },
  { city: "Chicago, IL",         lat: 41.88,  lon: -87.63,  region: "Midwest" },
  { city: "Dallas, TX",          lat: 32.78,  lon: -96.80,  region: "South Central" },
  { city: "Atlanta, GA",         lat: 33.75,  lon: -84.39,  region: "Southeast" },
  { city: "New York, NY",        lat: 40.71,  lon: -74.01,  region: "Northeast" },
  { city: "Miami, FL",           lat: 25.76,  lon: -80.19,  region: "Southeast" },
  { city: "Phoenix, AZ",         lat: 33.45,  lon: -112.07, region: "Southwest" },
  { city: "Houston, TX",         lat: 29.76,  lon: -95.37,  region: "South Central" },
  { city: "Seattle, WA",         lat: 47.61,  lon: -122.33, region: "Pacific Northwest" },
  { city: "Denver, CO",          lat: 39.74,  lon: -104.99, region: "Mountain" },
  { city: "San Francisco, CA",   lat: 37.77,  lon: -122.42, region: "West Coast" },
  { city: "Las Vegas, NV",       lat: 36.17,  lon: -115.14, region: "Southwest" },
  { city: "Portland, OR",        lat: 45.51,  lon: -122.68, region: "Pacific Northwest" },
  { city: "Salt Lake City, UT",  lat: 40.76,  lon: -111.89, region: "Mountain" },
  { city: "Nashville, TN",       lat: 36.16,  lon: -86.78,  region: "Southeast" },
  { city: "Charlotte, NC",       lat: 35.23,  lon: -80.84,  region: "Southeast" },
  { city: "Orlando, FL",         lat: 28.54,  lon: -81.38,  region: "Southeast" },
  { city: "Tampa, FL",           lat: 27.95,  lon: -82.46,  region: "Southeast" },
  { city: "Indianapolis, IN",    lat: 39.77,  lon: -86.16,  region: "Midwest" },
  { city: "Kansas City, MO",     lat: 39.10,  lon: -94.58,  region: "Midwest" },
];

// ---------------------------------------------------------------------------
// City classification sets (for archetype assignment)
// ---------------------------------------------------------------------------
const PORT_CITIES = new Set([
  "los angeles", "houston", "miami", "seattle", "new york", "san francisco",
]);
const AGRICULTURE_CITIES = new Set([
  "kansas city", "indianapolis", "dallas", "denver",
]);
const ENERGY_CITIES = new Set([
  "houston", "dallas", "denver", "salt lake city",
]);
const ECOMMERCE_HUBS = new Set([
  "los angeles", "chicago", "dallas", "atlanta", "new york", "indianapolis",
]);

const WEST_PACIFIC = new Set(["West Coast", "Pacific Northwest"]);
const EAST_COAST = new Set(["Northeast", "Southeast"]);
const SUNBELT_REGIONS = new Set(["Southeast", "South Central", "Southwest"]);

function classifyCity(fullCityName) {
  const name = cityName(fullCityName);
  return {
    isMetro: true, // all 20 are metros
    isPort: PORT_CITIES.has(name),
    isAgriculture: AGRICULTURE_CITIES.has(name),
    isEnergy: ENERGY_CITIES.has(name),
    isEcommerce: ECOMMERCE_HUBS.has(name),
  };
}

// ---------------------------------------------------------------------------
// Archetype resolution (simplified priority ladder)
// ---------------------------------------------------------------------------
const ARCHETYPE_DEFS = [
  {
    id: "short_haul_metro",
    label: "Short-Haul Metro",
    match: (ctx) => ctx.distance < 300,
  },
  {
    id: "port_to_inland",
    label: "Port to Inland",
    match: (ctx) =>
      (ctx.oClass.isPort && !ctx.dClass.isPort) ||
      (!ctx.oClass.isPort && ctx.dClass.isPort),
  },
  {
    id: "energy_corridor",
    label: "Energy Corridor",
    match: (ctx) => ctx.oClass.isEnergy || ctx.dClass.isEnergy,
  },
  {
    id: "agriculture_lane",
    label: "Agriculture Lane",
    match: (ctx) => ctx.oClass.isAgriculture || ctx.dClass.isAgriculture,
  },
  {
    id: "ecommerce_corridor",
    label: "E-Commerce Corridor",
    match: (ctx) => ctx.oClass.isEcommerce && ctx.dClass.isEcommerce,
  },
  {
    id: "coastal_to_coastal",
    label: "Coastal to Coastal",
    match: (ctx) => {
      const oWest = WEST_PACIFIC.has(ctx.oRegion);
      const dWest = WEST_PACIFIC.has(ctx.dRegion);
      const oEast = EAST_COAST.has(ctx.oRegion);
      const dEast = EAST_COAST.has(ctx.dRegion);
      return (oWest && dEast) || (oEast && dWest);
    },
  },
  {
    id: "sunbelt_growth",
    label: "Sunbelt Growth",
    match: (ctx) =>
      SUNBELT_REGIONS.has(ctx.oRegion) && SUNBELT_REGIONS.has(ctx.dRegion),
  },
  {
    id: "midwest_distribution",
    label: "Midwest Distribution",
    match: (ctx) => ctx.oRegion === "Midwest" || ctx.dRegion === "Midwest",
  },
  {
    id: "mountain_corridor",
    label: "Mountain Corridor",
    match: (ctx) => ctx.oRegion === "Mountain" || ctx.dRegion === "Mountain",
  },
  {
    id: "standard_lane",
    label: "Standard Lane",
    match: () => true, // fallback
  },
];

function resolveArchetype(origin, dest, distance) {
  const oClass = classifyCity(origin.city);
  const dClass = classifyCity(dest.city);
  const ctx = {
    distance,
    oClass,
    dClass,
    oRegion: origin.region,
    dRegion: dest.region,
  };
  for (const arch of ARCHETYPE_DEFS) {
    if (arch.match(ctx)) return arch;
  }
  return ARCHETYPE_DEFS[ARCHETYPE_DEFS.length - 1];
}

// ---------------------------------------------------------------------------
// Intro templates per archetype
// ---------------------------------------------------------------------------
const INTRO_TEMPLATES = {
  short_haul_metro: (o, d, mode) =>
    `${mode} freight between ${o} and ${d} covers one of the shortest metro-to-metro corridors in the network. For small and mid-size shipping teams, that means same-day and next-day options are realistic, last-mile scheduling is tighter, and per-shipment costs stay competitive. This page breaks down transit windows, carrier density, and booking strategies tailored to short-haul ${mode} shippers on the ${o} to ${d} lane.`,
  port_to_inland: (o, d, mode) =>
    `The ${o} to ${d} lane connects a major port gateway with an inland distribution point, making container drayage, intermodal coordination, and customs clearance central to every shipment. For small and mid-size shipping teams, understanding dwell times, chassis availability, and terminal fees on this corridor is critical. This guide covers ${mode} options, drayage strategies, and cost-saving approaches for the ${o} to ${d} port-to-inland lane.`,
  energy_corridor: (o, d, mode) =>
    `Shipping ${mode} freight between ${o} and ${d} means navigating an energy-sector corridor where oversized loads, specialized equipment, and regulatory compliance shape every move. For small and mid-size shipping teams, permit requirements, escort protocols, and heavy-haul carrier access on this lane are non-negotiable considerations. This page covers ${mode} rate factors, equipment options, and compliance checkpoints for the ${o} to ${d} energy corridor.`,
  agriculture_lane: (o, d, mode) =>
    `The ${o} to ${d} corridor is an active agriculture lane where seasonal harvest volumes, temperature-controlled freight, and time-sensitive delivery windows define the shipping rhythm. For small and mid-size shipping teams, aligning ${mode} capacity with planting and harvest cycles, managing reefer availability, and locking in rates before peak season are all priorities. This page outlines ${mode} strategies for produce, grain, and perishable freight between ${o} and ${d}.`,
  ecommerce_corridor: (o, d, mode) =>
    `The ${o} to ${d} lane is a high-velocity e-commerce corridor where parcel consolidation, fulfillment speed, and reverse logistics define competitive advantage. For small and mid-size shipping teams, optimizing ${mode} transit times between fulfillment centers, managing returns flow, and controlling last-mile handoff costs on this corridor are daily priorities. This guide covers ${mode} strategies for e-commerce freight moving between ${o} and ${d}.`,
  coastal_to_coastal: (o, d, mode) =>
    `Shipping ${mode} freight from ${o} to ${d} spans a cross-country corridor that crosses multiple time zones and climate regions. For small and mid-size shipping teams, planning multimodal options, managing extended transit windows, and building contingency into coast-to-coast schedules are essential. This page details ${mode} transit benchmarks, intermodal alternatives, and routing strategies for the ${o} to ${d} lane.`,
  sunbelt_growth: (o, d, mode) =>
    `The ${o} to ${d} lane sits within one of the fastest-growing freight regions in the country. For small and mid-size shipping teams, tapping into Sunbelt capacity, managing rapid demand cycles, and leveraging ${mode} options designed for high-growth markets are key to maintaining competitive transit and cost. This page covers ${mode} strategies for the ${o} to ${d} Sunbelt corridor.`,
  midwest_distribution: (o, d, mode) =>
    `${mode} freight between ${o} and ${d} moves through the Midwest distribution heartland where intermodal rail access, central hub positioning, and year-round capacity define the lane. For small and mid-size shipping teams, leveraging ${mode} on this corridor means tapping into one of the densest carrier markets in the country. This page details ${mode} transit, rate benchmarks, and distribution strategies for the ${o} to ${d} lane.`,
  mountain_corridor: (o, d, mode) =>
    `The ${o} to ${d} lane crosses mountain terrain where elevation changes, weather variability, and seasonal road restrictions impact ${mode} transit planning. For small and mid-size shipping teams, understanding pass closures, chain requirements, and altitude-adjusted transit windows is essential. This guide covers ${mode} routing, rate factors, and seasonal strategies for the ${o} to ${d} mountain corridor.`,
  standard_lane: (o, d, mode) =>
    `Small and mid-size shipping teams moving ${mode} freight from ${o} to ${d} can use this lane-specific workflow to compare options, reduce manual quote cycles, and book faster with stronger service visibility. This page provides ${mode} transit estimates, rate benchmarks, and carrier strategies tailored to the ${o} to ${d} lane.`,
};

// ---------------------------------------------------------------------------
// FAQ templates per archetype (5 per archetype)
// ---------------------------------------------------------------------------
const FAQ_TEMPLATES = {
  short_haul_metro: [
    { q: "How fast is {mode} transit from {origin} to {dest}?", a: "Short-haul metro lanes like {origin} to {dest} typically deliver within 1 business day for {mode}, with same-day options available for expedited shipments." },
    { q: "Are same-day {mode} pickups available from {origin}?", a: "Yes. Because {origin} and {dest} are both major metros, most carriers offer same-day pickup windows for {mode} freight on this corridor." },
    { q: "What is the average {mode} cost from {origin} to {dest}?", a: "Short-haul {mode} rates on the {origin} to {dest} lane are among the lowest per-mile in the network due to the short distance and high carrier density." },
    { q: "How does carrier availability compare on the {origin} to {dest} {mode} lane?", a: "Both {origin} and {dest} are metro hubs with deep carrier pools, so capacity is consistent year-round for {mode} shipments." },
    { q: "Can I schedule last-mile delivery windows for {mode} freight arriving in {dest}?", a: "Absolutely. Metro destinations like {dest} support appointment-based delivery scheduling for {mode} freight, including liftgate and inside delivery." },
  ],
  port_to_inland: [
    { q: "How does port congestion at {origin} affect {mode} transit to {dest}?", a: "Port dwell times at {origin} directly impact drayage schedules. WARP monitors terminal wait times and adjusts {mode} pickup windows to minimize delays on the {origin} to {dest} lane." },
    { q: "What intermodal options exist for {mode} freight from {origin} to {dest}?", a: "Container-on-chassis drayage to a nearby rail ramp is common for long-haul segments. For shorter runs, direct {mode} trucking from {origin} to {dest} is often faster." },
    { q: "Are there customs clearance delays on the {origin} to {dest} {mode} lane?", a: "If your freight originates as an ocean import, customs clearance at {origin} can add 1-3 days. Pre-clearing with a customs broker before vessel arrival reduces this window." },
    { q: "How do demurrage and detention fees work on the {origin} to {dest} lane?", a: "Demurrage accrues when containers sit at the port terminal past free time. Detention applies after the container leaves the terminal. Faster {mode} drayage to {dest} minimizes both charges." },
    { q: "What is the typical {mode} drayage cost from {origin} port to {dest}?", a: "Port drayage rates vary by distance, chassis type, and terminal fees. The {origin} to {dest} {mode} lane benefits from high carrier density at the port." },
  ],
  energy_corridor: [
    { q: "What specialized equipment is available for {mode} energy freight from {origin} to {dest}?", a: "Step-deck, double-drop, and RGN trailers are commonly used on energy corridors. {mode} carriers on the {origin} to {dest} lane maintain fleets rated for heavy and oversized loads." },
    { q: "Do I need permits for {mode} oversized shipments from {origin} to {dest}?", a: "Yes. Overweight and over-dimension loads require state permits for each jurisdiction between {origin} and {dest}. Lead times for permits vary by state." },
    { q: "How do oil and gas market cycles affect {mode} rates on the {origin} to {dest} lane?", a: "Active drilling seasons tighten flatbed and specialized capacity, pushing {mode} rates higher. Monitor rig counts and project schedules when planning shipments from {origin} to {dest}." },
    { q: "Are escort vehicles required for {mode} freight between {origin} and {dest}?", a: "Loads exceeding state width or height thresholds on the {origin} to {dest} corridor require pilot cars. Requirements vary by state and are determined during the permitting process." },
    { q: "What compliance certifications should {mode} carriers have on this energy lane?", a: "Look for TWIC cards, hazmat endorsements, and OSHA compliance certifications for carriers running {mode} freight between {origin} and {dest}." },
  ],
  agriculture_lane: [
    { q: "When is peak season for {mode} agriculture freight from {origin} to {dest}?", a: "Peak agricultural shipping on the {origin} to {dest} lane typically runs from late June through October, depending on crop cycles and regional harvest timing." },
    { q: "Are temperature-controlled {mode} trailers available from {origin} to {dest}?", a: "Yes. Reefer trailers with continuous temperature monitoring are available for {mode} shipments of produce, dairy, and other perishables on this agriculture corridor." },
    { q: "How do I lock in {mode} rates before harvest season on the {origin} to {dest} lane?", a: "Contract rates agreed 30-60 days before peak harvest provide rate stability. Spot {mode} rates on this lane can spike 15-25% during peak season." },
    { q: "What FSMA compliance requirements apply to {mode} food freight from {origin} to {dest}?", a: "The Sanitary Transportation Rule under FSMA requires temperature records, vehicle cleanliness, and proper handling procedures for {mode} food shipments between {origin} and {dest}." },
    { q: "How does harvest timing affect {mode} capacity between {origin} and {dest}?", a: "Harvest draws reefer and dry van capacity into agricultural regions, tightening the {mode} market. Book early and confirm capacity commitments before harvest peaks." },
  ],
  ecommerce_corridor: [
    { q: "How does e-commerce volume affect {mode} rates from {origin} to {dest}?", a: "High parcel density on e-commerce corridors like {origin} to {dest} supports competitive {mode} rates. Volume commitments unlock additional tier discounts." },
    { q: "Can I consolidate parcel shipments into {mode} loads from {origin} to {dest}?", a: "Yes. Parcel consolidation into {mode} trailers reduces per-unit costs by 20-40% compared to small-parcel carriers on high-volume corridors." },
    { q: "What {mode} options support 2-day delivery from {origin} to {dest}?", a: "Expedited {mode} services with direct routing and priority dispatch can achieve 2-day delivery between {origin} and {dest} fulfillment hubs." },
    { q: "How do I handle e-commerce returns via {mode} from {dest} back to {origin}?", a: "Reverse logistics consolidation at {dest} with scheduled {mode} return loads to {origin} keeps costs predictable and reduces per-unit return shipping expense." },
    { q: "Are fulfillment center dock appointments available for {mode} from {origin} to {dest}?", a: "Most fulfillment centers on this corridor offer appointment-based receiving. Coordinate {mode} delivery windows with FC schedules to avoid detention fees." },
  ],
  coastal_to_coastal: [
    { q: "What is the typical {mode} transit time from {origin} to {dest}?", a: "Coast-to-coast {mode} transit between {origin} and {dest} typically ranges from 4 to 7 business days depending on routing, weather, and carrier network." },
    { q: "Is intermodal {mode} a viable option from {origin} to {dest}?", a: "Yes. Rail-truck intermodal can reduce costs by 15-30% versus over-the-road {mode} on the {origin} to {dest} lane, with a 1-2 day transit trade-off." },
    { q: "How do time zone differences affect {mode} delivery scheduling between {origin} and {dest}?", a: "A 3-hour time difference between {origin} and {dest} impacts pickup and delivery appointment windows. Coordinate cutoff times across time zones to avoid missed appointments." },
    { q: "What weather risks apply to cross-country {mode} freight from {origin} to {dest}?", a: "Mountain passes, Great Plains storms, and seasonal weather patterns can delay {mode} transit. Build 1-2 buffer days into coast-to-coast schedules." },
    { q: "How does fuel cost impact {mode} rates on the {origin} to {dest} lane?", a: "Cross-country lanes are fuel-sensitive. {mode} fuel surcharges on the {origin} to {dest} corridor fluctuate with diesel prices and add 15-25% to base rates." },
  ],
  sunbelt_growth: [
    { q: "Why are {mode} rates competitive on the {origin} to {dest} Sunbelt lane?", a: "Rapid population and industrial growth in the Sunbelt drives high freight density between {origin} and {dest}, keeping {mode} rates competitive through consistent carrier utilization." },
    { q: "How does seasonal demand affect {mode} capacity from {origin} to {dest}?", a: "Sunbelt lanes see demand peaks during construction season and holiday retail. Book {mode} capacity early in Q3 and Q4 for the {origin} to {dest} corridor." },
    { q: "Are there new distribution centers opening near {dest} that affect {mode} freight?", a: "Sunbelt metros like {dest} are adding warehouse and DC capacity rapidly. New facilities create inbound {mode} demand and improve carrier backhaul options from {origin}." },
    { q: "What transit time should I expect for {mode} freight from {origin} to {dest}?", a: "{mode} transit between {origin} and {dest} typically ranges from 2 to 4 business days depending on distance and carrier routing within the Sunbelt corridor." },
    { q: "How do I find reliable {mode} carriers for the {origin} to {dest} lane?", a: "WARP pre-vets carriers on Sunbelt lanes including {origin} to {dest}. Carrier scorecards track on-time delivery, claims ratio, and communication quality." },
  ],
  midwest_distribution: [
    { q: "How does the Midwest hub network benefit {mode} shippers from {origin} to {dest}?", a: "Central positioning means shorter average distances to most US markets. {mode} freight from {origin} to {dest} benefits from dense carrier availability and competitive rates." },
    { q: "Is intermodal rail an option for {mode} freight between {origin} and {dest}?", a: "The Midwest has one of the densest intermodal rail networks in the country. Rail-truck combos can reduce {mode} costs on the {origin} to {dest} corridor." },
    { q: "How do winter conditions affect {mode} transit from {origin} to {dest}?", a: "Midwest winters can add 1-2 days to {mode} transit. Carriers pre-plan for weather delays on the {origin} to {dest} lane with contingency routing." },
    { q: "What {mode} capacity is available year-round between {origin} and {dest}?", a: "Midwest distribution lanes maintain strong year-round {mode} capacity due to the volume of freight flowing through central US hubs." },
    { q: "Can I use {origin} or {dest} as a cross-dock hub for {mode} distribution?", a: "Yes. Both {origin} and {dest} offer cross-dock facilities that support {mode} consolidation and deconsolidation for regional distribution." },
  ],
  mountain_corridor: [
    { q: "How do mountain passes affect {mode} transit from {origin} to {dest}?", a: "Elevation changes and seasonal pass closures can add 1-2 days to {mode} transit on the {origin} to {dest} mountain corridor. Winter chains may be required." },
    { q: "Are there weight restrictions on {mode} mountain routes between {origin} and {dest}?", a: "Some mountain routes have lower weight limits due to grade and bridge restrictions. Carriers pre-route {mode} loads from {origin} to {dest} to avoid restricted segments." },
    { q: "What seasonal road closures affect {mode} freight on this corridor?", a: "High-elevation passes between {origin} and {dest} may close during severe winter storms. Carriers monitor CDOT and state DOT alerts to reroute {mode} loads proactively." },
    { q: "How do altitude and grade affect {mode} fuel costs on the {origin} to {dest} lane?", a: "Mountain routes consume more fuel per mile. {mode} carriers factor grade-adjusted fuel consumption into rates on the {origin} to {dest} corridor." },
    { q: "Is reefer performance affected by altitude on {mode} shipments between {origin} and {dest}?", a: "Reefer units work harder at altitude. Temperature-sensitive {mode} loads between {origin} and {dest} should use units rated for high-altitude operation." },
  ],
  standard_lane: [
    { q: "How fast can we launch a {mode} pilot from {origin} to {dest}?", a: "Most small and mid-size shipping teams can define lane scope and start pilot quoting within days on the {origin} to {dest} {mode} lane." },
    { q: "What makes {mode} shipping different on the {origin} to {dest} lane?", a: "Each lane has unique volume patterns, carrier availability, and transit windows. WARP analyzes these factors to optimize your {mode} operations for this corridor." },
    { q: "Can we start with just the {origin} to {dest} lane before expanding?", a: "Yes. A lane-first rollout lets you validate performance before scaling to additional corridors." },
    { q: "What metrics should we track on this {mode} lane?", a: "Focus on quote response time, transit predictability, exception rate, and cost-per-shipment trends for a clear go/no-go scaling signal." },
    { q: "Do we need to migrate our entire process to use WARP for this lane?", a: "No. Use a fast, self-serve approach: start this single lane, measure results, and expand based on quick ROI evidence." },
  ],
};

// ---------------------------------------------------------------------------
// FAQ hydration — replace {origin}, {dest}, {mode} placeholders
// ---------------------------------------------------------------------------
function hydrateFaq(template, origin, dest, mode) {
  const hydrate = (s) =>
    s
      .replace(/\{origin\}/g, origin)
      .replace(/\{dest\}/g, dest)
      .replace(/\{mode\}/g, mode);
  return { q: hydrate(template.q), a: hydrate(template.a) };
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 200;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      dryRun = true;
      limit = 10;
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    }
  }

  // Clamp limit
  if (isNaN(limit) || limit < 0) limit = 0;
  if (limit > 380) limit = 380;

  return { limit, dryRun };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const { limit, dryRun } = parseArgs();
  const totalMetros = METROS.length;
  const totalPairs = totalMetros * (totalMetros - 1); // 380

  console.log(`Generating ${limit} pages from ${totalMetros} metros...`);
  if (dryRun) console.log("  (dry-run mode)");

  if (limit === 0) {
    console.log("Limit is 0. Nothing to generate.");
    process.exit(0);
  }

  // 1. Generate all 380 directional pairs
  const pairs = [];
  for (let i = 0; i < totalMetros; i++) {
    for (let j = 0; j < totalMetros; j++) {
      if (i === j) continue; // skip self-pairs
      const origin = METROS[i];
      const dest = METROS[j];
      const dist = haversine(origin.lat, origin.lon, dest.lat, dest.lon);
      const key = `${origin.city}|${dest.city}`;
      const hash = stableHash(key);
      // Deterministic priority score 1-10
      const priority = (hash % 10) + 1;
      pairs.push({ origin, dest, distance: dist, hash, priority, key });
    }
  }

  // 2. Sort by priority descending, then by hash for stable tie-breaking
  pairs.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.hash - a.hash;
  });

  // 3. Take top `limit` pairs
  const selected = pairs.slice(0, limit);

  // 4. Build page objects
  const mode = "LTL";
  const pages = selected.map((pair) => {
    const { origin, dest, distance } = pair;
    const slug = `${slugify(origin.city)}-to-${slugify(dest.city)}`;
    const archetype = resolveArchetype(origin, dest, distance);

    // Road distance estimate (haversine * 1.2 road multiplier)
    const roadDistance = Math.round(distance * 1.2);

    // SEO fields
    const seoTitle = `${origin.city} to ${dest.city} ${mode} Freight Quotes | WARP`;
    const h1 = `${origin.city} to ${dest.city} ${mode} freight quotes`;
    const metaDescription = `Compare ${mode} freight options from ${origin.city} to ${dest.city}. Small and mid-size shipping teams get lane-specific estimated pricing, performance data, and a fast, self-serve evaluation workflow.`;

    // Intro from archetype template
    const introFn = INTRO_TEMPLATES[archetype.id] || INTRO_TEMPLATES.standard_lane;
    const intro = introFn(origin.city, dest.city, mode);

    // FAQ (5 items from archetype templates)
    const faqTemplates = FAQ_TEMPLATES[archetype.id] || FAQ_TEMPLATES.standard_lane;
    const rng = seededRng(pair.hash);
    // Shuffle faq pool deterministically and take 5
    const shuffled = [...faqTemplates].sort((a, b) => rng() - 0.5);
    const faq = shuffled.slice(0, 5).map((t) => hydrateFaq(t, origin.city, dest.city, mode));

    // Transit estimate based on distance
    let transitLow, transitHigh;
    if (roadDistance < 300) {
      transitLow = 1; transitHigh = 2;
    } else if (roadDistance < 800) {
      transitLow = 2; transitHigh = 4;
    } else if (roadDistance < 1500) {
      transitLow = 3; transitHigh = 5;
    } else {
      transitLow = 4; transitHigh = 7;
    }

    return {
      slug,
      origin: origin.city,
      destination: dest.city,
      mode,
      archetype: archetype.id,
      archetype_label: archetype.label,
      canonical_path: `/${slug}`,
      seo_title: seoTitle,
      h1,
      meta_description: metaDescription,
      intro,
      faq,
      lane_stats: {
        estimated_distance_miles: roadDistance,
        haversine_miles: Math.round(distance),
        estimated_transit_days: `${transitLow}-${transitHigh}`,
        origin_region: origin.region,
        destination_region: dest.region,
      },
    };
  });

  // 5. Uniqueness metrics (simplified)
  const uniqueTitles = new Set(pages.map((p) => p.seo_title));
  const uniqueH1s = new Set(pages.map((p) => p.h1));
  const uniqueIntroPrefixes = new Set(pages.map((p) => p.intro.slice(0, 100)));
  const archetypeCounts = {};
  for (const p of pages) {
    archetypeCounts[p.archetype] = (archetypeCounts[p.archetype] || 0) + 1;
  }

  // 6. Write output
  const outDir = path.join(ROOT, "artifacts", "metro_cluster");
  const pagesDir = path.join(outDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });

  // Manifest
  const manifest = {
    generated_at: new Date().toISOString(),
    total_pages: pages.length,
    limit,
    dry_run: dryRun,
    metros_used: totalMetros,
    total_possible_pairs: totalPairs,
    archetype_distribution: archetypeCounts,
    pages: pages.map((p) => ({
      slug: p.slug,
      origin: p.origin,
      destination: p.destination,
      archetype: p.archetype,
    })),
  };
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  // Individual page files
  for (const page of pages) {
    fs.writeFileSync(
      path.join(pagesDir, `${page.slug}.json`),
      JSON.stringify(page, null, 2)
    );
  }

  // Summary markdown
  const summaryLines = [
    "# Metro Cluster Generation Summary",
    "",
    `**Generated:** ${manifest.generated_at}`,
    `**Total Pages:** ${pages.length}`,
    `**Limit:** ${limit}`,
    `**Dry Run:** ${dryRun}`,
    `**Metros Used:** ${totalMetros}`,
    `**Total Possible Pairs:** ${totalPairs}`,
    "",
    "## Uniqueness Metrics",
    "",
    `| Metric | Count |`,
    `|--------|-------|`,
    `| Unique SEO Titles | ${uniqueTitles.size} / ${pages.length} |`,
    `| Unique H1s | ${uniqueH1s.size} / ${pages.length} |`,
    `| Unique Intro Prefixes (100 chars) | ${uniqueIntroPrefixes.size} / ${pages.length} |`,
    "",
    "## Archetype Distribution",
    "",
    "| Archetype | Count |",
    "|-----------|-------|",
    ...Object.entries(archetypeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([arch, count]) => `| ${arch} | ${count} |`),
    "",
    "## Sample Pages",
    "",
    ...pages.slice(0, 10).map(
      (p) =>
        `- **${p.slug}** (${p.archetype_label}) — ${p.lane_stats.estimated_distance_miles} mi, ${p.lane_stats.estimated_transit_days} days`
    ),
    pages.length > 10 ? `- ... and ${pages.length - 10} more` : "",
    "",
  ];
  fs.writeFileSync(path.join(outDir, "summary.md"), summaryLines.join("\n"));

  // Console output
  console.log(`\nDone! Generated ${pages.length} pages.`);
  console.log(`  Output: artifacts/metro_cluster/`);
  console.log(`  Manifest: artifacts/metro_cluster/manifest.json`);
  console.log(`  Pages: artifacts/metro_cluster/pages/ (${pages.length} files)`);
  console.log(`  Summary: artifacts/metro_cluster/summary.md`);
  console.log("");
  console.log("Uniqueness:");
  console.log(`  Unique titles: ${uniqueTitles.size}/${pages.length}`);
  console.log(`  Unique H1s: ${uniqueH1s.size}/${pages.length}`);
  console.log(`  Unique intro prefixes: ${uniqueIntroPrefixes.size}/${pages.length}`);
  console.log("");
  console.log("Archetypes:");
  for (const [arch, count] of Object.entries(archetypeCounts).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${arch}: ${count}`);
  }
}

main();
