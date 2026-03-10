#!/usr/bin/env node

/**
 * Send Daily Publish Summary Email
 *
 * Reads published_pages.json and publish_next_report.json to determine
 * what was published today. Sends an HTML + plain text summary email to
 * troy@wearewarp.com (override with DAILY_SUMMARY_EMAIL_TO env var).
 *
 * Data sources (machine-readable artifacts, not guessed):
 *   data/published_pages.json        — persistent registry of all published pages
 *   artifacts/publish_next_report.json — latest publish run report
 *   artifacts/publish_decision.json   — latest publish decision (has classification)
 *
 * Only pages with dry_run === false AND published_at_iso within today's date
 * are counted as "posted today."
 *
 * If zero pages were confirmed posted, the email still sends with:
 *   "No confirmed pages were posted today."
 *
 * Outputs:
 *   artifacts/daily_publish_summary.json
 *   artifacts/daily_publish_summary.html
 *
 * Usage:
 *   node scripts/send_daily_publish_summary.js              (send real email)
 *   node scripts/send_daily_publish_summary.js --dry-run    (write artifacts only)
 *
 * Exit codes:
 *   0 — success
 *   1 — fatal error
 */

import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";
import {
  createManifest, setIntended, setEmail, addWarning,
  finalizeManifest, saveManifest, printManifestSummary,
} from "../lib/publish-manifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");

// Load .env.local
config({ path: path.join(ROOT, ".env.local") });

const DEFAULT_RECIPIENT = "troy@wearewarp.com";
const RECIPIENT = process.env.DAILY_SUMMARY_EMAIL_TO || DEFAULT_RECIPIENT;

const DRY_RUN = process.argv.includes("--dry-run");

// ── Helpers ──────────────────────────────────────────────────────────

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function todayDateString(timezone = "America/Los_Angeles") {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

function isoToDateBucket(isoTimestamp, timezone = "America/Los_Angeles") {
  try {
    const d = new Date(isoTimestamp);
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(d);
  } catch {
    return isoTimestamp?.split("T")?.[0] || "unknown";
  }
}

// ── Hub priority score for "Top 5 most strategic" ────────────────────

const HUB_CITIES = new Set([
  "los angeles", "chicago", "dallas", "atlanta", "new york",
  "houston", "miami", "seattle", "san francisco", "phoenix",
]);

function hubPriorityScore(entry) {
  let score = 0;
  const origin = (entry.origin_city || "").toLowerCase();
  const dest = (entry.destination_city || "").toLowerCase();
  if (HUB_CITIES.has(origin)) score += 10;
  if (HUB_CITIES.has(dest)) score += 10;
  // Prefer LTL (highest search volume) > FTL > Cargo Van / Box Truck
  if (entry.mode === "LTL") score += 5;
  else if (entry.mode === "FTL") score += 3;
  else if (entry.mode === "Cargo Van / Box Truck") score += 1;
  return score;
}

// ── Link Verification ────────────────────────────────────────────────

/**
 * Lightweight production URL probe (no retries, 5s timeout).
 *
 * Verification logic:
 *   1. HTTP status must be 200
 *   2. At least one POSITIVE_CONTENT_MARKER must appear in the body
 *   3. Soft-404 markers are ONLY checked in non-script visible text
 *      (Webflow embeds a 404 handler JS template on EVERY page, so the
 *       string "This Page Has Moved or Does Not Exist" appears in <script>
 *       blocks even on valid pages — we must ignore those occurrences.)
 */
async function verifyLiveUrl(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "WARP-SEO-Engine/1.0", Accept: "text/html" },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const status = res.status;
    if (status !== 200) return { url, status, verified: false, reason: `HTTP ${status}` };
    const body = await res.text();

    // Positive content check FIRST — if real content exists, the page is live
    let hasPositiveContent = false;
    let positiveMarkerFound = null;
    for (const marker of POSITIVE_CONTENT_MARKERS) {
      if (body.includes(marker)) {
        hasPositiveContent = true;
        positiveMarkerFound = marker;
        break;
      }
    }

    if (hasPositiveContent) {
      return { url, status, verified: true, reason: null, positiveMarker: positiveMarkerFound };
    }

    // No positive content — check soft-404 in visible text (strip <script> blocks)
    const visibleText = body.replace(/<script[\s\S]*?<\/script>/gi, "");
    for (const marker of SOFT_404_MARKERS) {
      if (visibleText.includes(marker)) {
        return { url, status, verified: false, reason: `soft-404: "${marker}"` };
      }
    }

    return { url, status, verified: false, reason: "No positive content marker found" };
  } catch (err) {
    return { url, status: 0, verified: false, reason: err.name === "AbortError" ? "timeout" : err.message };
  }
}

