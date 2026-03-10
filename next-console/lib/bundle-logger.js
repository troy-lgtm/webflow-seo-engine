/**
 * Bundle Logger — Tracks which content bundles were selected for each page.
 *
 * Classification: runtime-used now
 * Connected to: lib/lane-factory.js → buildPackageForLane()
 * Consumed by: scripts/run-faq-experiment.js, lib/learning-updater.js
 *
 * Logs:
 *   - archetype_id assigned
 *   - FAQ IDs selected (from faq-roster.json)
 *   - intro_template_id used
 *   - section emphasis profile
 *   - generation timestamp
 *   - page quality score at generation time
 *
 * Stored in: artifacts/bundle_selections.json (append-only)
 *
 * SAFETY: Logging only — does NOT modify page content or safety gates.
 */

import fs from "fs";
import path from "path";
import { getProjectRoot } from "./fs/project-root.js";

const ROOT = getProjectRoot();
const BUNDLE_LOG_PATH = path.join(ROOT, "artifacts", "bundle_selections.json");
const MAX_ENTRIES = 5000;

// ── Load / Save ───────────────────────────────────────────────────────

function loadBundleLog() {
  try {
    if (fs.existsSync(BUNDLE_LOG_PATH)) {
      return JSON.parse(fs.readFileSync(BUNDLE_LOG_PATH, "utf-8"));
    }
  } catch {
    /* corrupt file — start fresh */
  }
  return { version: "1.0.0", entries: [] };
}

function saveBundleLog(log) {
  // Trim to max entries (keep newest)
  if (log.entries.length > MAX_ENTRIES) {
    log.entries = log.entries.slice(-MAX_ENTRIES);
  }
  const dir = path.dirname(BUNDLE_LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BUNDLE_LOG_PATH, JSON.stringify(log, null, 2));
}

// ── Core Logger ───────────────────────────────────────────────────────

/**
 * Log a bundle selection for a generated page.
 * @param {object} params
 * @param {string} params.slug - Lane slug (e.g., "chicago-to-dallas")
 * @param {string} params.archetype_id - Archetype assigned (e.g., "short_haul_metro")
 * @param {string[]} params.faq_ids - FAQ roster IDs selected for this page
 * @param {string} params.intro_template_id - Intro template identifier
 * @param {string} params.title_pattern_id - Title pattern identifier (for future use)
 * @param {string} params.meta_pattern_id - Meta pattern identifier (for future use)
 * @param {string} params.cta_variant_id - CTA variant identifier (for future use)
 * @param {object} [params.section_emphasis] - Section emphasis profile
 * @param {number} [params.quality_score] - Page quality score at generation time
 * @param {object} [params.faq_weights_snapshot] - Snapshot of FAQ weights used
 * @param {string} [params.mode] - Freight mode
 * @param {string} [params.segment] - Customer segment
 */
export function logBundleSelection(params) {
  const log = loadBundleLog();

  const entry = {
    slug: params.slug,
    archetype_id: params.archetype_id || null,
    faq_ids: params.faq_ids || [],
    intro_template_id: params.intro_template_id || null,
    title_pattern_id: params.title_pattern_id || "default",
    meta_pattern_id: params.meta_pattern_id || "default",
    cta_variant_id: params.cta_variant_id || "default",
    section_emphasis: params.section_emphasis || null,
    quality_score: params.quality_score || null,
    faq_weights_snapshot: params.faq_weights_snapshot || null,
    mode: params.mode || null,
    segment: params.segment || null,
    generated_at: new Date().toISOString(),
  };

  // Upsert: replace existing entry for same slug, or append
  const existingIdx = log.entries.findIndex((e) => e.slug === entry.slug);
  if (existingIdx >= 0) {
    log.entries[existingIdx] = entry;
  } else {
    log.entries.push(entry);
  }

  saveBundleLog(log);
  return entry;
}

/**
 * Get bundle selection for a specific slug.
 * @param {string} slug
 * @returns {object|null}
 */
export function getBundleSelection(slug) {
  const log = loadBundleLog();
  return log.entries.find((e) => e.slug === slug) || null;
}

/**
 * Get all bundle selections.
 * @returns {object[]}
 */
export function getAllBundleSelections() {
  return loadBundleLog().entries;
}

/**
 * Get bundle selections by archetype.
 * @param {string} archetypeId
 * @returns {object[]}
 */
export function getBundlesByArchetype(archetypeId) {
  return loadBundleLog().entries.filter((e) => e.archetype_id === archetypeId);
}

/**
 * Get FAQ usage frequency across all pages.
 * @returns {Map<string, number>} faqId → usage count
 */
export function getFaqUsageFrequency() {
  const log = loadBundleLog();
  const freq = new Map();
  for (const entry of log.entries) {
    for (const faqId of entry.faq_ids || []) {
      freq.set(faqId, (freq.get(faqId) || 0) + 1);
    }
  }
  return freq;
}

export { BUNDLE_LOG_PATH };
