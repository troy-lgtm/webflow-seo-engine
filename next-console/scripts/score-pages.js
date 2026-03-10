#!/usr/bin/env node

/**
 * Page Quality Scorer — Score benchmark pages across all 5 dimensions.
 *
 * Classification: evaluation-only now
 * Connected to: lib/page-quality-scorer.js, config/benchmarks/benchmark-pages.json
 *
 * Usage:
 *   node scripts/score-pages.js                    # Score all benchmark pages
 *   node scripts/score-pages.js --slug=atlanta-to-orlando  # Score one page
 *   node scripts/score-pages.js --json             # Output JSON only
 *   node scripts/score-pages.js --save             # Save to artifacts/
 *
 * Output: Per-page quality scores with dimensional breakdown.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const { scorePageQuality, scoreFaqSet } = await import("../lib/page-quality-scorer.js");
  const { buildLaneKnowledge } = await import("../lib/lane-knowledge.js");
  const { buildCanonicalLanePageData } = await import("../lib/lane-page-schema.js");

  const args = process.argv.slice(2);
  const slugFilter = args.find((a) => a.startsWith("--slug="))?.split("=")[1];
  const jsonOnly = args.includes("--json");
  const shouldSave = args.includes("--save");

  if (!jsonOnly) {
    console.log("");
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  PAGE QUALITY SCORER — 5-Dimension Evaluation    ║");
    console.log("╚══════════════════════════════════════════════════╝");
    console.log("");
  }

  // Load benchmark pages
  const benchmarkPath = path.join(ROOT, "config", "benchmarks", "benchmark-pages.json");
  const benchmarkConfig = JSON.parse(fs.readFileSync(benchmarkPath, "utf-8"));
  let pages = benchmarkConfig.pages;

  if (slugFilter) {
    pages = pages.filter((p) => p.slug === slugFilter || p.slug.includes(slugFilter));
    if (pages.length === 0) {
      console.error(`No benchmark page matching slug: ${slugFilter}`);
      process.exit(1);
    }
  }

  // Load lane inventory
  const inventoryPath = path.join(ROOT, "data", "lane_inventory.json");
  let laneInventory = [];
  if (fs.existsSync(inventoryPath)) {
    laneInventory = JSON.parse(fs.readFileSync(inventoryPath, "utf-8"));
  }

  const results = [];

  for (const benchPage of pages) {
    const slug = benchPage.slug;
    if (!jsonOnly) console.log(`  Scoring: ${slug} (${benchPage.archetype})...`);

    const lane = laneInventory.find(
      (l) =>
        (l.slug || "").includes(slug) ||
        ((l.origin || "").includes(benchPage.origin.split(",")[0]) &&
          (l.destination || "").includes(benchPage.destination.split(",")[0]))
    );

    if (!lane) {
      if (!jsonOnly) console.log(`    ⚠ No lane data — skipped`);
      results.push({ slug, status: "no_lane_data" });
      continue;
    }

    try {
      const knowledge = buildLaneKnowledge(lane);
      const pageData = buildCanonicalLanePageData(knowledge, {
        corridor_hub: { label: "Corridor Hub", path: "/corridors/hub" },
        related_lanes: [],
      });

      const score = scorePageQuality(pageData);
      const faqs = pageData.lane_specific_faqs || [];
      const origin = (benchPage.origin || "").split(",")[0].trim();
      const dest = (benchPage.destination || "").split(",")[0].trim();
      const faqScore = scoreFaqSet(faqs, origin, dest, benchPage.mode);

      const result = {
        slug,
        archetype: benchPage.archetype,
        distance_class: benchPage.distance_class,
        mode: benchPage.mode,
        status: "scored",
        total: score.total,
        grade: score.grade,
        faq_score: faqScore.score,
        faq_count: faqs.length,
        dimensions: score.dimensions,
        checks_summary: score.checks_summary,
      };

      if (!jsonOnly) {
        console.log(`    Total: ${score.total} (${score.grade})`);
        console.log(`    SEO: ${score.dimensions.seo_quality.score} | AI: ${score.dimensions.ai_search_quality.score} | Read: ${score.dimensions.human_readability.score} | Design: ${score.dimensions.design_composition.score} | Conv: ${score.dimensions.conversion_readiness.score}`);
        console.log(`    FAQ: ${faqScore.score} (${faqs.length} FAQs)`);
        console.log(`    Checks: ${score.checks_summary.passing}/${score.checks_summary.total} passing`);
      }

      results.push(result);
    } catch (err) {
      if (!jsonOnly) console.log(`    ⚠ Error: ${err.message}`);
      results.push({ slug, status: "error", error: err.message });
    }
  }

  // Summary
  const scored = results.filter((r) => r.status === "scored");
  const avgTotal = scored.length > 0
    ? Math.round((scored.reduce((s, r) => s + r.total, 0) / scored.length) * 1000) / 1000
    : 0;

  const summary = {
    timestamp: new Date().toISOString(),
    pages_total: results.length,
    pages_scored: scored.length,
    avg_total: avgTotal,
    avg_by_dimension: scored.length > 0
      ? {
          seo_quality: Math.round((scored.reduce((s, r) => s + r.dimensions.seo_quality.score, 0) / scored.length) * 1000) / 1000,
          ai_search_quality: Math.round((scored.reduce((s, r) => s + r.dimensions.ai_search_quality.score, 0) / scored.length) * 1000) / 1000,
          human_readability: Math.round((scored.reduce((s, r) => s + r.dimensions.human_readability.score, 0) / scored.length) * 1000) / 1000,
          design_composition: Math.round((scored.reduce((s, r) => s + r.dimensions.design_composition.score, 0) / scored.length) * 1000) / 1000,
          conversion_readiness: Math.round((scored.reduce((s, r) => s + r.dimensions.conversion_readiness.score, 0) / scored.length) * 1000) / 1000,
        }
      : {},
    grade_distribution: {
      A: scored.filter((r) => r.grade === "A").length,
      B: scored.filter((r) => r.grade === "B").length,
      C: scored.filter((r) => r.grade === "C").length,
      D: scored.filter((r) => r.grade === "D").length,
      F: scored.filter((r) => r.grade === "F").length,
    },
    pages: results,
  };

  if (jsonOnly) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("");
    console.log("── Summary ─────────────────────────────────────────");
    console.log(`  Scored: ${scored.length}/${results.length} pages`);
    console.log(`  Average: ${avgTotal}`);
    if (summary.avg_by_dimension.seo_quality !== undefined) {
      console.log(`  SEO: ${summary.avg_by_dimension.seo_quality} | AI: ${summary.avg_by_dimension.ai_search_quality} | Read: ${summary.avg_by_dimension.human_readability} | Design: ${summary.avg_by_dimension.design_composition} | Conv: ${summary.avg_by_dimension.conversion_readiness}`);
    }
    console.log(`  Grades: A=${summary.grade_distribution.A} B=${summary.grade_distribution.B} C=${summary.grade_distribution.C} D=${summary.grade_distribution.D} F=${summary.grade_distribution.F}`);
  }

  if (shouldSave) {
    const outPath = path.join(ROOT, "artifacts", "page_quality_scores.json");
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    if (!jsonOnly) console.log(`\n  Saved to: ${outPath}`);
  }

  return summary;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nFATAL: ${err.message}\n${err.stack}`);
    process.exit(1);
  });