const SOFT_404_MARKERS = [
  "This Page Has Moved or Does Not Exist",
  "Page not found",
];

const POSITIVE_CONTENT_MARKERS = [
  "Book Freight Instantly",
  "Freight Quotes",
  "Get Instant Quote",
  "WARP",
];

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const today = todayDateString();

  // Create manifest for this email run
  const emailManifest = createManifest({
    scriptName: "send_daily_publish_summary.js",
    triggerSource: "manual",
    dryRun: DRY_RUN,
  });

  console.log(`=== Warp SEO Daily Publish Summary ===`);
  if (DRY_RUN) {
    console.log("  ╔═══════════════════════════════╗");
    console.log("  ║         DRY RUN MODE          ║");
    console.log("  ║  No email will be sent        ║");
    console.log("  ║  Artifacts only               ║");
    console.log("  ╚═══════════════════════════════╝");
  }
  console.log(`  Date:      ${today}`);
  console.log(`  Recipient: ${RECIPIENT}`);
  console.log(`  Mode:      ${DRY_RUN ? "DRY RUN — NO EMAIL WILL BE SENT" : "SEND"}`);

  // Guardrail: warn if recipient is not the default
  if (RECIPIENT !== DEFAULT_RECIPIENT) {
    console.warn(`  ⚠  WARNING: Recipient overridden to "${RECIPIENT}" (default: ${DEFAULT_RECIPIENT})`);
    console.warn(`     Set DAILY_SUMMARY_EMAIL_TO=${DEFAULT_RECIPIENT} in .env.local to restore.`);
    addWarning(emailManifest, `Recipient overridden from ${DEFAULT_RECIPIENT} to ${RECIPIENT}`);
  }
  console.log("");

  // 1. Load published pages registry
  const published = loadJSON(path.join(ROOT, "data", "published_pages.json")) || [];

  // Guardrail: detect if published_pages.json was wiped/corrupted
  if (published.length === 0) {
    console.warn("  ⚠  WARNING: published_pages.json is empty (0 entries).");
    console.warn("     This may indicate the file was overwritten by a failed publish script.");
    console.warn("     Run: node scripts/reconcile_published_pages.js --live");
    console.warn("");
  }

  // 2. Filter to today's confirmed (non-dry-run) publishes, with debug trail
  const validRows = [];
  const excludedRows = [];
  for (const p of published) {
    if (p.dry_run === true) {
      excludedRows.push({ slug: p.slug, reason: "dry_run_true" });
    } else if (!p.webflow_item_id || String(p.webflow_item_id).startsWith("dry-run")) {
      excludedRows.push({ slug: p.slug, reason: "missing_or_fake_item_id" });
    } else if (!p.published_at_iso) {
      excludedRows.push({ slug: p.slug, reason: "missing_timestamp" });
    } else if (isoToDateBucket(p.published_at_iso) !== today) {
      excludedRows.push({ slug: p.slug, reason: "timestamp_not_today" });
    } else {
      validRows.push(p);
    }
  }
  const todayPages = validRows;

  // 3. Load latest report for failure/skip counts
  const report = loadJSON(path.join(ARTIFACTS_DIR, "publish_next_report.json"));
  const failCount = report?.failures?.length || 0;
  const skipCount = report?.skipped_duplicates?.length || 0;

  // 4. Derive classification from today's actual pages, not stale publish_decision.json
  //    publish_decision.json can be overwritten by dry-runs and other audit commands.
  //    The daily summary should reflect reality: did real pages go to Webflow today?
  const decision = loadJSON(path.join(ARTIFACTS_DIR, "publish_decision.json"));
  let classification;
  let displayStatus;
  if (todayPages.length > 0) {
    const hasRealWebflowIds = todayPages.some(
      p => p.webflow_item_id && !String(p.webflow_item_id).startsWith("dry-run")
    );
    if (hasRealWebflowIds) {
      classification = "production_unverified";
      displayStatus = "Production publish (from Webflow API)";
    } else {
      classification = "staging_publish";
      displayStatus = "Staging publish";
    }
  } else {
    classification = "no_pages_today";
    displayStatus = "No pages published today";
  }

  // 5. Top 5 most strategic by hub priority score
  const ranked = [...todayPages]
    .map(p => ({ ...p, _hubScore: hubPriorityScore(p) }))
    .sort((a, b) => b._hubScore - a._hubScore);
  const top5 = ranked.slice(0, 5);

  // 6. Build live URLs with correct template path
  const baseUrl = decision?.site_base_url || "https://www.wearewarp.com";
  const templatePath = process.env.WEBFLOW_LANES_TEMPLATE_PATH || "/lanes";

  // 6a. Verify each live URL (HTTP probe + soft-404 + positive content)
  console.log("  Verifying live URLs...");
  const verificationResults = [];
  for (const p of todayPages) {
    const liveUrl = `${baseUrl}${templatePath}/${p.slug}`;
    const result = await verifyLiveUrl(liveUrl);
    verificationResults.push({ slug: p.slug, ...result });
    const icon = result.verified ? "✓" : "✗";
    console.log(`    ${icon} ${p.slug} → HTTP ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
  }

  const verifiedSlugs = new Set(verificationResults.filter(v => v.verified).map(v => v.slug));
  const verifiedCount = verifiedSlugs.size;
  const unverifiedCount = todayPages.length - verifiedCount;
  console.log(`  Verified: ${verifiedCount} / ${todayPages.length}`);
  if (unverifiedCount > 0) {
    console.log(`  ⚠  ${unverifiedCount} URL(s) failed verification`);
  }
  console.log("");

  // 6b. Write link verification artifact
  const linkVerification = {
    date: today,
    template_path: templatePath,
    base_url: baseUrl,
    total_checked: todayPages.length,
    verified_count: verifiedCount,
    unverified_count: unverifiedCount,
    results: verificationResults,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "daily_publish_link_verification.json"),
    JSON.stringify(linkVerification, null, 2)
  );
  console.log(`    daily_publish_link_verification.json`);

  // Update classification if all links verified
  if (todayPages.length > 0 && verifiedCount === todayPages.length) {
    classification = "production_verified";
    displayStatus = "Production publish (verified live)";
  }

  // 6c. Build summary data
  const summaryData = {
    date: today,
    recipient: RECIPIENT,
    total_confirmed_today: todayPages.length,
    verified_count: verifiedCount,
    unverified_count: unverifiedCount,
    classification,
    display_status: displayStatus,
    pages: todayPages.map(p => ({
      title: p.seo_title || p.slug,
      slug: p.slug,
      live_url: `${baseUrl}${templatePath}/${p.slug}`,
      item_id: p.webflow_item_id || null,
      mode: p.mode,
      origin: `${p.origin_city}, ${p.origin_state}`,
      destination: `${p.destination_city}, ${p.destination_state}`,
      verified: verifiedSlugs.has(p.slug),
    })),
    top_5_strategic: top5.map(p => ({
      title: p.seo_title || p.slug,
      slug: p.slug,
      live_url: `${baseUrl}${templatePath}/${p.slug}`,
      hub_score: p._hubScore,
    })),
    failures: failCount,
    skipped_duplicates: skipCount,
    generated_at: new Date().toISOString(),
  };

  // 6d. Write debug artifact + check for mismatch with publish_next_report
  const reportSuccessCount = report?.published_success?.length || 0;
  const hasMismatch = reportSuccessCount > 0 && todayPages.length === 0;
  const debugArtifact = {
    today_local_date: today,
    published_pages_rows_scanned: published.length,
    valid_real_publish_rows_today: validRows.map(p => ({
      slug: p.slug, webflow_item_id: p.webflow_item_id, published_at_iso: p.published_at_iso,
    })),
    excluded_rows: excludedRows,
    summary_total: todayPages.length,
    report_success_count: reportSuccessCount,
    report_mismatch: {
      exists: hasMismatch,
      details: hasMismatch
        ? `publish_next_report shows ${reportSuccessCount} successes but 0 real rows found in published_pages.json for today`
        : null,
    },
  };
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "published_today_debug.json"),
    JSON.stringify(debugArtifact, null, 2)
  );
  console.log(`    published_today_debug.json`);
  if (hasMismatch) {
    console.warn(`  ⚠  MISMATCH: ${debugArtifact.report_mismatch.details}`);
  }

  // 7. Build HTML email
  const html = buildEmailHtml(summaryData);
  const plainText = buildEmailPlainText(summaryData);
  const subject = `Warp SEO Daily Publish Summary — ${today}`;

  // 8. Write artifacts
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "daily_publish_summary.json"),
    JSON.stringify(summaryData, null, 2)
  );
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "daily_publish_summary.html"),
    html
  );
  console.log(`  ✓ Artifacts written`);
  console.log(`    daily_publish_summary.json`);
  console.log(`    daily_publish_summary.html`);

  // 9. Prepare send log (written before and after send attempt)
  const sendLogPath = path.join(ARTIFACTS_DIR, "daily_publish_summary_send_log.json");
  const sendLog = {
    to: RECIPIENT,
    subject,
    attempted: !DRY_RUN,
    sent: false,
    errorSummary: null,
  };

  function writeSendLog() {
    fs.writeFileSync(sendLogPath, JSON.stringify(sendLog, null, 2));
  }

  // 10. Send email (or dry-run)
  if (DRY_RUN) {
    sendLog.attempted = false;
    sendLog.sent = false;
    writeSendLog();
    console.log(`    daily_publish_summary_send_log.json`);
    console.log(`\n  ╔═══════════════════════════════════════╗`);
    console.log(`  ║  DRY RUN — email not sent              ║`);
    console.log(`  ║  Subject: ${subject.slice(0, 28).padEnd(28)}║`);
    console.log(`  ║  Pages today: ${String(todayPages.length).padEnd(24)}║`);
    console.log(`  ╚═══════════════════════════════════════╝`);

    // Save manifest
    setEmail(emailManifest, {
      attempted: false,
      sent: false,
      recipient: RECIPIENT,
      skipReason: "dry-run mode",
    });
    finalizeManifest(emailManifest);
    saveManifest(emailManifest);
    return;
  }

  // Real send
  const { EMAIL_USER, EMAIL_APP_PASSWORD } = process.env;
  if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
    sendLog.attempted = true;
    sendLog.sent = false;
    sendLog.errorSummary = "Missing EMAIL_USER or EMAIL_APP_PASSWORD in .env.local";
    writeSendLog();
    console.log(`    daily_publish_summary_send_log.json`);
    console.error("  ERROR: Missing EMAIL_USER or EMAIL_APP_PASSWORD in .env.local");
    console.error("  Artifacts have been written. Email not sent.");

    setEmail(emailManifest, {
      attempted: true,
      sent: false,
      recipient: RECIPIENT,
      error: "Missing EMAIL_USER or EMAIL_APP_PASSWORD",
    });
    finalizeManifest(emailManifest);
    saveManifest(emailManifest);
    process.exit(1);
  }

  try {
    const { createTransportFromEnv, verifyTransport } = await import("../lib/email-sender.js");
    const transport = await createTransportFromEnv();
    const verification = await verifyTransport(transport);
    if (!verification.ok) {
      throw new Error(`SMTP verification failed: ${verification.error}`);
    }

    const info = await transport.sendMail({
      from: EMAIL_USER,
      to: RECIPIENT,
      subject,
      html,
      text: plainText,
    });

    sendLog.attempted = true;
    sendLog.sent = true;
    writeSendLog();
    console.log(`    daily_publish_summary_send_log.json`);
    console.log(`\n  ✓ Email sent to ${RECIPIENT}`);
    console.log(`    Message ID: ${info.messageId}`);
    console.log(`    Subject: ${subject}`);
    console.log(`    Pages today: ${todayPages.length}`);

    setEmail(emailManifest, {
      attempted: true,
      sent: true,
      recipient: RECIPIENT,
      providerResponse: info.messageId,
    });
    finalizeManifest(emailManifest);
    saveManifest(emailManifest);
  } catch (err) {
    sendLog.attempted = true;
    sendLog.sent = false;
    sendLog.errorSummary = err.message;
    writeSendLog();
    console.log(`    daily_publish_summary_send_log.json`);
    console.error(`\n  ✗ Email send failed: ${err.message}`);
    console.error(`  Artifacts have been written. Retry with: npm run email:daily-summary`);

    setEmail(emailManifest, {
      attempted: true,
      sent: false,
      recipient: RECIPIENT,
      error: err.message,
    });
    finalizeManifest(emailManifest);
    saveManifest(emailManifest);
    process.exit(1);
  }
}

// ── HTML Builder ─────────────────────────────────────────────────────

function buildEmailHtml(data) {
  const verified = data.pages.filter(p => p.verified);
  const unverified = data.pages.filter(p => !p.verified);

  // Verified pages get clickable links. Unverified pages get plain text — no exceptions.
  function makeVerifiedPageRows(pages) {
    return pages.map(p => `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;">
            <a href="${escHtml(p.live_url)}" style="color:#1a73e8;text-decoration:none;">${escHtml(p.slug)}</a>
          </td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escHtml(p.title)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escHtml(p.mode)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:11px;color:#888;">${escHtml(p.item_id || "—")}</td>
        </tr>`).join("");
  }

  function makeUnverifiedPageRows(pages) {
    return pages.map(p => `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escHtml(p.slug)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escHtml(p.title)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escHtml(p.mode)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:11px;color:#888;">${escHtml(p.item_id || "—")}</td>
        </tr>`).join("");
  }

  const noPages = data.pages.length === 0;

  const verifiedSection = noPages
    ? `<h3 style="color:#2e7d32;">Verified Live Links</h3>
       <p style="color:#888;">No confirmed pages were posted today.</p>`
    : verified.length > 0
      ? `<h3 style="color:#2e7d32;">Verified Live Links (${verified.length})</h3>
         <table style="width:100%;border-collapse:collapse;font-size:13px;">
           <thead>
             <tr style="background:#e8f5e9;">
               <th style="padding:8px 12px;text-align:left;">Slug</th>
               <th style="padding:8px 12px;text-align:left;">Title</th>
               <th style="padding:8px 12px;text-align:left;">Mode</th>
               <th style="padding:8px 12px;text-align:left;">Item ID</th>
             </tr>
           </thead>
           <tbody>${makeVerifiedPageRows(verified)}</tbody>
         </table>`
      : `<h3 style="color:#2e7d32;">Verified Live Links</h3>
         <p style="color:#888;">None of the published pages could be verified live.</p>`;

  const unverifiedSection = unverified.length > 0
    ? `<h3 style="margin-top:24px;color:#c62828;">Unverified / Broken Links (${unverified.length})</h3>
       <table style="width:100%;border-collapse:collapse;font-size:13px;">
         <thead>
           <tr style="background:#ffebee;">
             <th style="padding:8px 12px;text-align:left;">Slug</th>
             <th style="padding:8px 12px;text-align:left;">Title</th>
             <th style="padding:8px 12px;text-align:left;">Mode</th>
             <th style="padding:8px 12px;text-align:left;">Item ID</th>
           </tr>
         </thead>
         <tbody>${makeUnverifiedPageRows(unverified)}</tbody>
       </table>
       <p style="font-size:12px;color:#c62828;margin-top:8px;">
         These pages were published to Webflow but could not be verified at the expected production URL.
         Check that the Webflow site has been published to production (not just staging).
       </p>`
    : "";

  const top5Section = data.top_5_strategic.length > 0
    ? `<h3 style="margin-top:24px;color:#333;">Top 5 Most Strategic Pages Posted Today</h3>
       <ol style="padding-left:20px;">
         ${data.top_5_strategic.map(p => {
           // Only link verified pages. Unverified pages show slug as plain text.
           const slugHtml = p.verified
             ? `<a href="${escHtml(p.live_url)}" style="color:#1a73e8;">${escHtml(p.slug)}</a>`
             : `<span style="color:#333;">${escHtml(p.slug)}</span>`;
           return `
           <li style="margin-bottom:8px;">
             ${slugHtml}
             <span style="color:#888;font-size:12px;"> (hub score: ${p.hub_score})</span>
           </li>`;
         }).join("")}
       </ol>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#333;">
  <h1 style="font-size:22px;color:#1a1a1a;border-bottom:2px solid #1a73e8;padding-bottom:8px;">
    Warp SEO Daily Publish Summary
  </h1>
  <p style="color:#666;margin:4px 0 16px;">
    <strong>Date:</strong> ${escHtml(data.date)} &nbsp;|&nbsp;
    <strong>Status:</strong> ${escHtml(data.display_status)} &nbsp;|&nbsp;
    <strong>Classification:</strong> ${escHtml(data.classification)}
  </p>

  <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin-bottom:20px;">
    <span style="font-size:32px;font-weight:bold;color:#1a73e8;">${data.total_confirmed_today}</span>
    <span style="font-size:16px;color:#555;"> confirmed page${data.total_confirmed_today !== 1 ? "s" : ""} posted today</span>
    <span style="font-size:14px;color:#2e7d32;margin-left:12px;">${data.verified_count || 0} verified</span>
    ${(data.unverified_count || 0) > 0 ? `<span style="font-size:14px;color:#c62828;margin-left:8px;">${data.unverified_count} unverified</span>` : ""}
  </div>

  ${verifiedSection}
  ${unverifiedSection}

  ${top5Section}

  <h3 style="margin-top:24px;color:#333;">Failures / Skips</h3>
  <ul style="padding-left:20px;color:#555;">
    <li>Failures: <strong>${data.failures}</strong></li>
    <li>Skipped duplicates: <strong>${data.skipped_duplicates}</strong></li>
  </ul>

  <hr style="margin-top:32px;border:none;border-top:1px solid #ddd;">
  <p style="font-size:11px;color:#aaa;margin-top:8px;">
    Generated automatically from publish artifacts on ${escHtml(data.generated_at)}.
    Classification: ${escHtml(data.classification)} | Trust: ${escHtml(data.display_status)}
  </p>
</body>
</html>`;
}

function buildEmailPlainText(data) {
  const lines = [
    `Warp SEO Daily Publish Summary`,
    `Date: ${data.date}`,
    `Status: ${data.display_status} | Classification: ${data.classification}`,
    ``,
    `${data.total_confirmed_today} confirmed page(s) posted today. (${data.verified_count || 0} verified, ${data.unverified_count || 0} unverified)`,
    ``,
  ];

  if (data.pages.length === 0) {
    lines.push(`No confirmed pages were posted today.`);
  } else {
    const verified = data.pages.filter(p => p.verified);
    const unverified = data.pages.filter(p => !p.verified);

    if (verified.length > 0) {
      lines.push(`Verified Live Links (${verified.length}):`);
      for (const p of verified) {
        lines.push(`  - ${p.slug}: ${p.live_url}`);
        lines.push(`    Title: ${p.title} | Mode: ${p.mode}`);
      }
    }

    if (unverified.length > 0) {
      lines.push(``);
      lines.push(`Unverified / Broken Links (${unverified.length}):`);
      for (const p of unverified) {
        lines.push(`  - ${p.slug}: ${p.live_url}`);
        lines.push(`    Title: ${p.title} | Mode: ${p.mode}`);
      }
      lines.push(`  Note: These pages were published to Webflow but could not be verified at the expected production URL.`);
    }
  }

  if (data.top_5_strategic.length > 0) {
    lines.push(``);
    lines.push(`Top 5 Most Strategic Pages:`);
    data.top_5_strategic.forEach((p, i) => {
      lines.push(`  ${i + 1}. ${p.slug} (hub score: ${p.hub_score})`);
      lines.push(`     ${p.live_url}`);
    });
  }

  lines.push(``);
  lines.push(`Failures: ${data.failures}`);
  lines.push(`Skipped duplicates: ${data.skipped_duplicates}`);
  lines.push(``);
  lines.push(`Generated from publish artifacts on ${data.generated_at}.`);

  return lines.join("\n");
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
