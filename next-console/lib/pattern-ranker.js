/**
 * Pattern Ranker
 * Weighted deterministic selection for content patterns.
 * Used by lane-content-engine to pick templates based on learning state.
 *
 * Determinism guarantee: same input + same learning state snapshot
 * always produces the same selection.
 */

import { rngFromKey } from "./hash.js";

/**
 * Weighted deterministic selection from a pool.
 * Uses a seeded PRNG so the same (key + weights) always picks the same item.
 *
 * @param {object[]} pool - Array of items to select from
 * @param {object} weights - Map of item_id → weight (default 1.0)
 * @param {string} seedKey - Deterministic seed (e.g., slug + pattern_type)
 * @param {string} [idField] - Field name used as item ID (default "id")
 * @returns {{ selected, selected_id, weight }}
 */
export function weightedDeterministicSelect(pool, weights, seedKey, idField = "id") {
  if (!pool || pool.length === 0) return { selected: null, selected_id: null, weight: 0 };

  if (pool.length === 1) {
    const id = pool[0][idField] || "item_0";
    return { selected: pool[0], selected_id: id, weight: weights?.[id] || 1.0 };
  }

  const rng = rngFromKey(seedKey || "default");

  // Build weighted cumulative distribution
  let cumulative = 0;
  const entries = pool.map((item, i) => {
    const id = item[idField] || `item_${i}`;
    const w = Math.max(0.01, weights?.[id] ?? 1.0); // Floor at 0.01 to never fully exclude
    cumulative += w;
    return { item, id, weight: w, cumulative };
  });

  // Select using seeded RNG
  const threshold = rng() * cumulative;
  for (const e of entries) {
    if (threshold <= e.cumulative) {
      return { selected: e.item, selected_id: e.id, weight: e.weight };
    }
  }

  // Fallback (shouldn't happen)
  const last = entries[entries.length - 1];
  return { selected: last.item, selected_id: last.id, weight: last.weight };
}

/**
 * Rank pool items by weight (descending).
 * @param {object[]} pool
 * @param {object} weights - Map of item_id → weight
 * @param {string} [idField]
 * @returns {object[]} Ranked items with weight attached
 */
export function rankByWeight(pool, weights, idField = "id") {
  if (!pool || pool.length === 0) return [];

  return pool
    .map((item, i) => {
      const id = item[idField] || `item_${i}`;
      return { ...item, _weight: weights?.[id] ?? 1.0, _id: id };
    })
    .sort((a, b) => b._weight - a._weight);
}

/**
 * Get top N items from a weighted pool.
 * @param {object[]} pool
 * @param {object} weights
 * @param {number} n
 * @param {string} [idField]
 * @returns {object[]}
 */
export function topN(pool, weights, n, idField = "id") {
  return rankByWeight(pool, weights, idField).slice(0, n);
}

/**
 * Compute a publish priority boost based on learned archetype performance.
 * Higher performing archetypes get a priority boost.
 * @param {string} archetypeId
 * @param {object} archetypeWeights - From learning_state.archetype_weights
 * @returns {number} Priority boost (0-20)
 */
export function computeLearnedPriorityBoost(archetypeId, archetypeWeights) {
  if (!archetypeWeights || !archetypeId) return 0;
  const aw = archetypeWeights[archetypeId];
  if (!aw) return 0;

  const weight = aw.priority_weight || 1.0;
  // Map weight range [0.3, 1.5] → boost range [0, 20]
  const boost = Math.max(0, Math.min(20, Math.round((weight - 0.3) / 1.2 * 20)));
  return boost;
}

/**
 * Verify that weighted selection is deterministic.
 * Runs the same selection twice and confirms identical results.
 * @param {object[]} pool
 * @param {object} weights
 * @param {string} seedKey
 * @returns {boolean}
 */
export function verifyDeterminism(pool, weights, seedKey) {
  const r1 = weightedDeterministicSelect(pool, weights, seedKey);
  const r2 = weightedDeterministicSelect(pool, weights, seedKey);
  return r1.selected_id === r2.selected_id;
}
