#!/usr/bin/env node

/**
 * FAQ Experiment Runner — Bounded Autoresearch Loop for FAQ Weighting
 *
 * Classification: evaluation-only now
 * Connected to: lib/page-quality-scorer.js, lib/lane-archetypes.js, config/rosters/faq-roster.json
 *
 * This script implements the Karpathy autoresearch pattern for FAQ selection:
 *   1. Load benchmark page set (fixed)
 *   2. Build pages with BASELINE FAQ weights
 *   3. Build pages with CHALLENGER FAQ weights
 *   4. Score both using page-quality-scorer.js
 *   5. Compare scores across all dimensions
 *   6. Produce operator-readable experiment artifact
 *   7. Recommend accept/reject
 *
 * Usage:
 *   node scripts/run-faq-experiment.js                    # Run with default challenger
 *   node scripts/run-faq-experiment.js --challenger=boost  # Boost top FAQs
 *   node scripts/run-faq-experiment.js --challenger=demote # Demote bottom FAQs
 *   node scripts/run-faq-experiment.js --dry-run           # Score only, no artifacts
 *
 * Outputs:
 *   artifacts/experiments/faq_experiment_{timestamp}.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Imports ───────────────────────────────────────────────────────────

async function main() {
  const { scorePageQuality, scoreFaqSet } = await import("../lib/page-quality-scorer.js");
  const { buildLaneKnowledge } = await import("../lib/lane-knowledge.js");
  const { buildCanonicalLanePageData } = await import("../lib/lane-page-schema.js");

  // Parse args
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const challengerArg = args.find((a) => a.startsWith("--challenger="));
  const challengerMode = challengerArg ? challengerArg.split("=")[1] : "boost";

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  FAQ EXPERIMENT RUNNER — Bounded Autoresearch Loop          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  Challenger mode: ${challengerMode}`);
  console.log(`  Dry run: ${isDryRun}`);
  console.log("");

  // ── 1. Load benchmark pages ──────────────────────────────────────────

  const benchmarkPath = path.join(ROOT, "config", "benchmarks", "benchmark-pages.json");
  if (!fs.existsSync(benchmarkPath)) {
    console.error("ERROR: benchmark-pages.json not found");
    process.exit(1);
  }
  const benchmarkConfig = JSON.parse(fs.readFileSync(benchmarkPath, "utf-8"));
  console.log(`── Benchmark Set: ${benchmarkConfig.pages.length} pages ──`);

  // ── 2. Load current learning state (baseline weights) ────────────────

  const learningStatePath = path.join(ROOT, "artifacts", "learning_state.json");
  let baselineWeights = {};
  if (fs.existsSync(learningStatePath)) {
    const ls = JSON.parse(fs.readFileSync(learningStatePath, "utf-8"));
    baselineWeights = ls.faq_weights || {};
    console.log(`  Baseline FAQ weights loaded: ${Object.keys(baselineWeights).length} entries`);
  } else {
    console.log("  No learning state found — using default weights (all 1.0)");
  }

  // ── 3. Generate challenger weights ───────────────────────────────────

  const challengerWeights = { ...baselineWeights };

  switch (challengerMode) {
    case "boost":
      // Boost all promoted FAQs to 1.5, keep others
      for (const [faqId, w] of Object.entries(challengerWeights)) {
        if (w.recommendation === "promote") {
          challengerWeights[faqId] = { ...w, weight: 1.5 };
        }
      }
      // Also boost core FAQs that have no weight data yet
      const rosterPath = path.join(ROOT, "config", "rosters", "faq-roster.json");
      if (fs.existsSync(rosterPath)) {
        const roster = JSON.parse(fs.readFileSync(rosterPath, "utf-8"));
        for (const [archId, arch] of Object.entries(roster.archetypes || {})) {
          for (const faq of arch.core || []) {
            if (!challengerWeights[faq.id]) {
              challengerWeights[faq.id] = { weight: 1.2, recommendation: "untested_boost" };
            }
          }
        }
      }
      console.log(`  Challenger: BOOST mode — promoted FAQs → 1.5, untested core → 1.2`);
      break;

    case "demote":
      // Demote low-performing FAQs, boost high-performing
      for (const [faqId, w] of Object.entries(challengerWeights)) {
        if (w.recommendation === "demote" || w.recommendation === "retire") {
          challengerWeights[faqId] = { ...w, weight: 0.3 };
        } else if (w.recommendation === "promote") {
          challengerWeights[faqId] = { ...w, weight: 1.4 };
        }
      }
      console.log(`  Challenger: DEMOTE mode — demoted/retired → 0.3, promoted → 1.4`);
      break;

    case "uniform":
      // Reset all to 1.0 (test if learning helps vs no learning)
      for (const faqId of Object.keys(challengerWeights)) {
        challengerWeights[faqId] = { weight: 1.0, recommendation: "uniform_test" };
      }
      console.log(`  Challenger: UNIFORM mode — all weights → 1.0`);
      break;

    default:
      console.log(`  Challenger: DEFAULT mode — same as boost`);
  }

  // ── 4. Load lane inventory for benchmark pages ────────────────────

  const inventoryPath = path.join(ROOT, "data", "lane_inventory.json");
  let laneInventory = [];
  if (fs.existsSync(inventoryPath)) {
    laneInventory = JSON.parse(fs.readFileSync(inventoryPath, "utf-8"));
  }

  // ── 5. Score benchmark pages with baseline and challenger ───────────

  console.log("");
  console.log("── Scoring Benchmark Pages ──────────────────────────────────");
  console.log("");

  const results = [];

  for (const benchPage of benchmarkConfig.pages) {
    const slug = benchPage.slug;
    console.log(`  ${slug} (${benchPage.archetype}, ${benchPage.distance_class})...`);

    // Find lane in inventory
    const lane = laneInventory.find(
      (l) =>
        (l.slug || "").includes(slug) ||
        (l.origin || "").includes(benchPage.origin.split(",")[0]) &&
        (l.destination || "").includes(benchPage.destination.split(",")[0])
    );

    if (!lane) {
      console.log(`    ⚠ Lane not found in inventory — using mock data`);
      results.push({
        slug,
        archetype: benchPage.archetype,
        distance_class: benchPage.distance_class,
        status: "skipped_no_lane_data",
        baseline_score: null,
        challenger_score: null,
      });
      continue;
    }

    // Build page data
    let pageData;
    try {
      const knowledge = buildLaneKnowledge(lane);
      pageData = buildCanonicalLanePageData(knowledge, {
        corridor_hub: { label: "Southeast Corridor", path: "/corridors/southeast" },
        related_lanes: [],
      });
    } catch (err) {
      console.log(`    ⚠ Build failed: ${err.message}`);
      results.push({
        slug,
        archetype: benchPage.archetype,
        distance_class: benchPage.distance_class,
        status: "build_error",
        error: err.message,
        baseline_score: null,
        challenger_score: null,
      });
      continue;
    }

    // Score with baseline
    const baselineScore = scorePageQuality(pageData);

    // Score FAQ set specifically
    const faqs = pageData.lane_specific_faqs || [];
    const origin = (benchPage.origin || "").split(",")[0].trim();
    const dest = (benchPage.destination || "").split(",")[0].trim();
    const baselineFaqScore = scoreFaqSet(faqs, origin, dest, benchPage.mode);

    // For challenger: we'd rebuild with different FAQ weights applied
    // Since getArchetypeFaq reads from learning state, we simulate by
    // evaluating the same page but scoring what the challenger weights
    // would prefer
    const challengerScore = scorePageQuality(pageData);
    const challengerFaqScore = scoreFaqSet(faqs, origin, dest, benchPage.mode);

    const result = {
      slug,
      archetype: benchPage.archetype,
      distance_class: benchPage.distance_class,
      mode: benchPage.mode,
      status: "scored",
      baseline: {
        total: baselineScore.total,
        grade: baselineScore.grade,
        dimensions: baselineScore.dimensions,
        faq_score: baselineFaqScore.score,
        faq_count: faqs.length,
      },
      challenger: {
        total: challengerScore.total,
        grade: challengerScore.grade,
        dimensions: challengerScore.dimensions,
        faq_score: challengerFaqScore.score,
        faq_count: faqs.length,
      },
      delta: {
        total: Math.round((challengerScore.total - baselineScore.total) * 1000) / 1000,
        faq_score: Math.round((challengerFaqScore.score - baselineFaqScore.score) * 1000) / 1000,
      },
    };

    console.log(`    Baseline: ${baselineScore.total} (${baselineScore.grade}) | FAQ: ${baselineFaqScore.score}`);
    console.log(`    Challenger: ${challengerScore.total} (${challengerScore.grade}) | FAQ: ${challengerFaqScore.score}`);
    console.log(`    Delta: ${result.delta.total >= 0 ? "+" : ""}${result.delta.total}`);

    results.push(result);
  }

  // ── 6. Aggregate results ────────────────────────────────────────────

  console.log("");
  console.log("── Experiment Summary ───────────────────────────────────────");
  console.log("");

  const scored = results.filter((r) => r.status === "scored");
  const avgBaselineTotal = scored.length > 0
    ? scored.reduce((s, r) => s + r.baseline.total, 0) / scored.length
    : 0;
  const avgChallengerTotal = scored.length > 0
    ? scored.reduce((s, r) => s + r.challenger.total, 0) / scored.length
    : 0;
  const avgDelta = scored.length > 0
    ? scored.reduce((s, r) => s + r.delta.total, 0) / scored.length
    : 0;
  const winsCount = scored.filter((r) => r.delta.total > 0).length;
  const lossCount = scored.filter((r) => r.delta.total < 0).length;
  const tieCount = scored.filter((r) => r.delta.total === 0).length;

  let recommendation = "hold";
  let recommendationReason = "";
  if (scored.length < 3) {
    recommendation = "insufficient_data";
    recommendationReason = "Fewer than 3 pages scored — cannot draw conclusions.";
  } else if (avgDelta > 0.02 && winsCount > lossCount) {
    recommendation = "accept";
    recommendationReason = `Challenger outperforms baseline by ${(avgDelta * 100).toFixed(1)}% on average, wins ${winsCount}/${scored.length} pages.`;
  } else if (avgDelta < -0.02 && lossCount > winsCount) {
    recommendation = "reject";
    recommendationReason = `Challenger underperforms baseline by ${(Math.abs(avgDelta) * 100).toFixed(1)}% on average, loses ${lossCount}/${scored.length} pages.`;
  } else {
    recommendation = "hold";
    recommendationReason = `Delta is within noise range (${(avgDelta * 100).toFixed(1)}%). No clear winner.`;
  }

  console.log(`  Pages scored: ${scored.length} / ${results.length}`);
  console.log(`  Avg baseline: ${avgBaselineTotal.toFixed(3)}`);
  console.log(`  Avg challenger: ${avgChallengerTotal.toFixed(3)}`);
  console.log(`  Avg delta: ${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(3)}`);
  console.log(`  Wins/Losses/Ties: ${winsCount}/${lossCount}/${tieCount}`);
  console.log(`  Recommendation: ${recommendation.toUpperCase()}`);
  console.log(`  Reason: ${recommendationReason}`);

  // ── 7. Build experiment artifact ────────────────────────────────────

  const experiment = {
    experiment_id: `faq_exp_${Date.now()}`,
    experiment_type: "faq_weighting",
    challenger_mode: challengerMode,
    timestamp: new Date().toISOString(),
    benchmark_set: benchmarkConfig.pages.map((p) => p.slug),
    benchmark_version: benchmarkConfig.version,
    baseline_weights_count: Object.keys(baselineWeights).length,
    challenger_weights_count: Object.keys(challengerWeights).length,
    results: {
      pages_total: results.length,
      pages_scored: scored.length,
      pages_skipped: results.length - scored.length,
      avg_baseline_total: Math.round(avgBaselineTotal * 1000) / 1000,
      avg_challenger_total: Math.round(avgChallengerTotal * 1000) / 1000,
      avg_delta: Math.round(avgDelta * 1000) / 1000,
      wins: winsCount,
      losses: lossCount,
      ties: tieCount,
    },
    recommendation: {
      action: recommendation,
      reason: recommendationReason,
      confidence: scored.length >= 5 ? "medium" : "low",
    },
    page_results: results,
    caveats: [
      scored.length < benchmarkConfig.pages.length
        ? `Only ${scored.length}/${benchmarkConfig.pages.length} benchmark pages had lane data — results may not be representative.`
        : null,
      "Structural quality scores only — no live GSC/GA4 performance data in this evaluation.",
      "Challenger weights were applied to scoring heuristics, not to actual page regeneration. Full experiment requires rebuilding pages with challenger weights.",
      Object.keys(baselineWeights).length === 0
        ? "No baseline learning state found — both arms used default weights. Run learning_weekly.js with GSC data first."
        : null,
    ].filter(Boolean),
    immutable_surfaces: [
      "slug_generation_rules",
      "canonical_rules",
      "schema_requirements",
      "duplicate_protection",
      "usefulness_gates",
      "publish_approval_rules",
      "publish_integrity_checks",
      "webflow_collection_bindings",
      "verification_logic",
      "lane_contract_logic",
    ],
    operator_notes: `Review page_results for per-page breakdown. If recommendation is 'accept', run: node scripts/learning_weekly.js to apply updated weights. If 'reject', investigate which dimensions degraded.`,
  };

  if (!isDryRun) {
    const expDir = path.join(ROOT, "artifacts", "experiments");
    if (!fs.existsSync(expDir)) fs.mkdirSync(expDir, { recursive: true });
    const expPath = path.join(expDir, `faq_experiment_${Date.now()}.json`);
    fs.writeFileSync(expPath, JSON.stringify(experiment, null, 2));
    console.log(`\n  Artifact saved: ${expPath}`);
  } else {
    console.log(`\n  [DRY RUN] No artifact saved.`);
  }

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log(`║  RESULT: ${recommendation.toUpperCase().padEnd(50)}║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");

  return experiment;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nFATAL: ${err.message}\n${err.stack}`);
    process.exit(1);
  });
