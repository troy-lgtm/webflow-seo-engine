#!/usr/bin/env node

/**
 * publish:audit — "Prove It" Command
 *
 * Proves exactly what happened for a given date or run ID.
 * Cross-checks manifests, registry, live URLs, and CMS state.
 *
 * Usage:
 *   node scripts/publish_audit.js --date=2026-03-06
 *   node scripts/publish_audit.js --run=2026-03-06T01-48-29-305Z
 *   node scripts/publish_audit.js                    # defaults to today
 *   node scripts/publish_audit.js --check-live       # also probe live URLs
 *   node scripts/publish_audit.js --check-cms        # also check Webflow CMS
 *   node scripts/publish_audit.js --full             # all checks
 *   node scripts/publish_audit.js --json             # output as JSON
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";
import { listManifests, loadManifest, findManifestsByDate } from "../lib/publish-manifest.js";
import { loadRegistry } from "../lib/publish-registry-disk.js";
import { runHealthCheck, printHealthCheck } from "../lib/publish-health-check.js";

const ROOT = getProjectRoot();
config({ path: path.join(ROOT, ".env.local") });

const args = process.argv.slice(2);
const dateArg = args.find(a => a.startsWith("--date="))?.split("=")[1] || null;
const runArg = args.find(a => a.startsWith("--run="))?.split("=")[1] || null;
const checkLive = args.includes("--check-live") || args.includes("--full");
const checkCms = args.includes("--check-cms") || args.includes("--full");
const jsonOutput = args.includes("--json");

function todayDateString() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

async function main() {
  const targetDate = dateArg || (runArg ? null : todayDateString());

  console.log("=== PUBLISH AUDIT ===");
  if (runArg) {
    console.log(`  Target: Run ${runArg}`);
  } else {
    console.log(`  Target: Date ${targetDate}`);
  }
  console.log(`  Live check: ${checkLive ? "YES" : "no (use --check-live)"}`);
  console.log(`  CMS check: ${checkCms ? "YES" : "no (use --check-cms)"}`);
  console.log("");

  // ── Section 1: Manifest Evidence ────────────────────────────────────

  let manifests = [];

  if (runArg) {
    const m = loadManifest(runArg);
    if (m) {
      manifests = [m];
    } else {
      console.log(`  ✗ No manifest found for run ID: ${runArg}`);
    }
  } else if (targetDate) {
    manifests = findManifestsByDate(targetDate);
  }

  console.log(`\n── PUBLISH RUNS (${manifests.length}) ──────────────────────────────`);

  if (manifests.length === 0) {
    // Fall back to listing all manifests
    const all = listManifests({ limit: 10 });
    if (all.length > 0) {
      console.log(`  No runs found for ${targetDate || runArg}.`);
      console.log(`  Last 5 runs:`);
      for (const m of all.slice(0, 5)) {
        const dryTag = m.dry_run ? " [DRY]" : "";
        console.log(`    ${m.started_at} — ${m.script_name}${dryTag} — ${m.published_count} published, ${m.failed_count} failed`);
      }
    } else {
      console.log("  No manifests found. The manifest system may not have been active for previous runs.");
      console.log("  Check artifacts/publish_run_history.json for legacy run data.");
    }
  }

  let totalPublished = 0;
  let totalFailed = 0;
  let totalBlocked = 0;

  for (const m of manifests) {
    const dryTag = m.dry_run ? " [DRY RUN]" : "";
    console.log(`\n  Run: ${m.run_id}${dryTag}`);
    console.log(`  Script: ${m.script_name}`);
    console.log(`  Mode: ${m.mode}`);
    console.log(`  Started: ${m.started_at}`);
    console.log(`  Completed: ${m.completed_at || "unknown"}`);
    console.log(`  Duration: ${m.duration_ms ? Math.round(m.duration_ms / 1000) + "s" : "unknown"}`);
    console.log("");
    console.log(`  Counts:`);
    console.log(`    Intended:   ${m.intended_count}`);
    console.log(`    Attempted:  ${m.attempted_count}`);
    console.log(`    Published:  ${m.published_count}`);
    console.log(`    Failed:     ${m.failed_count}`);
    console.log(`    Blocked:    ${m.blocked_count}`);
    console.log("");
    console.log(`  Deploy: ${m.deploy_status || "none"} (${m.deploy_provider || "none"}, ID: ${m.deploy_id || "none"})`);
    console.log(`  Email: ${m.email_sent ? "SENT → " + m.email_recipient : "NOT SENT"}`);
    if (m.email_skip_reason) {
      console.log(`  Email skip reason: ${m.email_skip_reason}`);
    }
    if (m.email_error) {
      console.log(`  Email error: ${m.email_error}`);
    }

    // Pages published
    if (m.published_pages && m.published_pages.length > 0) {
      console.log(`\n  Published pages:`);
      for (const p of m.published_pages) {
        console.log(`    ✓ ${p.slug} (${p.webflow_item_id || "no ID"})`);
      }
    }

    // Pages failed
    if (m.failed_pages && m.failed_pages.length > 0) {
      console.log(`\n  Failed pages:`);
      for (const f of m.failed_pages) {
        console.log(`    ✗ ${f.slug}: ${f.reason}`);
      }
    }

    // Pages blocked
    if (m.blocked_pages && m.blocked_pages.length > 0) {
      console.log(`\n  Blocked pages:`);
      for (const b of m.blocked_pages) {
        console.log(`    ⊘ ${b.slug}: ${b.reason} (${b.rule_id || "no rule"})`);
      }
    }

    // Warnings
    if (m.warnings && m.warnings.length > 0) {
      console.log(`\n  Warnings (${m.warnings.length}):`);
      for (const w of m.warnings) {
        console.log(`    ⚠ ${w}`);
      }
    }

    totalPublished += m.published_count || 0;
    totalFailed += m.failed_count || 0;
    totalBlocked += m.blocked_count || 0;
  }

  // ── Section 2: Registry State ───────────────────────────────────────

  console.log(`\n── REGISTRY STATE ──────────────────────────────────`);
  const { entries, warnings: regWarnings } = loadRegistry();
  console.log(`  Total entries: ${entries.length}`);

  const realEntries = entries.filter(e => !e.dry_run && e.webflow_item_id);
  const dryEntries = entries.filter(e => e.dry_run);
  const todayEntries = entries.filter(e => {
    const d = (e.published_at_iso || "").split("T")[0];
    return d === targetDate;
  });

  console.log(`  Real (non-dry-run): ${realEntries.length}`);
  console.log(`  Dry-run: ${dryEntries.length}`);
  if (targetDate) {
    console.log(`  Published on ${targetDate}: ${todayEntries.length}`);
  }

  if (regWarnings.length > 0) {
    console.log(`  Registry warnings:`);
    for (const w of regWarnings) {
      console.log(`    ⚠ ${w}`);
    }
  }

  // ── Section 3: Cross-Check ──────────────────────────────────────────

  if (checkLive || checkCms) {
    console.log(`\n── CROSS-CHECK ─────────────────────────────────────`);
    const healthResult = await runHealthCheck({
      checkLive,
      checkCms,
      dateFilter: targetDate,
    });
    printHealthCheck(healthResult);

    if (jsonOutput) {
      const reportPath = path.join(ROOT, "artifacts", "publish_audit_result.json");
      const report = {
        audit_date: targetDate || runArg,
        manifests_found: manifests.length,
        total_published: totalPublished,
        total_failed: totalFailed,
        total_blocked: totalBlocked,
        registry_entries: entries.length,
        health_check: healthResult,
      };
      const fs = await import("fs");
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
      console.log(`\n  JSON report: ${reportPath}`);
    }
  }

  // ── Section 4: Aggregate Summary ────────────────────────────────────

  console.log(`\n── SUMMARY ─────────────────────────────────────────`);
  console.log(`  Publish runs found:  ${manifests.length}`);
  console.log(`  Total published:     ${totalPublished}`);
  console.log(`  Total failed:        ${totalFailed}`);
  console.log(`  Total blocked:       ${totalBlocked}`);
  console.log(`  Registry entries:    ${entries.length}`);
  console.log(`  Registry real:       ${realEntries.length}`);

  if (manifests.length > 0 && !checkLive && !checkCms) {
    console.log(`\n  Tip: Use --check-live to verify URLs, --check-cms to check Webflow, --full for all.`);
  }

  console.log("");
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
