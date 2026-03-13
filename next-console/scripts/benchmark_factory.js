#!/usr/bin/env node
/**
 * benchmark_factory.js — Factory Pipeline Benchmark
 *
 * Runs produceLanePage() against benchmark lanes and prints
 * structured results proving the pipeline produces route-ready output.
 *
 * Usage: node scripts/benchmark_factory.js
 */

import { produceLanePage, produceLanePages, validateFactoryOutput } from "../lib/lane-page-factory.js";

const BENCHMARK_LANES = [
  { origin: "Atlanta", destination: "Orlando" },
  { origin: "Atlanta", destination: "Miami" },
  { origin: "Los Angeles", destination: "New York" },
];

console.log("═══════════════════════════════════════════════════════════════");
console.log("  LANE PAGE FACTORY — BENCHMARK PROOF");
console.log("═══════════════════════════════════════════════════════════════\n");

// ── Individual Lane Production ──────────────────────────────────────
for (const lane of BENCHMARK_LANES) {
  console.log(`── ${lane.origin} → ${lane.destination} ──────────────────────`);
  try {
    const result = produceLanePage(lane);
    const validation = validateFactoryOutput(result);

    console.log(`  Slug:        ${result.slug}`);
    console.log(`  Path:        ${result.path}`);
    console.log(`  Quality:     ${result.quality.score}% (${result.quality.grade})`);
    console.log(`  Gates:       ${result.quality.gates_passed}/${result.quality.gates_total}`);
    console.log(`  Publishable: ${result.quality.publishable}`);
    console.log(`  Valid:       ${result.validation.valid}`);
    console.log(`  Headline:    ${result.content.headline}`);
    console.log(`  Sections:    ${result.content.sections}`);
    console.log(`  FAQs:        ${result.content.faqs}`);
    console.log(`  JSON-LD:     ${result.jsonLd.count} types: [${result.jsonLd.types.join(", ")}]`);
    console.log(`  Metadata:    title="${result.metadata.title}"`);
    console.log(`  Factory:     v${result._factory.version} @ ${result._factory.timestamp}`);

    // Factory output validation
    if (!validation.valid) {
      console.log(`  ⚠ FACTORY VALIDATION ERRORS:`);
      validation.errors.forEach((e) => console.log(`    - ${e}`));
    } else {
      console.log(`  ✓ Factory output structurally complete`);
    }

    // Headline format verification (no orphaned commas)
    if (result.content.headline.includes(", to ") || result.content.headline.includes(", LTL") || result.content.headline.includes(", FTL")) {
      console.log(`  ✗ HEADLINE BUG: orphaned commas detected!`);
    } else {
      console.log(`  ✓ Headline format clean (no orphaned commas)`);
    }

    console.log("");
  } catch (err) {
    console.log(`  ✗ ERROR: ${err.message}\n`);
  }
}

// ── Batch Production ────────────────────────────────────────────────
console.log("── BATCH PRODUCTION ─────────────────────────────────────────");
try {
  const batch = produceLanePages(BENCHMARK_LANES);
  console.log(`  Total:       ${batch.summary.total}`);
  console.log(`  Produced:    ${batch.summary.produced}`);
  console.log(`  Publishable: ${batch.summary.publishable}`);
  console.log(`  Blocked:     ${batch.summary.blocked}`);
  console.log(`  Errored:     ${batch.summary.errored}`);
  console.log(`  Avg Score:   ${batch.summary.avgScore}%`);
  console.log(`  Grades:      ${JSON.stringify(batch.summary.grades)}`);
  console.log(`  Slugs:       ${batch.summary.slugs.join(", ")}`);
  console.log("");
} catch (err) {
  console.log(`  ✗ BATCH ERROR: ${err.message}\n`);
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("  BENCHMARK COMPLETE");
console.log("═══════════════════════════════════════════════════════════════");
