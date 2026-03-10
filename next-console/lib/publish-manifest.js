/**
 * Publish Manifest — Immutable Per-Run Record
 *
 * Every publish run creates an immutable JSON manifest in manifests/ dir.
 * This is the DURABLE SOURCE OF TRUTH — not published_pages.json.
 *
 * Manifest file naming: manifests/publish_{run_id}.json
 *
 * A manifest captures EVERYTHING about a publish run:
 *   - Who triggered it (script name, trigger source)
 *   - What was intended, attempted, published, failed, blocked
 *   - Deploy outcome (provider, ID, status)
 *   - Email outcome (attempted, sent, recipient, provider response)
 *   - Sample live URLs
 *   - Warnings
 *   - Timing (started, completed, duration)
 *
 * Manifests are append-only. Never modified after creation.
 *
 * Never uses process.cwd(). All paths resolved via project-root.
 */

import fs from "fs";
import path from "path";
import { resolveFromRoot } from "./fs/project-root.js";

// ── Constants ──────────────────────────────────────────────────────────

const MANIFESTS_DIR = "manifests";

// ── Manifest Builder ───────────────────────────────────────────────────

/**
 * Create a new publish manifest builder.
 * Call methods to populate fields, then call save() to persist.
 *
 * @param {{ scriptName: string, triggerSource?: string, dryRun?: boolean }} opts
 * @returns {PublishManifest}
 */
export function createManifest({ scriptName, triggerSource = "manual", dryRun = false }) {
  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/[:.]/g, "-").replace("Z", "Z");

  const manifest = {
    // Identity
    run_id: runId,
    script_name: scriptName,
    trigger_source: triggerSource,
    dry_run: dryRun,

    // Timing
    started_at: startedAt,
    completed_at: null,
    duration_ms: null,

    // Counts
    intended_count: 0,
    attempted_count: 0,
    published_count: 0,
    failed_count: 0,
    blocked_count: 0,

    // Deploy
    deploy_status: null,
    deploy_id: null,
    deploy_provider: null,

    // Email
    email_attempted: false,
    email_sent: false,
    email_recipient: null,
    email_error: null,
    email_skip_reason: null,
    email_provider_response: null,

    // Pages
    published_pages: [],
    failed_pages: [],
    blocked_pages: [],

    // URLs
    published_urls: [],
    sample_live_urls: [],

    // Warnings
    warnings: [],

    // Mode
    mode: dryRun ? "dry-run" : "live",
  };

  return manifest;
}

// ── Manifest Setters ───────────────────────────────────────────────────

/**
 * Set the intended count for the manifest.
 */
export function setIntended(manifest, count) {
  manifest.intended_count = count;
}

/**
 * Add a published page to the manifest.
 */
export function addPublished(manifest, { slug, webflow_item_id, url }) {
  // url must be the expectedUrl from lib/page-url.js — never construct ad-hoc
  if (!url && slug) {
    // Fallback: derive from slug using canonical pattern
    url = `https://www.wearewarp.com/lanes/${slug}`;
  }
  manifest.published_pages.push({ slug, webflow_item_id, url });
  manifest.published_urls.push(url);
  manifest.published_count = manifest.published_pages.length;
  manifest.attempted_count = manifest.published_count + manifest.failed_count;
}

/**
 * Add a failed page to the manifest.
 */
export function addFailed(manifest, { slug, reason, error }) {
  manifest.failed_pages.push({ slug, reason: reason || error || "unknown" });
  manifest.failed_count = manifest.failed_pages.length;
  manifest.attempted_count = manifest.published_count + manifest.failed_count;
}

/**
 * Add a blocked page to the manifest.
 */
export function addBlocked(manifest, { slug, reason, rule_id }) {
  manifest.blocked_pages.push({ slug, reason, rule_id: rule_id || null });
  manifest.blocked_count = manifest.blocked_pages.length;
}

/**
 * Set deploy information.
 */
export function setDeploy(manifest, { status, id, provider }) {
  manifest.deploy_status = status || null;
  manifest.deploy_id = id || null;
  manifest.deploy_provider = provider || null;
}

/**
 * Set email information.
 */
export function setEmail(manifest, { attempted, sent, recipient, error, skipReason, providerResponse }) {
  manifest.email_attempted = attempted || false;
  manifest.email_sent = sent || false;
  manifest.email_recipient = recipient || null;
  manifest.email_error = error || null;
  manifest.email_skip_reason = skipReason || null;
  manifest.email_provider_response = providerResponse || null;
}

/**
 * Add a warning to the manifest.
 */
export function addWarning(manifest, warning) {
  manifest.warnings.push(warning);
}

/**
 * Set sample live URLs (first 5 for quick verification).
 */
export function setSampleLiveUrls(manifest, urls) {
  manifest.sample_live_urls = (urls || []).slice(0, 5);
}

// ── Finalize & Save ────────────────────────────────────────────────────

/**
 * Finalize the manifest: set completion time and duration.
 */
export function finalizeManifest(manifest) {
  manifest.completed_at = new Date().toISOString();
  manifest.duration_ms = new Date(manifest.completed_at) - new Date(manifest.started_at);

  // Ensure counts are consistent
  manifest.published_count = manifest.published_pages.length;
  manifest.failed_count = manifest.failed_pages.length;
  manifest.blocked_count = manifest.blocked_pages.length;
  manifest.attempted_count = manifest.published_count + manifest.failed_count;
}

