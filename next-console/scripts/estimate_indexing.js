#!/usr/bin/env node

/**
 * Estimate Google Indexing Velocity
 *
 * Reads the staged publish plan and estimates how quickly Google will
 * crawl and index each wave of lane pages, based on conservative
 * assumptions for a domain with established authority plus sitemap
 * submission.
 *
 * Inputs:
 *   artifacts/lane_publish_plan.json — 4-wave staged publish plan
 *
 * Output:
 *   config/indexing_targets.json — crawl/index estimates per wave with milestones
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = getProjectRoot();

function readJSON(relPath) {
  const fullPath = path.join(ROOT, relPath);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
}

function writeJSON(relPath, data) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------

// With sitemap submission + established domain authority:
//   - Google crawls ~50-100 new pages/day baseline
//   - With sitemaps submitted via GSC: ~200 pages/day
//   - XML sitemaps accelerate URL discovery
//   - Internal linking further accelerates crawl priority
const CRAWL_RATE_PAGES_PER_DAY = 200;

// Index delay multiplier: after crawl, Google takes additional time to
// process, render, and add pages to the index. Typically 1.5x crawl time.
const INDEX_DELAY_MULTIPLIER = 1.5;

// Each wave starts 7 days after the previous wave (weekly publish cadence)
const DAYS_PER_WAVE = 7;

// ---------------------------------------------------------------------------
// 1. Load publish plan
// ---------------------------------------------------------------------------

console.log("[estimate_indexing] Loading publish plan...");

const plan = readJSON("artifacts/lane_publish_plan.json");

const waveKeys = ["week_1", "week_2", "week_3", "week_4"];
const totalPages = waveKeys.reduce(
  (sum, key) => sum + (plan.waves[key]?.count || 0),
  0
);

console.log(`  Total publishable pages: ${totalPages}`);
console.log(`  Crawl rate assumption:   ${CRAWL_RATE_PAGES_PER_DAY} pages/day`);

// ---------------------------------------------------------------------------
// 2. Calculate per-wave estimates
// ---------------------------------------------------------------------------

const waves = [];
let cumulativeLive = 0;
let cumulativeDays = 0;

for (let i = 0; i < waveKeys.length; i++) {
  const key = waveKeys[i];
  const wave = plan.waves[key];
  if (!wave) continue;

  const pageCount = wave.count;
  const waveStartDay = i * DAYS_PER_WAVE;

  // How many days for Google to crawl all pages in this wave
  const estCrawlDays = Math.ceil(pageCount / CRAWL_RATE_PAGES_PER_DAY);

  // How many days for full indexing (crawl + processing delay)
  const estIndexDays = Math.ceil(estCrawlDays * INDEX_DELAY_MULTIPLIER);

  cumulativeLive += pageCount;

  // The absolute day by which this wave should be fully indexed
  // (wave start day + index days)
  const absoluteIndexDay = waveStartDay + estIndexDays;
  if (absoluteIndexDay > cumulativeDays) {
    cumulativeDays = absoluteIndexDay;
  }

  waves.push({
    week: i + 1,
    label: wave.label,
    pages: pageCount,
    wave_start_day: waveStartDay,
    est_crawl_days: estCrawlDays,
    est_index_days: estIndexDays,
    cumulative_live: cumulativeLive,
  });
}

// ---------------------------------------------------------------------------
// 3. Calculate milestones
// ---------------------------------------------------------------------------

function findMilestone(targetPercent) {
  const targetPages = Math.ceil(totalPages * targetPercent);
  let runningPages = 0;

  for (const wave of waves) {
    const pagesNeededFromWave = targetPages - runningPages;

    if (pagesNeededFromWave <= wave.pages) {
      // Milestone is reached during this wave
      const fractionOfWave = pagesNeededFromWave / wave.pages;
      const daysIntoWave = Math.ceil(fractionOfWave * wave.est_index_days);
      return {
        week: wave.week,
        est_day: wave.wave_start_day + daysIntoWave,
      };
    }

    runningPages += wave.pages;
  }

  // Fallback: all waves needed
  const lastWave = waves[waves.length - 1];
  return {
    week: lastWave.week,
    est_day: lastWave.wave_start_day + lastWave.est_index_days,
  };
}

const milestones = {
  "50_percent": findMilestone(0.5),
  "90_percent": findMilestone(0.9),
  "100_percent": findMilestone(1.0),
};

// Full index estimate: the latest absolute index day across all waves
const fullIndexEstimateDays = Math.max(
  ...waves.map((w) => w.wave_start_day + w.est_index_days)
);

// ---------------------------------------------------------------------------
// 4. Write output
// ---------------------------------------------------------------------------

const output = {
  timestamp: new Date().toISOString(),
  crawl_rate_assumption: CRAWL_RATE_PAGES_PER_DAY,
  total_pages: totalPages,
  waves: waves.map((w) => ({
    week: w.week,
    pages: w.pages,
    est_crawl_days: w.est_crawl_days,
    est_index_days: w.est_index_days,
    cumulative_live: w.cumulative_live,
  })),
  full_index_estimate_days: fullIndexEstimateDays,
  milestones,
};

writeJSON("config/indexing_targets.json", output);
console.log("  Wrote config/indexing_targets.json");

// ---------------------------------------------------------------------------
// 5. Console summary
// ---------------------------------------------------------------------------

console.log("\n===== Indexing Velocity Estimate =====");
console.log(`Timestamp               : ${output.timestamp}`);
console.log(`Crawl rate assumption   : ${output.crawl_rate_assumption} pages/day`);
console.log(`Total pages             : ${output.total_pages}`);
console.log(`Full index estimate     : ${output.full_index_estimate_days} days`);
console.log("");

console.log("Per-wave estimates:");
console.log(
  "  Week  Pages  Crawl(d)  Index(d)  Cumulative"
);
console.log(
  "  ----  -----  --------  --------  ----------"
);
for (const w of waves) {
  console.log(
    `  ${String(w.week).padEnd(4)}  ${String(w.pages).padStart(5)}  ${String(
      w.est_crawl_days
    ).padStart(8)}  ${String(w.est_index_days).padStart(8)}  ${String(
      w.cumulative_live
    ).padStart(10)}`
  );
}

console.log("\nMilestones:");
for (const [label, milestone] of Object.entries(milestones)) {
  const pct = label.replace("_percent", "%").replace("_", "");
  console.log(
    `  ${pct.padEnd(8)} — Week ${milestone.week}, est. day ${milestone.est_day}`
  );
}

console.log("\nAssumptions:");
console.log(`  - Domain has established authority with Google`);
console.log(`  - Sitemaps submitted via Google Search Console`);
console.log(`  - Crawl rate: ~${CRAWL_RATE_PAGES_PER_DAY} pages/day with sitemap submission`);
console.log(`  - Index delay: ${INDEX_DELAY_MULTIPLIER}x crawl time for processing`);
console.log(`  - Weekly publish cadence (${DAYS_PER_WAVE}-day intervals)`);
console.log(`  - Internal linking present to accelerate crawl priority`);

console.log("\n===== Estimate complete =====");
