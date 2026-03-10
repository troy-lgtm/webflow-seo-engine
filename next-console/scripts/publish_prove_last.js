#!/usr/bin/env node

/**
 * publish:prove:last — Prove the last publish batch outcome
 *
 * Single command to show everything about the most recent publish run:
 *   - Run ID, script, final status
 *   - Selected pages
 *   - Verified live URLs (re-checks them now with retry)
 *   - Published unverified URLs
 *   - Failed pages with reasons
 *   - Blocked pages with reasons
 *   - Retry history from verification attempts
 *   - Email recipient and send result
 *   - Manifest path and receipt path
 *   - Mismatches between manifest, registry, and live URLs
 *
 * Usage:
 *   npm run publish:prove:last                    # prove the last run
 *   npm run publish:prove:last -- --run=RUN_ID    # prove a specific run
 *   npm run publish:prove:last -- --json          # output as JSON
 */

import { config } from "dotenv";
import path from "path";
import { getProjectRoot, resolveFromRoot } from "../lib/fs/project-root.js";
import { listManifests, loadManifest } from "../lib/publish-manifest.js";
import { loadRegistry } from "../lib/publish-registry-disk.js";
import { loadReceipt, verifyLiveUrl } from "../lib/publish-receipt.js";

const ROOT = getProjectRoot();
config({ path: path.join(ROOT, ".env.local") });

const args = process.argv.slice(2);
const RUN_ID = args.find(a => a.startsWith("--run="))?.split("=")[1] || null;
const JSON_OUTPUT = args.includes("--json");

// ── Retry wrapper for live verification ───────────────────────────────

/**
 * Verify a single URL with exponential backoff retry.
 * Uses shorter backoff intervals for proof mode (faster feedback).
 *
 * @param {string} url
 * @param {string} slug
 * @param {{ backoffMs?: number[], timeoutMs?: number }} opts
 * @returns {Promise<{ slug: string, url: string, status: string, httpStatus: number|null, identityMatch: boolean, error: string|null, attempts: number }>}
 */
