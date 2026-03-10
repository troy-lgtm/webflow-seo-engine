#!/usr/bin/env node

/**
 * Lane Page Factory — Plan
 *
 * Dry-run manufacturing of top N candidates. Builds content, validates,
 * checks duplicates. Writes NOTHING to Webflow. Changes NO approval state.
 *
 * Use this to preview what the factory will manufacture before committing.
 *
 * Flags:
 *   --count N         Number of candidates to evaluate (default 10)
 *   --filter-mode X   LTL, FTL, etc. (default: LTL)
 *   --cluster CITIES  Cluster-first priority (e.g. "chicago-dallas-atlanta")
 *   --json            Output machine-readable JSON only
 *
 * Outputs:
 *   artifacts/lane_factory_plan.json — per-lane details
 *
 * Exit codes:
 *   0 — success
 */

import fs from "fs";
import path from "path";
import { getProjectRoot } from "../lib/fs/project-root.js";
import { computeFactoryInventory, loadApprovalState } from "../lib/approval-gate.js";
import { loadRegistry } from "../lib/publish-registry-disk.js";
import { runFullValidation } from "../lib/lane-page-validator.js";
import {
  buildPackageForLane, buildBodyContent, buildFaqSchemaEmbed,
  buildBreadcrumbSchemaEmbed, computeHubPriority, computeClusterPriority,
  loadLearningStateForPriority, parseClusterCities,
} from "../lib/lane-factory.js";

const ROOT = getProjectRoot();

// --- CLI flags ---
const args = process.argv.slice(2);
const JSON_OUTPUT = args.includes("--json");
function getFlag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}
const TARGET_COUNT = parseInt(getFlag("count", "10"), 10);
const FILTER_MODE = getFlag("filter-mode", "LTL");
const CLUSTER_FLAG = getFlag("cluster", null);

// --- Main ---

const inventory = computeFactoryInventory({ filterMode: FILTER_MODE });

// Candidates = ready_to_manufacture + approved (both are eligible for production)
let candidates = [...inventory.ready_to_manufacture, ...inventory.approved];

if (candidates.length === 0) {
  console.log("No candidates available for manufacturing.");
  console.log(`  Already live: ${inventory.totals.overlap}`);
  console.log(`  Blocked: ${inventory.totals.blocked}`);
  console.log(`  Failed: ${inventory.totals.failed}`);
  process.exit(0);
}

// Build published slug set for priority scoring
const { entries: published } = loadRegistry();
const publishedSlugSet = new Set(
  published.filter(p => !p.dry_run).map(p => (p.slug || "").toLowerCase())
);

// Sort by priority
const clusterCities = parseClusterCities(CLUSTER_FLAG);
if (clusterCities) {
  candidates = candidates
    .map(lane => ({ ...lane, _score: computeClusterPriority(lane, clusterCities, publishedSlugSet) }))
    .sort((a, b) => b._score - a._score);
} else {
  const learningState = loadLearningStateForPriority();
  candidates = candidates
    .map(lane => ({ ...lane, _score: computeHubPriority(lane, publishedSlugSet, learningState) }))
    .sort((a, b) => b._score - a._score);
}

// Take top N
const planCandidates = candidates.slice(0, TARGET_COUNT);

// Within-batch duplicate tracking
const batchSlugs = new Set();
const batchTitles = new Set();
const batchH1s = new Set();

// Evaluate each candidate
const results = [];

