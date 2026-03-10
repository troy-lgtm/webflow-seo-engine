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
 *   - integrated sitemap regeneration
 *
 * This script is retained for backward compatibility only.
 * ─────────────────────────────────────────────────────────────────────
 *
 * publish:text-batch — Canonical batch publish with receipt and email
 *
 * This is the ONE supported command for publishing a batch of lane pages
 * with verified receipts and email confirmation.
 *
 * Flow:
 *   1. Run publish_next.js to publish N pages (default 5)
 *   2. Read the manifest it produced (direct run_id handoff from stdout)
 *   3. Verify all published URLs are live (retry-enabled verification)
 *   4. Generate a post-publish receipt (JSON + HTML fallback)
 *   5. Send confirmation email to recipient
 *   6. Print operator summary
 *
 * Usage:
 *   npm run publish:text-batch                                     # dry run, 5 pages
 *   npm run publish:text-batch -- --count=5 --live --notify=troy@wearewarp.com
 *   npm run publish:text-batch -- --count=10 --live                # live, 10 pages, default recipient
 *   npm run publish:text-batch -- --dry-run                        # explicit dry run
 *
 * Flags:
 *   --count=N              Number of pages (default: 5)
 *   --live                 Actually publish (default: dry run)
 *   --dry-run              Explicit dry run
 *   --notify=EMAIL         Email recipient (default: troy@wearewarp.com)
 *   --skip-verify          Skip live URL verification (not recommended)
 *   --mode=LTL             Filter mode (default: LTL)
 *   --cluster=CITIES       City cluster filter (e.g., chicago-dallas-atlanta)
 */

import { config } from "dotenv";
import path from "path";
import { execSync } from "child_process";
import { getProjectRoot, resolveFromRoot } from "../lib/fs/project-root.js";
import {
  loadManifest, listManifests,
} from "../lib/publish-manifest.js";
import {
  verifyLiveUrls, verifyLiveUrlWithRetry,
  buildReceipt, saveReceipt, printReceipt,
  buildConfirmationEmailHtml, saveReceiptHtml,
} from "../lib/publish-receipt.js";
import { transitionState } from "../lib/approval-gate.js";

const ROOT = getProjectRoot();
config({ path: path.join(ROOT, ".env.local") });

// ── Parse Args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const COUNT = parseInt(args.find(a => a.startsWith("--count="))?.split("=")[1] || "5", 10);
const IS_LIVE = args.includes("--live") && !args.includes("--dry-run");
const DRY_RUN = !IS_LIVE;
const SKIP_VERIFY = args.includes("--skip-verify");
const MODE_FILTER = args.find(a => a.startsWith("--mode="))?.split("=")[1] || null;
const CLUSTER = args.find(a => a.startsWith("--cluster="))?.split("=")[1] || null;

const DEFAULT_RECIPIENT = "troy@wearewarp.com";
const NOTIFY = args.find(a => a.startsWith("--notify="))?.split("=")[1] || DEFAULT_RECIPIENT;