/**
 * Save the manifest to disk. Immutable — once saved, never modified.
 *
 * @param {object} manifest - The finalized manifest
 * @returns {{ path: string, run_id: string }}
 */
export function saveManifest(manifest) {
  const dir = resolveFromRoot(MANIFESTS_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const fileName = `publish_${manifest.run_id}.json`;
  const absPath = path.join(dir, fileName);

  fs.writeFileSync(absPath, JSON.stringify(manifest, null, 2) + "\n");

  return { path: absPath, run_id: manifest.run_id };
}

// ── Read Operations ────────────────────────────────────────────────────

/**
 * Load a manifest by run_id.
 *
 * @param {string} runId
 * @returns {object|null}
 */
export function loadManifest(runId) {
  const absPath = resolveFromRoot(MANIFESTS_DIR, `publish_${runId}.json`);
  if (!fs.existsSync(absPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(absPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * List all manifests, sorted by date descending.
 *
 * @param {{ limit?: number }} opts
 * @returns {object[]} Array of { run_id, path, started_at, dry_run, published_count, failed_count }
 */
export function listManifests({ limit = 50 } = {}) {
  const dir = resolveFromRoot(MANIFESTS_DIR);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("publish_") && f.endsWith(".json"))
    .sort()
    .reverse();

  const results = [];
  for (const file of files.slice(0, limit)) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      results.push({
        run_id: data.run_id,
        path: path.join(dir, file),
        started_at: data.started_at,
        completed_at: data.completed_at,
        script_name: data.script_name,
        dry_run: data.dry_run,
        mode: data.mode,
        intended_count: data.intended_count,
        published_count: data.published_count,
        failed_count: data.failed_count,
        blocked_count: data.blocked_count,
        deploy_status: data.deploy_status,
        email_sent: data.email_sent,
        email_recipient: data.email_recipient,
        warnings_count: (data.warnings || []).length,
      });
    } catch {
      // Corrupted manifest — skip
    }
  }

  return results;
}

/**
 * Find manifests by date string (YYYY-MM-DD).
 *
 * @param {string} dateStr - Date to search for (e.g. "2026-03-06")
 * @returns {object[]} Full manifest objects
 */
export function findManifestsByDate(dateStr) {
  const dir = resolveFromRoot(MANIFESTS_DIR);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("publish_") && f.endsWith(".json"))
    .sort()
    .reverse();

  const results = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      const runDate = (data.started_at || "").split("T")[0];
      if (runDate === dateStr) {
        results.push(data);
      }
    } catch {
      // Skip corrupted
    }
  }

  return results;
}

// ── Print Summary ──────────────────────────────────────────────────────

/**
 * Print a human-readable summary of the manifest to console.
 * Called at the end of every publish run.
 *
 * @param {object} manifest
 */
export function printManifestSummary(manifest) {
  const dryTag = manifest.dry_run ? " [DRY RUN]" : "";
  console.log("");
  console.log(`╔══════════════════════════════════════════════════╗`);
  console.log(`║  PUBLISH RUN SUMMARY${dryTag.padEnd(29)}║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Run ID:      ${(manifest.run_id || "").slice(0, 34).padEnd(34)}║`);
  console.log(`║  Script:      ${(manifest.script_name || "").padEnd(34)}║`);
  console.log(`║  Mode:        ${(manifest.mode || "").padEnd(34)}║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Intended:    ${String(manifest.intended_count).padEnd(34)}║`);
  console.log(`║  Attempted:   ${String(manifest.attempted_count).padEnd(34)}║`);
  console.log(`║  Published:   ${String(manifest.published_count).padEnd(34)}║`);
  console.log(`║  Failed:      ${String(manifest.failed_count).padEnd(34)}║`);
  console.log(`║  Blocked:     ${String(manifest.blocked_count).padEnd(34)}║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Deploy:      ${(manifest.deploy_status || "none").padEnd(34)}║`);
  console.log(`║  Email sent:  ${(manifest.email_sent ? "YES → " + manifest.email_recipient : "NO").padEnd(34)}║`);
  if (manifest.email_skip_reason) {
    console.log(`║  Email skip:  ${manifest.email_skip_reason.slice(0, 34).padEnd(34)}║`);
  }
  console.log(`╠══════════════════════════════════════════════════╣`);

  // Sample live URLs (first 5)
  const urls = manifest.sample_live_urls || manifest.published_urls || [];
  if (urls.length > 0) {
    console.log(`║  Live URLs:                                      ║`);
    for (const url of urls.slice(0, 5)) {
      console.log(`║    ${url.slice(0, 46).padEnd(46)}║`);
    }
  }

  // Warnings
  if (manifest.warnings && manifest.warnings.length > 0) {
    console.log(`╠══════════════════════════════════════════════════╣`);
    console.log(`║  ⚠ Warnings (${manifest.warnings.length}):                               ║`);
    for (const w of manifest.warnings.slice(0, 5)) {
      console.log(`║    ${w.slice(0, 46).padEnd(46)}║`);
    }
  }

  // Manifest path
  const manifestPath = resolveFromRoot(MANIFESTS_DIR, `publish_${manifest.run_id}.json`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Manifest: manifests/publish_${(manifest.run_id || "").slice(0, 18)}...  ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);

  // Failed pages detail
  if (manifest.failed_pages && manifest.failed_pages.length > 0) {
    console.log(`\n  Failed pages:`);
    for (const f of manifest.failed_pages) {
      console.log(`    ✗ ${f.slug}: ${(f.reason || "unknown").slice(0, 60)}`);
    }
  }
}
