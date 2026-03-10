/**
 * Publish Health Check — Cross-System Validation
 *
 * Compares:
 *   - Publish manifests (source of truth)
 *   - published_pages.json (convenience cache)
 *   - Live URL responses (HTTP status)
 *   - Webflow CMS state (via API if token available)
 *
 * Flags mismatches like:
 *   - Published in manifest but missing from registry
 *   - In registry but 404 on live site
 *   - CMS item exists but is draft
 *   - Email says published but published_count is 0
 *   - Registry has entries not in any manifest
 *
 * Never uses process.cwd().
 */

import fs from "fs";
import { resolveFromRoot } from "./fs/project-root.js";
import { loadRegistry } from "./publish-registry-disk.js";
import { listManifests, loadManifest } from "./publish-manifest.js";
import { expectedUrlForSlug } from "./page-url.js";

const LIVE_CHECK_TIMEOUT = 5000;
const RATE_LIMIT_MS = 300;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Run a full cross-check of the publish system.
 *
 * @param {{ checkLive?: boolean, checkCms?: boolean, dateFilter?: string, verbose?: boolean }} opts
 * @returns {Promise<HealthCheckResult>}
 */
export async function runHealthCheck({
  checkLive = true,
  checkCms = false,
  dateFilter = null,
  verbose = false,
} = {}) {
  const result = {
    timestamp: new Date().toISOString(),
    checks_run: [],
    mismatches: [],
    warnings: [],
    summary: {
      manifests_checked: 0,
      registry_entries: 0,
      live_checked: 0,
      live_ok: 0,
      live_failed: 0,
      cms_checked: 0,
      cms_ok: 0,
      cms_draft: 0,
      total_mismatches: 0,
    },
  };

  // 1. Load manifests
  const manifests = listManifests({ limit: 100 });
  let filteredManifests = manifests;
  if (dateFilter) {
    filteredManifests = manifests.filter(m => (m.started_at || "").startsWith(dateFilter));
  }
  result.summary.manifests_checked = filteredManifests.length;
  result.checks_run.push("manifests");

  // 2. Load registry
  const { entries: registryEntries, warnings: regWarnings } = loadRegistry();
  result.summary.registry_entries = registryEntries.length;
  result.warnings.push(...regWarnings);
  result.checks_run.push("registry");

  // 3. Build slug sets
  const registrySlugs = new Set(registryEntries.map(e => e.slug));
  const manifestSlugs = new Set();
  const manifestPublishedSlugs = new Set();

  for (const summary of filteredManifests) {
    const full = loadManifest(summary.run_id);
    if (!full) continue;

    // Check: pages published in manifest but missing from registry
    for (const page of (full.published_pages || [])) {
      manifestSlugs.add(page.slug);
      if (!full.dry_run) {
        manifestPublishedSlugs.add(page.slug);
      }

      if (!registrySlugs.has(page.slug) && !full.dry_run) {
        result.mismatches.push({
          type: "manifest_not_in_registry",
          slug: page.slug,
          manifest_run_id: full.run_id,
          detail: `Published in manifest ${full.run_id} but missing from published_pages.json`,
        });
      }
    }

    // Check: email claimed published but count is 0
    if (full.email_sent && full.published_count === 0) {
      result.mismatches.push({
        type: "email_sent_zero_published",
        manifest_run_id: full.run_id,
        detail: `Email was sent but published_count is 0`,
      });
    }

    // Check: dry_run but deploy_status is success
    if (full.dry_run && full.deploy_status === "success") {
      result.mismatches.push({
        type: "dry_run_deploy_success",
        manifest_run_id: full.run_id,
        detail: `Manifest marked as dry_run but deploy_status is "success"`,
      });
    }
  }

  // 4. Check: registry entries not in any manifest
  for (const entry of registryEntries) {
    if (entry.wave_id === "reconciled-from-webflow-cms") continue; // expected
    if (!manifestSlugs.has(entry.slug) && entry.wave_id !== "reconciled-from-webflow-cms") {
      // Only flag if we have manifests to compare against
      if (filteredManifests.length > 0) {
        result.warnings.push(
          `Registry entry "${entry.slug}" not found in any checked manifest (wave: ${entry.wave_id || "unknown"})`
        );
      }
    }
  }

  // 5. Live URL checks
  if (checkLive) {
    result.checks_run.push("live_urls");
    const urlsToCheck = registryEntries
      .filter(e => !e.dry_run && e.webflow_item_id)
      .map(e => ({
        slug: e.slug,
        url: expectedUrlForSlug(e.slug),
      }));

    for (const { slug, url } of urlsToCheck) {
      result.summary.live_checked++;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), LIVE_CHECK_TIMEOUT);
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 200) {
          result.summary.live_ok++;
        } else {
          result.summary.live_failed++;
          result.mismatches.push({
            type: "registry_not_live",
            slug,
            url,
            status: res.status,
            detail: `In registry but returns HTTP ${res.status}`,
          });
        }
      } catch (err) {
        result.summary.live_failed++;
        result.mismatches.push({
          type: "registry_not_live",
          slug,
          url,
          status: "error",
          detail: `In registry but fetch failed: ${err.message}`,
        });
      }
      await sleep(RATE_LIMIT_MS);
    }
  }

  // 6. CMS check (if token available)
  if (checkCms) {
    result.checks_run.push("cms_state");
    try {
      const { config } = await import("dotenv");
      config({ path: resolveFromRoot(".env.local") });

      const token = process.env.WEBFLOW_API_TOKEN;
      const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID;

      if (token && collectionId) {
        // Check each registry entry against CMS
        for (const entry of registryEntries) {
          if (!entry.webflow_item_id || entry.dry_run) continue;

          result.summary.cms_checked++;
          try {
            const res = await fetch(
              `https://api.webflow.com/v2/collections/${collectionId}/items/${entry.webflow_item_id}`,
              { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
            );

            if (res.ok) {
              const data = await res.json();
              if (data.isDraft) {
                result.summary.cms_draft++;
                result.mismatches.push({
                  type: "cms_item_is_draft",
                  slug: entry.slug,
                  webflow_item_id: entry.webflow_item_id,
                  detail: `CMS item exists but is draft (not published)`,
                });
              } else {
                result.summary.cms_ok++;
              }
            } else if (res.status === 404) {
              result.mismatches.push({
                type: "cms_item_not_found",
                slug: entry.slug,
                webflow_item_id: entry.webflow_item_id,
                detail: `CMS item ${entry.webflow_item_id} returns 404`,
              });
            }
          } catch (err) {
            result.warnings.push(`CMS check failed for ${entry.slug}: ${err.message}`);
          }
          await sleep(RATE_LIMIT_MS);
        }
      } else {
        result.warnings.push("CMS check skipped: WEBFLOW_API_TOKEN or WEBFLOW_LANE_COLLECTION_ID not set");
      }
    } catch (err) {
      result.warnings.push(`CMS check initialization failed: ${err.message}`);
    }
  }

  // Finalize
  result.summary.total_mismatches = result.mismatches.length;

  return result;
}

