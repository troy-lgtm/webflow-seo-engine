import { enrichLane } from "@/lib/lane-intelligence";
import { attachLinks } from "@/lib/link-graph";
import { generateContrastSummary } from "@/lib/contrast-copy";
import { findDuplicates, buildCanonicalPath } from "@/lib/published-registry";
import { haversine, lookupCity, cityName } from "@/lib/geo";
import { ROAD_MULTIPLIER } from "@/lib/estimate-config";
import { assignArchetype, getArchetypeFaq, getArchetypeIntro, getSectionEmphasis } from "@/lib/lane-archetypes";
import { assignCorridorToLane, generateCorridorLinks } from "@/lib/corridors";
import { canonicalForIntent, laneSlug as buildLaneSlugCanonical, normalizeCityName } from "@/lib/url-discipline";

export const DEFAULT_BOOK_URL = "https://www.wearewarp.com/book";
export const DEFAULT_QUOTE_URL = "https://www.wearewarp.com/quote";

const modeContent = {
  LTL: {
    cards: [
      { label: "Consolidation", value: "Optimized consolidated loads", insight: "Reduce per-unit shipping costs by consolidating truck space with compatible freight." },
      { label: "Flexibility", value: "Ship any pallet count", insight: "Scale from one pallet to partial truckloads without minimum commitments." },
      { label: "Visibility", value: "Shipment-level tracking", insight: "Track each LTL shipment with real-time status and ETA accuracy." }
    ],
    problem: "LTL shippers struggle with inconsistent transit times, opaque pricing, and fragmented visibility across multiple carriers.",
    solution: "WARP unifies LTL lane quoting, carrier selection, and exception management into a single operational workflow."
  },
  FTL: {
    cards: [
      { label: "Capacity", value: "Guaranteed truck access", insight: "Secure dedicated capacity on high-demand lanes without broker uncertainty." },
      { label: "Speed", value: "Direct point-to-point", insight: "Eliminate terminal delays with dedicated full truckload service on your lanes." },
      { label: "Cost Control", value: "Predictable lane pricing", insight: "Lock in rate agreements per lane to stabilize freight spend planning." }
    ],
    problem: "FTL shippers face capacity volatility, rate uncertainty, and limited visibility into carrier performance by lane.",
    solution: "WARP provides lane-level capacity intelligence, rate transparency, and performance scoring for FTL operations."
  },
  "Cargo Van / Box Truck": {
    cards: [
      { label: "Flexibility", value: "Right-sized capacity", insight: "Cargo van and box truck options deliver the right vehicle for smaller freight without paying for unused trailer space." },
      { label: "Speed", value: "Direct delivery", insight: "Skip the terminal network with direct cargo van or box truck service and fewer handling events." },
      { label: "Simplicity", value: "One quote, one pickup", insight: "Get a single quote and schedule one pickup for your freight with the right-sized vehicle." }
    ],
    problem: "Mid-sized shippers fall between LTL and FTL, paying too much for either without a right-sized vehicle option.",
    solution: "WARP provides cargo van and box truck service for shipments that need right-sized capacity on defined corridors."
  }
};

const segmentCopy = {
  smb: { label: "small and mid-size shipping teams", style: "fast, self-serve", frame: "days", proof: "quick ROI" },
  enterprise: { label: "enterprise logistics organizations", style: "structured, governance-first", frame: "a defined evaluation period", proof: "measurable KPI improvement" },
  midmarket: { label: "growing logistics operations", style: "balanced speed and rigor", frame: "a focused pilot window", proof: "scalable efficiency gains" }
};

