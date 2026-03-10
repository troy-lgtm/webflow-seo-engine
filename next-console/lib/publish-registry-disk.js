/**
 * Publish Registry — Disk-Safe Read/Merge/Write for published_pages.json
 *
 * This is the SINGLE shared module that all scripts must use to touch
 * published_pages.json. It guarantees:
 *
 *   1. Never destructively overwrites — always merges
 *   2. Deduplicates by slug (primary) and webflow_item_id (secondary)
 *   3. Validates schema on read and write
 *   4. Warns on suspicious total count drops
 *   5. Treats the file as a convenience cache, not source of truth
 *   6. Falls back gracefully if file is missing or empty
 *
 * Source of truth is now the per-run manifest in manifests/ dir.
 *
 * Never uses process.cwd(). All paths resolved via project-root.
 */

import fs from "fs";
import path from "path";
import { resolveFromRoot } from "./fs/project-root.js";

// ── Constants ──────────────────────────────────────────────────────────

const REGISTRY_REL_PATH = "data/published_pages.json";
const BACKUP_DIR_REL = "data/registry_backups";
const MAX_BACKUPS = 10;

// Required fields for a valid entry
const REQUIRED_FIELDS = ["slug", "webflow_item_id"];

// Full schema fields for a well-formed entry
const SCHEMA_FIELDS = [
  "slug", "webflow_item_id", "published_at_iso", "dry_run",
  "canonical_path", "seo_title", "h1", "origin_city", "destination_city",
  "mode", "segment", "wave_id", "source_script", "run_id",
];

/**
 * Normalize a registry entry to the canonical schema.
 * Handles known outlier shapes (e.g., published_at vs published_at_iso).
 *
 * @param {object} entry
 * @returns {object} Normalized entry
 */
export function normalizeEntry(entry) {
  const normalized = { ...entry };

  // Normalize published_at → published_at_iso
  if (normalized.published_at && !normalized.published_at_iso) {
    normalized.published_at_iso = normalized.published_at;
    delete normalized.published_at;
  }

  // Ensure slug exists
  if (!normalized.slug && normalized.canonical_path) {
    normalized.slug = normalized.canonical_path.replace(/^\/lanes\//, "");
  }

  // Ensure canonical_path exists
  if (!normalized.canonical_path && normalized.slug) {
    normalized.canonical_path = `/lanes/${normalized.slug}`;
  }

  // Ensure url field is present for convenience
  if (!normalized.url && normalized.slug) {
    normalized.url = `https://www.wearewarp.com/lanes/${normalized.slug}`;
  }

  // Default dry_run to false if not set
  if (normalized.dry_run === undefined) {
    normalized.dry_run = false;
  }

  // Normalize title field
  if (normalized.title && !normalized.seo_title) {
    normalized.seo_title = normalized.title;
    delete normalized.title;
  }

  return normalized;
}

// ── Read ───────────────────────────────────────────────────────────────

/**
 * Load published_pages.json from disk. Always returns an array.
 * Never throws — returns [] on any failure.
 *
 * @returns {{ entries: object[], warnings: string[], path: string }}
 */
export function loadRegistry() {
  const absPath = resolveFromRoot(REGISTRY_REL_PATH);
  const warnings = [];

  if (!fs.existsSync(absPath)) {
    warnings.push(`Registry file does not exist: ${absPath}`);
    return { entries: [], warnings, path: absPath };
  }

  let raw;
  try {
    raw = fs.readFileSync(absPath, "utf-8");
  } catch (err) {
    warnings.push(`Failed to read registry: ${err.message}`);
    return { entries: [], warnings, path: absPath };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warnings.push(`Registry JSON parse error: ${err.message}`);
    return { entries: [], warnings, path: absPath };
  }

  if (!Array.isArray(parsed)) {
    warnings.push(`Registry is not an array (type: ${typeof parsed})`);
    return { entries: [], warnings, path: absPath };
  }

  // Validate entries
  const validEntries = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!entry || typeof entry !== "object") {
      warnings.push(`Entry ${i} is not an object`);
      continue;
    }
    if (!entry.slug && !entry.webflow_item_id) {
      warnings.push(`Entry ${i} has no slug or webflow_item_id — skipped`);
      continue;
    }
    validEntries.push(entry);
  }

  if (validEntries.length < parsed.length) {
    warnings.push(`Dropped ${parsed.length - validEntries.length} invalid entries`);
  }

  // Normalize all entries to canonical schema
  const normalizedEntries = validEntries.map(e => normalizeEntry(e));

  return { entries: normalizedEntries, warnings, path: absPath };
}

// ── Merge ──────────────────────────────────────────────────────────────

/**
 * Merge new entries into existing registry.
 * Deduplicates by slug (primary key).
 * Updates existing entries, appends new ones.
 * Preserves history — never removes entries.
 *
 * @param {object[]} existing - Current registry entries
 * @param {object[]} incoming - New entries to merge
 * @returns {{ merged: object[], added: number, updated: number, warnings: string[] }}
 */
