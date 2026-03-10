#!/usr/bin/env node

/**
 * ⚠️  DEPRECATED — Use lanes_auto_publish.js instead.
 *
 *   npm run lanes:factory -- --count=N --interval=4 --notify=troy@wearewarp.com
 *
 * lanes_auto_publish.js does everything this script does plus:
 *   - autonomous manufacturing (no manual approval needed)
 *   - state machine transitions (manufactured → published → verified)
 *   - factory inventory integration
 *
 * This script is retained for backward compatibility only.
 * ─────────────────────────────────────────────────────────────────────
 *
 * publish:lanes:all — Publish ALL approved lanes with post-publish SEO pipeline
 *
 * Canonical command for batch-publishing every approved lane page.
 * Decouples verification from publish for speed, then runs
 * sitemap regeneration and SEO boost reporting.
 *
 * Flow:
 *   1. Load approved eligible lanes from approval gate
 *   2. Call publish_next.js with auto-calculated count
 *   3. Regenerate sitemap (published-only)
 *   4. Generate SEO boost report
 *   5. Save enhanced receipt
 *   6. Send confirmation email
 *
 * Usage:
 *   npm run publish:lanes:all                                           # dry run
 *   npm run publish:lanes:all -- --live --notify=troy@wearewarp.com     # live
 *   npm run publish:lanes:all -- --live --force --notify=troy@wearewarp.com
 *   npm run publish:lanes:all -- --live --verify                        # opt-in verification
 *   npm run publish:lanes:all -- --dry-run                              # explicit dry run
 *
 * Flags:
 *   --live                Actually publish (default: dry run)
 *   --dry-run             Explicit dry run
 *   --force               Skip guardrails (passes --allow-empty-webflow-slugs)
 *   --verify              Opt-in live URL verification (default: skip for speed)
 *   --notify=EMAIL        Email recipient (default: troy@wearewarp.com)
 *   --mode=LTL            Filter mode (default: LTL)
 *   --cluster=CITIES      City cluster filter
 */

import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { getProjectRoot, resolveFromRoot } from "../lib/fs/project-root.js";
import { loadManifest, listManifests } from "../lib/publish-manifest.js";
import {
  verifyLiveUrlWithRetry,
  buildReceipt, saveReceipt, printReceipt,
  buildConfirmationEmailHtml, saveReceiptHtml,
} from "../lib/publish-receipt.js";
import { computePublishEligibility, transitionState } from "../lib/approval-gate.js";
import { buildSeoBoostReport, saveSeoBoostReport, printSeoBoostReport } from "../lib/seo-boost-report.js";

const ROOT = getProjectRoot();
config({ path: path.join(ROOT, ".env.local") });

// ── Parse Args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const IS_LIVE = args.includes("--live") && !args.includes("--dry-run");
const DRY_RUN = !IS_LIVE;
const FORCE = args.includes("--force");
const VERIFY = args.includes("--verify");
const MODE_FILTER = args.find(a => a.startsWith("--mode="))?.split("=")[1] || null;
const CLUSTER = args.find(a => a.startsWith("--cluster="))?.split("=")[1] || null;

const DEFAULT_RECIPIENT = "troy@wearewarp.com";
const NOTIFY = args.find(a => a.startsWith("--notify="))?.split("=")[1] || DEFAULT_RECIPIENT;

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse the run_id from publish_next.js stdout.
 * @param {string} stdout
 * @returns {string|null}
 */
