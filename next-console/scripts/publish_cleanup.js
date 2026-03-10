#!/usr/bin/env node

/**
 * publish:cleanup — Clean up old manifests and receipts
 *
 * Retention policy:
 *   - Keep artifacts from the last N days (default: 30)
 *   - Always keep the most recent M runs (default: 5) regardless of age
 *   - Never delete anything without --confirm flag (dry run by default)
 *
 * Usage:
 *   npm run publish:cleanup                          # dry run — show what would be deleted
 *   npm run publish:cleanup -- --confirm             # actually delete
 *   npm run publish:cleanup -- --days=14             # keep last 14 days
 *   npm run publish:cleanup -- --keep=10             # always keep last 10 runs
 */

import fs from "fs";
import path from "path";
import { resolveFromRoot } from "../lib/fs/project-root.js";

// ── Parse CLI args ────────────────────────────────────────────────────

const args = process.argv.slice(2);

function parseIntArg(name, defaultVal) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  if (!arg) return defaultVal;
  const val = parseInt(arg.split("=")[1], 10);
  return Number.isNaN(val) ? defaultVal : val;
}

const retentionDays = parseIntArg("days", 30);
const keepMinRuns = parseIntArg("keep", 5);
const confirm = args.includes("--confirm");

// ── Helpers ───────────────────────────────────────────────────────────

const NOW = Date.now();
const MS_PER_DAY = 86_400_000;
const cutoffMs = NOW - retentionDays * MS_PER_DAY;

/**
 * Extract a timestamp from a run_id or file content.
 *
 * Run IDs look like: 2026-03-06T14-30-00-000Z
 * We parse the ISO portion back to a Date.
 *
 * @param {string} fileName - File name (e.g. receipt_2026-03-06T14-30-00-000Z.json)
 * @param {string} absPath  - Absolute path to the file
 * @returns {number|null}   - Epoch ms or null
 */
function extractTimestamp(fileName, absPath) {
  // Try to parse from filename first (faster, no I/O)
  // Pattern: receipt_ or publish_ followed by ISO-ish date
  const match = fileName.match(/(?:receipt_|publish_)(\d{4}-\d{2}-\d{2}T[\d-]+Z?)\.json$/);
  if (match) {
    // Convert run_id back to ISO: replace interior dashes that replaced colons/dots
    // 2026-03-06T14-30-00-000Z → 2026-03-06T14:30:00.000Z
    const raw = match[1];
    const parts = raw.split("T");
    if (parts.length === 2) {
      const datePart = parts[0]; // 2026-03-06
      const timePart = parts[1]; // 14-30-00-000Z
      // Reconstruct: first two dashes → colons, third dash → dot
      const timeSegments = timePart.replace("Z", "").split("-");
      let isoTime;
      if (timeSegments.length >= 4) {
        isoTime = `${timeSegments[0]}:${timeSegments[1]}:${timeSegments[2]}.${timeSegments[3]}Z`;
      } else if (timeSegments.length === 3) {
        isoTime = `${timeSegments[0]}:${timeSegments[1]}:${timeSegments[2]}Z`;
      } else {
        isoTime = timePart;
      }
      const d = new Date(`${datePart}T${isoTime}`);
      if (!isNaN(d.getTime())) return d.getTime();
    }
  }

  // Fallback: read file content and look for started_at or receipt_generated_at
  try {
    const content = JSON.parse(fs.readFileSync(absPath, "utf-8"));
    const ts = content.started_at || content.receipt_generated_at || content.completed_at;
    if (ts) {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) return d.getTime();
    }
  } catch {
    // Corrupted file — treat as old
  }

  return null;
}

/**
 * Scan a directory for matching files, sort by date, and decide what to delete.
 *
 * @param {string} relDir   - Relative directory from project root
 * @param {string} prefix   - File prefix to match (e.g. "receipt_" or "publish_")
 * @returns {{ toDelete: string[], toKeep: string[] }}
 */
