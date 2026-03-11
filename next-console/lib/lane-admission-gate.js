/**
 * Lane Admission Gate — Pre-Publish Admission System
 *
 * Evaluates whether a lane page deserves to exist before it enters the
 * publish pipeline. Scores 6 dimensions of page worthiness and blocks
 * pages that are generic, thin, or graph-worthless.
 *
 * This is a STRUCTURAL gate, not a content quality gate. The quality
 * gate (assessPublishQuality) checks rendering and schema correctness.
 * The admission gate checks whether the page adds value to the site.
 *
 * Dimensions:
 *   1. Differentiation (20%) — materially different from nearby lanes?
 *   2. Operational Signal Density (25%) — real freight logic present?
 *   3. Graph Contribution (15%) — meaningful authority graph connections?
 *   4. Internal Link Utility (10%) — creates useful navigation?
 *   5. Content Specificity (20%) — lane-specific reasoning, not template?
 *   6. Publish Worthiness (10%) — meta-assessment across all dimensions
 *
 * Usage:
 *   const result = assessLaneAdmission(knowledge, pageData);
 *   if (!result.admitted) { // block publish }
 *
 * @module lane-admission-gate
 */

import { buildClassificationProfile, classifyLaneAuthority } from "./lane-authority-classifier.js";

// ── Constants ─────────────────────────────────────────────────────────

/**
 * Minimum weighted score (0-100) for a page to be admitted.
 * Pages scoring below this are rejected with explicit reasons.
 */
const ADMISSION_THRESHOLD = 50;

/**
 * Dimension weights. Must sum to 1.0.
 */
const DIMENSION_WEIGHTS = {
  differentiation: 0.20,
  operational_signal_density: 0.25,
  graph_contribution: 0.15,
  internal_link_utility: 0.10,
  content_specificity: 0.20,
  publish_worthiness: 0.10,
};

/**
 * Operational freight terminology indicating real logistics knowledge.
 * These are terms a freight operator would use, not a marketer.
 */
const OPERATIONAL_TERMS = [
  "cross-dock", "crossdock", "linehaul", "line-haul",
  "transit", "carrier", "pallet", "freight class", "nmfc",
  "accessorial", "appointment", "dock", "trailer",
  "dry van", "reefer", "flatbed", "intermodal",
  "consolidation", "deconsolidation", "pickup", "delivery",
  "routing", "hub", "terminal", "capacity", "equipment",
  "tracking", "pod", "bill of lading", "bol",
  "detention", "demurrage", "fuel surcharge",
  "liftgate", "residential", "limited access",
  "shipment", "freight", "load", "palletized",
  "cross-dock routing", "carrier selection", "transit time",
  "rate", "quoting", "booking",
];

/**
 * Marketing fluff terms that indicate template copy, not operational insight.
 */
const FLUFF_TERMS = [
  "revolutionary", "game-changing", "world-class", "cutting-edge",
  "seamless", "frictionless", "disruptive", "supercharge",
  "next-generation", "state-of-the-art", "unparalleled",
  "best-in-class", "holistic", "synergy",
  "leverage", "paradigm", "ecosystem",
];

// ── Helpers ───────────────────────────────────────────────────────────

