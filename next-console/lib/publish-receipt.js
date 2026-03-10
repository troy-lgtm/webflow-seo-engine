/**
 * Post-Publish Receipt Generator
 *
 * Every live publish run creates a receipt — a self-contained proof document
 * that records exactly what happened, what was verified live, and whether
 * the confirmation email was attempted.
 *
 * Receipt location: artifacts/publish-receipts/{run_id}.json
 *
 * A receipt is generated AFTER live verification completes.
 * It is the final artifact of every publish run.
 *
 * Status classes:
 *   - verified_live:       URL returns HTTP 200 + identity plausible
 *   - published_unverified: Webflow says published but live check skipped/failed
 *   - failed:              Publish API call failed
 *   - blocked:             Duplicate, validation, or gate blocked
 *   - dry_run:             Dry-run mode — nothing published
 *
 * Never uses process.cwd(). All paths resolved via project-root.
 */

import fs from "fs";
import path from "path";
import { resolveFromRoot } from "./fs/project-root.js";

// ── Constants ──────────────────────────────────────────────────────────

const RECEIPTS_DIR = "artifacts/publish-receipts";

// ── HTML Parsing Helpers ──────────────────────────────────────────────

/**
 * Extract the href from the first <link rel="canonical" href="..."> tag.
 * Returns null if not found.
 */
function extractCanonicalHref(html) {
  const match = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]+href\s*=\s*["']([^"']+)["'][^>]*>/i)
    || html.match(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["']canonical["'][^>]*>/i);
  return match ? match[1] : null;
}

/**
 * Extract the text content of the first <title> tag.
 * Returns null if not found.
 */
function extractTitleText(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : null;
}

/**
 * Extract slug words suitable for identity matching.
 * E.g. "chicago-to-dallas" => ["chicago", "dallas"]
 * Filters out short words (<=2 chars) and common connectors.
 */
function extractSlugWords(slug) {
  return slug
    .replace(/-/g, " ")
    .split(" ")
    .filter(w => w.length > 2)
    .map(w => w.toLowerCase());
}

// ── Live Verification ──────────────────────────────────────────────────

/**
 * Verify a single URL is live using multi-signal structured checks.
 *
 * Checks:
 *   1. HTTP GET returns 200
 *   2. Canonical tag href ends with expected slug path
 *   3. Title tag contains key slug words
 *   4. Body text contains slug words (fallback)
 *
 * @param {string} url - Full URL to check
 * @param {string} slug - Expected slug for identity verification
 * @param {{ timeoutMs?: number }} opts
 * @returns {Promise<{
 *   status: "verified_live" | "published_unverified",
 *   httpStatus: number|null,
 *   checks: {
 *     http_ok: boolean,
 *     canonical_match: boolean|null,
 *     title_match: boolean|null,
 *     body_match: boolean,
 *   },
 *   verification_confidence: "high" | "medium" | "low" | "none",
 *   error: string|null,
 *   identityMatch: boolean,
 * }>}
 */
export async function verifyLiveUrl(url, slug, { timeoutMs = 8000 } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "WarpSEO-PublishVerifier/1.0",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    clearTimeout(timer);

    const httpStatus = res.status;
    const http_ok = httpStatus === 200;

    if (!http_ok) {
      return {
        status: "published_unverified",
        httpStatus,
        checks: {
          http_ok: false,
          canonical_match: null,
          title_match: null,
          body_match: false,
        },
        verification_confidence: "none",
        error: `HTTP ${httpStatus}`,
        identityMatch: false,
      };
    }

    // Read first 50KB to check identity
    const body = await res.text();
    const sample = body.slice(0, 50000);
    const sampleLower = sample.toLowerCase();

    const slugWords = extractSlugWords(slug);

    // ── Check 1: Canonical tag ──
    const canonicalHref = extractCanonicalHref(sample);
    let canonical_match = null;
    if (canonicalHref !== null) {
      // Check if canonical href ends with a path containing the slug
      // e.g. /lanes/chicago-to-dallas or /lanes/chicago-to-dallas/
      const canonicalLower = canonicalHref.toLowerCase();
      canonical_match = canonicalLower.endsWith(`/${slug}`) || canonicalLower.endsWith(`/${slug}/`);
    }

    // ── Check 2: Title tag ──
    const titleText = extractTitleText(sample);
    let title_match = null;
    if (titleText !== null) {
      const titleLower = titleText.toLowerCase();
      title_match = slugWords.length > 0 && slugWords.every(w => titleLower.includes(w));
    }

    // ── Check 3: Body text (fallback) ──
    const body_match = slugWords.length > 0 && slugWords.every(w => sampleLower.includes(w));

    // ── Determine confidence ──
    let verification_confidence;
    if (http_ok && (canonical_match === true || title_match === true)) {
      verification_confidence = "high";
    } else if (http_ok && body_match) {
      verification_confidence = "medium";
    } else if (http_ok) {
      verification_confidence = "low";
    } else {
      verification_confidence = "none";
    }

    const isVerified = verification_confidence === "high" || verification_confidence === "medium";
    const status = isVerified ? "verified_live" : "published_unverified";
    const identityMatch = isVerified;

    let error = null;
    if (!isVerified) {
      error = "Page returned 200 but identity checks did not reach sufficient confidence";
    }

    return {
      status,
      httpStatus: 200,
      checks: {
        http_ok,
        canonical_match,
        title_match,
        body_match,
      },
      verification_confidence,
      error,
      identityMatch,
    };
  } catch (err) {
    const errorMsg = err.name === "AbortError"
      ? `Timeout after ${timeoutMs}ms`
      : err.message;
    return {
      status: "published_unverified",
      httpStatus: null,
      checks: {
        http_ok: false,
        canonical_match: null,
        title_match: null,
        body_match: false,
      },
      verification_confidence: "none",
      error: errorMsg,
      identityMatch: false,
    };
  }
}