function scanAndMark(relDir, prefix) {
  const absDir = resolveFromRoot(relDir);
  if (!fs.existsSync(absDir)) {
    return { toDelete: [], toKeep: [] };
  }

  const files = fs.readdirSync(absDir)
    .filter(f => f.startsWith(prefix) && f.endsWith(".json"));

  // Attach timestamps and sort descending (newest first)
  const withTimestamps = files.map(f => {
    const absPath = path.join(absDir, f);
    return {
      fileName: f,
      absPath,
      timestamp: extractTimestamp(f, absPath),
    };
  });

  // Sort newest first; null timestamps go to the end (treated as oldest)
  withTimestamps.sort((a, b) => {
    if (a.timestamp === null && b.timestamp === null) return 0;
    if (a.timestamp === null) return 1;
    if (b.timestamp === null) return -1;
    return b.timestamp - a.timestamp;
  });

  const toKeep = [];
  const toDelete = [];

  for (let i = 0; i < withTimestamps.length; i++) {
    const entry = withTimestamps[i];

    // Always keep the most recent N runs regardless of age
    if (i < keepMinRuns) {
      toKeep.push(entry.absPath);
      continue;
    }

    // Keep if within retention window
    if (entry.timestamp !== null && entry.timestamp >= cutoffMs) {
      toKeep.push(entry.absPath);
      continue;
    }

    // Mark for deletion
    toDelete.push(entry.absPath);
  }

  return { toDelete, toKeep };
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  console.log("=== PUBLISH CLEANUP ===\n");
  console.log(`  Retention:   ${retentionDays} days`);
  console.log(`  Keep recent: ${keepMinRuns} runs`);
  console.log(`  Mode:        ${confirm ? "LIVE DELETE" : "DRY RUN (use --confirm to delete)"}\n`);

  // Scan receipts
  const receipts = scanAndMark("artifacts/publish-receipts", "receipt_");

  // Scan manifests
  const manifests = scanAndMark("manifests", "publish_");

  // Also scan for receipt HTML files alongside JSON receipts being deleted
  const receiptHtmlToDelete = [];
  for (const jsonPath of receipts.toDelete) {
    const htmlPath = jsonPath.replace(/\.json$/, ".html");
    if (fs.existsSync(htmlPath)) {
      receiptHtmlToDelete.push(htmlPath);
    }
  }

  const totalToDelete = receipts.toDelete.length + manifests.toDelete.length + receiptHtmlToDelete.length;

  if (totalToDelete === 0) {
    console.log("  Nothing to clean up. All artifacts are within retention policy.\n");
    process.exit(0);
  }

  // Print what would be / will be deleted
  if (receipts.toDelete.length > 0) {
    console.log(`  Receipts to delete (${receipts.toDelete.length}):`);
    for (const f of receipts.toDelete) {
      console.log(`    - ${path.basename(f)}`);
    }
    console.log("");
  }

  if (receiptHtmlToDelete.length > 0) {
    console.log(`  Receipt HTML to delete (${receiptHtmlToDelete.length}):`);
    for (const f of receiptHtmlToDelete) {
      console.log(`    - ${path.basename(f)}`);
    }
    console.log("");
  }

  if (manifests.toDelete.length > 0) {
    console.log(`  Manifests to delete (${manifests.toDelete.length}):`);
    for (const f of manifests.toDelete) {
      console.log(`    - ${path.basename(f)}`);
    }
    console.log("");
  }

  // Execute deletion if confirmed
  if (confirm) {
    let deletedCount = 0;
    const allToDelete = [...receipts.toDelete, ...receiptHtmlToDelete, ...manifests.toDelete];

    for (const f of allToDelete) {
      try {
        fs.unlinkSync(f);
        deletedCount++;
      } catch (err) {
        console.error(`    ERROR deleting ${path.basename(f)}: ${err.message}`);
      }
    }

    console.log(`  Deleted: ${receipts.toDelete.length} receipts, ${manifests.toDelete.length} manifests` +
      (receiptHtmlToDelete.length > 0 ? `, ${receiptHtmlToDelete.length} receipt HTML files` : "") +
      ` (kept: ${receipts.toKeep.length} receipts, ${manifests.toKeep.length} manifests)`);
  } else {
    console.log(`  Would delete: ${receipts.toDelete.length} receipts, ${manifests.toDelete.length} manifests` +
      (receiptHtmlToDelete.length > 0 ? `, ${receiptHtmlToDelete.length} receipt HTML files` : "") +
      ` (keeping: ${receipts.toKeep.length} receipts, ${manifests.toKeep.length} manifests)`);
    console.log(`\n  Run with --confirm to actually delete.`);
  }

  console.log("");
  process.exit(0);
}

main();
