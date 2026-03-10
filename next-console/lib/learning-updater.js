/**
 * Learning Updater
 * Updates learning weights based on postmortem data and feedback.
 *
 * SAFETY RULES:
 * - Only updates ACTIVE dimensions: archetype_weights, faq_weights
 * - INACTIVE dimensions (title, meta, cta, intro, link patterns) are NOT updated
 *   because no variant pools exist to consume them. Preserved for future use.
 * - May NOT update: hard gate thresholds, domains, verification rules,
 *   duplicate blocking, slug/path logic, schema drift rules.
 * - Any blocked change → written to learning_recommendations.json
 *   with requires_human_approval: true.
 *
 * SIGNAL CONFIDENCE:
 * - Only "high" (GSC data) and "medium" (GA4 data) postmortems drive weight updates.
 * - "low" confidence (internal signals only) is logged but does not change weights.
 */

import {
  loadLearningState,
  saveLearningState,
  appendLearningHistory,
  saveRecommendations,
  isImmutableKey,
  IMMUTABLE_KEYS,
} from "./learning-store.js";

import {
  computePerformanceScore,
  computeNormalizationBounds,
  scorePattern,
  scoreArchetypes,
  scoreToWeight,
} from "./learning-scoring.js";

// Dimensions that are actually wired to change output
const ACTIVE_DIMENSIONS = ["archetype_weights", "faq_weights"];

// Dimensions computed but not consumed — no variant pools exist
const INACTIVE_DIMENSIONS = [
  "title_pattern_weights",
  "meta_pattern_weights",
  "cta_weights",
  "intro_pattern_weights",
  "link_pattern_weights",
];

// ── Weight Update Logic ────────────────────────────────────────────

/**
 * Update learning state from postmortem data.
 * Only updates ACTIVE dimensions. Filters by signal confidence.
 * @param {object[]} postmortems - Page postmortem records
 * @param {object[]} [manualFeedback] - Manual feedback entries
 * @returns {{ state, recommendations, report }}
 */
