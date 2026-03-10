/**
 * Project Root Resolution
 *
 * Determines the repository root by walking upward from __dirname until
 * finding a package.json with "warp" in the name or a "next" dependency,
 * or a marker directory (artifacts/ or data/).
 *
 * NEVER uses process.cwd() — all paths are relative to actual file location.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {string|null} */
let _cachedRoot = null;

/**
 * Walk upward from startDir looking for the project root.
 * Markers (in priority order):
 *   1. package.json with name containing "warp" OR "next" in dependencies
 *   2. An artifacts/ directory alongside a data/ directory
 */
function discoverRoot(startDir) {
  let dir = startDir;
  const root = path.parse(dir).root;

  while (dir !== root) {
    // Check for package.json with matching criteria
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const nameMatch = (pkg.name || "").toLowerCase().includes("warp");
        const hasNext = Boolean(pkg.dependencies?.next || pkg.devDependencies?.next);
        if (nameMatch || hasNext) {
          return dir;
        }
      } catch {
        // Malformed package.json — skip
      }
    }

    // Check for marker directories
    const hasArtifacts = fs.existsSync(path.join(dir, "artifacts"));
    const hasData = fs.existsSync(path.join(dir, "data"));
    if (hasArtifacts && hasData) {
      return dir;
    }

    dir = path.dirname(dir);
  }

  return null;
}

/**
 * Get the absolute path to the project root.
 * Caches the result after first call.
 *
 * @returns {string} Absolute path to project root
 * @throws {Error} If project root cannot be found
 */
export function getProjectRoot() {
  if (_cachedRoot) return _cachedRoot;

  // Start from this file's directory (lib/fs/) and walk up
  const found = discoverRoot(__dirname);
  if (!found) {
    throw new Error(
      `[project-root] Could not locate project root.\n` +
      `  Searched upward from: ${__dirname}\n` +
      `  Looking for: package.json with "warp" name or "next" dep, or artifacts/ + data/ dirs.\n` +
      `  process.cwd() is: ${process.cwd()}\n` +
      `  Hint: Ensure you are running from within the warp-seo-console project tree.`
    );
  }

  _cachedRoot = found;
  return _cachedRoot;
}

/**
 * Resolve a path relative to the project root.
 * Equivalent to path.join(getProjectRoot(), ...parts).
 *
 * @param {...string} parts - Path segments relative to project root
 * @returns {string} Absolute path
 */
export function resolveFromRoot(...parts) {
  return path.join(getProjectRoot(), ...parts);
}

/**
 * Reset the cached root (for testing only).
 */
export function _resetCache() {
  _cachedRoot = null;
}