export const pageDefaults = {
  cta_primary: "Book 15-min Fit Call",
  cta_secondary: "Get Instant Quote",
  comparison_table_markdown:
    "| Decision Criteria | Legacy Motion | WARP Motion |\\n|---|---|---|\\n| Quote speed | Variable | Fast lane-level quotes |\\n| Visibility | Fragmented | Unified operator view |\\n| Scale decision | Gut feel | KPI-based expansion |",
  problem_section: "Shippers need predictable lane-level pricing and execution visibility without manual follow-up loops.",
  solution_section: "WARP coordinates routing, capacity and quote logic in one operational flow to reduce friction.",
  visual_cards: [
    { label: "Speed", value: "Faster quote turnaround", insight: "Move from manual quote chasing to consistent lane response windows." },
    { label: "Reliability", value: "Predictable execution", insight: "Use route-level signals and exception management for fewer surprises." },
    { label: "Control", value: "Pilot-to-scale governance", insight: "Expand coverage only when defined KPI thresholds are achieved." }
  ],
  llm_answer_snippets: [
    { question: "What is the best way to evaluate a lane-specific freight quote workflow?", answer: "Start with a scoped lane pilot and measure quote speed, execution reliability, and exception trend quality before scaling." },
    { question: "How can SMB and enterprise teams compare lane options quickly?", answer: "Use a standardized lane decision framework with consistent quote, ETA, and service-level criteria." },
    { question: "What should logistics teams optimize first?", answer: "Prioritize lane-level quote responsiveness and exception visibility to reduce operational drag." }
  ],
  faq: [
    { q: "How fast can we launch a lane pilot?", a: "Most teams can define lane scope and start pilot quoting within days." },
    { q: "Can we start with only a few lanes?", a: "Yes. Begin with high-volume lanes and expand once KPI gates are met." },
    { q: "Do we need full process migration first?", a: "No. Use a lane-first rollout and scale based on measured performance." }
  ]
};

