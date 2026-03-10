/**
 * Uniqueness Configuration
 * Hard thresholds that the learning system may NOT change automatically.
 * These protect against programmatic SEO penalties.
 */

// ── Hard thresholds (immutable by learning system) ─────────────────

export const UNIQUENESS_THRESHOLDS = {
  title_similarity_max: 0.65,
  intro_similarity_max: 0.50,
  faq_overlap_max: 2,
  eight_gram_overlap_cap: 0.30,
  sentence_reuse_max_fraction: 0.05,
  faq_question_reuse_max_fraction: 0.03,
  h2_heading_reuse_max_fraction: 0.05,
  min_publishable_uniqueness_score: 60,
  shingle_size: 8,
  min_sentence_words: 8,
};

export const CHECKED_SECTIONS = [
  "seo_title",
  "meta_description",
  "h1",
  "intro",
  "quick_answer",
  "faq_questions",
  "lane_insight",
  "cost_drivers",
];

// ── Helpers ────────────────────────────────────────────────────────

export function isAboveThreshold(metric, value) {
  const t = UNIQUENESS_THRESHOLDS[metric];
  if (t === undefined) throw new Error(`Unknown threshold metric: ${metric}`);
  return value > t;
}

export function getThreshold(metric) {
  const t = UNIQUENESS_THRESHOLDS[metric];
  if (t === undefined) throw new Error(`Unknown threshold metric: ${metric}`);
  return t;
}

export const IMMUTABLE_THRESHOLD_KEYS = Object.keys(UNIQUENESS_THRESHOLDS);

export function validateThresholdsUnchanged(proposed) {
  const violations = [];
  for (const key of IMMUTABLE_THRESHOLD_KEYS) {
    if (proposed[key] !== undefined && proposed[key] !== UNIQUENESS_THRESHOLDS[key]) {
      violations.push({
        key,
        current: UNIQUENESS_THRESHOLDS[key],
        proposed: proposed[key],
        message: `Cannot change immutable uniqueness threshold: ${key}`,
      });
    }
  }
  return { valid: violations.length === 0, violations };
}