// ── Live Verification with Retry ──────────────────────────────────────

/**
 * Verify a single URL is live with exponential backoff retries.
 *
 * Waits the first backoff delay, then verifies. If not verified_live,
 * waits the next backoff delay and retries. Continues until the
 * backoffSchedule is exhausted.
 *
 * @param {string} url - Full URL to check
 * @param {string} slug - Expected slug for identity verification
 * @param {{ timeoutMs?: number, backoffSchedule?: number[] }} opts
 * @returns {Promise<{
 *   status: string,
 *   httpStatus: number|null,
 *   checks: object,
 *   verification_confidence: string,
 *   error: string|null,
 *   identityMatch: boolean,
 *   attempts: Array<{ attempt: number, timestamp: string, httpStatus: number|null, status: string, confidence: string }>,
 * }>}
 */
export async function verifyLiveUrlWithRetry(url, slug, {
  timeoutMs = 8000,
  backoffSchedule = [10000, 20000, 40000, 80000],
} = {}) {
  const attempts = [];

  for (let i = 0; i < backoffSchedule.length; i++) {
    // Wait the backoff delay before each attempt
    await new Promise(r => setTimeout(r, backoffSchedule[i]));

    const result = await verifyLiveUrl(url, slug, { timeoutMs });

    attempts.push({
      attempt: i + 1,
      timestamp: new Date().toISOString(),
      httpStatus: result.httpStatus,
      status: result.status,
      confidence: result.verification_confidence,
    });

    if (result.status === "verified_live") {
      return { ...result, attempts };
    }
  }

  // All retries exhausted — return the last result as published_unverified
  const lastResult = await verifyLiveUrl(url, slug, { timeoutMs });
  // The last call already has published_unverified if it failed, but make sure
  const finalResult = {
    ...lastResult,
    status: lastResult.status === "verified_live" ? "verified_live" : "published_unverified",
    attempts: [
      ...attempts,
      {
        attempt: backoffSchedule.length + 1,
        timestamp: new Date().toISOString(),
        httpStatus: lastResult.httpStatus,
        status: lastResult.status,
        confidence: lastResult.verification_confidence,
      },
    ],
  };

  return finalResult;
}

// ── Batch Verification ────────────────────────────────────────────────

/**
 * Verify multiple URLs with rate limiting.
 *
 * @param {Array<{ slug: string, url: string }>} pages - Pages to verify
 * @param {{ delayMs?: number, timeoutMs?: number, retry?: boolean, backoffSchedule?: number[] }} opts
 * @returns {Promise<Array<{ slug: string, url: string, status: string, httpStatus: number|null, identityMatch: boolean, error: string|null }>>}
 */