for (const lane of planCandidates) {
  const result = {
    slug: lane.slug,
    origin: lane.origin,
    destination: lane.destination,
    mode: lane.mode || FILTER_MODE,
    priority_score: lane._score,
    computed_status: lane.computed_status,
  };

  try {
    // Build page package
    const pkg = buildPackageForLane(lane.origin, lane.destination, lane.mode || FILTER_MODE, "smb");

    // Within-batch duplicate check
    if (batchSlugs.has(pkg.page.slug)) {
      result.status = "blocked";
      result.block_reason = "duplicate slug within batch";
      results.push(result);
      continue;
    }
    if (batchTitles.has(pkg.page.seo_title)) {
      result.status = "blocked";
      result.block_reason = "duplicate seo_title within batch";
      results.push(result);
      continue;
    }
    if (batchH1s.has(pkg.page.h1)) {
      result.status = "blocked";
      result.block_reason = "duplicate h1 within batch";
      results.push(result);
      continue;
    }

    // Validate content
    const bodyHtml = buildBodyContent(pkg.page);
    const faqEmbed = buildFaqSchemaEmbed(pkg.page);
    const breadcrumbEmbed = buildBreadcrumbSchemaEmbed(pkg.page);
    const validation = runFullValidation(pkg.page, bodyHtml, faqEmbed, breadcrumbEmbed);

    result.quality_score = validation.quality_score;
    result.validation_gates = validation.gates;

    if (!validation.valid) {
      const failedGates = Object.entries(validation.gates)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      result.status = "blocked";
      result.block_reason = `Validation: ${failedGates.join(", ")}`;
      result.failed_gates = failedGates;
      result.errors = validation.errors.slice(0, 3).map(e => e.message);
    } else {
      result.status = "would_manufacture";
      batchSlugs.add(pkg.page.slug);
      batchTitles.add(pkg.page.seo_title);
      batchH1s.add(pkg.page.h1);
    }
  } catch (err) {
    result.status = "error";
    result.error = err.message;
  }

  results.push(result);
}

const wouldManufacture = results.filter(r => r.status === "would_manufacture").length;
const wouldBlock = results.filter(r => r.status === "blocked").length;
const errors = results.filter(r => r.status === "error").length;

// Write plan artifact
const plan = {
  generated_at: new Date().toISOString(),
  filter_mode: FILTER_MODE,
  cluster: CLUSTER_FLAG || null,
  target_count: TARGET_COUNT,
  total_candidates: candidates.length,
  evaluated: results.length,
  would_manufacture: wouldManufacture,
  would_block: wouldBlock,
  errors,
  results,
};

const artifactsDir = path.join(ROOT, "artifacts");
fs.mkdirSync(artifactsDir, { recursive: true });
fs.writeFileSync(
  path.join(artifactsDir, "lane_factory_plan.json"),
  JSON.stringify(plan, null, 2) + "\n"
);

if (JSON_OUTPUT) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

// --- Formatted output ---

console.log("");
console.log("╔══════════════════════════════════════════════════╗");
console.log(`║  LANE PAGE FACTORY — PLAN                         ║`);
console.log(`║  Evaluating top ${String(TARGET_COUNT).padEnd(3)} candidates${" ".repeat(20)}║`);
console.log("╚══════════════════════════════════════════════════╝");
console.log(`  Mode: ${FILTER_MODE}${CLUSTER_FLAG ? `  |  Cluster: ${CLUSTER_FLAG}` : ""}`);
console.log(`  Pool: ${candidates.length} total candidates`);
console.log("");

console.log("── Candidate Results ───────────────────────────────");
for (const r of results) {
  if (r.status === "would_manufacture") {
    const score = r.quality_score || 0;
    const hub = (r.priority_score || 0).toFixed(1);
    console.log(`  \u2713 ${r.slug.padEnd(32)} ${r.mode}  quality: ${score}  hub: ${hub}`);
  } else if (r.status === "blocked") {
    console.log(`  \u2717 ${r.slug.padEnd(32)} ${r.mode}  BLOCKED: ${r.block_reason}`);
  } else if (r.status === "error") {
    console.log(`  ! ${r.slug.padEnd(32)} ${r.mode}  ERROR: ${r.error}`);
  }
}
console.log("");

console.log("── Summary ─────────────────────────────────────────");
console.log(`  Would manufacture:     ${wouldManufacture}`);
console.log(`  Would block:           ${wouldBlock}`);
console.log(`  Errors:                ${errors}`);
console.log(`  Ready to produce:      ${wouldManufacture}`);
console.log("");
console.log(`  Plan: artifacts/lane_factory_plan.json`);
console.log("");
console.log("═══════════════════════════════════════════════════");