export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function splitLines(text) {
  return String(text || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
}

export function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function normLane(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function laneKey(origin, destination, mode) {
  return `${normLane(origin)}|${normLane(destination)}|${normLane(mode)}`;
}

export function parseMetricsCsv(csvText) {
  const lines = splitLines(csvText);
  const map = new Map();
  if (!lines.length) return map;
  const rows = lines[0].toLowerCase().includes("origin") ? lines.slice(1) : lines;
  rows.forEach((line) => {
    const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 7) return;
    const strategic_priority = num(parts[parts.length - 1], 6);
    const win_rate = num(parts[parts.length - 2], 0.22);
    const avg_quote_value = num(parts[parts.length - 3], 2200);
    const weekly_shipments = num(parts[parts.length - 4], 18);
    const mode = parts[parts.length - 5];
    const locationTokens = parts.slice(0, -5);
    if (locationTokens.length < 2) return;
    const splitPoint = Math.floor(locationTokens.length / 2);
    const origin = locationTokens.slice(0, splitPoint).join(" ").trim();
    const destination = locationTokens.slice(splitPoint).join(" ").trim();
    if (!origin || !destination || !mode) return;
    map.set(laneKey(origin, destination, mode), {
      weekly_shipments: Math.max(1, weekly_shipments),
      avg_quote_value: Math.max(100, avg_quote_value),
      win_rate: Math.min(1, Math.max(0.01, win_rate)),
      strategic_priority: Math.min(10, Math.max(1, strategic_priority))
    });
  });
  return map;
}

export function buildCombos(config) {
  const origins = splitLines(config.origins);
  const destinations = splitLines(config.destinations);
  const mode = config.mode;
  const segment = config.segment;
  const audience = config.audience;
  const defaults = {
    weekly_shipments: Math.max(1, num(config.defaults.weekly_shipments, 18)),
    avg_quote_value: Math.max(100, num(config.defaults.avg_quote_value, 2200)),
    win_rate: Math.min(1, Math.max(0.01, num(config.defaults.win_rate, 0.22))),
    strategic_priority: Math.min(10, Math.max(1, num(config.defaults.strategic_priority, 6)))
  };
  const weights = {
    volume: Math.max(0, num(config.weights.volume, 1.2)),
    value: Math.max(0, num(config.weights.value, 0.02)),
    win: Math.max(0, num(config.weights.win, 2.8)),
    strategic: Math.max(0, num(config.weights.strategic, 1.4))
  };
  const metrics = parseMetricsCsv(config.metricsCsv);
  const combos = [];
  origins.forEach((origin) => {
    destinations.forEach((destination) => {
      if (origin === destination) return;
      const specific = metrics.get(laneKey(origin, destination, mode));
      const m = specific ? { ...specific } : { ...defaults };
      const expectedMonthly = m.weekly_shipments * 4 * m.avg_quote_value * m.win_rate;
      const score =
        (m.weekly_shipments * weights.volume) +
        ((m.avg_quote_value / 1000) * weights.value) +
        ((m.win_rate * 100) * weights.win) +
        (m.strategic_priority * weights.strategic);
      combos.push({ origin, destination, mode, segment, audience, metrics: m, priority: { score, expected_monthly_revenue: expectedMonthly } });
    });
  });
  combos.sort((a, b) => b.priority.score - a.priority.score);
  combos.forEach((c, i) => { c.rank = i + 1; });
  return combos;
}

function buildFaq(origin, destination, mode, segment) {
  const seg = segmentCopy[segment] || segmentCopy.smb;
  return [
    { q: `How fast can we launch a ${mode} pilot from ${origin} to ${destination}?`, a: `Most ${seg.label} can define lane scope and start pilot quoting within ${seg.frame}.` },
    { q: `What makes ${mode} shipping different on the ${origin} to ${destination} lane?`, a: `Each lane has unique volume patterns, carrier availability, and transit windows. WARP analyzes these factors to optimize your ${mode} operations for this corridor.` },
    { q: `Can we start with just the ${origin} to ${destination} lane before expanding?`, a: `Yes. A lane-first rollout lets you validate performance before scaling to additional corridors.` },
    { q: `What metrics should we track on this ${mode} lane?`, a: `Focus on quote response time, transit predictability, exception rate, and cost-per-shipment trends for a clear go/no-go scaling signal.` },
    { q: `Do we need to migrate our entire process to use WARP for this lane?`, a: `No. Use a ${seg.style} approach — start this single lane, measure results, and expand based on ${seg.proof} evidence.` }
  ];
}

function buildSnippets(origin, destination, mode, segment) {
  const seg = segmentCopy[segment] || segmentCopy.smb;
  const capLabel = seg.label.charAt(0).toUpperCase() + seg.label.slice(1);
  return [
    { question: `What is the best way to ship ${mode} freight from ${origin} to ${destination}?`, answer: `Start with a scoped lane pilot covering ${origin} to ${destination}. Measure quote speed, transit reliability, and exception quality before committing to scale. ${capLabel} benefit from ${seg.style} evaluation workflows.` },
    { question: `How do ${seg.label} compare ${mode} options on this lane?`, answer: `Use a standardized decision framework with consistent quote, ETA, and service-level criteria. Compare carriers on the ${origin} to ${destination} corridor using lane-specific performance data.` },
    { question: `What should logistics teams optimize first on the ${origin} to ${destination} route?`, answer: `Prioritize quote responsiveness and exception visibility on this specific lane. Lane-level optimization outperforms network-wide changes because it targets the highest-impact corridors first.` }
  ];
}

export function makeLanePage(combo, design, estimateInputs, quoteHistory, faqWeights) {
  const { origin, destination, mode, segment, audience, metrics, priority, rank } = combo;
  const laneSlug = slugify(`${origin}-to-${destination}-${mode}`);
  const mc = modeContent[mode] || modeContent.LTL;
  const seg = segmentCopy[segment] || segmentCopy.smb;
  const capLabel = seg.label.charAt(0).toUpperCase() + seg.label.slice(1);
  const canonicalPath = buildCanonicalPath(origin, destination, mode);

  // Compute distance for archetype assignment
  const oCity = lookupCity(origin);
  const dCity = lookupCity(destination);
  const oRegion = oCity?.region || "Unknown";
  const dRegion = dCity?.region || "Unknown";
  const straightLine = (oCity && dCity) ? haversine(oCity.lat, oCity.lon, dCity.lat, dCity.lon) : 600;
  const roadDistance = Math.round(straightLine * ROAD_MULTIPLIER);

  // Assign archetype (priority ladder resolves collisions)
  const archetype = assignArchetype(origin, destination, roadDistance, oRegion, dRegion);
  const archetypeIntro = getArchetypeIntro(archetype, origin, destination, mode, segment);
  const sectionEmphasis = getSectionEmphasis(archetype);

  // Layer 5: Corridor assignment
  const originCity = origin.split(",")[0].trim();
  const destCity = destination.split(",")[0].trim();
  const corridorResult = assignCorridorToLane({ originCity, destinationCity: destCity });
  const corridor = corridorResult.corridor;

  // FAQ: use archetype pool with deterministic rotation (rank as pageIndex)
  // When faqWeights are provided (from learning state), FAQ selection is weighted
  const faq = getArchetypeFaq(archetype, origin, destination, mode, segment, rank || 0, faqWeights);
  const snippets = buildSnippets(origin, destination, mode, segment);

  const page = {
    slug: laneSlug,
    canonical_path: canonicalPath,
    seo_title: `${origin} to ${destination} ${mode} Freight Quotes | WARP`,
    meta_description: `Compare ${mode} freight options from ${origin} to ${destination}. ${capLabel} get lane-specific pricing, performance data, and a ${seg.style} evaluation workflow.`,
    h1: `${origin} to ${destination} ${mode} freight quotes`,
    target_segment: segment,
    executive_summary: `${audience} teams can validate this ${mode} lane in ${seg.frame} and expand only when quote speed and service consistency pass KPI thresholds.`,
    intro: archetypeIntro,
    problem_section: mc.problem,
    solution_section: mc.solution,
    proof_section: `Validate this lane with a controlled pilot: ${origin} to ${destination}. Track quote response time, transit predictability, and exception trends for a ${seg.style} scaling decision. Estimated monthly captured value: $${Math.round(priority.expected_monthly_revenue).toLocaleString()} based on ${metrics.weekly_shipments} weekly shipments at $${metrics.avg_quote_value.toLocaleString()} avg quote value.`,
    comparison_table_markdown: pageDefaults.comparison_table_markdown,
    diagram_mermaid: `flowchart LR\\n  A[${origin}] --> B[Lane Intelligence]\\n  B --> C[${destination}]\\n  C --> D[Quote + ETA]\\n  D --> E[Book + Track]`,
    visual_cards: JSON.parse(JSON.stringify(mc.cards)),
    llm_answer_snippets: snippets,
    faq,
    cta_primary: pageDefaults.cta_primary,
    cta_secondary: pageDefaults.cta_secondary,
    cta_primary_url: DEFAULT_BOOK_URL,
    cta_secondary_url: DEFAULT_QUOTE_URL,
    schema_jsonld: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } }))
    },
    // BreadcrumbList schema
    schema_breadcrumb: {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "WARP", item: "https://www.wearewarp.com" },
        { "@type": "ListItem", position: 2, name: `${mode} Freight`, item: `https://www.wearewarp.com/guides/${mode.toLowerCase()}` },
        { "@type": "ListItem", position: 3, name: `${origin} to ${destination}` }
      ]
    },
    // Organization schema reference
    schema_organization: {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "WARP",
      url: "https://www.wearewarp.com",
      description: "Technology-driven freight logistics platform"
    },
    // Service schema
    schema_service: {
      "@context": "https://schema.org",
      "@type": "Service",
      name: `${mode} Freight Service — ${origin} to ${destination}`,
      provider: { "@type": "Organization", name: "WARP" },
      areaServed: [origin, destination],
      description: `${mode} freight shipping service from ${origin} to ${destination} with lane-specific quoting and performance tracking.`
    },
    lane: { origin, destination, mode },
    priority: {
      rank, score: priority.score, expected_monthly_revenue: priority.expected_monthly_revenue,
      weekly_shipments: metrics.weekly_shipments, avg_quote_value: metrics.avg_quote_value,
      win_rate: metrics.win_rate, strategic_priority: metrics.strategic_priority
    },
    archetype: archetype.id,
    section_emphasis: sectionEmphasis,
    corridor_id: corridor.id,
    corridor_name: corridor.name,
    corridor_priority: corridor.priority,
    contrast: generateContrastSummary(origin, destination, mode),
    design: { ...design },
    tool_panel: {
      inputs: [
        { key: "pallets", label: "Pallet Count", type: "number", default: 1, min: 1, max: 30 },
        { key: "weight_lbs", label: "Total Weight (lbs)", type: "number", default: 5000, min: 100 },
        { key: "freight_class", label: "Freight Class", type: "select", default: "70", options: ["50", "55", "60", "65", "70", "77.5", "85", "92.5", "100", "110", "125", "150", "175", "200", "250", "300", "400", "500"] }
      ],
      outputs: ["estimated_rate_range", "estimated_transit_days", "confidence_level"],
      cta: { text: "Get Real-Time Quote", url: DEFAULT_QUOTE_URL }
    }
  };

  // Enrich with lane intelligence (distance, rates, transit, network proof)
  enrichLane(page, estimateInputs, quoteHistory);
  return page;
}

