/**
 * Artifact Loader
 *
 * Centralized JSON artifact reader with clear error messages.
 * Uses resolveFromRoot() — never process.cwd().
 */

import fs from "fs";
import { resolveFromRoot } from "../fs/project-root.js";

/**
 * Load and parse a JSON file relative to the project root.
 *
 * @param {string} relativePath - Path relative to project root (e.g. "artifacts/publish_decision.json")
 * @param {object} [opts]
 * @param {boolean} [opts.required=false] - If true, throws when file is missing
 * @param {*} [opts.defaultValue=null] - Returned when file is missing and not required
 * @returns {*} Parsed JSON or defaultValue
 */
export function loadJsonArtifact(relativePath, { required = false, defaultValue = null } = {}) {
  const absPath = resolveFromRoot(relativePath);

  if (!fs.existsSync(absPath)) {
    if (required) {
      throw new Error(
        `[load-artifact] Required file not found: ${relativePath}\n` +
        `  Resolved to: ${absPath}\n` +
        `  Project root: ${resolveFromRoot()}\n` +
        `  Hint: Run 'npm run snapshots:seo' to generate artifact files.`
      );
    }
    return defaultValue;
  }

  let raw;
  try {
    raw = fs.readFileSync(absPath, "utf-8");
  } catch (err) {
    if (required) {
      throw new Error(
        `[load-artifact] Failed to read: ${relativePath}\n` +
        `  Resolved to: ${absPath}\n` +
        `  Error: ${err.message}`
      );
    }
    return defaultValue;
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[load-artifact] Invalid JSON in: ${relativePath}\n` +
      `  Resolved to: ${absPath}\n` +
      `  Parse error: ${err.message}`
    );
  }
}

/**
 * Check whether an artifact file exists.
 *
 * @param {string} relativePath - Path relative to project root
 * @returns {{ exists: boolean, path: string, bytes: number|null, parsed: boolean }}
 */
export function probeArtifact(relativePath) {
  const absPath = resolveFromRoot(relativePath);
  const result = { exists: false, path: absPath, bytes: null, parsed: false };

  try {
    const stat = fs.statSync(absPath);
    result.exists = true;
    result.bytes = stat.size;
  } catch {
    return result;
  }

  try {
    JSON.parse(fs.readFileSync(absPath, "utf-8"));
    result.parsed = true;
  } catch {
    // exists but not valid JSON
  }

  return result;
}