if (NOTIFY !== DEFAULT_RECIPIENT) {
  console.log(`  ╔═══════════════════════════════════════════════════╗`);
  console.log(`  ║  ⚠ WARNING: Recipient override                   ║`);
  console.log(`  ║  Default: ${DEFAULT_RECIPIENT.padEnd(39)}║`);
  console.log(`  ║  Override: ${NOTIFY.padEnd(38)}║`);
  console.log(`  ╚═══════════════════════════════════════════════════╝`);
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse the run_id from publish_next.js stdout.
 * Looks for a line matching "Run ID:      <value>".
 *
 * @param {string} stdout - Full stdout output from publish_next.js
 * @returns {string|null} Extracted run_id or null
 */
function parseRunIdFromStdout(stdout) {
  if (!stdout) return null;
  for (const line of stdout.split("\n")) {
    // Machine-readable line emitted by publish_next.js
    const exact = line.match(/^PUBLISH_RUN_ID=(.+)/);
    if (exact) return exact[1].trim();
    // Fallback: human-readable Run ID line
    const match = line.match(/Run ID:\s+(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Fallback: find the most recent manifest from publish_next.js
 * that was created in the last 60 seconds.
 *
 * @returns {string|null} run_id or null
 */
function findRecentManifestRunId() {
  const cutoff = Date.now() - 60_000;
  const manifests = listManifests({ limit: 10 });
  for (const m of manifests) {
    if (m.script_name === "publish_next.js" && new Date(m.started_at).getTime() >= cutoff) {
      return m.run_id;
    }
  }
  return null;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== WARP Publish Text Batch ===");
  if (DRY_RUN) {
    console.log("  ╔═══════════════════════════════╗");
    console.log("  ║         DRY RUN MODE          ║");
    console.log("  ║  No pages will be published   ║");
    console.log("  ║  No emails will be sent       ║");
    console.log("  ╚═══════════════════════════════╝");
  }
  console.log(`  Count:     ${COUNT}`);
  console.log(`  Mode:      ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`  Recipient: ${NOTIFY}`);
  console.log(`  Verify:    ${SKIP_VERIFY ? "SKIP (--skip-verify)" : "YES"}`);
  console.log("");

  // Step 1: Run publish_next.js
  console.log("── Step 1: Publish pages ──────────────────────────────\n");

  const publishArgs = [`--count`, `${COUNT}`];
  if (DRY_RUN) publishArgs.push("--dry-run");
  if (MODE_FILTER) publishArgs.push(`--mode=${MODE_FILTER}`);
  if (CLUSTER) publishArgs.push(`--cluster=${CLUSTER}`);

  const publishCmd = `node scripts/publish_next.js ${publishArgs.join(" ")}`;
  console.log(`  Running: ${publishCmd}\n`);

  let publishStdout = "";

  try {
    publishStdout = execSync(publishCmd, {
      cwd: ROOT,
      stdio: ["inherit", "pipe", "inherit"],
      timeout: 300000, // 5 min timeout
      env: { ...process.env },
    }).toString("utf-8");

    // Echo captured stdout so the operator still sees it
    if (publishStdout) process.stdout.write(publishStdout);
  } catch (err) {
    // publish_next exits 2 when inventory exhausted but some pages published
    // exit 1 means fatal error
    if (err.status === 1) {
      console.error("\n  FATAL: publish_next.js failed with exit code 1");
      process.exit(1);
    }
    // Exit 2 = inventory exhausted, continue with what was published
    // execSync still captures stdout on non-zero exit in err.stdout
    if (err.stdout) {
      publishStdout = err.stdout.toString("utf-8");
      if (publishStdout) process.stdout.write(publishStdout);
    }
    console.log("\n  publish_next.js exited with code 2 (inventory exhausted). Continuing with verification.");
  }

  // Step 2: Find the manifest via direct run_id handoff
  console.log("\n── Step 2: Find publish manifest ──────────────────────\n");

  // Primary: parse run_id from publish_next.js stdout
  let runId = parseRunIdFromStdout(publishStdout);

  if (runId) {
    console.log(`  Parsed run_id from stdout: ${runId}`);
  } else {
    // Fallback: find most recent publish_next.js manifest created in the last 60 seconds
    console.log("  Could not parse run_id from stdout. Falling back to recent manifest lookup...");
    runId = findRecentManifestRunId();
    if (runId) {
      console.log(`  Found recent manifest: ${runId}`);
    }
  }

  if (!runId) {
    console.error("  ERROR: No manifest found from publish_next.js.");
    console.error("  Neither stdout parsing nor recent-manifest fallback found a run_id.");
    process.exit(1);
  }

  const manifest = loadManifest(runId);
  if (!manifest) {
    console.error(`  ERROR: Could not load manifest for run ${runId}`);
    process.exit(1);
  }

  console.log(`  Loaded manifest: ${runId}`);
  console.log(`  Published: ${manifest.published_count}, Failed: ${manifest.failed_count}, Blocked: ${manifest.blocked_count}`);

  // Step 3: Verify live URLs
  console.log("\n── Step 3: Verify live URLs ───────────────────────────\n");

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
  } else if (SKIP_VERIFY) {
    console.log("  Skipping verification (--skip-verify).");
    verificationResults = (manifest.published_pages || []).map(p => ({
      slug: p.slug,
      url: p.url || `https://www.wearewarp.com/lanes/${p.slug}`,
      status: "published_unverified",
      httpStatus: null,
      identityMatch: false,
      error: "verification_skipped",
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
          console.log(`    ↻ Retry #${attempt} for ${page.slug} in ${delay / 1000}s...`);
        },
      });

      verificationResults.push({
        slug: page.slug,
        url: page.url,
        ...result,
      });

      // Transition approval state on verification
      if (result.status === "verified_live") {
        transitionState(page.slug, "LTL", "verified_live", {
          by: "publish_text_batch.js",
          note: `Verified at ${page.url}`,
        });
      }

      const icon = result.status === "verified_live" ? "✓" : (result.status === "published_unverified" ? "?" : "✗");
      console.log(`  ${icon} ${page.slug} — ${result.status} (HTTP ${result.httpStatus || "N/A"})${result.error ? ` [${result.error}]` : ""}`);
    }
  } else {
    console.log("  No pages to verify (0 published).");
  }

  // Step 4: Generate receipt
  console.log("\n── Step 4: Generate receipt ───────────────────────────\n");

  const receipt = buildReceipt(manifest, verificationResults);
  receipt.recipient = NOTIFY;

  const { path: receiptPath } = saveReceipt(receipt);
  console.log(`  Receipt saved: ${receiptPath}`);

  // Step 5: Send confirmation email
  console.log("\n── Step 5: Send confirmation email ────────────────────\n");

  let emailFailed = false;
  let emailSkipped = false;
  let credentialsMissing = false;

  if (DRY_RUN) {
    console.log("  Skipping email (dry run).");
    receipt.email_attempted = false;
    receipt.email_sent = false;
    receipt.email_provider_status = "dry_run_skipped";
    emailSkipped = true;
  } else if (receipt.verified_live_count === 0 && receipt.published_unverified_count === 0) {
    console.log("  Skipping email — no pages published or verified.");
    receipt.email_attempted = false;
    receipt.email_sent = false;
    receipt.email_provider_status = "no_verified_pages";
    emailSkipped = true;
  } else {
    // Send email
    const { EMAIL_USER, EMAIL_APP_PASSWORD } = process.env;
    if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
      console.error("  ⚠ Cannot send email — EMAIL_USER or EMAIL_APP_PASSWORD not set.");
      receipt.email_attempted = true;
      receipt.email_sent = false;
      receipt.email_provider_status = "missing_credentials";
      emailFailed = true;
      credentialsMissing = true;
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
        const subjectStatus = receipt.verified_live_count > 0 ? `${receipt.verified_live_count} verified live` : `${receipt.published_count} published`;
        const subject = `Warp Publish Receipt — ${subjectStatus} — ${receipt.run_id.split("T")[0]}`;

        const info = await transport.sendMail({
          from: EMAIL_USER,
          to: NOTIFY,
          subject,
          html: emailHtml,
        });

        console.log(`  ✓ Email sent: ${info.messageId} → ${NOTIFY}`);
        receipt.email_attempted = true;
        receipt.email_sent = true;
        receipt.email_provider_status = info.messageId || "sent";
      } catch (emailErr) {
        console.error(`  ✗ Email failed: ${emailErr.message}`);
        receipt.email_attempted = true;
        receipt.email_sent = false;
        receipt.email_provider_status = emailErr.message;
        emailFailed = true;
      }
    }
  }

  // Update receipt with final email status and re-save
  saveReceipt(receipt);

  // Step 6: Generate fallback HTML receipt
  const htmlReceiptResult = saveReceiptHtml(receipt);

  if (emailFailed || credentialsMissing) {
    console.log("");
    console.log(`  ⚠ Email not sent. Fallback receipt saved:`);
    console.log(`    ${htmlReceiptResult.path}`);
    console.log("");
  } else if (!emailSkipped) {
    console.log(`  HTML receipt also saved: ${htmlReceiptResult.path}`);
  }

  // Step 7: Print receipt
  printReceipt(receipt);

  // Exit code
  if (DRY_RUN) {
    console.log("\n  Dry run complete. No pages were published.");
    process.exit(0);
  } else if (receipt.verified_live_count > 0) {
    console.log(`\n  ✓ Batch complete: ${receipt.verified_live_count}/${receipt.intended_count} verified live.`);
    process.exit(0);
  } else if (receipt.published_count > 0) {
    console.log(`\n  ⚠ Batch complete: ${receipt.published_count} published but 0 verified live.`);
    process.exit(0);
  } else {
    console.log(`\n  ✗ Batch failed: 0 pages published.`);
    process.exit(2);
  }
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
