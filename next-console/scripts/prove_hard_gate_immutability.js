#!/usr/bin/env node
/**
 * Prove Hard Gate Immutability
 *
 * Demonstrates that the learning system CANNOT modify hard safety gates.
 * For each IMMUTABLE_KEY:
 *   1. Inject the key into learning state
 *   2. Run updateLearningWeights
 *   3. Verify the key was deleted from state
 *   4. Verify a recommendation was generated with requires_human_approval: true
 *
 * Exit code 0 = proven (all gates locked), 1 = failed
 */

import {
  loadLearningState,
  saveLearningState,
  IMMUTABLE_KEYS,
} from "../lib/learning-store.js";

import { updateLearningWeights } from "../lib/learning-updater.js";

function main() {
  console.log("=== Prove Hard Gate Immutability ===\n");
  console.log(`Testing ${IMMUTABLE_KEYS.length} immutable keys:\n`);

  // Create test postmortems with high confidence so the updater runs
  const testPostmortems = [
    {
      slug: "test-page-1",
      signal_confidence: "high",
      impressions: 100,
      clicks: 10,
      ctr: 0.10,
      avg_position: 5,
      quote_starts: 3,
      archetype_id: "test_archetype",
      faq_ids: ["faq_1"],
    },
  ];

  let allPassed = true;

  for (const key of IMMUTABLE_KEYS) {
    // Save a state with the immutable key injected
    const state = loadLearningState();
    state[key] = { injected: true, test: "should_be_blocked" };
    saveLearningState(state);

    // Run the updater
    const { state: newState, recommendations } = updateLearningWeights(testPostmortems);

    // Check 1: Key must be deleted from state
    const keyDeleted = newState[key] === undefined;

    // Check 2: A recommendation must exist for this key
    const hasRecommendation = recommendations.some(
      (r) => r.proposed_change.includes(key) && r.requires_human_approval === true && r.action === "blocked"
    );

    const passed = keyDeleted && hasRecommendation;
    if (!passed) allPassed = false;

    const icon = passed ? "✓" : "✗";
    console.log(`  ${icon} ${key}`);
    console.log(`      Deleted from state:   ${keyDeleted ? "YES" : "NO ← FAIL"}`);
    console.log(`      Recommendation added: ${hasRecommendation ? "YES" : "NO ← FAIL"}`);
  }

  console.log("");
  if (allPassed) {
    console.log(`✓ PROVEN: All ${IMMUTABLE_KEYS.length} immutable keys are locked.`);
    console.log("  Learning system cannot modify hard safety gates.");
    process.exit(0);
  } else {
    console.log("✗ FAILED: Some immutable keys were NOT properly protected.");
    process.exit(1);
  }
}

main();