function wordCount(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function hasSubstring(text, sub) {
  if (!text || !sub) return false;
  return text.toLowerCase().includes(sub.toLowerCase());
}

/**
 * Extract all meaningful text from canonical page data.
 * Joins section bodies, FAQ content, operating detail items, and why WARP reasons.
 */
function extractAllText(pageData) {
  const parts = [];
  const p = pageData || {};

  if (p.hero?.subhead) parts.push(p.hero.subhead);
  if (p.lane_overview?.body) parts.push(p.lane_overview.body);
  if (p.warp_fit_for_lane?.body) parts.push(p.warp_fit_for_lane.body);
  if (p.pricing_and_commercial_framing?.body) parts.push(p.pricing_and_commercial_framing.body);
  if (p.best_fit_shipments?.intro) parts.push(p.best_fit_shipments.intro);

  // Operating details items
  if (p.operating_details?.items) {
    for (const item of p.operating_details.items) {
      if (item.label) parts.push(item.label);
      if (item.value) parts.push(item.value);
    }
  }

  // FAQ content
  const faqs = p.lane_specific_faqs || [];
  for (const faq of faqs) {
    if (faq.question || faq.q) parts.push(faq.question || faq.q);
    if (faq.answer || faq.a) parts.push(faq.answer || faq.a);
  }

  // Why WARP reasons
  if (p.why_warp?.reasons) {
    for (const r of p.why_warp.reasons) {
      if (r.heading) parts.push(r.heading);
      if (r.body) parts.push(r.body);
    }
  }

  // Best-fit shipment items
  if (p.best_fit_shipments?.items) {
    for (const item of p.best_fit_shipments.items) {
      if (item.type) parts.push(item.type);
      if (item.description) parts.push(item.description);
    }
  }

  return parts.filter(Boolean).join(" ");
}

/**
 * Count distinct terms from a list found in text. Case-insensitive.
 */
function countDistinctTerms(text, termList) {
  const lower = (text || "").toLowerCase();
  let count = 0;
  for (const term of termList) {
    if (lower.includes(term.toLowerCase())) count++;
  }
  return count;
}

/**
 * Count total occurrences of terms from a list in text. Case-insensitive.
 */
function countTermOccurrences(text, termList) {
  const lower = (text || "").toLowerCase();
  let count = 0;
  for (const term of termList) {
    const termLower = term.toLowerCase();
    let idx = 0;
    while ((idx = lower.indexOf(termLower, idx)) !== -1) {
      count++;
      idx += termLower.length;
    }
  }
  return count;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip lane-specific variables from text for boilerplate measurement.
 * Replaces city names, mode names, dollar amounts, distances, transit
 * times, and percentages with placeholders. Self-contained — does not
 * depend on uniqueness-engine.js (which uses @/ alias).
 */
function stripLaneVariables(text, originCity, destCity) {
  if (!text) return "";
  let stripped = text.toLowerCase();

  // Strip origin/destination city names
  for (const city of [originCity, destCity].filter(Boolean)) {
    const name = city.toLowerCase().split(",")[0].trim();
    if (name.length >= 3) {
      stripped = stripped.replace(new RegExp(escapeRegex(name), "g"), "{CITY}");
    }
  }

  // Strip mode names
  stripped = stripped.replace(/\b(ltl|ftl|cargo van|box truck|truckload|less than truckload|full truckload)\b/g, "{MODE}");

  // Strip dollar amounts
  stripped = stripped.replace(/\$[\d,]+(?:\.\d{1,2})?/g, "{AMOUNT}");

  // Strip distances
  stripped = stripped.replace(/[\d,]+(?:\.\d+)?[\s-]*(?:mile|miles|mi)\b/g, "{DISTANCE}");

  // Strip transit day ranges
  stripped = stripped.replace(/\d+[\s]*[-\u2013][\s]*\d+\s*(?:business\s+)?days?/g, "{TRANSIT}");
  stripped = stripped.replace(/\d+\s*(?:business\s+)?days?\b/g, "{TRANSIT}");

  // Strip percentages
  stripped = stripped.replace(/[\d.]+\s*%/g, "{PCT}");

  // Strip standalone numbers
  stripped = stripped.replace(/\b\d[\d,]*(?:\.\d+)?\b/g, "{N}");

  return stripped;
}

/**
 * Weighted dimension score computation.
 * Same pattern as page-quality-scorer.js.
 * @returns {number} 0.0 - 1.0
 */
function computeDimensionScore(checks) {
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const weightedScore = checks.reduce((s, c) => s + c.score * c.weight, 0);
  return totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) / 100 : 0;
}

// ── Dimension 1: Differentiation (20%) ────────────────────────────────
//
// Is this lane page materially different from nearby lanes?
// Measures: template ratio, word count, FAQ specificity,
//           heading specificity, absence of marketing fluff.

function scoreDifferentiation(knowledge, pageData) {
  const checks = [];
  const allText = extractAllText(pageData);
  const origin = pageData.origin || knowledge.origin_city || "";
  const dest = pageData.destination || knowledge.destination_city || "";
  const originCity = origin.split(",")[0].trim();
  const destCity = dest.split(",")[0].trim();

  // 1a. Template ratio — after stripping lane variables, what fraction is placeholders?
  const stripped = stripLaneVariables(allText, origin, dest);
  const originalWords = wordCount(allText);
  const placeholderCount = (stripped.match(/\{[A-Z]+\}/g) || []).length;
  const templateRatio = originalWords > 0 ? placeholderCount / originalWords : 1;
  checks.push({
    id: "diff_template_ratio",
    score: templateRatio < 0.05 ? 1 : templateRatio < 0.10 ? 0.8 : templateRatio < 0.15 ? 0.6 : templateRatio < 0.25 ? 0.4 : 0.2,
    weight: 1.0,
  });

  // 1b. Word count — substantial content provides more differentiation surface
  checks.push({
    id: "diff_word_count",
    score: originalWords >= 800 ? 1 : originalWords >= 500 ? 0.7 : originalWords >= 300 ? 0.4 : 0.2,
    weight: 0.8,
  });

  // 1c. FAQ answer specificity — do FAQ answers mention both origin AND destination?
  const faqs = pageData.lane_specific_faqs || [];
  const specificFaqs = faqs.filter(f => {
    const answer = f.answer || f.a || "";
    return hasSubstring(answer, originCity) && hasSubstring(answer, destCity);
  });
  checks.push({
    id: "diff_faq_specificity",
    score: faqs.length > 0 ? Math.min(1, specificFaqs.length / Math.max(faqs.length * 0.5, 1)) : 0,
    weight: 0.8,
  });

  // 1d. Heading specificity — do section headings reference the lane?
  const headings = [
    pageData.lane_overview?.heading,
    pageData.warp_fit_for_lane?.heading,
    pageData.operating_details?.heading,
    pageData.pricing_and_commercial_framing?.heading,
  ].filter(Boolean);
  const laneSpecificHeadings = headings.filter(h =>
    hasSubstring(h, originCity) || hasSubstring(h, destCity)
  );
  checks.push({
    id: "diff_heading_specificity",
    score: headings.length > 0 ? Math.min(1, laneSpecificHeadings.length / headings.length) : 0,
    weight: 0.6,
  });

  // 1e. No marketing fluff — fluff indicates template copy, not differentiation
  const fluffCount = countDistinctTerms(allText, FLUFF_TERMS);
  checks.push({
    id: "diff_no_fluff",
    score: fluffCount === 0 ? 1 : fluffCount <= 1 ? 0.7 : fluffCount <= 3 ? 0.4 : 0.1,
    weight: 0.8,
  });

  const score = computeDimensionScore(checks);
  return { score, checks };
}

// ── Dimension 2: Operational Signal Density (25%) ─────────────────────
//
// Does the page contain real freight logic or lane-specific insight?
// Measures: operational term diversity, term frequency, stats completeness,
//           infrastructure references, numeric evidence, seasonality.

function scoreOperationalDensity(knowledge, pageData) {
  const checks = [];
  const allText = extractAllText(pageData);
  const ls = knowledge.lane_stats || pageData.lane_stats || {};
  const np = knowledge.network_proof || pageData.network_proof || {};

  // 2a. Operational term diversity — how many distinct freight terms appear?
  const opTermCount = countDistinctTerms(allText, OPERATIONAL_TERMS);
  checks.push({
    id: "ops_term_diversity",
    score: opTermCount >= 15 ? 1 : opTermCount >= 10 ? 0.8 : opTermCount >= 6 ? 0.6 : opTermCount >= 3 ? 0.3 : 0.1,
    weight: 1.2,
  });

  // 2b. Operational term frequency — total occurrences (depth, not just breadth)
  const opOccurrences = countTermOccurrences(allText, OPERATIONAL_TERMS);
  checks.push({
    id: "ops_term_frequency",
    score: opOccurrences >= 40 ? 1 : opOccurrences >= 25 ? 0.8 : opOccurrences >= 15 ? 0.5 : opOccurrences >= 5 ? 0.3 : 0.1,
    weight: 0.8,
  });

  // 2c. Lane stats completeness — real data points present?
  const statsPresent = [
    (ls.estimated_distance_miles || 0) > 0,
    (ls.estimated_transit_days_range?.min || 0) > 0,
    (ls.estimated_rate_range_usd?.low || 0) > 0,
    (ls.common_equipment || []).length > 0,
    (np.estimated_carrier_count || 0) > 0,
  ].filter(Boolean).length;
  checks.push({
    id: "ops_stats_completeness",
    score: statsPresent / 5,
    weight: 1.0,
  });

  // 2d. Infrastructure references — cross-docks and hub mentions
  const crossDocks = np.nearest_cross_docks || [];
  checks.push({
    id: "ops_infrastructure_refs",
    score: crossDocks.length >= 3 ? 1 : crossDocks.length >= 2 ? 0.7 : crossDocks.length >= 1 ? 0.4 : 0.1,
    weight: 0.8,
  });

  // 2e. Numeric evidence — specific numbers embedded in prose
  const numberMatches = (allText.match(/\d[\d,]*(?:\.\d+)?/g) || []).length;
  checks.push({
    id: "ops_numeric_evidence",
    score: numberMatches >= 20 ? 1 : numberMatches >= 10 ? 0.7 : numberMatches >= 5 ? 0.4 : 0.2,
    weight: 0.6,
  });

  // 2f. Seasonality / regional intelligence present
  const seasonality = ls.seasonality_notes || "";
  checks.push({
    id: "ops_seasonality",
    score: seasonality.length > 20 ? 1 : seasonality.length > 0 ? 0.5 : 0,
    weight: 0.4,
  });

  const score = computeDimensionScore(checks);
  return { score, checks };
}

// ── Dimension 3: Graph Contribution (15%) ─────────────────────────────
//
// Does the page meaningfully contribute to the authority graph?
// Measures: active relationships, primary count, family coverage,
//           evidence diversity, average relationship score.

function scoreGraphContribution(knowledge) {
  const checks = [];

  let classification;
  try {
    const profile = buildClassificationProfile(knowledge);
    classification = classifyLaneAuthority(profile);
  } catch {
    // If classifier fails, graph contribution is zero
    return {
      score: 0,
      checks: [{ id: "graph_classifier_error", score: 0, weight: 1 }],
    };
  }

  const active = classification.relationships.filter(r => !r.blocked);
  const primary = active.filter(r => r.rank === "primary");

  // 3a. Active relationship count
  checks.push({
    id: "graph_active_relationships",
    score: active.length >= 8 ? 1 : active.length >= 5 ? 0.7 : active.length >= 3 ? 0.5 : active.length > 0 ? 0.3 : 0,
    weight: 1.2,
  });

  // 3b. Primary relationship count
  checks.push({
    id: "graph_primary_count",
    score: primary.length >= 3 ? 1 : primary.length >= 2 ? 0.7 : primary.length >= 1 ? 0.4 : 0,
    weight: 1.0,
  });

  // 3c. Family coverage — are all 3 entity families represented?
  const familySet = new Set(active.map(r => r.entity_family));
  checks.push({
    id: "graph_family_coverage",
    score: familySet.size >= 3 ? 1 : familySet.size >= 2 ? 0.6 : familySet.size >= 1 ? 0.3 : 0,
    weight: 0.8,
  });

  // 3d. Evidence diversity — how many distinct rule types across all evidence?
  const allRuleTypes = new Set();
  for (const rel of active) {
    for (const ev of (rel.evidence || [])) {
      allRuleTypes.add(ev.rule);
    }
  }
  checks.push({
    id: "graph_evidence_diversity",
    score: allRuleTypes.size >= 5 ? 1 : allRuleTypes.size >= 3 ? 0.6 : allRuleTypes.size > 0 ? 0.3 : 0,
    weight: 0.6,
  });

  // 3e. Average relationship score — higher = more confident connections
  const avgScore = active.length > 0
    ? active.reduce((s, r) => s + r.score, 0) / active.length
    : 0;
  checks.push({
    id: "graph_avg_score",
    score: avgScore >= 55 ? 1 : avgScore >= 45 ? 0.7 : avgScore >= 35 ? 0.4 : 0.2,
    weight: 0.6,
  });

  const score = computeDimensionScore(checks);
  return { score, checks };
}

// ── Dimension 4: Internal Link Utility (10%) ──────────────────────────
//
// Does the page create useful navigation links?
// Measures: authority link count, link family diversity,
//           related lanes, tool/guide links.

function scoreInternalLinkUtility(pageData) {
  const checks = [];
  const p = pageData || {};

  // 4a. Authority links count (primary + secondary, as rendered)
  const authorityLinks = (p.authority_links || []).filter(
    l => l.rank === "primary" || l.rank === "secondary"
  );
  checks.push({
    id: "link_authority_count",
    score: authorityLinks.length >= 5 ? 1 : authorityLinks.length >= 3 ? 0.7 : authorityLinks.length >= 1 ? 0.4 : 0,
    weight: 1.2,
  });

  // 4b. Authority link family diversity
  const linkFamilies = new Set(authorityLinks.map(l => l.family));
  checks.push({
    id: "link_family_diversity",
    score: linkFamilies.size >= 3 ? 1 : linkFamilies.size >= 2 ? 0.6 : linkFamilies.size >= 1 ? 0.3 : 0,
    weight: 0.8,
  });

  // 4c. Related lanes present
  const relatedLanes = p.related_links?.related_lanes || [];
  checks.push({
    id: "link_related_lanes",
    score: relatedLanes.length >= 5 ? 1 : relatedLanes.length >= 3 ? 0.7 : relatedLanes.length >= 1 ? 0.4 : 0,
    weight: 0.8,
  });

  // 4d. Tool link present
  const hasToolLink = !!p.related_links?.tool_link;
  checks.push({
    id: "link_tool_present",
    score: hasToolLink ? 1 : 0,
    weight: 0.4,
  });

  const score = computeDimensionScore(checks);
  return { score, checks };
}

// ── Dimension 5: Content Specificity (20%) ────────────────────────────
//
// Does the page contain lane-specific freight reasoning?
// Measures: body lane mentions, FAQ lane references, distance context,
//           region references, cross-dock name references, equipment refs.

function scoreContentSpecificity(knowledge, pageData) {
  const checks = [];
  const p = pageData || {};
  const allText = extractAllText(p);
  const originCity = (p.origin || knowledge.origin_city || "").split(",")[0].trim();
  const destCity = (p.destination || knowledge.destination_city || "").split(",")[0].trim();

  // 5a. Section bodies mention origin AND destination (beyond headings)
  const bodyTexts = [
    p.lane_overview?.body,
    p.warp_fit_for_lane?.body,
    p.pricing_and_commercial_framing?.body,
  ].filter(Boolean);
  const specificBodies = bodyTexts.filter(t =>
    hasSubstring(t, originCity) && hasSubstring(t, destCity)
  );
  checks.push({
    id: "spec_body_lane_mentions",
    score: bodyTexts.length > 0 ? specificBodies.length / bodyTexts.length : 0,
    weight: 1.2,
  });

  // 5b. FAQ specificity — fraction of FAQs mentioning both cities
  const faqs = p.lane_specific_faqs || [];
  const specificFaqs = faqs.filter(f => {
    const text = (f.question || f.q || "") + " " + (f.answer || f.a || "");
    return hasSubstring(text, originCity) && hasSubstring(text, destCity);
  });
  checks.push({
    id: "spec_faq_lane_refs",
    score: faqs.length > 0 ? specificFaqs.length / faqs.length : 0,
    weight: 1.0,
  });

  // 5c. Distance-band contextual copy — content should adapt to distance
  const dist = (knowledge.lane_stats || p.lane_stats || {}).estimated_distance_miles || 0;
  const distTerms = dist > 1000
    ? ["long-haul", "long haul", "interstate", "linehaul"]
    : dist > 500
      ? ["regional", "interstate", "corridor"]
      : dist > 200
        ? ["regional", "corridor"]
        : ["short-haul", "short haul", "metro", "local"];
  const distTermHits = countDistinctTerms(allText, distTerms);
  checks.push({
    id: "spec_distance_context",
    score: distTermHits >= 2 ? 1 : distTermHits >= 1 ? 0.6 : 0.2,
    weight: 0.8,
  });

  // 5d. Region references — mentions specific regions in prose
  const np = knowledge.network_proof || p.network_proof || {};
  const regions = [np.origin_region, np.destination_region].filter(r => r && r !== "Unknown");
  const regionHits = regions.filter(r => hasSubstring(allText, r)).length;
  checks.push({
    id: "spec_region_refs",
    score: regions.length > 0 ? regionHits / regions.length : 0,
    weight: 0.6,
  });

  // 5e. Cross-dock name references in prose
  const crossDocks = np.nearest_cross_docks || [];
  const crossDockMentions = crossDocks.filter(cd => hasSubstring(allText, cd)).length;
  checks.push({
    id: "spec_crossdock_refs",
    score: crossDocks.length > 0 ? Math.min(1, crossDockMentions / crossDocks.length) : 0,
    weight: 0.6,
  });

  // 5f. Equipment specificity — mentions actual equipment types in prose
  const equipment = (knowledge.lane_stats || p.lane_stats || {}).common_equipment || [];
  const equipMentions = equipment.filter(e => hasSubstring(allText, e)).length;
  checks.push({
    id: "spec_equipment_refs",
    score: equipment.length > 0 ? Math.min(1, equipMentions / equipment.length) : 0,
    weight: 0.6,
  });

  const score = computeDimensionScore(checks);
  return { score, checks };
}

// ── Dimension 6: Publish Worthiness (10%) ─────────────────────────────
//
// Meta-assessment: should this page exist at all?
// Derived from the other 5 dimensions. Penalizes pages with critical
// weaknesses in any dimension, rewards consistent quality.

function scorePublishWorthiness(dims) {
  const checks = [];
  const dimScores = [
    dims.differentiation.score,
    dims.operational_signal_density.score,
    dims.graph_contribution.score,
    dims.internal_link_utility.score,
    dims.content_specificity.score,
  ];

  // 6a. Cross-dimensional average
  const avg = dimScores.reduce((s, v) => s + v, 0) / dimScores.length;
  checks.push({
    id: "worth_avg_dims",
    score: avg,
    weight: 1.0,
  });

  // 6b. No critical weakness — penalize if any dimension below 0.3
  const weakDims = dimScores.filter(s => s < 0.3).length;
  checks.push({
    id: "worth_no_weakness",
    score: weakDims === 0 ? 1 : weakDims === 1 ? 0.5 : 0.2,
    weight: 1.2,
  });

  // 6c. Consistency — reward if all dimensions above 0.5
  const allAboveHalf = dimScores.every(s => s >= 0.5);
  checks.push({
    id: "worth_consistency",
    score: allAboveHalf ? 1 : 0.4,
    weight: 0.8,
  });

  const score = computeDimensionScore(checks);
  return { score, checks };
}

// ── Main Entry Point ──────────────────────────────────────────────────

/**
 * Assess whether a lane page should be admitted for publish.
 *
 * @param {object} knowledge - Output of buildLaneKnowledge()
 * @param {object} pageData - Output of buildCanonicalLanePageData()
 * @returns {{
 *   admitted: boolean,
 *   score: number,       // 0-100
 *   grade: string,       // A/B/C/D/F
 *   dimensions: object,  // per-dimension scores and checks
 *   rejections: Array<{ dimension: string, reason: string }>,
 *   debug: object,       // raw scoring internals
 * }}
 */
export function assessLaneAdmission(knowledge, pageData) {
  // Score each dimension independently
  const diff = scoreDifferentiation(knowledge, pageData);
  const ops = scoreOperationalDensity(knowledge, pageData);
  const graph = scoreGraphContribution(knowledge);
  const links = scoreInternalLinkUtility(pageData);
  const spec = scoreContentSpecificity(knowledge, pageData);

  // Publish worthiness is derived from the other 5
  const prelimDims = {
    differentiation: diff,
    operational_signal_density: ops,
    graph_contribution: graph,
    internal_link_utility: links,
    content_specificity: spec,
  };
  const worth = scorePublishWorthiness(prelimDims);

  const dimensions = {
    ...prelimDims,
    publish_worthiness: worth,
  };

  // Compute weighted total (0-1 internally, displayed as 0-100)
  const total = Object.entries(dimensions).reduce((sum, [key, dim]) => {
    return sum + dim.score * (DIMENSION_WEIGHTS[key] || 0);
  }, 0);
  const score = Math.round(total * 100);

  // Grade
  let grade;
  if (score >= 90) grade = "A";
  else if (score >= 80) grade = "B";
  else if (score >= 70) grade = "C";
  else if (score >= 60) grade = "D";
  else if (score >= 50) grade = "D-";
  else grade = "F";

  // Build explicit rejection reasons
  const rejections = [];
  if (score < ADMISSION_THRESHOLD) {
    rejections.push({
      dimension: "_overall",
      reason: `Overall score ${score}% below admission threshold ${ADMISSION_THRESHOLD}%`,
    });
  }
  for (const [key, dim] of Object.entries(dimensions)) {
    if (dim.score < 0.3) {
      rejections.push({
        dimension: key,
        reason: `${key} scored ${Math.round(dim.score * 100)}% — critically low (below 30%)`,
      });
    }
  }

  const admitted = score >= ADMISSION_THRESHOLD;

  return {
    admitted,
    score,
    grade,
    dimensions: Object.fromEntries(
      Object.entries(dimensions).map(([key, dim]) => [
        key,
        {
          score: Math.round(dim.score * 100),
          weight: DIMENSION_WEIGHTS[key],
          checks: dim.checks.map(c => ({
            id: c.id,
            score: Math.round(c.score * 100),
            weight: c.weight,
          })),
        },
      ])
    ),
    rejections,
    debug: {
      dimension_scores: Object.fromEntries(
        Object.entries(dimensions).map(([k, d]) => [k, Math.round(d.score * 100)])
      ),
      total_weighted: score,
      threshold: ADMISSION_THRESHOLD,
    },
  };
}

// ── Exports for Testing ───────────────────────────────────────────────

export const _DIMENSION_WEIGHTS = DIMENSION_WEIGHTS;
export const _ADMISSION_THRESHOLD = ADMISSION_THRESHOLD;
export const _OPERATIONAL_TERMS = OPERATIONAL_TERMS;
export const _FLUFF_TERMS = FLUFF_TERMS;
