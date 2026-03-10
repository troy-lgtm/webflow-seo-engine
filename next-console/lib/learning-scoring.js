/**
 * Learning Scoring Model
 * Computes composite learning scores for patterns and pages.
 * Used to reweight content pools, prioritize future generation,
 * and rank FAQs / intros / CTAs / link patterns.
 *
 * SAFETY: Scoring only — does NOT modify hard safety gates.
 */

// ── Score Weights ──────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
  ctr: 0.30,
  impressions: 0.20,
  quote_starts: 0.20,
  ai_extractability: 0.15,
  publish_success: 0.10,
  uniqueness_safety: 0.05,
};

// ── Normalization ──────────────────────────────────────────────────

function normalizeValue(value, min, max) {
  if (max <= min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function computeNormBounds(values) {
  if (!values || values.length === 0) return { min: 0, max: 1 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

// ── Core Scoring ───────────────────────────────────────────────────

/**
 * Compute composite performance score for a page postmortem.
 * @param {object} postmortem - Page postmortem record
 * @param {object} [normBounds] - { ctr: {min,max}, impressions: {min,max}, ... }
 * @param {object} [weights] - Override default weights
 * @returns {{ total, breakdown }}
 */
export function computePerformanceScore(postmortem, normBounds = {}, weights = DEFAULT_WEIGHTS) {
  const p = postmortem || {};

  const ctrNorm = normalizeValue(
    p.ctr || 0,
    normBounds.ctr?.min || 0,
    normBounds.ctr?.max || 0.10
  );

  const impNorm = normalizeValue(
    p.impressions || 0,
    normBounds.impressions?.min || 0,
    normBounds.impressions?.max || 1000
  );

  const quoteNorm = normalizeValue(
    p.quote_starts || 0,
    normBounds.quote_starts?.min || 0,
    normBounds.quote_starts?.max || 50
  );

  const aiNorm = normalizeValue(
    p.ai_extractability_score || 0,
    0,
    100
  );

  const pubNorm = p.verification_passed === true ? 1.0 : p.verification_passed === false ? 0.0 : 0.5;

  const uniNorm = normalizeValue(
    p.uniqueness_score || 80,
    0,
    100
  );

  const breakdown = {
    ctr_score: ctrNorm,
    impressions_score: impNorm,
    quote_start_score: quoteNorm,
    ai_extractability_score: aiNorm,
    publish_success_score: pubNorm,
    uniqueness_safety_score: uniNorm,
  };

  const total =
    (weights.ctr || 0) * ctrNorm +
    (weights.impressions || 0) * impNorm +
    (weights.quote_starts || 0) * quoteNorm +
    (weights.ai_extractability || 0) * aiNorm +
    (weights.publish_success || 0) * pubNorm +
    (weights.uniqueness_safety || 0) * uniNorm;

  return { total: Math.round(total * 1000) / 1000, breakdown };
}

/**
 * Compute normalization bounds from a set of postmortems.
 * @param {object[]} postmortems
 * @returns {object} normBounds
 */
export function computeNormalizationBounds(postmortems) {
  if (!postmortems || postmortems.length === 0) return {};

  return {
    ctr: computeNormBounds(postmortems.map((p) => p.ctr || 0)),
    impressions: computeNormBounds(postmortems.map((p) => p.impressions || 0)),
    quote_starts: computeNormBounds(postmortems.map((p) => p.quote_starts || 0)),
    ai_extractability_score: computeNormBounds(postmortems.map((p) => p.ai_extractability_score || 0)),
    uniqueness_score: computeNormBounds(postmortems.map((p) => p.uniqueness_score || 0)),
  };
}

/**
 * Score a pattern (title, FAQ, CTA, intro) based on pages that used it.
 * @param {string} patternId
 * @param {object[]} postmortems - All page postmortems
 * @param {string} patternField - Field name in postmortem (e.g., "title_pattern_id")
 * @returns {{ pattern_id, pages_count, avg_score, win_rate, recommendation }}
 */
export function scorePattern(patternId, postmortems, patternField) {
  const matching = postmortems.filter((p) => p[patternField] === patternId);
  if (matching.length === 0) {
    return {
      pattern_id: patternId,
      pages_count: 0,
      avg_score: 0.5,
      win_rate: 0,
      recommendation: "insufficient_data",
    };
  }

  const normBounds = computeNormalizationBounds(postmortems);
  const scores = matching.map((p) => computePerformanceScore(p, normBounds));
  const avgScore = scores.reduce((s, r) => s + r.total, 0) / scores.length;
  const medianScore = [...scores.map((s) => s.total)].sort((a, b) => a - b)[Math.floor(scores.length / 2)];

  // Win rate: fraction of pages above median performance
  const allScores = postmortems.map((p) => computePerformanceScore(p, normBounds).total);
  const globalMedian = [...allScores].sort((a, b) => a - b)[Math.floor(allScores.length / 2)] || 0.5;
  const wins = scores.filter((s) => s.total >= globalMedian).length;
  const winRate = wins / scores.length;

  let recommendation = "keep";
  if (avgScore >= 0.7) recommendation = "promote";
  else if (avgScore <= 0.3 && matching.length >= 3) recommendation = "demote";
  else if (avgScore <= 0.2 && matching.length >= 5) recommendation = "retire";

  return {
    pattern_id: patternId,
    pages_count: matching.length,
    avg_score: Math.round(avgScore * 1000) / 1000,
    win_rate: Math.round(winRate * 1000) / 1000,
    recommendation,
  };
}

/**
 * Score all archetypes based on postmortem data.
 * @param {object[]} postmortems
 * @returns {object[]} Array of archetype scores
 */
export function scoreArchetypes(postmortems) {
  const archetypeIds = [...new Set(postmortems.map((p) => p.archetype_id).filter(Boolean))];
  return archetypeIds.map((id) => {
    const matching = postmortems.filter((p) => p.archetype_id === id);
    const indexed = matching.filter((p) => p.indexed === true).length;
    const avgCtr = matching.length > 0
      ? matching.reduce((s, p) => s + (p.ctr || 0), 0) / matching.length
      : 0;
    const avgPosition = matching.length > 0
      ? matching.reduce((s, p) => s + (p.avg_position || 0), 0) / matching.length
      : 0;
    const avgAi = matching.length > 0
      ? matching.reduce((s, p) => s + (p.ai_extractability_score || 0), 0) / matching.length
      : 0;

    return {
      archetype_id: id,
      pages_published: matching.length,
      pages_indexed: indexed,
      avg_ctr: Math.round(avgCtr * 10000) / 10000,
      avg_position: Math.round(avgPosition * 10) / 10,
      ai_extraction_score_avg: Math.round(avgAi),
      ...scorePattern(id, postmortems, "archetype_id"),
    };
  });
}

/**
 * Convert pattern score to a weight multiplier.
 * promote → 1.2-1.5, keep → 1.0, demote → 0.6-0.8, retire → 0.3
 */
export function scoreToWeight(patternScore) {
  if (!patternScore || patternScore.recommendation === "insufficient_data") return 1.0;
  switch (patternScore.recommendation) {
    case "promote": return 1.0 + Math.min(0.5, patternScore.avg_score * 0.5);
    case "keep": return 1.0;
    case "demote": return Math.max(0.5, 1.0 - (1.0 - patternScore.avg_score) * 0.4);
    case "retire": return 0.3;
    default: return 1.0;
  }
}

export { DEFAULT_WEIGHTS };