async function verifyLiveUrlWithRetry(url, slug, { backoffMs = [5000, 10000], timeoutMs = 8000 } = {}) {
  // First attempt (no delay)
  let result = await verifyLiveUrl(url, slug, { timeoutMs });
  let attempts = 1;

  if (result.status === "verified_live") {
    return { slug, url, ...result, attempts };
  }

  // Retry with backoff
  for (const delay of backoffMs) {
    await new Promise(r => setTimeout(r, delay));
    attempts++;
    result = await verifyLiveUrl(url, slug, { timeoutMs });
    if (result.status === "verified_live") {
      return { slug, url, ...result, attempts };
    }
  }

  return { slug, url, ...result, attempts };
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("=== PUBLISH PROOF ===\n");

  // 1. Find the manifest
  let manifest;
  let runId;

  if (RUN_ID) {
    manifest = loadManifest(RUN_ID);
    runId = RUN_ID;
    if (!manifest) {
      console.error(`  ERROR: No manifest found for run ID: ${RUN_ID}`);
      process.exit(1);
    }
  } else {
    const recent = listManifests({ limit: 10 });
    // Find the most recent non-email manifest (actual publish run)
    const publishManifest = recent.find(m =>
      m.script_name !== "send_daily_publish_summary.js"
    );
    if (!publishManifest) {
      console.error("  ERROR: No publish manifests found.");
      console.error("  Run a publish command first, then use this to prove it.");
      process.exit(1);
    }
    manifest = loadManifest(publishManifest.run_id);
    runId = publishManifest.run_id;
  }

  // 2. Load receipt if it exists
  const receipt = loadReceipt(runId);

  // 3. Load registry
  const { entries: registryEntries } = loadRegistry();

  // 4. Re-verify live URLs with retry
  const publishedPages = manifest.published_pages || [];
  const pagesToVerify = publishedPages
    .filter(p => !manifest.dry_run)
    .map(p => ({
      slug: p.slug,
      url: p.url || `https://www.wearewarp.com/lanes/${p.slug}`,
    }));

  let liveResults = [];
  if (pagesToVerify.length > 0) {
    console.log(`  Re-verifying ${pagesToVerify.length} URLs (with retry)...\n`);
    for (const page of pagesToVerify) {
      const result = await verifyLiveUrlWithRetry(page.url, page.slug, {
        backoffMs: [5000, 10000],
        timeoutMs: 8000,
      });
      liveResults.push(result);

      // Rate limit between pages
      if (pagesToVerify.indexOf(page) < pagesToVerify.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  // 5. Separate verified vs unverified
  const verifiedLive = liveResults.filter(v => v.status === "verified_live");
  const publishedUnverified = liveResults.filter(v => v.status !== "verified_live");

  // 6. Build retry history from receipt verification_attempts (if available)
  const retryHistory = receipt?.verification_attempts || null;

  // 7. Find mismatches
  const mismatches = [];

  // Check: pages in manifest but not in registry
  for (const p of publishedPages) {
    if (manifest.dry_run) continue;
    const inRegistry = registryEntries.find(e => e.slug === p.slug);
    if (!inRegistry) {
      mismatches.push({
        type: "manifest_not_in_registry",
        slug: p.slug,
        detail: "Page in manifest but missing from published_pages.json",
      });
    }
  }

  // Check: verified live now vs receipt
  for (const v of liveResults) {
    if (v.status !== "verified_live") {
      mismatches.push({
        type: "live_check_failed",
        slug: v.slug,
        detail: `URL returned ${v.httpStatus || "error"}: ${v.error || "unknown"}`,
      });
    }
  }

  // Check: receipt vs manifest consistency
  if (receipt) {
    if (receipt.published_count !== manifest.published_count) {
      mismatches.push({
        type: "receipt_manifest_count_mismatch",
        detail: `Receipt says ${receipt.published_count} published, manifest says ${manifest.published_count}`,
      });
    }
  }

  // 8. Output
  const dryTag = manifest.dry_run ? " [DRY RUN]" : "";
  const verifiedCount = verifiedLive.length;
  const unverifiedCount = publishedUnverified.length;

  // Receipt and manifest relative paths
  const manifestRelPath = `manifests/publish_${runId}.json`;
  const receiptRelPath = receipt ? `artifacts/publish-receipts/receipt_${runId}.json` : null;

  if (JSON_OUTPUT) {
    const proof = {
      run_id: runId,
      script_name: manifest.script_name,
      final_status: receipt?.final_status || (manifest.dry_run ? "dry_run" : (manifest.published_count > 0 ? "published" : "no_pages")),
      dry_run: manifest.dry_run,
      started_at: manifest.started_at,
      completed_at: manifest.completed_at,
      intended_count: manifest.intended_count,
      published_count: manifest.published_count,
      verified_live_now: verifiedCount,
      published_unverified_count: unverifiedCount,
      failed_count: manifest.failed_count,
      blocked_count: manifest.blocked_count,
      selected_pages: publishedPages.map(p => p.slug),
      verified_live_urls: verifiedLive.map(v => v.url),
      published_unverified_urls: publishedUnverified.map(v => ({
        slug: v.slug,
        url: v.url,
        httpStatus: v.httpStatus,
        error: v.error,
        attempts: v.attempts,
      })),
      failed_pages: (manifest.failed_pages || []).map(f => ({ slug: f.slug, reason: f.reason })),
      blocked_pages: (manifest.blocked_pages || []).map(b => ({ slug: b.slug, reason: b.reason })),
      recipient: manifest.email_recipient || receipt?.recipient || "unknown",
      email_sent: manifest.email_sent,
      email_result: manifest.email_provider_response || manifest.email_error || manifest.email_skip_reason || "unknown",
      manifest_path: manifestRelPath,
      receipt_path: receiptRelPath,
      retry_history: retryHistory,
      mismatches,
    };
    console.log(JSON.stringify(proof, null, 2));
    process.exit(mismatches.length > 0 ? 1 : 0);
  }

  // Human-readable output
  console.log(`\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557`);
  console.log(`\u2551  PUBLISH PROOF${dryTag.padEnd(35)}\u2551`);
  console.log(`\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563`);
  console.log(`\u2551  Run ID:      ${(runId || "").slice(0, 34).padEnd(34)}\u2551`);
  console.log(`\u2551  Script:      ${(manifest.script_name || "").padEnd(34)}\u2551`);
  console.log(`\u2551  Status:      ${(receipt?.final_status || (manifest.dry_run ? "dry_run" : "published")).padEnd(34)}\u2551`);
  console.log(`\u2551  Started:     ${(manifest.started_at || "").slice(0, 34).padEnd(34)}\u2551`);
  console.log(`\u2551  Completed:   ${(manifest.completed_at || "").slice(0, 34).padEnd(34)}\u2551`);
  console.log(`\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563`);
  console.log(`\u2551  Intended:    ${String(manifest.intended_count).padEnd(34)}\u2551`);
  console.log(`\u2551  Published:   ${String(manifest.published_count).padEnd(34)}\u2551`);
  console.log(`\u2551  Verified now:${String(verifiedCount).padEnd(34)}\u2551`);
  console.log(`\u2551  Unverified:  ${String(unverifiedCount).padEnd(34)}\u2551`);
  console.log(`\u2551  Failed:      ${String(manifest.failed_count).padEnd(34)}\u2551`);
  console.log(`\u2551  Blocked:     ${String(manifest.blocked_count).padEnd(34)}\u2551`);
  console.log(`\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563`);

  // Selected pages
  if (publishedPages.length > 0) {
    console.log(`\u2551  Selected pages:                                 \u2551`);
    for (const p of publishedPages) {
      console.log(`\u2551    ${p.slug.slice(0, 46).padEnd(46)}\u2551`);
    }
  }

  // Verified URLs
  if (verifiedLive.length > 0) {
    console.log(`\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563`);
    console.log(`\u2551  Verified live URLs:                             \u2551`);
    for (const v of verifiedLive) {
      const retryNote = v.attempts > 1 ? ` (${v.attempts} attempts)` : "";
      console.log(`\u2551    \u2713 ${(v.url + retryNote).slice(0, 43).padEnd(43)}\u2551`);
    }
  }

  // Published unverified URLs
  if (publishedUnverified.length > 0) {
    console.log(`\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563`);
    console.log(`\u2551  Published unverified URLs:                      \u2551`);
    for (const v of publishedUnverified) {
      const errShort = (v.error || "unverified").slice(0, 30);
      console.log(`\u2551    ? ${v.slug.slice(0, 43).padEnd(43)}\u2551`);
      console.log(`\u2551      ${errShort.padEnd(43)}\u2551`);
    }
  }

  // Failed pages
  if (manifest.failed_pages && manifest.failed_pages.length > 0) {
    console.log(`\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563`);
    console.log(`\u2551  Failed pages:                                   \u2551`);
    for (const f of manifest.failed_pages) {
      console.log(`\u2551    \u2717 ${f.slug}: ${(f.reason || "").slice(0, 30).padEnd(30)}\u2551`);
    }
  }

  // Blocked pages
  if (manifest.blocked_pages && manifest.blocked_pages.length > 0) {
    console.log(`\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563`);
    console.log(`\u2551  Blocked pages:                                  \u2551`);
    for (const b of manifest.blocked_pages) {
      console.log(`\u2551    \u2298 ${b.slug}: ${(b.reason || "").slice(0, 30).padEnd(30)}\u2551`);
    }
  }

  // Retry history from receipt
  if (retryHistory && Array.isArray(retryHistory) && retryHistory.length > 0) {
    console.log(`\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563`);
    console.log(`\u2551  Retry history (from receipt):                   \u2551`);
    for (const attempt of retryHistory) {
      const slug = (attempt.slug || "").slice(0, 20);
      const att = attempt.attempt || "?";
      const status = (attempt.status || "").slice(0, 15);
      console.log(`\u2551    ${slug.padEnd(20)} attempt ${String(att).padEnd(3)} ${status.padEnd(15)}\u2551`);
    }
  }

  // Email
  console.log(`\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563`);
  console.log(`\u2551  Recipient:   ${(manifest.email_recipient || receipt?.recipient || "unknown").padEnd(34)}\u2551`);
  console.log(`\u2551  Email sent:  ${(manifest.email_sent ? "YES" : "NO").padEnd(34)}\u2551`);
  const emailResult = manifest.email_provider_response || manifest.email_error || manifest.email_skip_reason || "N/A";
  console.log(`\u2551  Email result:${String(emailResult).slice(0, 34).padEnd(34)}\u2551`);

  // Paths — show full relative paths
  console.log(`\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563`);
  console.log(`\u2551  Manifest:                                       \u2551`);
  console.log(`\u2551    ${manifestRelPath.slice(0, 46).padEnd(46)}\u2551`);
  if (receiptRelPath) {
    console.log(`\u2551  Receipt:                                        \u2551`);
    console.log(`\u2551    ${receiptRelPath.slice(0, 46).padEnd(46)}\u2551`);
  } else {
    console.log(`\u2551  Receipt:     (none found)                       \u2551`);
  }

  // Mismatches
  if (mismatches.length > 0) {
    console.log(`\u2560\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2563`);
    console.log(`\u2551  \u26a0 MISMATCHES (${String(mismatches.length).padEnd(33)})\u2551`);
    for (const m of mismatches) {
      console.log(`\u2551    ${m.type}: ${(m.detail || m.slug || "").slice(0, 33).padEnd(33)}\u2551`);
    }
  }

  console.log(`\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d`);

  if (mismatches.length > 0) {
    console.log(`\n  \u26a0 ${mismatches.length} mismatch(es) found. Investigate above.`);
    process.exit(1);
  } else {
    console.log(`\n  \u2713 Proof complete. No mismatches.`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
