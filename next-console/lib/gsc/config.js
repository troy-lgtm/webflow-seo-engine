/**
 * GSC Configuration
 *
 * Centralized config for brand keywords, priority pages,
 * and ingestion defaults. Stored in config/gsc.json.
 */

import fs from "fs";
import { resolveFromRoot } from "../fs/project-root.js";

const CONFIG_PATH = "config/gsc.json";

const DEFAULT_CONFIG = {
  brand_keywords: ["warp", "wearewarp"],
  priority_page_patterns: [
    "/ltl",
    "/ftl",
    "/box-truck",
    "/cargo-van",
    "/zone-skipping",
    "/pool-distribution",
    "/store-replenishment",
    "/cross-dock",
    "/middle-mile",
    "/solutions",
  ],
  ingestion: {
    default_search_type: "web",
    daily_refresh_days: 3,
    backfill_default_days: 30,
    skip_page_query_on_daily: false,
  },
  reporting: {
    leaderboard_limit: 20,
    trend_days: 90,
  },
};

let _cachedConfig = null;

/**
 * Load GSC configuration, merging with defaults.
 */
export function loadGscConfig() {
  if (_cachedConfig) return _cachedConfig;

  const absPath = resolveFromRoot(CONFIG_PATH);
  let fileConfig = {};

  if (fs.existsSync(absPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(absPath, "utf-8"));
    } catch (err) {
      console.warn(`[gsc-config] Failed to parse ${CONFIG_PATH}: ${err.message}`);
    }
  }

  _cachedConfig = {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ingestion: { ...DEFAULT_CONFIG.ingestion, ...(fileConfig.ingestion || {}) },
    reporting: { ...DEFAULT_CONFIG.reporting, ...(fileConfig.reporting || {}) },
  };

  return _cachedConfig;
}

/**
 * Save configuration to disk.
 */
export function saveGscConfig(config) {
  const absPath = resolveFromRoot(CONFIG_PATH);
  fs.writeFileSync(absPath, JSON.stringify(config, null, 2));
  _cachedConfig = null; // Bust cache
}

/**
 * Reset config cache (for testing).
 */
export function _resetConfigCache() {
  _cachedConfig = null;
}

export { DEFAULT_CONFIG };
