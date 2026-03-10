/**
 * Page Quality Scorer — Composite Offline Page Quality Evaluation
 *
 * Classification: evaluation-only now
 * Connected to: scripts/run-faq-experiment.js, scripts/score-pages.js
 *
 * Computes a structural quality score across 5 dimensions:
 *   1. SEO Quality (metadata specificity, duplicate penalties, schema completeness)
 *   2. AI Search Quality (extractability, answer-shaped content, entity richness)
 *   3. Human Readability (scanability, sentence length, section balance)
 *   4. Design Composition (section completeness, CTA placement, proof presence)
 *   5. Conversion Readiness (CTA clarity, trust signals, next-step clarity)
 *
 * SAFETY: Scoring only — does NOT modify any page content or safety gates.
 * HONESTY: All scores are structural heuristics. Live performance scores
 *   come from learning-scoring.js and require real GSC/GA4 data.
 */

// ── Dimension Weights ─────────────────────────────────────────────────

const DIMENSION_WEIGHTS = {
  seo_quality: 0.25,
  ai_search_quality: 0.20,
  human_readability: 0.20,
  design_composition: 0.15,
  conversion_readiness: 0.20,
};

// ── Helpers ────────────────────────────────────────────────────────────

function wordCount(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function sentenceCount(text) {
  if (!text) return 0;
  return text.split(/[.!?]+/).filter((s) => s.trim().length > 5).length;
}

function avgSentenceLength(text) {
  const words = wordCount(text);
  const sentences = sentenceCount(text);
  return sentences > 0 ? words / sentences : 0;
}

function hasSubstring(text, sub) {
  return (text || "").toLowerCase().includes(sub.toLowerCase());
}

function countMatches(text, pattern) {
  if (!text) return 0;
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

// ── 1. SEO Quality ────────────────────────────────────────────────────

function scoreSeoQuality(page) {
  const checks = [];
  const p = page || {};

  // Title specificity: contains origin, destination, mode
  const title = p.page_title || p.seo_title || "";
  const origin = (p.origin_city || p.origin || "").split(",")[0].trim();
  const dest = (p.destination_city || p.destination || "").split(",")[0].trim();
  const mode = p.mode || "LTL";

  checks.push({
    id: "seo_title_has_origin",
    score: hasSubstring(title, origin) ? 1 : 0,
    weight: 1,
  });
  checks.push({
    id: "seo_title_has_dest",
    score: hasSubstring(title, dest) ? 1 : 0,
    weight: 1,
  });
  checks.push({
    id: "seo_title_has_mode",
    score: hasSubstring(title, mode) ? 1 : 0,
    weight: 0.8,
  });
  checks.push({
    id: "seo_title_length",
    score: title.length >= 30 && title.length <= 70 ? 1 : title.length > 0 ? 0.5 : 0,
    weight: 0.6,
  });

  // Meta description specificity
  const meta = p.meta_description || "";
  checks.push({
    id: "seo_meta_has_origin",
    score: hasSubstring(meta, origin) ? 1 : 0,
    weight: 0.8,
  });
  checks.push({
    id: "seo_meta_has_dest",
    score: hasSubstring(meta, dest) ? 1 : 0,
    weight: 0.8,
  });
  checks.push({
    id: "seo_meta_length",
    score: meta.length >= 80 && meta.length <= 160 ? 1 : meta.length > 0 ? 0.4 : 0,
    weight: 0.6,
  });

  // Canonical path present
  checks.push({
    id: "seo_canonical_present",
    score: p.canonical_path ? 1 : 0,
    weight: 1,
  });

  // Schema completeness (FAQPage, BreadcrumbList, Service, Organization)
  const schemas = p._schema_types || [];
  const requiredSchemas = ["FAQPage", "BreadcrumbList", "Service", "Organization"];
  const schemaScore = requiredSchemas.filter((s) => schemas.includes(s)).length / requiredSchemas.length;
  checks.push({
    id: "seo_schema_completeness",
    score: schemaScore,
    weight: 1,
  });

  // Internal links present
  const relatedLanes = p.related_links?.related_lanes || [];
  checks.push({
    id: "seo_internal_links",
    score: Math.min(1, relatedLanes.length / 5),
    weight: 0.8,
  });

  // H1 specificity
  const h1 = p.hero?.headline || p.h1 || "";
  checks.push({
    id: "seo_h1_has_origin",
    score: hasSubstring(h1, origin) ? 1 : 0,
    weight: 1,
  });
  checks.push({
    id: "seo_h1_has_dest",
    score: hasSubstring(h1, dest) ? 1 : 0,
    weight: 1,
  });

  return computeDimensionScore(checks);
}

// ── 2. AI Search Quality ──────────────────────────────────────────────

function scoreAiSearchQuality(page) {
  const checks = [];
  const p = page || {};

  // Combine all text content
  const allText = [
    p.lane_overview?.body,
    p.warp_fit_for_lane?.body,
    p.operating_details?.heading,
    p.pricing_and_commercial_framing?.body,
    p.best_fit_shipments?.intro,
  ]
    .filter(Boolean)
    .join(" ");

  // Direct answer presence (quick_answer or first paragraph answers the query)
  checks.push({
    id: "ai_has_direct_answer",
    score: p.lane_overview?.body && wordCount(p.lane_overview.body) >= 30 ? 1 : 0.3,
    weight: 1.2,
  });

  // FAQ specificity: FAQs mention origin and destination
  const faqs = p.lane_specific_faqs || [];
  const specificFaqs = faqs.filter(
    (f) =>
      (hasSubstring(f.question || f.q, p.origin_city || p.origin || "") ||
        hasSubstring(f.answer || f.a, p.origin_city || p.origin || "")) &&
      (hasSubstring(f.question || f.q, p.destination_city || p.destination || "") ||
        hasSubstring(f.answer || f.a, p.destination_city || p.destination || ""))
  );
  checks.push({
    id: "ai_faq_specificity",
    score: faqs.length > 0 ? specificFaqs.length / faqs.length : 0,
    weight: 1.2,
  });

  // FAQ count (5+ is good, 4 is minimum, <4 is bad)
  checks.push({
    id: "ai_faq_count",
    score: faqs.length >= 5 ? 1 : faqs.length >= 4 ? 0.7 : faqs.length > 0 ? 0.3 : 0,
    weight: 1,
  });

  // Entity clarity: mode, geography, shipment type mentioned
  const entityTerms = [
    p.mode || "LTL",
    "freight",
    "pallet",
    "shipment",
    p.origin_city || "",
    p.destination_city || "",
  ].filter(Boolean);
  const entityHits = entityTerms.filter((t) => hasSubstring(allText, t)).length;
  checks.push({
    id: "ai_entity_richness",
    score: Math.min(1, entityHits / entityTerms.length),
    weight: 0.8,
  });

  // Low ambiguity: contains specific numbers (distance, transit days, rates)
  const hasNumbers = countMatches(allText, /\d+/g) >= 3;
  checks.push({
    id: "ai_specificity_numbers",
    score: hasNumbers ? 1 : 0.3,
    weight: 0.8,
  });

  // Answer-shaped sentences (sentences that start with a direct statement)
  const answerPatterns = /\b(WARP|provides|offers|supports|operates|handles|delivers|costs?|takes?|ranges?)\b/gi;
  const answerHits = countMatches(allText, answerPatterns);
  checks.push({
    id: "ai_answer_shaped",
    score: Math.min(1, answerHits / 5),
    weight: 0.6,
  });

  // Heading clarity (sections have descriptive headings)
  const headings = [
    p.lane_overview?.heading,
    p.warp_fit_for_lane?.heading,
    p.operating_details?.heading,
    p.pricing_and_commercial_framing?.heading,
    p.best_fit_shipments?.heading,
  ].filter(Boolean);
  checks.push({
    id: "ai_heading_clarity",
    score: Math.min(1, headings.length / 5),
    weight: 0.6,
  });

  return computeDimensionScore(checks);
}

// ── 3. Human Readability ──────────────────────────────────────────────

function scoreHumanReadability(page) {
  const checks = [];
  const p = page || {};

  const bodyText = [
    p.lane_overview?.body,
    p.warp_fit_for_lane?.body,
    p.pricing_and_commercial_framing?.body,
    p.best_fit_shipments?.intro,
  ]
    .filter(Boolean)
    .join(" ");

  // Average sentence length (15-25 words is ideal)
  const avgLen = avgSentenceLength(bodyText);
  checks.push({
    id: "read_avg_sentence_length",
    score: avgLen >= 10 && avgLen <= 28 ? 1 : avgLen > 0 ? 0.5 : 0,
    weight: 1,
  });

  // Total word count (500+ is strong, 300+ is acceptable)
  const totalWords = wordCount(bodyText);
  checks.push({
    id: "read_total_word_count",
    score: totalWords >= 500 ? 1 : totalWords >= 300 ? 0.7 : totalWords > 0 ? 0.4 : 0,
    weight: 0.8,
  });

  // Section balance (no single section dominates >60% of total text)
  const sectionTexts = [
    p.lane_overview?.body,
    p.warp_fit_for_lane?.body,
    p.pricing_and_commercial_framing?.body,
    p.best_fit_shipments?.intro,
  ].filter(Boolean);
  const sectionWordCounts = sectionTexts.map(wordCount);
  const maxSectionRatio =
    totalWords > 0 ? Math.max(...sectionWordCounts) / totalWords : 0;
  checks.push({
    id: "read_section_balance",
    score: maxSectionRatio <= 0.6 ? 1 : maxSectionRatio <= 0.8 ? 0.6 : 0.3,
    weight: 0.6,
  });

  // Bullet/list presence (operating details should have items)
  const opItems = p.operating_details?.items || [];
  checks.push({
    id: "read_has_scannable_lists",
    score: opItems.length >= 3 ? 1 : opItems.length > 0 ? 0.5 : 0,
    weight: 0.8,
  });

  // No marketing fluff (check for banned patterns)
  const fluffPatterns = /\b(revolutionary|game.changing|world.class|cutting.edge|seamless|frictionless|disrupt|supercharge)\b/gi;
  const fluffCount = countMatches(bodyText, fluffPatterns);
  checks.push({
    id: "read_no_fluff",
    score: fluffCount === 0 ? 1 : fluffCount <= 2 ? 0.5 : 0,
    weight: 1,
  });

  // Operational terminology present
  const opTerms = /\b(pallet|freight class|cross.dock|linehaul|appointment|dock|transit|carrier|NMFC|accessorial|reefer|dry van|flatbed)\b/gi;
  const opHits = countMatches(bodyText, opTerms);
  checks.push({
    id: "read_operational_terms",
    score: Math.min(1, opHits / 5),
    weight: 0.8,
  });

  return computeDimensionScore(checks);
}

// ── 4. Design & Composition ───────────────────────────────────────────

function scoreDesignComposition(page) {
  const checks = [];
  const p = page || {};

  // Required sections present (11 canonical sections)
  const sections = [
    p.hero?.headline,
    p.lane_overview?.body,
    p.warp_fit_for_lane?.body,
    p.operating_details?.heading,
    p.pricing_and_commercial_framing?.body,
    p.best_fit_shipments?.intro,
    p.lane_specific_faqs?.length > 0,
    p.related_links?.related_lanes?.length > 0,
    p.why_warp?.reasons?.length > 0,
    p.final_cta?.headline,
  ].filter(Boolean);
  checks.push({
    id: "design_section_completeness",
    score: sections.length / 10,
    weight: 1.2,
  });

  // Hero has both CTAs
  checks.push({
    id: "design_hero_ctas",
    score:
      p.hero?.primary_cta?.label && p.hero?.secondary_cta?.label
        ? 1
        : p.hero?.primary_cta?.label
          ? 0.6
          : 0,
    weight: 0.8,
  });

  // Proof/validation section present
  checks.push({
    id: "design_proof_present",
    score: p.lane_stats?.distance_miles > 0 ? 1 : 0.3,
    weight: 0.8,
  });

  // Lane stats completeness (distance, transit, rates, equipment, cross-docks)
  const stats = p.lane_stats || {};
  const statFields = [
    stats.distance_miles > 0,
    stats.transit_days_range?.min > 0,
    stats.rate_range_usd?.low > 0,
    stats.common_equipment?.length > 0,
    stats.seasonality_notes,
  ].filter(Boolean);
  checks.push({
    id: "design_stats_completeness",
    score: statFields.length / 5,
    weight: 0.8,
  });

  // Why WARP section has multiple reasons
  const reasons = p.why_warp?.reasons || [];
  checks.push({
    id: "design_why_warp_depth",
    score: reasons.length >= 4 ? 1 : reasons.length >= 2 ? 0.6 : reasons.length > 0 ? 0.3 : 0,
    weight: 0.6,
  });

  // Network proof present
  const proof = p.network_proof || {};
  checks.push({
    id: "design_network_proof",
    score:
      proof.estimated_carrier_count > 0 && (proof.nearest_cross_docks || []).length > 0
        ? 1
        : proof.estimated_carrier_count > 0
          ? 0.5
          : 0,
    weight: 0.6,
  });

  return computeDimensionScore(checks);
}

// ── 5. Conversion Readiness ───────────────────────────────────────────

function scoreConversionReadiness(page) {
  const checks = [];
  const p = page || {};

  // Primary CTA present and specific
  const primaryCta = p.hero?.primary_cta?.label || p.final_cta?.primary_cta?.label || "";
  checks.push({
    id: "conv_primary_cta_present",
    score: primaryCta ? 1 : 0,
    weight: 1.2,
  });
  checks.push({
    id: "conv_primary_cta_specific",
    score:
      hasSubstring(primaryCta, "quote") || hasSubstring(primaryCta, "rate") || hasSubstring(primaryCta, "price")
        ? 1
        : primaryCta
          ? 0.5
          : 0,
    weight: 0.8,
  });

  // Secondary CTA (talk to expert / enterprise path)
  const secondaryCta = p.hero?.secondary_cta?.label || p.final_cta?.secondary_cta?.label || "";
  checks.push({
    id: "conv_secondary_cta_present",
    score: secondaryCta ? 1 : 0,
    weight: 0.6,
  });

  // Trust signals present in final CTA
  const trustSignals = p.final_cta?.trust_signals || [];
  checks.push({
    id: "conv_trust_signals",
    score: trustSignals.length >= 3 ? 1 : trustSignals.length > 0 ? 0.5 : 0,
    weight: 0.8,
  });

  // Final CTA has compelling headline (not generic)
  const ctaHeadline = p.final_cta?.headline || "";
  const isGeneric = /\b(get started|learn more|contact us|sign up)\b/i.test(ctaHeadline);
  checks.push({
    id: "conv_cta_not_generic",
    score: ctaHeadline && !isGeneric ? 1 : ctaHeadline ? 0.4 : 0,
    weight: 0.6,
  });

  // Proof before ask: lane stats appear before final CTA
  checks.push({
    id: "conv_proof_before_ask",
    score: p.lane_stats?.distance_miles > 0 && p.final_cta?.headline ? 1 : 0.3,
    weight: 0.8,
  });

  // Best-fit section (helps qualify intent before CTA)
  checks.push({
    id: "conv_best_fit_present",
    score: p.best_fit_shipments?.items?.length > 0 ? 1 : 0,
    weight: 0.6,
  });

  return computeDimensionScore(checks);
}

// ── Dimension Score Computation ───────────────────────────────────────

function computeDimensionScore(checks) {
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const weightedScore = checks.reduce((s, c) => s + c.score * c.weight, 0);
  const score = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) / 100 : 0;
  return { score, checks };
}

// ── Composite Score ───────────────────────────────────────────────────

/**
 * Compute composite offline page quality score.
 * @param {object} page - Canonical lane page data object
 * @returns {{ total, grade, dimensions, checks_summary }}
 */
export function scorePageQuality(page) {
  const seo = scoreSeoQuality(page);
  const ai = scoreAiSearchQuality(page);
  const read = scoreHumanReadability(page);
  const design = scoreDesignComposition(page);
  const conv = scoreConversionReadiness(page);

  const dimensions = {
    seo_quality: { score: seo.score, weight: DIMENSION_WEIGHTS.seo_quality, checks: seo.checks },
    ai_search_quality: { score: ai.score, weight: DIMENSION_WEIGHTS.ai_search_quality, checks: ai.checks },
    human_readability: { score: read.score, weight: DIMENSION_WEIGHTS.human_readability, checks: read.checks },
    design_composition: { score: design.score, weight: DIMENSION_WEIGHTS.design_composition, checks: design.checks },
    conversion_readiness: { score: conv.score, weight: DIMENSION_WEIGHTS.conversion_readiness, checks: conv.checks },
  };

  const total = Object.values(dimensions).reduce(
    (s, d) => s + d.score * d.weight,
    0
  );
  const rounded = Math.round(total * 100) / 100;

  let grade = "F";
  if (rounded >= 0.9) grade = "A";
  else if (rounded >= 0.8) grade = "B";
  else if (rounded >= 0.7) grade = "C";
  else if (rounded >= 0.6) grade = "D";

  const totalChecks = Object.values(dimensions).reduce(
    (s, d) => s + d.checks.length,
    0
  );
  const passingChecks = Object.values(dimensions).reduce(
    (s, d) => s + d.checks.filter((c) => c.score >= 0.7).length,
    0
  );

  return {
    total: rounded,
    grade,
    dimensions: Object.fromEntries(
      Object.entries(dimensions).map(([k, v]) => [k, { score: v.score, weight: v.weight }])
    ),
    checks_summary: {
      total: totalChecks,
      passing: passingChecks,
      failing: totalChecks - passingChecks,
    },
    full_checks: dimensions,
  };
}

/**
 * Score a specific FAQ set for a page.
 * Evaluates FAQ quality independent of the rest of the page.
 * @param {Array} faqs - Array of {question, answer} or {q, a}
 * @param {string} origin - Origin city
 * @param {string} destination - Destination city
 * @param {string} mode - Freight mode
 * @returns {{ score, checks }}
 */
export function scoreFaqSet(faqs, origin, destination, mode) {
  const checks = [];
  const faqList = faqs || [];

  // Count
  checks.push({
    id: "faq_count",
    score: faqList.length >= 5 ? 1 : faqList.length >= 4 ? 0.7 : faqList.length > 0 ? 0.3 : 0,
    weight: 1,
  });

  // Specificity: what fraction mention origin AND destination
  const specificCount = faqList.filter((f) => {
    const q = f.question || f.q || "";
    const a = f.answer || f.a || "";
    const text = q + " " + a;
    return hasSubstring(text, origin) && hasSubstring(text, destination);
  }).length;
  checks.push({
    id: "faq_lane_specificity",
    score: faqList.length > 0 ? specificCount / faqList.length : 0,
    weight: 1.2,
  });

  // Mode mention
  const modeMentionCount = faqList.filter((f) => {
    const text = (f.question || f.q || "") + " " + (f.answer || f.a || "");
    return hasSubstring(text, mode);
  }).length;
  checks.push({
    id: "faq_mode_mention",
    score: faqList.length > 0 ? modeMentionCount / faqList.length : 0,
    weight: 0.8,
  });

  // Answer length (50-200 words per answer is ideal)
  const avgAnswerWords =
    faqList.length > 0
      ? faqList.reduce((s, f) => s + wordCount(f.answer || f.a || ""), 0) / faqList.length
      : 0;
  checks.push({
    id: "faq_answer_depth",
    score: avgAnswerWords >= 40 && avgAnswerWords <= 200 ? 1 : avgAnswerWords > 20 ? 0.6 : 0.2,
    weight: 0.8,
  });

  // Topic diversity: unique topic coverage
  const topics = new Set();
  for (const f of faqList) {
    const q = (f.question || f.q || "").toLowerCase();
    if (q.includes("cost") || q.includes("rate") || q.includes("price")) topics.add("cost");
    if (q.includes("transit") || q.includes("fast") || q.includes("time")) topics.add("transit");
    if (q.includes("track")) topics.add("tracking");
    if (q.includes("equipment") || q.includes("trailer")) topics.add("equipment");
    if (q.includes("carrier") || q.includes("capacity")) topics.add("capacity");
    if (q.includes("book") || q.includes("schedule") || q.includes("pilot")) topics.add("booking");
  }
  checks.push({
    id: "faq_topic_diversity",
    score: Math.min(1, topics.size / 4),
    weight: 1,
  });

  // No generic/thin answers
  const thinAnswers = faqList.filter((f) => wordCount(f.answer || f.a || "") < 15).length;
  checks.push({
    id: "faq_no_thin_answers",
    score: faqList.length > 0 ? 1 - thinAnswers / faqList.length : 0,
    weight: 0.8,
  });

  return computeDimensionScore(checks);
}

export { DIMENSION_WEIGHTS };
