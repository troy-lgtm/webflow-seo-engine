// usefulness-gates.js
// ---------------------------------------------------------------------------
// 40+ content-quality rules that every lane page must pass before publishing.
// Each rule returns a structured result with rule_id, passed, severity,
// detail, fix_hint, and auto_fixable.
// ---------------------------------------------------------------------------

// ---- helpers --------------------------------------------------------------

function result(rule_id, passed, severity, detail, fix_hint, auto_fixable = false) {
  return { rule_id, passed, severity, detail, fix_hint, auto_fixable };
}

/** Average sentence length (in words) for a block of text. */
function avgSentenceLen(text) {
  if (!text) return 0;
  const sentences = text
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return 0;
  const totalWords = sentences.reduce(
    (sum, s) => sum + s.split(/\s+/).filter(Boolean).length,
    0
  );
  return totalWords / sentences.length;
}

/** Count sentences in a block of text. */
function countSentences(text) {
  if (!text) return 0;
  return text
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

/** Combine all body-text sections into one string for scanning. */
function bodyText(page) {
  return [
    page.intro,
    page.problem_section,
    page.solution_section,
    page.proof_section,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Combine all scannable text (body + faq answers). */
function allText(page) {
  const parts = [bodyText(page)];
  if (Array.isArray(page.faq)) {
    for (const item of page.faq) {
      if (item.a) parts.push(item.a);
    }
  }
  return parts.join(" ");
}

/** Carrier name patterns. */
const CARRIER_NAMES = [
  "FedEx Freight",
  "XPO",
  "SAIA",
  "Old Dominion",
  "Estes",
  "ABF",
  "R\\+L Carriers",
  "YRC",
  "Holland",
];
const CARRIER_RE = new RegExp(`(${CARRIER_NAMES.join("|")})`, "i");

// ---- STRUCTURE rules (UF-STRUCT-01 .. UF-STRUCT-08) -----------------------

function ufStruct01(page) {
  const id = "UF-STRUCT-01";
  const has = typeof page.h1 === "string" && page.h1.trim().length > 0;
  return result(
    id,
    has,
    "block",
    has
      ? `H1 is present: '${page.h1.trim()}'`
      : "H1 is missing or empty",
    "Add an H1 heading to the page"
  );
}

function ufStruct02(page, quickAnswers) {
  const id = "UF-STRUCT-02";
  const hasFaq =
    Array.isArray(page.faq) &&
    page.faq.some((item) => item.a && item.a.trim().length > 0);
  const hasQA =
    Array.isArray(quickAnswers) &&
    quickAnswers.some(
      (item) => item.answer && item.answer.trim().length > 0
    );
  const passed = hasFaq || hasQA;
  return result(
    id,
    passed,
    "block",
    passed
      ? "Page has at least one answered FAQ or quick answer"
      : "No FAQ answers and no quick answers found",
    "Add at least one FAQ with an answer or provide quick answers"
  );
}

function ufStruct03(page) {
  const id = "UF-STRUCT-03";
  const range = page.lane_stats?.estimated_transit_days_range;
  const has =
    range &&
    typeof range.min === "number" &&
    typeof range.max === "number";
  return result(
    id,
    has,
    "block",
    has
      ? `Transit range present: ${range.min}-${range.max} days`
      : "Lane stats missing transit days range",
    "Ensure lane_stats.estimated_transit_days_range has min and max values"
  );
}

function ufStruct04(page) {
  const id = "UF-STRUCT-04";
  const hasProblem =
    typeof page.problem_section === "string" &&
    page.problem_section.trim().length > 0;
  const hasSolution =
    typeof page.solution_section === "string" &&
    page.solution_section.trim().length > 0;
  const passed = hasProblem || hasSolution;
  return result(
    id,
    passed,
    "block",
    passed
      ? "Cost drivers section exists (problem and/or solution)"
      : "Neither problem_section nor solution_section is present",
    "Add a problem_section or solution_section covering cost drivers"
  );
}

function ufStruct05(page) {
  const id = "UF-STRUCT-05";
  const quoteRe = /quote/i;
  const hasPrimary =
    typeof page.cta_primary === "string" && quoteRe.test(page.cta_primary);
  const hasSecondary =
    typeof page.cta_secondary === "string" &&
    quoteRe.test(page.cta_secondary);
  const passed = hasPrimary || hasSecondary;
  return result(
    id,
    passed,
    "block",
    passed
      ? 'CTA with "quote" in text exists'
      : 'No CTA text contains "quote"',
    'Add a CTA with "Quote" in its text so users know how to get an exact quote'
  );
}

function ufStruct06(page) {
  const id = "UF-STRUCT-06";
  const count = Array.isArray(page.faq) ? page.faq.length : 0;
  const passed = count >= 5;
  return result(
    id,
    passed,
    "block",
    passed
      ? `FAQ count is ${count} (>= 5)`
      : `FAQ count is ${count} (need at least 5)`,
    "Add more FAQ entries so there are at least 5"
  );
}

function ufStruct07(page) {
  const id = "UF-STRUCT-07";
  const lanes = Array.isArray(page.related_lanes)
    ? page.related_lanes.length
    : 0;
  const guides = Array.isArray(page.related_guides)
    ? page.related_guides.length
    : 0;
  const total = lanes + guides;
  const passed = total >= 7;
  return result(
    id,
    passed,
    "warn",
    passed
      ? `Internal links count is ${total} (>= 7)`
      : `Internal links count is ${total} (need at least 7)`,
    "Add more related_lanes or related_guides so total internal links >= 7"
  );
}

function ufStruct08(page) {
  const id = "UF-STRUCT-08";
  const refRe = /reference|index|guide/i;
  const refs = Array.isArray(page.related_guides)
    ? page.related_guides.filter(
        (g) => typeof g.href === "string" && refRe.test(g.href)
      )
    : [];
  const count = refs.length;
  const passed = count >= 3;
  return result(
    id,
    passed,
    "warn",
    passed
      ? `Reference links count is ${count} (>= 3)`
      : `Reference links count is ${count} (need at least 3)`,
    'Add more related_guides whose href contains "reference", "index", or "guide"'
  );
}

// ---- LANE SPECIFICITY rules (UF-LANE-01 .. UF-LANE-09) -------------------

function ufLane01(page) {
  const id = "UF-LANE-01";
  const origin = page.lane?.origin;
  if (!origin) {
    return result(id, false, "block", "Lane origin is not set", "Set lane.origin");
  }
  const found =
    typeof page.intro === "string" &&
    page.intro.toLowerCase().includes(origin.toLowerCase());
  return result(
    id,
    found,
    "block",
    found
      ? `Origin city "${origin}" appears in intro`
      : `Origin city "${origin}" not found in intro`,
    `Mention "${origin}" in the intro paragraph`
  );
}

function ufLane02(page) {
  const id = "UF-LANE-02";
  const destination = page.lane?.destination;
  if (!destination) {
    return result(
      id,
      false,
      "block",
      "Lane destination is not set",
      "Set lane.destination"
    );
  }
  const found =
    typeof page.intro === "string" &&
    page.intro.toLowerCase().includes(destination.toLowerCase());
  return result(
    id,
    found,
    "block",
    found
      ? `Destination city "${destination}" appears in intro`
      : `Destination city "${destination}" not found in intro`,
    `Mention "${destination}" in the intro paragraph`
  );
}

function ufLane03(page, quickAnswers) {
  const id = "UF-LANE-03";
  const origin = page.lane?.origin || "";
  const destination = page.lane?.destination || "";

  const faqAnswers = Array.isArray(page.faq)
    ? page.faq.map((item) => (item.a || "").toLowerCase()).join(" ")
    : "";
  const qaAnswers = Array.isArray(quickAnswers)
    ? quickAnswers
        .map((item) => (item.answer || "").toLowerCase())
        .join(" ")
    : "";
  const combined = faqAnswers + " " + qaAnswers;

  const hasOrigin = origin && combined.includes(origin.toLowerCase());
  const hasDest = destination && combined.includes(destination.toLowerCase());
  const passed = hasOrigin || hasDest;

  return result(
    id,
    passed,
    "warn",
    passed
      ? "Origin or destination appears in at least one FAQ/quick answer"
      : "Neither origin nor destination found in any FAQ or quick answer",
    "Mention the origin or destination city in at least one FAQ answer or quick answer"
  );
}

function ufLane04(page) {
  const id = "UF-LANE-04";
  const distance = page.lane_stats?.estimated_distance_miles;
  const passed = typeof distance === "number" && distance > 0;
  return result(
    id,
    passed,
    "warn",
    passed
      ? `Lane distance is ${distance} miles`
      : "Lane distance is missing or zero",
    "Ensure lane_stats.estimated_distance_miles exists and is > 0"
  );
}

function ufLane05(page) {
  const id = "UF-LANE-05";
  const range = page.lane_stats?.estimated_transit_days_range;
  const passed =
    range &&
    typeof range.min === "number" &&
    typeof range.max === "number";
  return result(
    id,
    passed,
    "block",
    passed
      ? `Transit range: ${range.min}-${range.max} days`
      : "Transit range min/max not present in lane_stats",
    "Ensure lane_stats.estimated_transit_days_range has min and max"
  );
}

function ufLane06(page) {
  const id = "UF-LANE-06";
  const range = page.lane_stats?.estimated_rate_range_usd;
  const passed =
    range &&
    typeof range.low === "number" &&
    typeof range.high === "number";
  return result(
    id,
    passed,
    "block",
    passed
      ? `Rate range: $${range.low}-$${range.high}`
      : "Rate range low/high not present in lane_stats",
    "Ensure lane_stats.estimated_rate_range_usd has low and high"
  );
}

function ufLane07(page) {
  const id = "UF-LANE-07";
  const conf = page.lane_stats?.confidence;
  const hasTransit = conf && typeof conf.transit === "string" && conf.transit.length > 0;
  const hasRate = conf && typeof conf.rate === "string" && conf.rate.length > 0;
  const passed = hasTransit && hasRate;
  return result(
    id,
    passed,
    "warn",
    passed
      ? `Confidence labels present: transit="${conf.transit}", rate="${conf.rate}"`
      : `Confidence labels missing: transit=${hasTransit ? "yes" : "no"}, rate=${hasRate ? "yes" : "no"}`,
    "Set lane_stats.confidence.transit and lane_stats.confidence.rate"
  );
}

function ufLane08(page) {
  const id = "UF-LANE-08";
  const disclaimers = page.lane_stats?.disclaimers;
  const passed = Array.isArray(disclaimers) && disclaimers.length > 0;
  return result(
    id,
    passed,
    "block",
    passed
      ? `${disclaimers.length} disclaimer(s) present`
      : "No disclaimers found in lane_stats",
    "Add at least one disclaimer to lane_stats.disclaimers"
  );
}

function ufLane09(page) {
  const id = "UF-LANE-09";
  const passed =
    typeof page.archetype === "string" && page.archetype.trim().length > 0;
  return result(
    id,
    passed,
    "warn",
    passed
      ? `Archetype is set: "${page.archetype}"`
      : "Archetype field is not set",
    "Set the archetype field on the page"
  );
}

// ---- READABILITY rules (UF-READ-01 .. UF-READ-05) ------------------------

function ufRead01(page) {
  const id = "UF-READ-01";
  const avg = avgSentenceLen(page.intro);
  const passed = avg <= 25;
  return result(
    id,
    passed,
    "warn",
    passed
      ? `Intro avg sentence length is ${avg.toFixed(1)} words (<= 25)`
      : `Intro avg sentence length is ${avg.toFixed(1)} words (exceeds 25)`,
    "Shorten sentences in the intro so the average is <= 25 words"
  );
}

function ufRead02(page) {
  const id = "UF-READ-02";
  if (!Array.isArray(page.faq) || page.faq.length === 0) {
    return result(
      id,
      true,
      "warn",
      "No FAQ answers to check",
      "Add FAQ entries"
    );
  }
  const answers = page.faq
    .map((item) => item.a)
    .filter((a) => typeof a === "string" && a.trim().length > 0);
  if (answers.length === 0) {
    return result(id, true, "warn", "No FAQ answers to check", "Add FAQ answers");
  }
  const totalAvg =
    answers.reduce((sum, a) => sum + avgSentenceLen(a), 0) / answers.length;
  const passed = totalAvg <= 22;
  return result(
    id,
    passed,
    "warn",
    passed
      ? `FAQ answers avg sentence length is ${totalAvg.toFixed(1)} words (<= 22)`
      : `FAQ answers avg sentence length is ${totalAvg.toFixed(1)} words (exceeds 22)`,
    "Shorten sentences in FAQ answers so the average is <= 22 words"
  );
}

function ufRead03(page) {
  const id = "UF-READ-03";
  if (!Array.isArray(page.faq) || page.faq.length === 0) {
    return result(id, true, "warn", "No FAQ answers to check", "Add FAQ entries");
  }
  const offenders = [];
  for (const item of page.faq) {
    if (typeof item.a === "string" && countSentences(item.a) > 4) {
      offenders.push(item.q || "(no question)");
    }
  }
  const passed = offenders.length === 0;
  return result(
    id,
    passed,
    "warn",
    passed
      ? "No FAQ answer exceeds 4 sentences"
      : `${offenders.length} FAQ answer(s) exceed 4 sentences: ${offenders.join("; ")}`,
    "Trim FAQ answers to 4 sentences or fewer"
  );
}

function ufRead04(page) {
  const id = "UF-READ-04";
  const sections = {
    intro: page.intro,
    problem_section: page.problem_section,
    solution_section: page.solution_section,
    proof_section: page.proof_section,
  };
  const offenders = [];
  for (const [name, text] of Object.entries(sections)) {
    if (typeof text !== "string") continue;
    const chunks = text.split(/\n/);
    for (const chunk of chunks) {
      if (chunk.length > 800) {
        offenders.push(name);
        break;
      }
    }
  }
  const passed = offenders.length === 0;
  return result(
    id,
    passed,
    "warn",
    passed
      ? "No text section has a wall of text (> 800 chars without newline)"
      : `Wall of text detected in: ${offenders.join(", ")}`,
    "Break long text blocks with newlines so no single block exceeds 800 characters"
  );
}

function ufRead05(page) {
  const id = "UF-READ-05";
  if (!Array.isArray(page.faq) || page.faq.length === 0) {
    return result(
      id,
      false,
      "warn",
      "No FAQ questions to check",
      "Add FAQ entries with question-shaped questions ending in ?"
    );
  }
  const questionShaped = page.faq.filter(
    (item) => typeof item.q === "string" && item.q.trim().endsWith("?")
  );
  const passed = questionShaped.length >= 2;
  return result(
    id,
    passed,
    "warn",
    passed
      ? `${questionShaped.length} FAQ questions are question-shaped (end with "?")`
      : `Only ${questionShaped.length} FAQ question(s) end with "?" (need at least 2)`,
    'Ensure at least 2 FAQ questions end with "?"'
  );
}

// ---- ANTI-HALLUCINATION rules (UF-TRUTH-01 .. UF-TRUTH-04) ---------------

function ufTruth01(page) {
  const id = "UF-TRUTH-01";
  const re = /\$\d{2,}\s*(exactly|precise|guaranteed|specific)/i;
  const text = allText(page);
  const match = re.exec(text);
  const passed = !match;
  return result(
    id,
    passed,
    "block",
    passed
      ? "No exact rate pattern found in body text"
      : `Exact rate pattern found: "${match[0]}"`,
    "Remove exact rate claims (e.g. $500 exactly). Use ranges instead.",
    true
  );
}

function ufTruth02(page) {
  const id = "UF-TRUTH-02";
  const re = /\d+(\.\d+)?\s*days?\s*(exactly|precise|guaranteed)/i;
  const text = allText(page);
  const match = re.exec(text);
  const passed = !match;
  return result(
    id,
    passed,
    "block",
    passed
      ? "No exact transit claim found in body text"
      : `Exact transit claim found: "${match[0]}"`,
    "Remove exact transit claims. Use ranges instead.",
    true
  );
}

function ufTruth03(page) {
  const id = "UF-TRUTH-03";
  const nonFaqText = [
    page.intro,
    page.problem_section,
    page.solution_section,
  ]
    .filter(Boolean)
    .join(" ");

  const found = [];
  for (const name of CARRIER_NAMES) {
    const re = new RegExp(name, "i");
    if (re.test(nonFaqText)) {
      found.push(name.replace(/\\/g, ""));
    }
  }

  const passed = found.length === 0;
  return result(
    id,
    passed,
    "warn",
    passed
      ? "No specific carrier names in intro/problem/solution"
      : `Carrier name(s) found outside FAQ: ${found.join(", ")}`,
    "Move specific carrier references into FAQ answers or remove them",
    true
  );
}

function ufTruth04(page) {
  const id = "UF-TRUTH-04";
  const re = /\bguarantee[d]?\b/i;
  const sections = [
    page.intro,
    page.problem_section,
    page.solution_section,
    page.proof_section,
  ].filter(Boolean);

  const found = sections.some((s) => re.test(s));
  const passed = !found;
  return result(
    id,
    passed,
    "block",
    passed
      ? 'No "guarantee/guaranteed" found in body sections'
      : '"guarantee" or "guaranteed" found in intro/problem/solution/proof (not in disclaimer)',
    'Remove "guarantee/guaranteed" from body text. Use disclaimers for such language.',
    true
  );
}

// ---- CONVERSION rules (UF-CNV-01 .. UF-CNV-03) ---------------------------

function ufCnv01(page) {
  const id = "UF-CNV-01";
  const quoteRe = /quote/i;
  const hasPrimary =
    typeof page.cta_primary === "string" && quoteRe.test(page.cta_primary);
  const hasSecondary =
    typeof page.cta_secondary === "string" &&
    quoteRe.test(page.cta_secondary);
  const passed = hasPrimary || hasSecondary;
  return result(
    id,
    passed,
    "block",
    passed
      ? 'CTA text contains "quote"'
      : 'Neither primary nor secondary CTA text contains "quote"',
    'Include "quote" in CTA text (e.g. "Get a Free Quote")'
  );
}

function ufCnv02(page) {
  const id = "UF-CNV-02";
  const badRe = /localhost|127\.0\.0\.1/i;
  const urls = [page.cta_primary_url, page.cta_secondary_url].filter(Boolean);
  const offenders = urls.filter((u) => badRe.test(u));
  const passed = offenders.length === 0;
  return result(
    id,
    passed,
    "block",
    passed
      ? "CTA URLs do not reference localhost"
      : `CTA URL(s) contain localhost: ${offenders.join(", ")}`,
    "Replace localhost URLs with production URLs"
  );
}

function ufCnv03(page) {
  const id = "UF-CNV-03";
  const url = page.cta_primary_url;
  const passed =
    typeof url === "string" && url.startsWith("https://");
  return result(
    id,
    passed,
    "warn",
    passed
      ? "Primary CTA URL starts with https://"
      : `Primary CTA URL does not start with https://: "${url || "(empty)"}"`,
    "Ensure the primary CTA URL starts with https://"
  );
}

// ---- Rule registry --------------------------------------------------------

const ALL_RULES = [
  // STRUCTURE
  { id: "UF-STRUCT-01", fn: ufStruct01 },
  { id: "UF-STRUCT-02", fn: ufStruct02, needsQA: true },
  { id: "UF-STRUCT-03", fn: ufStruct03 },
  { id: "UF-STRUCT-04", fn: ufStruct04 },
  { id: "UF-STRUCT-05", fn: ufStruct05 },
  { id: "UF-STRUCT-06", fn: ufStruct06 },
  { id: "UF-STRUCT-07", fn: ufStruct07 },
  { id: "UF-STRUCT-08", fn: ufStruct08 },
  // LANE SPECIFICITY
  { id: "UF-LANE-01", fn: ufLane01 },
  { id: "UF-LANE-02", fn: ufLane02 },
  { id: "UF-LANE-03", fn: ufLane03, needsQA: true },
  { id: "UF-LANE-04", fn: ufLane04 },
  { id: "UF-LANE-05", fn: ufLane05 },
  { id: "UF-LANE-06", fn: ufLane06 },
  { id: "UF-LANE-07", fn: ufLane07 },
  { id: "UF-LANE-08", fn: ufLane08 },
  { id: "UF-LANE-09", fn: ufLane09 },
  // READABILITY
  { id: "UF-READ-01", fn: ufRead01 },
  { id: "UF-READ-02", fn: ufRead02 },
  { id: "UF-READ-03", fn: ufRead03 },
  { id: "UF-READ-04", fn: ufRead04 },
  { id: "UF-READ-05", fn: ufRead05 },
  // ANTI-HALLUCINATION
  { id: "UF-TRUTH-01", fn: ufTruth01 },
  { id: "UF-TRUTH-02", fn: ufTruth02 },
  { id: "UF-TRUTH-03", fn: ufTruth03 },
  { id: "UF-TRUTH-04", fn: ufTruth04 },
  // CONVERSION
  { id: "UF-CNV-01", fn: ufCnv01 },
  { id: "UF-CNV-02", fn: ufCnv02 },
  { id: "UF-CNV-03", fn: ufCnv03 },
];

// ---- Public API -----------------------------------------------------------

/**
 * Run all usefulness gates against a page.
 * @param {object} page - The lane page object
 * @param {object} [options] - Optional { quickAnswers: [...] }
 * @returns {{ passed: boolean, results: Array<{rule_id:string, passed:boolean, severity:string, detail:string, fix_hint:string, auto_fixable:boolean}>, blockers: number, warnings: number }}
 */
export function runUsefulnessGates(page, options = {}) {
  const quickAnswers = options.quickAnswers || [];
  const results = [];

  for (const rule of ALL_RULES) {
    let res;
    if (rule.needsQA) {
      res = rule.fn(page, quickAnswers);
    } else {
      res = rule.fn(page);
    }
    results.push(res);
  }

  const blockers = results.filter((r) => !r.passed && r.severity === "block").length;
  const warnings = results.filter((r) => !r.passed && r.severity === "warn").length;
  const passed = blockers === 0;

  return { passed, results, blockers, warnings };
}

/**
 * Get all rule IDs.
 * @returns {string[]} Array of all rule ID strings
 */
export function getAllRuleIds() {
  return ALL_RULES.map((r) => r.id);
}