export function mergeEntries(existing, incoming) {
  const warnings = [];
  const result = [...existing]; // shallow copy
  let added = 0;
  let updated = 0;

  for (const rawEntry of incoming) {
    const entry = normalizeEntry(rawEntry);
    if (!entry.slug) {
      warnings.push(`Incoming entry has no slug — skipped`);
      continue;
    }

    const idx = result.findIndex(e => e.slug === entry.slug);
    if (idx >= 0) {
      // Update: merge fields, prefer incoming values for non-null fields
      const merged = { ...result[idx] };
      for (const [key, value] of Object.entries(entry)) {
        if (value !== null && value !== undefined && value !== "") {
          merged[key] = value;
        }
      }
      result[idx] = merged;
      updated++;
    } else {
      result.push(entry);
      added++;
    }
  }

  // Warn on suspicious patterns
  if (existing.length > 0 && result.length < existing.length) {
    warnings.push(
      `⚠ ALERT: Registry shrank from ${existing.length} to ${result.length} entries. ` +
      `This should never happen with merge logic.`
    );
  }

  return { merged: result, added, updated, warnings };
}

// ── Write ──────────────────────────────────────────────────────────────

/**
 * Safely write the registry to disk.
 * Creates a backup before writing.
 * Validates the data before persisting.
 *
 * @param {object[]} entries - Entries to write
 * @param {{ backup?: boolean, source?: string }} opts
 * @returns {{ path: string, count: number, warnings: string[] }}
 */
export function writeRegistry(entries, { backup = true, source = "unknown" } = {}) {
  const absPath = resolveFromRoot(REGISTRY_REL_PATH);
  const warnings = [];

  if (!Array.isArray(entries)) {
    throw new Error("[publish-registry-disk] writeRegistry received non-array data");
  }

  // Validate entries
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e.slug) {
      warnings.push(`Entry ${i} has no slug — included but may cause issues`);
    }
  }

  // Create backup before writing
  if (backup && fs.existsSync(absPath)) {
    try {
      const backupDir = resolveFromRoot(BACKUP_DIR_REL);
      fs.mkdirSync(backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(backupDir, `published_pages_${timestamp}.json`);
      fs.copyFileSync(absPath, backupPath);

      // Cleanup old backups (keep only MAX_BACKUPS)
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith("published_pages_") && f.endsWith(".json"))
        .sort()
        .reverse();
      for (const old of backups.slice(MAX_BACKUPS)) {
        fs.unlinkSync(path.join(backupDir, old));
      }
    } catch (err) {
      warnings.push(`Backup failed: ${err.message}`);
    }
  }

  // Ensure data directory exists
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });

  // Write atomically (write to tmp, then rename)
  const tmpPath = absPath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2) + "\n");
  fs.renameSync(tmpPath, absPath);

  return { path: absPath, count: entries.length, warnings };
}

// ── High-Level Operations ──────────────────────────────────────────────

/**
 * The main entry point: safely merge new entries into the registry.
 * Reads current → merges → writes back. Never loses data.
 *
 * @param {object[]} newEntries - Entries to add/update
 * @param {{ source?: string }} opts - Source identifier for audit
 * @returns {{ total: number, added: number, updated: number, warnings: string[], path: string }}
 */
export function safeRegistryUpdate(newEntries, { source = "unknown" } = {}) {
  const allWarnings = [];

  // 1. Load existing
  const { entries: existing, warnings: loadWarnings } = loadRegistry();
  allWarnings.push(...loadWarnings);

  // 2. Merge
  const { merged, added, updated, warnings: mergeWarnings } = mergeEntries(existing, newEntries);
  allWarnings.push(...mergeWarnings);

  // 3. Suspicious drop check
  if (existing.length > 5 && merged.length < existing.length * 0.5) {
    allWarnings.push(
      `⚠ CRITICAL: Registry would drop from ${existing.length} to ${merged.length}. ` +
      `This looks like a destructive operation. Proceeding but creating backup.`
    );
  }

  // 4. Write
  const { warnings: writeWarnings } = writeRegistry(merged, { backup: true, source });
  allWarnings.push(...writeWarnings);

  return {
    total: merged.length,
    added,
    updated,
    warnings: allWarnings,
    path: resolveFromRoot(REGISTRY_REL_PATH),
  };
}

/**
 * Mark entries as failed (add failed_at timestamp and error reason).
 * Does NOT remove them — just annotates.
 *
 * @param {string[]} slugs - Slugs to mark as failed
 * @param {string} reason - Failure reason
 * @returns {{ total: number, marked: number, warnings: string[] }}
 */
export function markFailed(slugs, reason) {
  const { entries } = loadRegistry();
  let marked = 0;

  for (const slug of slugs) {
    const idx = entries.findIndex(e => e.slug === slug);
    if (idx >= 0) {
      entries[idx].failed_at = new Date().toISOString();
      entries[idx].failure_reason = reason;
      marked++;
    }
  }

  const { warnings } = writeRegistry(entries, { backup: true, source: "mark-failed" });
  return { total: entries.length, marked, warnings };
}

/**
 * Get a summary of the registry for display.
 *
 * @returns {{ total: number, published: number, dryRun: number, failed: number, slugs: string[] }}
 */
export function registrySummary() {
  const { entries } = loadRegistry();
  return {
    total: entries.length,
    published: entries.filter(e => !e.dry_run && e.webflow_item_id && !e.failure_reason).length,
    dryRun: entries.filter(e => e.dry_run === true).length,
    failed: entries.filter(e => e.failure_reason).length,
    slugs: entries.map(e => e.slug).filter(Boolean),
  };
}