export function updateLearningWeights(postmortems, manualFeedback = []) {
  const state = loadLearningState();
  const recommendations = [];
  const reportNotes = [];

  if (!postmortems || postmortems.length === 0) {
    reportNotes.push("No postmortem data available — learning state unchanged.");
    return { state, recommendations, report: { notes: reportNotes } };
  }

  // Filter to only high/medium confidence signals for weight updates.
  // Low confidence (internal-only signals) is logged but does not change weights.
  const qualifiedPostmortems = postmortems.filter(
    (p) => p.signal_confidence === "high" || p.signal_confidence === "medium"
  );
  const lowConfidenceCount = postmortems.length - qualifiedPostmortems.length;

  if (lowConfidenceCount > 0) {
    reportNotes.push(`Filtered out ${lowConfidenceCount} low-confidence postmortems (internal signals only).`);
  }

  if (qualifiedPostmortems.length === 0) {
    reportNotes.push("No high/medium confidence postmortem data — learning state unchanged. Waiting for GSC/GA4 data.");
    return {
      state,
      recommendations,
      report: {
        notes: reportNotes,
        signal_confidence_filter: {
          total: postmortems.length,
          qualified: 0,
          filtered_out: lowConfidenceCount,
        },
      },
    };
  }

  reportNotes.push(`Using ${qualifiedPostmortems.length} qualified postmortems (${postmortems.length} total, ${lowConfidenceCount} filtered).`);

  const normBounds = computeNormalizationBounds(qualifiedPostmortems);
  const prevVersion = state.content_version || "v1";
  const newVersion = `v${Date.now()}`;

  // ── ACTIVE DIMENSION 1: Update archetype weights ────────────────
  const archetypeScores = scoreArchetypes(qualifiedPostmortems);
  for (const as of archetypeScores) {
    const weight = scoreToWeight(as);
    if (!state.archetype_weights[as.archetype_id]) {
      state.archetype_weights[as.archetype_id] = {};
    }
    state.archetype_weights[as.archetype_id].priority_weight = weight;
    state.archetype_weights[as.archetype_id].pages_published = as.pages_published;
    state.archetype_weights[as.archetype_id].avg_ctr = as.avg_ctr;
    state.archetype_weights[as.archetype_id].recommendation = as.recommendation;
    reportNotes.push(`[ACTIVE] Archetype ${as.archetype_id}: weight=${weight.toFixed(2)}, rec=${as.recommendation}`);
  }

  // ── ACTIVE DIMENSION 2: Update FAQ weights ──────────────────────
  const faqIds = [...new Set(qualifiedPostmortems.flatMap((p) => p.faq_ids || []))];
  for (const fid of faqIds) {
    const usageCount = qualifiedPostmortems.filter((p) => (p.faq_ids || []).includes(fid)).length;
    const matchingPages = qualifiedPostmortems.filter((p) => (p.faq_ids || []).includes(fid));
    const avgScore = matchingPages.length > 0
      ? matchingPages.reduce((s, p) => s + computePerformanceScore(p, normBounds).total, 0) / matchingPages.length
      : 0.5;

    let rec = "keep";
    if (avgScore >= 0.7 && usageCount >= 2) rec = "promote";
    else if (avgScore <= 0.3 && usageCount >= 3) rec = "demote";
    else if (avgScore <= 0.2 && usageCount >= 5) rec = "retire";

    state.faq_weights[fid] = {
      weight: rec === "promote" ? 1.3 : rec === "demote" ? 0.7 : rec === "retire" ? 0.3 : 1.0,
      times_used: usageCount,
      avg_score: Math.round(avgScore * 1000) / 1000,
      recommendation: rec,
    };
  }
  if (faqIds.length > 0) {
    reportNotes.push(`[ACTIVE] FAQ weights updated: ${faqIds.length} FAQs scored`);
  }

  // ── INACTIVE DIMENSIONS: NOT updated ────────────────────────────
  // title_pattern_weights, meta_pattern_weights, cta_weights,
  // intro_pattern_weights, link_pattern_weights
  // These are preserved in state but NOT recomputed because no variant
  // pools exist to consume them. When pools are added, move to ACTIVE.
  reportNotes.push(`[INACTIVE] Skipped ${INACTIVE_DIMENSIONS.length} dimensions (no variant pools): ${INACTIVE_DIMENSIONS.join(", ")}`);

  // ── Process manual feedback ─────────────────────────────────────
  for (const fb of manualFeedback) {
    const slug = fb.slug;
    const pm = qualifiedPostmortems.find((p) => p.slug === slug) || postmortems.find((p) => p.slug === slug);
    if (!pm) continue;

    switch (fb.feedback_type) {
      case "great_page":
        if (pm.archetype_id && state.archetype_weights[pm.archetype_id]) {
          state.archetype_weights[pm.archetype_id].priority_weight = Math.min(
            1.5,
            (state.archetype_weights[pm.archetype_id].priority_weight || 1.0) + 0.05 * (fb.weight || 1)
          );
        }
        reportNotes.push(`Manual feedback: ${slug} marked as great_page`);
        break;
      case "bad_layout":
      case "faq_weak":
      case "rewrite_intro":
        reportNotes.push(`Manual feedback: ${slug} — ${fb.feedback_type}: ${fb.note || ""}`);
        break;
      case "ai_extract_good":
      case "ai_extract_bad":
        reportNotes.push(`Manual feedback: ${slug} — ${fb.feedback_type}`);
        break;
    }
  }

  // ── Immutable gate protection ───────────────────────────────────
  for (const key of IMMUTABLE_KEYS) {
    if (state[key] !== undefined && key !== "content_version") {
      recommendations.push({
        proposed_change: `Learning system attempted to set "${key}"`,
        evidence: "Detected in state update",
        risk: "Would modify a hard safety gate",
        requires_human_approval: true,
        action: "blocked",
      });
      delete state[key];
    }
  }

  // ── Version bump ────────────────────────────────────────────────
  state.content_version = newVersion;
  state.learning_notes = reportNotes.slice(-50);

  return {
    state,
    recommendations,
    report: {
      previous_version: prevVersion,
      new_version: newVersion,
      archetypes_updated: archetypeScores.length,
      faq_weights_updated: faqIds.length,
      inactive_dimensions_skipped: INACTIVE_DIMENSIONS.length,
      manual_feedback_processed: manualFeedback.length,
      recommendations_count: recommendations.length,
      signal_confidence_filter: {
        total: postmortems.length,
        qualified: qualifiedPostmortems.length,
        filtered_out: lowConfidenceCount,
      },
      notes: reportNotes,
    },
  };
}

/**
 * Apply and persist learning update.
 * @param {object[]} postmortems
 * @param {object[]} [manualFeedback]
 * @returns {object} report
 */
export function applyLearningUpdate(postmortems, manualFeedback = []) {
  const { state, recommendations, report } = updateLearningWeights(postmortems, manualFeedback);

  // Save state
  saveLearningState(state);

  // Save recommendations if any
  if (recommendations.length > 0) {
    saveRecommendations(recommendations);
  }

  // Append to history
  appendLearningHistory({
    version: state.content_version,
    archetypes_updated: report.archetypes_updated,
    faq_weights_updated: report.faq_weights_updated,
    inactive_skipped: report.inactive_dimensions_skipped,
    recommendations_count: report.recommendations_count,
    total_postmortems: postmortems.length,
    qualified_postmortems: report.signal_confidence_filter.qualified,
  });

  return report;
}

// Export for testing
export { ACTIVE_DIMENSIONS, INACTIVE_DIMENSIONS };
