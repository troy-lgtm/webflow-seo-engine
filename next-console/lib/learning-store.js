/**
 * Learning Store
 * Persistence layer for the self-learning system.
 * Reads/writes learning state, history, and recommendations.
 *
 * SAFETY: This module may read/write learning weights but NEVER
 * modifies hard safety gates (uniqueness thresholds, slug rules,
 * schema requirements, etc.).
 */

import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd());

const PATHS = {
  state: () => path.join(ROOT, "artifacts", "learning_state.json"),
  history: () => path.join(ROOT, "data", "learning_history.json"),
  recommendations: () => path.join(ROOT, "artifacts", "learning_recommendations.json"),
  postmortems: () => path.join(ROOT, "data", "page_postmortems.json"),
  manualFeedback: () => path.join(ROOT, "data", "manual_feedback.json"),
  gscCurrent: () => path.join(ROOT, "data", "gsc_import_current.csv"),
  gscPrevious: () => path.join(ROOT, "data", "gsc_import_previous.csv"),
  ga4Current: () => path.join(ROOT, "data", "ga4_import_current.csv"),
  ga4Previous: () => path.join(ROOT, "data", "ga4_import_previous.csv"),
};

function loadJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { /* ignore parse errors */ }
  return null;
}

function saveJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadCSV(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    return lines.slice(1).map((line) => {
      const vals = line.split(",");
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = vals[i]?.trim() ?? "";
      });
      return obj;
    });
  } catch { return []; }
}

// ── Default State ──────────────────────────────────────────────────

function defaultState() {
  return {
    generated_at: new Date().toISOString(),
    content_version: "v1",
    archetype_weights: {},
    title_pattern_weights: {},
    meta_pattern_weights: {},
    faq_weights: {},
    cta_weights: {},
    link_pattern_weights: {},
    intro_pattern_weights: {},
    learning_notes: [],
  };
}

// ── Public API ─────────────────────────────────────────────────────

export function loadLearningState() {
  return loadJSON(PATHS.state()) || defaultState();
}

export function saveLearningState(state) {
  state.generated_at = new Date().toISOString();
  saveJSON(PATHS.state(), state);
}

export function loadLearningHistory() {
  return loadJSON(PATHS.history()) || [];
}

export function appendLearningHistory(entry) {
  const history = loadLearningHistory();
  history.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  // Keep last 52 weekly entries max
  const trimmed = history.slice(-52);
  saveJSON(PATHS.history(), trimmed);
}

export function loadRecommendations() {
  return loadJSON(PATHS.recommendations()) || [];
}

export function saveRecommendations(recs) {
  saveJSON(PATHS.recommendations(), recs);
}

export function loadPostmortems() {
  return loadJSON(PATHS.postmortems()) || [];
}

export function savePostmortems(data) {
  saveJSON(PATHS.postmortems(), data);
}

export function loadManualFeedback() {
  return loadJSON(PATHS.manualFeedback()) || [];
}

export function loadGSCData(which = "current") {
  return loadCSV(which === "previous" ? PATHS.gscPrevious() : PATHS.gscCurrent());
}

export function loadGA4Data(which = "current") {
  return loadCSV(which === "previous" ? PATHS.ga4Previous() : PATHS.ga4Current());
}

export function loadPublishedPages() {
  return loadJSON(path.join(ROOT, "data", "published_pages.json")) || [];
}

// ── Immutable Safety Gate Keys ─────────────────────────────────────

export const IMMUTABLE_KEYS = [
  "uniqueness_thresholds",
  "usefulness_gate_rules",
  "slug_rules",
  "schema_requirements",
  "duplicate_protection",
  "live_verification_rules",
  "domain_path_trust_rules",
  "collection_template_path",
];

/**
 * Check if a proposed change touches an immutable safety gate.
 * @param {string} key
 * @returns {boolean}
 */
export function isImmutableKey(key) {
  return IMMUTABLE_KEYS.includes(key);
}

export { PATHS };