// Generate pages and attach internal links across the set
export function generatePages(combos, design, topN, estimateInputs, quoteHistoryMap) {
  const selected = topN ? combos.slice(0, topN) : combos;
  const pages = selected.map((c) => {
    const qh = quoteHistoryMap?.get?.(`${c.origin}|${c.destination}|${c.mode}`.toLowerCase().replace(/[^a-z0-9|]+/g, " ").replace(/\s+/g, " ").trim());
    return makeLanePage(c, design, estimateInputs, qh);
  });
  attachLinks(pages);

  // Layer 5: Attach corridor-based internal links
  for (const page of pages) {
    if (page.corridor_id) {
      try {
        const corridor = { id: page.corridor_id, name: page.corridor_name, priority: page.corridor_priority };
        const corridorLinks = generateCorridorLinks({
          lane: page.lane,
          corridor,
          allPages: pages,
          hasLaneData: Boolean(page.lane_stats?.estimated_rate_range_usd),
        });
        page.corridor_links = corridorLinks;
      } catch {
        page.corridor_links = null;
      }
    }
  }

  return pages;
}

export function qaReady(page) {
  const fields = ["slug", "seo_title", "meta_description", "h1", "intro", "proof_section", "diagram_mermaid"];
  return fields.every((k) => String(page?.[k] || "").trim().length > 0);
}