function parseRunIdFromStdout(stdout) {
  if (!stdout) return null;
  for (const line of stdout.split("\n")) {
    const exact = line.match(/^PUBLISH_RUN_ID=(.+)/);
    if (exact) return exact[1].trim();
    const match = line.match(/Run ID:\s+(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Fallback: find the most recent manifest from publish_next.js
 * created in the last 120 seconds.
 * @returns {string|null}
 */
function findRecentManifestRunId() {
  const cutoff = Date.now() - 120_000;
  const manifests = listManifests({ limit: 10 });
  for (const m of manifests) {
    if (m.script_name === "publish_next.js" && new Date(m.started_at).getTime() >= cutoff) {
      return m.run_id;
    }
  }
  return null;
}

function loadJSON(relPath) {
  const fullPath = resolveFromRoot(relPath);
  if (!fs.existsSync(fullPath)) return null;
  try { return JSON.parse(fs.readFileSync(fullPath, "utf-8")); } catch { return null; }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== WARP Publish All Approved Lanes ===");
  if (DRY_RUN) {
    console.log("  \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
    console.log("  \u2551         DRY RUN MODE          \u2551");
    console.log("  \u2551  No pages will be published   \u2551");
    console.log("  \u2551  No emails will be sent       \u2551");
    console.log("  \u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
  }

  // Step 1: Compute eligible count
  console.log("\n\u2500\u2500 Step 1: Compute approved eligible lanes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");

  const eligibility = computePublishEligibility();
  let approvedLanes = eligibility.approved_eligible;

  // Apply mode filter if specified
  if (MODE_FILTER) {
    approvedLanes = approvedLanes.filter(l => l.mode === MODE_FILTER);
  }

  const approvedCount = approvedLanes.length;

  if (approvedCount === 0) {
    console.log("  No approved lanes eligible for publish.");
    console.log("  To approve lanes:");
    console.log("    npm run approve:lane -- --slug SLUG --mode LTL --by YOUR_NAME");
    console.log("    npm run approve:lane:batch -- --file data/approved_batch.txt --by YOUR_NAME");
    console.log("");
    console.log("  To see current state:");
    console.log("    npm run publish:approved:list");
    process.exit(0);
  }

  console.log(`  Approved eligible:  ${approvedCount} lanes`);
  console.log(`  Mode filter:        ${MODE_FILTER || "all"}`);
  console.log(`  Recipient:          ${NOTIFY}`);
  console.log(`  Verification:       ${VERIFY ? "YES (opt-in)" : "DEFERRED (run publish:seo-check:last later)"}`);
  console.log(`  Force:              ${FORCE ? "YES" : "NO"}`);
  console.log("");

  for (const lane of approvedLanes.slice(0, 10)) {
    const note = lane.approval_note ? ` \u2014 ${lane.approval_note}` : "";
    console.log(`    ${lane.slug} (${lane.mode})${note}`);
  }
  if (approvedCount > 10) {
    console.log(`    ... and ${approvedCount - 10} more`);
  }
  console.log("");

  // Step 2: Run publish_next.js
  console.log("\u2500\u2500 Step 2: Publish pages \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");

  const publishArgs = [`--count`, `${approvedCount}`];
  if (DRY_RUN) publishArgs.push("--dry-run");
  else publishArgs.push("--mode", "live");
  if (FORCE) publishArgs.push("--allow-empty-webflow-slugs");
  if (MODE_FILTER) publishArgs.push(`--filter-mode`, MODE_FILTER);
  if (CLUSTER) publishArgs.push(`--cluster=${CLUSTER}`);

  const publishCmd = `node scripts/publish_next.js ${publishArgs.join(" ")}`;
  console.log(`  Running: ${publishCmd}\n`);

  let publishStdout = "";

  try {
    publishStdout = execSync(publishCmd, {
      cwd: ROOT,
      stdio: ["inherit", "pipe", "inherit"],
      timeout: 3600000, // 60 min timeout for large batches
      env: { ...process.env },
    }).toString("utf-8");

    if (publishStdout) process.stdout.write(publishStdout);
  } catch (err) {
    if (err.status === 1) {
      console.error("\n  FATAL: publish_next.js failed with exit code 1");
      process.exit(1);
    }
    // Exit 2 = inventory exhausted, continue with what was published
    if (err.stdout) {
      publishStdout = err.stdout.toString("utf-8");
      if (publishStdout) process.stdout.write(publishStdout);
    }
    console.log("\n  publish_next.js exited with code 2 (inventory exhausted). Continuing.");
  }

  // Step 3: Find the manifest
  console.log("\n\u2500\u2500 Step 3: Find publish manifest \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");

  let runId = parseRunIdFromStdout(publishStdout);

  if (runId) {
    console.log(`  Parsed run_id from stdout: ${runId}`);
  } else {
    console.log("  Could not parse run_id from stdout. Falling back to recent manifest lookup...");
    runId = findRecentManifestRunId();
    if (runId) {
      console.log(`  Found recent manifest: ${runId}`);
    }
  }

  if (!runId) {
    console.error("  ERROR: No manifest found from publish_next.js.");
    process.exit(1);
  }

  const manifest = loadManifest(runId);
  if (!manifest) {
    console.error(`  ERROR: Could not load manifest for run ${runId}`);
    process.exit(1);
  }

  console.log(`  Published: ${manifest.published_count}, Failed: ${manifest.failed_count}, Blocked: ${manifest.blocked_count}`);

  // Step 4: Regenerate sitemap (published-only)
  console.log("\n\u2500\u2500 Step 4: Regenerate sitemap (published-only) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");

  if (DRY_RUN) {
    console.log("  Skipping sitemap regeneration (dry run).");
  } else {
    try {
      execSync("node scripts/generate_all_sitemaps.js --published-only", {
        cwd: ROOT,
        stdio: "inherit",
        timeout: 60000,
      });
      console.log("  Sitemap regenerated (published URLs only).");
    } catch (err) {
      console.log(`  WARNING: Sitemap regeneration failed: ${err.message}`);
    }
  }

  // Step 5: Verify live URLs (optional, default skip)
  console.log("\n\u2500\u2500 Step 5: Verify live URLs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");

  let verificationResults = [];

  if (DRY_RUN) {
    console.log("  Skipping verification (dry run).");
    verificationResults = (manifest.published_pages || []).map(p => ({
      slug: p.slug,
      url: p.url || `https://www.wearewarp.com/lanes/${p.slug}`,
      status: "dry_run",
      httpStatus: null,
      identityMatch: false,
      error: "dry_run",
    }));
  } else if (!VERIFY) {
    console.log("  Verification deferred (default). Pages remain in published_pending_verification.");
    console.log("  Run later: npm run publish:seo-check:last");
    verificationResults = (manifest.published_pages || []).map(p => ({
      slug: p.slug,
      url: p.url || `https://www.wearewarp.com/lanes/${p.slug}`,
      status: "published_unverified",
      httpStatus: null,
      identityMatch: false,
      error: "verification_deferred",
    }));
  } else if (manifest.published_count > 0) {
    const pagesToVerify = (manifest.published_pages || []).map(p => ({
      slug: p.slug,
      url: p.url || `https://www.wearewarp.com/lanes/${p.slug}`,
    }));

    console.log(`  Verifying ${pagesToVerify.length} URLs with retry...\n`);

    const retryBackoff = [10000, 20000, 40000, 80000];

    for (const page of pagesToVerify) {
      const result = await verifyLiveUrlWithRetry(page.url, page.slug, {
        backoff: retryBackoff,
        onRetry: (attempt, delay) => {
          console.log(`    \u21BB Retry #${attempt} for ${page.slug} in ${delay / 1000}s...`);
        },
      });

      verificationResults.push({
        slug: page.slug,
        url: page.url,
        ...result,
      });

      if (result.status === "verified_live") {
        transitionState(page.slug, MODE_FILTER || "LTL", "verified_live", {
          by: "publish_approved_batch.js",
          note: `Verified at ${page.url}`,
        });
      }

      const icon = result.status === "verified_live" ? "\u2713" : (result.status === "published_unverified" ? "?" : "\u2717");
      console.log(`  ${icon} ${page.slug} \u2014 ${result.status} (HTTP ${result.httpStatus || "N/A"})${result.error ? ` [${result.error}]` : ""}`);
    }
  } else {
    console.log("  No pages to verify (0 published).");
  }

  // Step 6: Generate receipt + SEO boost report
  console.log("\n\u2500\u2500 Step 6: Generate receipt + SEO report \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");

  const receipt = buildReceipt(manifest, verificationResults);
  receipt.recipient = NOTIFY;

  // Build SEO boost report
  const sitemapReport = loadJSON("artifacts/sitemap_generation_report.json");
  const seoReport = buildSeoBoostReport({
    manifest,
    verificationResults,
    sitemapReport,
  });

  // Attach SEO status to receipt
  receipt.seo_status = {
    sitemap_regenerated: !DRY_RUN,
    sitemap_urls_added: seoReport.summary.sitemap_added,
    internally_linked: seoReport.summary.internally_linked,
    missing_internal_links: seoReport.missing_internal_links.length,
    missing_sitemap: seoReport.missing_sitemap.length,
    verification_deferred: !VERIFY && !DRY_RUN,
  };

  const { path: receiptPath } = saveReceipt(receipt);
  console.log(`  Receipt saved: ${receiptPath}`);

  const { path: seoPath } = saveSeoBoostReport(seoReport);
  console.log(`  SEO report saved: ${seoPath}`);

  // Step 7: Send confirmation email
  console.log("\n\u2500\u2500 Step 7: Send confirmation email \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n");

  let emailFailed = false;
  let emailSkipped = false;

  if (DRY_RUN) {
    console.log("  Skipping email (dry run).");
    receipt.email_attempted = false;
    receipt.email_sent = false;
    receipt.email_provider_status = "dry_run_skipped";
    emailSkipped = true;
  } else if (receipt.published_count === 0) {
    console.log("  Skipping email \u2014 no pages published.");
    receipt.email_attempted = false;
    receipt.email_sent = false;
    receipt.email_provider_status = "no_published_pages";
    emailSkipped = true;
  } else {
    const { EMAIL_USER, EMAIL_APP_PASSWORD } = process.env;
    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
      console.error("  \u26A0 Cannot send email \u2014 EMAIL_USER or EMAIL_APP_PASSWORD not set.");
      receipt.email_attempted = true;
      receipt.email_sent = false;
      receipt.email_provider_status = "missing_credentials";
      emailFailed = true;
    } else {
      try {
        const nodemailer = await import("nodemailer");
        const transport = nodemailer.default.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
        });

        await transport.verify();

        const emailHtml = buildConfirmationEmailHtml(receipt);
        const subjectStatus = receipt.verified_live_count > 0
          ? `${receipt.verified_live_count} verified live`
          : `${receipt.published_count} published`;
        const subject = `Warp Publish Receipt \u2014 ${subjectStatus} \u2014 ${receipt.run_id.split("T")[0]}`;

        const info = await transport.sendMail({
          from: EMAIL_USER,
          to: NOTIFY,
          subject,
          html: emailHtml,
        });

        console.log(`  \u2713 Email sent: ${info.messageId} \u2192 ${NOTIFY}`);
        receipt.email_attempted = true;
        receipt.email_sent = true;
        receipt.email_provider_status = info.messageId || "sent";
      } catch (emailErr) {
        console.error(`  \u2717 Email failed: ${emailErr.message}`);
        receipt.email_attempted = true;
        receipt.email_sent = false;
        receipt.email_provider_status = emailErr.message;
        emailFailed = true;
      }
    }
  }

  // Update receipt with email status and re-save
  saveReceipt(receipt);

  // Save HTML receipt
  const htmlReceiptResult = saveReceiptHtml(receipt);

  if (emailFailed) {
    console.log("");
    console.log(`  \u26A0 Email not sent. Fallback receipt saved:`);
    console.log(`    ${htmlReceiptResult.path}`);
  } else if (!emailSkipped) {
    console.log(`  HTML receipt also saved: ${htmlReceiptResult.path}`);
  }

  // Step 8: Print summary
  printReceipt(receipt);
  printSeoBoostReport(seoReport);

  // Final output
  if (DRY_RUN) {
    console.log("  Dry run complete. No pages were published.");
    console.log("  To publish for real: npm run publish:lanes:all -- --live --notify=troy@wearewarp.com");
  } else if (receipt.published_count > 0) {
    console.log(`  \u2713 Batch complete: ${receipt.published_count} published.`);
    if (!VERIFY) {
      console.log("  Verify later: npm run publish:seo-check:last");
    }
  } else {
    console.log("  \u2717 Batch failed: 0 pages published.");
    process.exit(2);
  }

  console.log("");
  process.exit(0);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
