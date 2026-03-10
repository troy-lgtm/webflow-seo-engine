/**
 * Page Quality Contract
 * Hard contract for what every lane page must contain.
 * No page may publish without meeting all required sections and answer fields.
 */

// ── Required sections ──────────────────────────────────────────────

const REQUIRED_SECTIONS = [
  { id: "h1", label: "H1 Heading", field: "h1" },
  { id: "quick_answer", label: "Quick Answer", field: "quick_answer" },
  { id: "transit_section", label: "Transit Time", field: "lane_stats.transit_days_range" },
  { id: "cost_estimate", label: "Cost Estimate / Rate Range", field: "lane_stats.rate_range_usd" },
  { id: "cost_drivers", label: "Cost Drivers", field: "cost_drivers" },
  { id: "lane_insight", label: "Lane Specific Insight", field: "lane_insight" },
  { id: "faq", label: "FAQ (min 5)", field: "faq", minCount: 5 },
  { id: "quote_cta", label: "Quote CTA", field: "cta_label" },
  { id: "internal_links", label: "Internal Links (min 5)", field: "related_lanes", minCount: 5 },
  { id: "reference_links", label: "Reference Links (min 3)", field: "related_guides", minCount: 3 },
];

const REQUIRED_ANSWER_FIELDS = [
  { id: "origin", label: "Origin", check: (p) => !!(p.origin_city || p.origin) },
  { id: "destination", label: "Destination", check: (p) => !!(p.destination_city || p.destination) },
  { id: "mode", label: "Mode", check: (p) => !!p.mode },
  { id: "distance_estimate", label: "Distance Estimate", check: (p) => p.lane_stats?.distance_miles > 0 },
  { id: "transit_range", label: "Transit Range", check: (p) => !!p.lane_stats?.transit_days_range },
  { id: "rate_range", label: "Rate Range", check: (p) => !!p.lane_stats?.rate_range_usd },
  {
    id: "confidence_methodology",
    label: "Confidence / Methodology",
    check: (p) =>
      !!(p.confidence?.transit || p.confidence?.rate) ||
      /modeled|estimated|approximate|typical|based on/i.test(JSON.stringify(p.lane_stats || {})),
  },
];

const TRUTHFULNESS_RULES = [
  { id: "no_exact_rate", pattern: /\bexact\s+(rate|price|cost)\b/i, message: "No exact rate claims allowed" },
  { id: "no_exact_transit", pattern: /\bexact\s+transit\b/i, message: "No exact transit claims allowed" },
  { id: "no_guarantee", pattern: /\bguarantee[ds]?\b/i, message: "No guarantee language allowed" },
  { id: "no_always_deliver", pattern: /\balways\s+(deliver|arrive|cost)\b/i, message: "No absolute delivery claims" },
  { id: "no_lowest_price", pattern: /\blowest\s+(price|rate|cost)\b/i, message: "No lowest price claims" },
  { id: "no_fastest_transit", pattern: /\bfastest\s+transit\b/i, message: "No fastest transit claims" },
];

// ── Helpers ────────────────────────────────────────────────────────

function getNestedField(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let val = obj;
  for (const p of parts) {
    if (val == null) return undefined;
    val = val[p];
  }
  return val;
}

function collectTextFields(page) {
  const fields = [];
  if (page.seo_title) fields.push(page.seo_title);
  if (page.meta_description) fields.push(page.meta_description);
  if (page.h1) fields.push(page.h1);
  if (page.intro) fields.push(page.intro);
  if (page.quick_answer) fields.push(page.quick_answer);
  if (page.cost_drivers) fields.push(page.cost_drivers);
  if (page.lane_insight) fields.push(page.lane_insight);
  if (page.problem) fields.push(page.problem);
  if (page.solution) fields.push(page.solution);
  if (Array.isArray(page.faq)) {
    for (const f of page.faq) {
      if (f.q) fields.push(f.q);
      if (f.a) fields.push(f.a);
    }
  }
  return fields;
}

// ── Exports ────────────────────────────────────────────────────────

export function getRequiredSections() {
  return [...REQUIRED_SECTIONS];
}

export function getRequiredAnswerFields() {
  return [...REQUIRED_ANSWER_FIELDS];
}

export function getTruthfulnessRules() {
  return [...TRUTHFULNESS_RULES];
}

/**
 * Validate a page object against the hard quality contract.
 * @param {object} page
 * @returns {{ passed, score, sections, answer_fields, truthfulness, missing, blocking_failures }}
 */
export function validatePageQuality(page) {
  if (!page) {
    return {
      passed: false,
      score: 0,
      sections: [],
      answer_fields: [],
      truthfulness: [],
      missing: ["page object is null/undefined"],
      blocking_failures: ["page object is null/undefined"],
    };
  }

  const sectionResults = [];
  const missing = [];
  const blocking = [];

  // 1. Check required sections
  for (const s of REQUIRED_SECTIONS) {
    const val = getNestedField(page, s.field);
    let passed = false;
    let detail = "";

    if (s.minCount) {
      const arr = Array.isArray(val) ? val : [];
      passed = arr.length >= s.minCount;
      detail = passed
        ? `${arr.length} items (min ${s.minCount})`
        : `Only ${arr.length} items, need ${s.minCount}`;
    } else {
      passed = val != null && val !== "" && val !== 0;
      detail = passed ? "present" : "missing or empty";
    }

    sectionResults.push({ id: s.id, label: s.label, passed, detail });
    if (!passed) {
      missing.push(s.label);
      blocking.push(`Missing required section: ${s.label}`);
    }
  }

  // 2. Check required answer fields
  const answerResults = [];
  for (const a of REQUIRED_ANSWER_FIELDS) {
    const passed = a.check(page);
    answerResults.push({
      id: a.id,
      label: a.label,
      passed,
      detail: passed ? "present" : "missing",
    });
    if (!passed) {
      missing.push(a.label);
      blocking.push(`Missing required answer field: ${a.label}`);
    }
  }

  // 3. Check truthfulness rules
  const truthResults = [];
  const allText = collectTextFields(page).join(" ");
  for (const r of TRUTHFULNESS_RULES) {
    const match = r.pattern.exec(allText);
    const passed = !match;
    truthResults.push({
      id: r.id,
      passed,
      detail: passed ? "clean" : `Found: "${match[0]}" — ${r.message}`,
    });
    if (!passed) {
      blocking.push(`Truthfulness violation [${r.id}]: ${r.message}`);
    }
  }

  // 4. Compute score
  const totalChecks = sectionResults.length + answerResults.length + truthResults.length;
  const passedChecks =
    sectionResults.filter((r) => r.passed).length +
    answerResults.filter((r) => r.passed).length +
    truthResults.filter((r) => r.passed).length;
  const score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;

  return {
    passed: blocking.length === 0,
    score,
    sections: sectionResults,
    answer_fields: answerResults,
    truthfulness: truthResults,
    missing,
    blocking_failures: blocking,
  };
}