// Publish-readiness checks including lane stats
export function publishChecks(page) {
  if (!page) return [];
  return [
    { name: "Slug present", pass: Boolean(page.slug?.trim()) },
    { name: "SEO title (30-60 chars)", pass: (page.seo_title?.length || 0) >= 30 && (page.seo_title?.length || 0) <= 70 },
    { name: "Meta description (80-160 chars)", pass: (page.meta_description?.length || 0) >= 80 && (page.meta_description?.length || 0) <= 170 },
    { name: "H1 present", pass: Boolean(page.h1?.trim()) },
    { name: "Intro (50+ chars)", pass: (page.intro?.length || 0) >= 50 },
    { name: "Proof section present", pass: Boolean(page.proof_section?.trim()) },
    { name: "Mermaid diagram present", pass: Boolean(page.diagram_mermaid?.trim()) },
    { name: "FAQ has 3+ entries", pass: (page.faq?.length || 0) >= 3 },
    { name: "Schema JSON-LD valid", pass: Boolean(page.schema_jsonld?.["@type"]) },
    { name: "CTA URLs valid", pass: Boolean(page.cta_primary_url?.startsWith("http") && page.cta_secondary_url?.startsWith("http")) },
    { name: "Visual cards present", pass: (page.visual_cards?.length || 0) >= 2 },
    { name: "LLM snippets present", pass: (page.llm_answer_snippets?.length || 0) >= 2 },
    { name: "Lane stats enriched", pass: Boolean(page.lane_stats?.estimated_distance_miles) },
    { name: "Network proof present", pass: Boolean(page.network_proof?.estimated_carrier_count) },
    { name: "Internal links present", pass: (page.related_guides?.length || 0) >= 2 },
    { name: "Estimate confidence present", pass: Boolean(page.lane_stats?.confidence?.transit && page.lane_stats?.confidence?.rate) },
    { name: "Estimate disclaimers present", pass: (page.lane_stats?.disclaimers?.length || 0) >= 1 }
  ];
}