/**
 * Print a health check result to console.
 */
export function printHealthCheck(result) {
  const s = result.summary;
  console.log("");
  console.log("=== PUBLISH SYSTEM HEALTH CHECK ===");
  console.log(`  Timestamp:      ${result.timestamp}`);
  console.log(`  Checks run:     ${result.checks_run.join(", ")}`);
  console.log("");
  console.log(`  Manifests:      ${s.manifests_checked}`);
  console.log(`  Registry:       ${s.registry_entries} entries`);
  console.log(`  Live URLs:      ${s.live_ok}/${s.live_checked} OK (${s.live_failed} failed)`);
  if (s.cms_checked > 0) {
    console.log(`  CMS items:      ${s.cms_ok}/${s.cms_checked} OK (${s.cms_draft} draft)`);
  }
  console.log(`  Mismatches:     ${s.total_mismatches}`);
  console.log("");

  if (result.mismatches.length > 0) {
    console.log("  MISMATCHES:");
    for (const m of result.mismatches) {
      console.log(`    ✗ [${m.type}] ${m.slug || m.manifest_run_id}: ${m.detail}`);
    }
    console.log("");
  }

  if (result.warnings.length > 0) {
    console.log(`  WARNINGS (${result.warnings.length}):`);
    for (const w of result.warnings.slice(0, 10)) {
      console.log(`    ⚠ ${w}`);
    }
    if (result.warnings.length > 10) {
      console.log(`    ... and ${result.warnings.length - 10} more`);
    }
    console.log("");
  }

  if (result.mismatches.length === 0 && result.warnings.length === 0) {
    console.log("  ✓ All checks passed. System is healthy.");
  }
}