export async function verifyLiveUrls(pages, { delayMs = 500, timeoutMs = 8000, retry = false, backoffSchedule } = {}) {
  const results = [];

  for (const page of pages) {
    let result;
    if (retry) {
      const retryOpts = { timeoutMs };
      if (backoffSchedule) retryOpts.backoffSchedule = backoffSchedule;
      result = await verifyLiveUrlWithRetry(page.url, page.slug, retryOpts);
    } else {
      result = await verifyLiveUrl(page.url, page.slug, { timeoutMs });
    }
    results.push({
      slug: page.slug,
      url: page.url,
      ...result,
    });

    // Rate limit
    if (pages.indexOf(page) < pages.length - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return results;
}

// ── Receipt Builder ────────────────────────────────────────────────────

/**
 * Build a post-publish receipt from a finalized manifest and verification results.
 *
 * @param {object} manifest - Finalized publish manifest
 * @param {Array<{ slug: string, url: string, status: string, httpStatus: number|null, identityMatch: boolean, error: string|null, attempts?: Array }>} verificationResults
 * @param {{ receiptOverrides?: object }} opts - Optional overrides for receipt fields
 * @returns {object} The receipt object
 */
export function buildReceipt(manifest, verificationResults = [], { receiptOverrides = {} } = {}) {
  const verifiedLive = verificationResults.filter(v => v.status === "verified_live");
  const publishedUnverified = verificationResults.filter(v => v.status === "published_unverified");

  // Build slug → webflow_item_id lookup from manifest's published_pages
  const slugToItemId = {};
  for (const p of (manifest.published_pages || [])) {
    if (p.slug && p.webflow_item_id) {
      slugToItemId[p.slug] = p.webflow_item_id;
    }
  }

  // Determine final status
  let finalStatus;
  if (manifest.dry_run) {
    finalStatus = "dry_run";
  } else if (manifest.published_count === 0 && manifest.failed_count === 0) {
    finalStatus = "no_pages_attempted";
  } else if (manifest.failed_count > 0 && verifiedLive.length === 0) {
    finalStatus = "all_failed";
  } else if (verifiedLive.length === manifest.published_count && manifest.published_count > 0) {
    finalStatus = "all_verified_live";
  } else if (verifiedLive.length > 0) {
    finalStatus = "partial_verified";
  } else if (manifest.published_count > 0) {
    finalStatus = "published_unverified";
  } else {
    finalStatus = "unknown";
  }

  // Collect verification attempts data if present
  const hasAttempts = verificationResults.some(v => v.attempts && v.attempts.length > 0);

  const receipt = {
    // Identity
    run_id: manifest.run_id,
    script_name: manifest.script_name,
    receipt_generated_at: new Date().toISOString(),

    // Timing
    started_at: manifest.started_at,
    completed_at: manifest.completed_at,

    // Status
    final_status: finalStatus,

    // Counts
    intended_count: manifest.intended_count,
    attempted_count: manifest.attempted_count,
    published_count: manifest.published_count,
    verified_live_count: verifiedLive.length,
    published_unverified_count: publishedUnverified.length,
    failed_count: manifest.failed_count,
    blocked_count: manifest.blocked_count,

    // Email
    recipient: manifest.email_recipient,
    email_attempted: manifest.email_attempted,
    email_sent: manifest.email_sent,
    email_provider_status: manifest.email_provider_response || manifest.email_error || (manifest.email_sent ? "sent" : (manifest.email_skip_reason || "not_attempted")),

    // References
    manifest_path: `manifests/publish_${manifest.run_id}.json`,

    // Verified live pages
    verified_live_urls: verifiedLive.map(v => ({
      slug: v.slug,
      url: v.url,
      httpStatus: v.httpStatus,
      webflowItemId: slugToItemId[v.slug] || null,
    })),

    // Published but unverified pages
    published_unverified_urls: publishedUnverified.map(v => ({
      slug: v.slug,
      url: v.url,
      httpStatus: v.httpStatus,
      error: v.error,
      webflowItemId: slugToItemId[v.slug] || null,
    })),

    // Failed pages
    failed_slugs: (manifest.failed_pages || []).map(f => ({
      slug: f.slug,
      reason: f.reason,
    })),

    // Blocked pages
    blocked_slugs: (manifest.blocked_pages || []).map(b => ({
      slug: b.slug,
      reason: b.reason,
      rule_id: b.rule_id,
    })),

    // Overrides
    ...receiptOverrides,
  };

  // Add verification attempts data if any results contained retry attempts
  if (hasAttempts) {
    receipt.verification_attempts = verificationResults
      .filter(v => v.attempts && v.attempts.length > 0)
      .map(v => ({
        slug: v.slug,
        url: v.url,
        attempts: v.attempts,
      }));
  }

  return receipt;
}

// ── Receipt Persistence ────────────────────────────────────────────────

/**
 * Save receipt to disk.
 *
 * @param {object} receipt
 * @returns {{ path: string }}
 */
export function saveReceipt(receipt) {
  const dir = resolveFromRoot(RECEIPTS_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const fileName = `receipt_${receipt.run_id}.json`;
  const absPath = path.join(dir, fileName);

  fs.writeFileSync(absPath, JSON.stringify(receipt, null, 2) + "\n");

  return { path: absPath };
}

/**
 * Save receipt as rendered HTML file.
 *
 * @param {object} receipt
 * @returns {{ path: string }}
 */
export function saveReceiptHtml(receipt) {
  const dir = resolveFromRoot(RECEIPTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const html = buildConfirmationEmailHtml(receipt);
  const fileName = `receipt_${receipt.run_id}.html`;
  const absPath = path.join(dir, fileName);
  fs.writeFileSync(absPath, html);
  return { path: absPath };
}

/**
 * Load a receipt by run_id.
 *
 * @param {string} runId
 * @returns {object|null}
 */
export function loadReceipt(runId) {
  const absPath = resolveFromRoot(RECEIPTS_DIR, `receipt_${runId}.json`);
  if (!fs.existsSync(absPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(absPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * List receipts, sorted by date descending.
 *
 * @param {{ limit?: number }} opts
 * @returns {object[]}
 */
export function listReceipts({ limit = 20 } = {}) {
  const dir = resolveFromRoot(RECEIPTS_DIR);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith("receipt_") && f.endsWith(".json"))
    .sort()
    .reverse();

  const results = [];
  for (const file of files.slice(0, limit)) {
    try {
      results.push(JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")));
    } catch {
      // Skip corrupted
    }
  }

  return results;
}

// ── Cleanup / Retention ────────────────────────────────────────────────

/**
 * Clean up old receipt artifacts based on a retention policy.
 *
 * Deletes receipt files (both .json and .html) older than `retentionDays`,
 * but always keeps at least `keepMinRuns` most recent receipts.
 *
 * @param {{ retentionDays?: number, keepMinRuns?: number }} opts
 * @returns {{ deleted: number, kept: number }}
 */
export function cleanupArtifacts({ retentionDays = 30, keepMinRuns = 5 } = {}) {
  const dir = resolveFromRoot(RECEIPTS_DIR);
  if (!fs.existsSync(dir)) return { deleted: 0, kept: 0 };

  // Gather all receipt files (json and html), grouped by run_id
  const allFiles = fs.readdirSync(dir).filter(f => f.startsWith("receipt_"));

  // Extract unique run_ids from json files, sorted descending (most recent first)
  const jsonFiles = allFiles
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse();

  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let kept = 0;

  for (let i = 0; i < jsonFiles.length; i++) {
    const filePath = path.join(dir, jsonFiles[i]);
    const stat = fs.statSync(filePath);
    const isExpired = stat.mtimeMs < cutoffMs;

    // Always keep at least keepMinRuns most recent receipts
    if (i < keepMinRuns || !isExpired) {
      kept++;
      continue;
    }

    // Delete the JSON receipt
    try {
      fs.unlinkSync(filePath);
      deleted++;
    } catch {
      // Skip if unable to delete
      kept++;
      continue;
    }

    // Also delete the matching HTML receipt if it exists
    const htmlFile = jsonFiles[i].replace(/\.json$/, ".html");
    const htmlPath = path.join(dir, htmlFile);
    if (fs.existsSync(htmlPath)) {
      try {
        fs.unlinkSync(htmlPath);
        // HTML deletion doesn't count separately — it's part of the same receipt
      } catch {
        // Best effort
      }
    }
  }

  return { deleted, kept };
}

// ── Print Receipt ──────────────────────────────────────────────────────

/**
 * Print receipt to console in a readable format.
 *
 * @param {object} receipt
 */
export function printReceipt(receipt) {
  const statusEmoji = {
    all_verified_live: "✓",
    partial_verified: "⚠",
    published_unverified: "?",
    all_failed: "✗",
    dry_run: "⊘",
    no_pages_attempted: "—",
  };

  const emoji = statusEmoji[receipt.final_status] || "?";

  console.log("");
  console.log(`╔══════════════════════════════════════════════════╗`);
  console.log(`║  POST-PUBLISH RECEIPT                            ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Run ID:      ${(receipt.run_id || "").slice(0, 34).padEnd(34)}║`);
  console.log(`║  Script:      ${(receipt.script_name || "").padEnd(34)}║`);
  console.log(`║  Status:      ${emoji} ${(receipt.final_status || "").padEnd(32)}║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Intended:    ${String(receipt.intended_count).padEnd(34)}║`);
  console.log(`║  Attempted:   ${String(receipt.attempted_count).padEnd(34)}║`);
  console.log(`║  Published:   ${String(receipt.published_count).padEnd(34)}║`);
  console.log(`║  Verified:    ${String(receipt.verified_live_count).padEnd(34)}║`);
  console.log(`║  Unverified:  ${String(receipt.published_unverified_count).padEnd(34)}║`);
  console.log(`║  Failed:      ${String(receipt.failed_count).padEnd(34)}║`);
  console.log(`║  Blocked:     ${String(receipt.blocked_count).padEnd(34)}║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Recipient:   ${(receipt.recipient || "none").padEnd(34)}║`);
  console.log(`║  Email sent:  ${(receipt.email_sent ? "YES" : "NO").padEnd(34)}║`);
  console.log(`║  Email status:${(String(receipt.email_provider_status || "")).slice(0, 34).padEnd(34)}║`);
  console.log(`╠══════════════════════════════════════════════════╣`);

  // Verified live URLs
  if (receipt.verified_live_urls && receipt.verified_live_urls.length > 0) {
    console.log(`║  Verified Live URLs:                             ║`);
    for (const v of receipt.verified_live_urls) {
      console.log(`║    ✓ ${v.url.slice(0, 43).padEnd(43)}║`);
    }
  }

  // Published unverified
  if (receipt.published_unverified_urls && receipt.published_unverified_urls.length > 0) {
    console.log(`║  Published Unverified:                           ║`);
    for (const v of receipt.published_unverified_urls) {
      console.log(`║    ? ${v.url.slice(0, 43).padEnd(43)}║`);
    }
  }

  // Failed
  if (receipt.failed_slugs && receipt.failed_slugs.length > 0) {
    console.log(`║  Failed:                                         ║`);
    for (const f of receipt.failed_slugs) {
      console.log(`║    ✗ ${f.slug}: ${(f.reason || "").slice(0, 30).padEnd(30)}║`);
    }
  }

  // Blocked
  if (receipt.blocked_slugs && receipt.blocked_slugs.length > 0) {
    console.log(`║  Blocked:                                        ║`);
    for (const b of receipt.blocked_slugs) {
      console.log(`║    ⊘ ${b.slug}: ${(b.reason || "").slice(0, 30).padEnd(30)}║`);
    }
  }

  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Manifest: ${(receipt.manifest_path || "").slice(0, 37).padEnd(37)}║`);
  const receiptPath = `artifacts/publish-receipts/receipt_${(receipt.run_id || "").slice(0, 10)}...`;
  console.log(`║  Receipt:  ${receiptPath.padEnd(37)}║`);
  console.log(`╚══════════════════════════════════════════════════╝`);
}

// ── Confirmation Email Builder ─────────────────────────────────────────

/**
 * Link rule: only pages with final_verification_status === "verified_live"
 * may be rendered as clickable <a href="..."> links. The href must be the
 * exact verified absolute URL (https://...). Everything else is plain text.
 *
 * Manifest / receipt / artifact paths are always rendered as plain text
 * because they are local file paths, not reachable URLs.
 *
 * No action buttons (Publish, Open, View, etc.) are ever included.
 * This is a proof/receipt email, not an action email.
 */

/**
 * Build confirmation email HTML from a receipt.
 *
 * @param {object} receipt
 * @returns {string} HTML email body
 */
export function buildConfirmationEmailHtml(receipt) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // Warp brand tokens
  const bg = "#0B0C0E";
  const surface = "#121418";
  const border = "rgba(255,255,255,0.08)";
  const text = "#E8E8E8";
  const muted = "#A7A7A7";
  const accent = "#00FF33";
  const red = "#FF4444";
  const yellow = "#FFB800";
  const fontStack = "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

  const statusColors = {
    all_verified_live: accent,
    partial_verified: yellow,
    published_unverified: yellow,
    all_failed: red,
    dry_run: muted,
    no_pages_attempted: muted,
  };
  const statusColor = statusColors[receipt.final_status] || muted;
  const statusLabel = (receipt.final_status || "unknown").replace(/_/g, " ").toUpperCase();

  // ── Section 1: Verified Live Pages ──
  // ONLY verified_live pages get clickable <a> links.
  // Each link must be an absolute URL starting with https://.
  let verifiedSection = "";
  if (receipt.verified_live_urls && receipt.verified_live_urls.length > 0) {
    const urlRows = receipt.verified_live_urls
      .filter(v => v.url && v.url.startsWith("https://"))
      .map(v => {
        const displaySlug = v.slug || v.url.split("/").pop() || "";
        return `<tr>
          <td style="padding:8px 0;border-bottom:1px solid ${border};">
            <span style="font-size:13px;font-weight:600;color:${text};">${esc(displaySlug)}</span><br>
            <a href="${esc(v.url)}" style="color:${accent};text-decoration:none;font-size:12px;font-family:monospace;">${esc(v.url)}</a>
          </td>
        </tr>`;
      }).join("");
    if (urlRows) {
      verifiedSection = `
        <tr><td style="height:12px;"></td></tr>
        <tr><td style="padding:16px 24px;background:${surface};border:1px solid ${border};border-radius:8px;">
          <p style="margin:0;font-size:12px;color:${accent};text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Verified Live Pages</p>
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">${urlRows}</table>
        </td></tr>`;
    }
  }

  // ── Section 2: Published But Not Yet Verified ──
  // NO clickable links. Plain text only with the reason.
  let unverifiedSection = "";
  if (receipt.published_unverified_urls && receipt.published_unverified_urls.length > 0) {
    const rows = receipt.published_unverified_urls.map(v => {
      const reason = v.error || "verification pending";
      return `<tr>
        <td style="padding:6px 0;border-bottom:1px solid ${border};">
          <span style="font-size:13px;color:${text};">${esc(v.slug)}</span>
          <span style="font-size:12px;color:${yellow};margin-left:8px;">${esc(reason)}</span>
        </td>
      </tr>`;
    }).join("");
    unverifiedSection = `
      <tr><td style="height:12px;"></td></tr>
      <tr><td style="padding:16px 24px;background:${surface};border:1px solid ${border};border-radius:8px;">
        <p style="margin:0;font-size:12px;color:${yellow};text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Published — Not Yet Verified</p>
        <p style="margin:6px 0 0;font-size:11px;color:${muted};">These pages were published to Webflow but could not be verified live. No links are shown until verification passes.</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">${rows}</table>
      </td></tr>`;
  }

  // ── Section 3: Failed / Blocked Pages ──
  // NO clickable links. Plain text with reason.
  let failBlockSection = "";
  const failedItems = (receipt.failed_slugs || []).map(f =>
    `<tr><td style="padding:4px 0;font-size:13px;color:${red};">${esc(f.slug)}: ${esc(f.reason)}</td></tr>`
  );
  const blockedItems = (receipt.blocked_slugs || []).map(b =>
    `<tr><td style="padding:4px 0;font-size:13px;color:${muted};">${esc(b.slug)}: ${esc(b.reason)}</td></tr>`
  );
  if (failedItems.length > 0 || blockedItems.length > 0) {
    let innerRows = "";
    if (failedItems.length > 0) {
      innerRows += `<tr><td style="padding:6px 0 2px;font-size:11px;color:${red};text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Failed</td></tr>` + failedItems.join("");
    }
    if (blockedItems.length > 0) {
      innerRows += `<tr><td style="padding:${failedItems.length > 0 ? "10" : "6"}px 0 2px;font-size:11px;color:${muted};text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">Blocked</td></tr>` + blockedItems.join("");
    }
    failBlockSection = `
      <tr><td style="height:12px;"></td></tr>
      <tr><td style="padding:16px 24px;background:${surface};border:1px solid ${border};border-radius:8px;">
        <p style="margin:0;font-size:12px;color:${muted};text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Failed / Blocked</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">${innerRows}</table>
      </td></tr>`;
  }

  // ── Section 4: Metadata ──
  // Script name, manifest path, receipt path — ALL plain text, never linked.
  const metadataSection = `
    <tr><td style="height:12px;"></td></tr>
    <tr><td style="padding:16px 24px;background:${surface};border:1px solid ${border};border-radius:8px;">
      <p style="margin:0;font-size:12px;color:${muted};text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Metadata</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
        <tr><td style="padding:4px 0;"><span style="font-size:12px;color:${muted};">Script</span></td><td align="right" style="font-size:12px;font-family:monospace;color:${text};">${esc(receipt.script_name)}</td></tr>
        <tr><td style="padding:4px 0;"><span style="font-size:12px;color:${muted};">Manifest</span></td><td align="right" style="font-size:12px;font-family:monospace;color:${text};">${esc(receipt.manifest_path)}</td></tr>
        <tr><td style="padding:4px 0;"><span style="font-size:12px;color:${muted};">Receipt</span></td><td align="right" style="font-size:12px;font-family:monospace;color:${text};">artifacts/publish-receipts/receipt_${esc(receipt.run_id)}.json</td></tr>
      </table>
    </td></tr>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:${bg};font-family:${fontStack};-webkit-font-smoothing:antialiased;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${bg};">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

  <!-- HEADER -->
  <tr><td style="padding:0 0 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td><span style="font-size:20px;font-weight:700;color:${accent};letter-spacing:0.02em;">WARP</span></td>
      <td align="right"><span style="font-size:12px;color:${muted};">Publish Receipt</span></td>
    </tr></table>
  </td></tr>

  <!-- STATUS -->
  <tr><td style="padding:24px;background:${surface};border:1px solid ${border};border-radius:12px;">
    <p style="margin:0;font-size:12px;color:${statusColor};text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">${statusLabel}</p>
    <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:${text};line-height:1.3;">Publish Batch Complete</h1>
    <p style="margin:8px 0 0;font-size:14px;color:${muted};">Run ID: ${esc(receipt.run_id)}</p>
  </td></tr>
  <tr><td style="height:16px;"></td></tr>

  <!-- SUMMARY -->
  <tr><td style="padding:16px 24px;background:${surface};border:1px solid ${border};border-radius:8px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:4px 0;"><span style="font-size:12px;color:${muted};">Intended</span></td><td align="right" style="font-size:14px;color:${text};font-weight:600;">${receipt.intended_count}</td></tr>
      <tr><td style="padding:4px 0;"><span style="font-size:12px;color:${muted};">Attempted</span></td><td align="right" style="font-size:14px;color:${text};font-weight:600;">${receipt.attempted_count}</td></tr>
      <tr><td style="padding:4px 0;"><span style="font-size:12px;color:${muted};">Published</span></td><td align="right" style="font-size:14px;color:${text};font-weight:600;">${receipt.published_count}</td></tr>
      <tr><td style="padding:4px 0;"><span style="font-size:12px;color:${accent};font-weight:600;">Verified Live</span></td><td align="right" style="font-size:14px;color:${accent};font-weight:700;">${receipt.verified_live_count}</td></tr>
      <tr><td style="padding:4px 0;"><span style="font-size:12px;color:${muted};">Failed</span></td><td align="right" style="font-size:14px;color:${receipt.failed_count > 0 ? red : text};font-weight:600;">${receipt.failed_count}</td></tr>
      <tr><td style="padding:4px 0;"><span style="font-size:12px;color:${muted};">Blocked</span></td><td align="right" style="font-size:14px;color:${text};font-weight:600;">${receipt.blocked_count}</td></tr>
    </table>
  </td></tr>

  ${verifiedSection}
  ${unverifiedSection}
  ${failBlockSection}
  ${metadataSection}

  <!-- FOOTER -->
  <tr><td style="height:20px;"></td></tr>
  <tr><td style="padding:16px 0;border-top:1px solid ${border};">
    <p style="margin:0;font-size:11px;color:${muted};">Automated publish receipt from WARP SEO Engine.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}