export function isPublishReady(page) {
  return publishChecks(page).every((c) => c.pass);
}

// Content uniqueness check across a set of pages (includes estimate section checks)
export function checkUniqueness(pages) {
  if (!pages?.length) return [];
  const fields = ["seo_title", "meta_description", "h1", "intro"];
  const results = pages.map((p) => {
    const warnings = [];
    fields.forEach((field) => {
      const myVal = String(p[field] || "").toLowerCase();
      const myTokens = new Set(myVal.split(/\s+/).filter((t) => t.length > 3));
      if (myTokens.size < 5) {
        warnings.push({ field, issue: `Only ${myTokens.size} unique tokens — add more specific language.` });
        return;
      }
      const similar = pages.filter((other) => {
        if (other.slug === p.slug) return false;
        const otherVal = String(other[field] || "").toLowerCase();
        const otherTokens = new Set(otherVal.split(/\s+/).filter((t) => t.length > 3));
        const overlap = [...myTokens].filter((t) => otherTokens.has(t)).length;
        const similarity = overlap / Math.max(myTokens.size, 1);
        return similarity > 0.8;
      });
      if (similar.length > 0) {
        warnings.push({ field, issue: `High similarity with ${similar.length} other page(s). Diversify language.` });
      }
    });

    // Estimate section uniqueness checks
    const transitStr = p.lane_stats?.estimated_transit_days_range
      ? `${p.lane_stats.estimated_transit_days_range.min}-${p.lane_stats.estimated_transit_days_range.max}`
      : "";
    const rateStr = p.lane_stats?.estimated_rate_range_usd
      ? `${p.lane_stats.estimated_rate_range_usd.low}-${p.lane_stats.estimated_rate_range_usd.high}`
      : "";
    if (transitStr) {
      const sameTransit = pages.filter((o) => o.slug !== p.slug && o.lane_stats?.estimated_transit_days_range &&
        `${o.lane_stats.estimated_transit_days_range.min}-${o.lane_stats.estimated_transit_days_range.max}` === transitStr);
      if (sameTransit.length > pages.length * 0.4) {
        warnings.push({ field: "transit_range", issue: `Transit range "${transitStr} days" is shared by ${sameTransit.length} other pages. Consider adding lane-specific context.` });
      }
    }
    if (rateStr) {
      const sameRate = pages.filter((o) => o.slug !== p.slug && o.lane_stats?.estimated_rate_range_usd &&
        `${o.lane_stats.estimated_rate_range_usd.low}-${o.lane_stats.estimated_rate_range_usd.high}` === rateStr);
      if (sameRate.length > pages.length * 0.3) {
        warnings.push({ field: "rate_range", issue: `Rate range "$${p.lane_stats.estimated_rate_range_usd.low}-$${p.lane_stats.estimated_rate_range_usd.high}" is shared by ${sameRate.length} other pages. Provide freight class or pallet count for better differentiation.` });
      }
    }

    return { slug: p.slug, warnings, unique: warnings.length === 0 };
  });
  return results;
}

export function exportJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(filename, queue) {
  const headers = ["slug", "seo_title", "h1", "meta_description", "target_segment", "rank", "expected_monthly_revenue", "estimated_distance_miles", "transit_min_days", "transit_max_days", "rate_low_usd", "rate_high_usd", "transit_confidence", "rate_confidence", "assumptions", "disclaimers", "carrier_count", "qa_ready", "publish_ready"];
  const rows = queue.map((p) => [
    p.slug || "",
    `"${(p.seo_title || "").replace(/"/g, '""')}"`,
    `"${(p.h1 || "").replace(/"/g, '""')}"`,
    `"${(p.meta_description || "").replace(/"/g, '""')}"`,
    p.target_segment || "",
    p.priority?.rank || "",
    Math.round(num(p.priority?.expected_monthly_revenue, 0)),
    p.lane_stats?.estimated_distance_miles || "",
    p.lane_stats?.estimated_transit_days_range?.min || "",
    p.lane_stats?.estimated_transit_days_range?.max || "",
    p.lane_stats?.estimated_rate_range_usd?.low || "",
    p.lane_stats?.estimated_rate_range_usd?.high || "",
    p.lane_stats?.confidence?.transit || "",
    p.lane_stats?.confidence?.rate || "",
    `"${(p.lane_stats?.assumptions || []).join(" | ").replace(/"/g, '""')}"`,
    `"${(p.lane_stats?.disclaimers || []).join(" | ").replace(/"/g, '""')}"`,
    p.network_proof?.estimated_carrier_count || "",
    qaReady(p) ? "yes" : "no",
    isPublishReady(p) ? "yes" : "no"
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Check a set of pages against the published registry for duplicates.
 * Returns { clean: [...], blocked: [{ page, duplicates }] }
 */
export function checkPageDuplicates(pages, publishedList) {
  const clean = [];
  const blocked = [];
  for (const page of pages) {
    const candidate = {
      slug: page.slug,
      canonical_path: page.canonical_path || `/${page.slug}`,
      seo_title: page.seo_title,
      h1: page.h1,
      intro: page.intro
    };
    const dupes = findDuplicates(candidate, publishedList);
    if (dupes.length > 0) {
      blocked.push({ page, duplicates: dupes });
    } else {
      clean.push(page);
    }
  }
  return { clean, blocked };
}

export function generateSuggestions(metrics) {
  const suggestions = [];
  const ctaCtr = num(metrics.cta_ctr, 0);
  const bounceRate = num(metrics.bounce_rate, 0);
  const quoteStartRate = num(metrics.quote_start_rate, 0);
  const avgTimeOnPage = num(metrics.avg_time_on_page, 0);
  const formSubmitRate = num(metrics.form_submit_rate, 0);
  if (ctaCtr < 3) suggestions.push({ impact: "high", text: "CTA click rate below 3%. Try moving the primary CTA above the fold, using action-first copy, and increasing button contrast." });
  if (bounceRate > 60) suggestions.push({ impact: "high", text: "Bounce rate above 60%. Strengthen the H1-to-search-intent match, add a direct-answer snippet in the first fold, and reduce page load time." });
  if (quoteStartRate < 1) suggestions.push({ impact: "high", text: "Quote start rate under 1%. Simplify the quote form to 3 fields max, add social proof near the CTA, and test urgency copy." });
  if (avgTimeOnPage < 30) suggestions.push({ impact: "medium", text: "Avg time on page under 30s. Add a comparison table and FAQ section to increase engagement depth." });
  if (avgTimeOnPage > 180) suggestions.push({ impact: "medium", text: "Avg time on page over 3min but low conversion. Simplify the page structure and make the next action obvious." });
  if (formSubmitRate < 2) suggestions.push({ impact: "medium", text: "Form submit rate under 2%. Reduce form fields, add inline validation, and show estimated response time." });
  if (ctaCtr >= 3 && quoteStartRate >= 1 && bounceRate <= 60) suggestions.push({ impact: "low", text: "Core metrics look healthy. Test headline variants and CTA copy A/B tests for incremental lift." });
  if (!suggestions.length) suggestions.push({ impact: "low", text: "Enter conversion metrics above to receive optimization suggestions." });
  return suggestions;
}
