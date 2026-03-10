/**
 * Publish Audit — Audit trail core logic
 *
 * Every publish run leaves behind a clear, machine-readable and human-readable
 * audit trail. This module provides the read/write layer for:
 *
 *   artifacts/publish_decision.json         — source of truth for latest run
 *   artifacts/publish_run_history.json      — append-only history
 *   artifacts/published_pages_latest.json   — exact page lists
 *   artifacts/publish_confirmation_report.json — human-readable summary
 *
 * Never uses process.cwd(). All paths resolved via project-root.
 */

import fs from "fs";
import { resolveFromRoot } from "./fs/project-root.js";
import { loadJsonArtifact } from "./artifacts/load-artifact.js";
import {
  classifyPublishRun,
  isConfirmedProductionPublish,
  DISPLAY_LABELS,
  TRUST_LEVELS,
} from "./publish-classification.js";

// ── Config ──────────────────────────────────────────────────────────

function loadAuditConfig() {
  return loadJsonArtifact("config/publish-audit.json") || {
    timezone: "America/Los_Angeles",
    sample_live_url_count: 20,
  };
}

// ── Read helpers ────────────────────────────────────────────────────

/**
 * Load the latest publish decision artifact.
 * Returns null if file does not exist.
 */
export function loadLatestPublishDecision() {
  return loadJsonArtifact("artifacts/publish_decision.json");
}

/**
 * Load the full publish run history.
 * Returns { runs: [] } if file does not exist.
 */
export function loadPublishRunHistory() {
  return loadJsonArtifact("artifacts/publish_run_history.json") || { runs: [] };
}

/**
 * Load the latest published pages manifest.
 */
export function loadPublishedPagesLatest() {
  return loadJsonArtifact("artifacts/published_pages_latest.json");
}

/**
 * Load the confirmation report for the latest run.
 */
export function loadPublishConfirmationReport() {
  return loadJsonArtifact("artifacts/publish_confirmation_report.json");
}

/**
 * Load live page verification results.
 */
export function loadLivePageVerification() {
  return loadJsonArtifact("artifacts/live_page_verification.json");
}

/**
 * Load the SEO impact estimate.
 */
export function loadSeoImpactEstimate() {
  return loadJsonArtifact("artifacts/seo_impact_estimate.json");
}

/**
 * Load the SEO momentum report.
 */
export function loadSeoMomentumReport() {
  return loadJsonArtifact("artifacts/seo_momentum_report.json");
}

/**
 * Load publish integrity report.
 */
export function loadPublishIntegrityReport() {
  return loadJsonArtifact("artifacts/publish_integrity_report.json");
}

// ── Date / timezone helpers ─────────────────────────────────────────

/**
 * Get today's date string in the configured timezone.
 * @param {string} [timezone] — IANA timezone, defaults to config
 * @returns {string} "YYYY-MM-DD"
 */
function todayInTimezone(timezone) {
  const tz = timezone || loadAuditConfig().timezone || "America/Los_Angeles";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    return parts; // en-CA formats as YYYY-MM-DD
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

/**
 * Convert an ISO timestamp to a date bucket in the configured timezone.
 */
function timestampToDateBucket(isoTimestamp, timezone) {
  const tz = timezone || loadAuditConfig().timezone || "America/Los_Angeles";
  try {
    const d = new Date(isoTimestamp);
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  } catch {
    return isoTimestamp?.split("T")?.[0] || "unknown";
  }
}

// ── Query helpers ───────────────────────────────────────────────────

/**
 * Get all publish runs that fall in today's date bucket.
 * @param {{ timezone?: string }} opts
 * @returns {{ runs: object[], date_bucket: string }}
 */
export function getTodaysPublishRuns({ timezone } = {}) {
  const history = loadPublishRunHistory();
  const today = todayInTimezone(timezone);

  const runs = (history.runs || []).filter(run => {
    const bucket = timestampToDateBucket(run.timestamp, timezone);
    return bucket === today;
  });

  return { runs, date_bucket: today };
}

/**
 * Determine if a confirmed production publish happened today.
 *
 * HARDENED RULES:
 *  - Only returns confirmed_posted_today: true when the latest decision's
 *    classification === "production_confirmed".
 *  - A local audit bundle run can NEVER return confirmed_posted_today: true.
 *  - Uses the publish-classification layer as the single source of truth.
 *
 * @param {{ timezone?: string }} opts
 * @returns {{ confirmed_posted_today: boolean, best_available_status: string, reason: string, date_bucket: string, runs_today: number, classification: object|null }}
 */
export function didSomethingPostToday({ timezone } = {}) {
  const { runs, date_bucket } = getTodaysPublishRuns({ timezone });

  if (runs.length === 0) {
    return {
      confirmed_posted_today: false,
      best_available_status: "No runs today",
      reason: "No publish runs found for today",
      date_bucket,
      runs_today: 0,
      classification: null,
    };
  }

  // Load the latest decision and verification for classification
  const decision = loadLatestPublishDecision();
  const verification = loadLivePageVerification();
  const latestClassification = decision
    ? classifyPublishRun(decision, verification)
    : null;

  // Check: is the latest decision from today AND production_confirmed?
  const latestIsToday = decision?.timestamp
    ? timestampToDateBucket(decision.timestamp, timezone) === date_bucket
    : false;

  const confirmedToday =
    latestIsToday && latestClassification
      ? isConfirmedProductionPublish(latestClassification)
      : false;

  // Determine best available status from today's runs
  let bestStatus;
  const hasProductionFailed = runs.some(r => r.mode === "production" && r.deploy_status === "failed");
  const hasProductionSuccess = runs.some(r => r.mode === "production" && r.deploy_status === "success");
  const hasStaging = runs.some(r => r.mode === "staging");
  const allLocal = runs.every(r =>
    r.mode === "dry" || r.mode === "local" ||
    r.deploy_status === "unknown" ||
    (!r.deployment_id || r.deployment_id === "unknown" || r.deployment_id === "local-audit")
  );

  if (confirmedToday) {
    bestStatus = DISPLAY_LABELS.production_confirmed;
  } else if (hasProductionFailed) {
    bestStatus = DISPLAY_LABELS.production_failed;
  } else if (hasProductionSuccess) {
    bestStatus = DISPLAY_LABELS.production_unverified;
  } else if (hasStaging) {
    bestStatus = DISPLAY_LABELS.staging_publish;
  } else if (allLocal) {
    bestStatus = DISPLAY_LABELS.local_simulation;
  } else {
    bestStatus = DISPLAY_LABELS.unknown;
  }

  return {
    confirmed_posted_today: confirmedToday,
    best_available_status: bestStatus,
    reason: confirmedToday
      ? "Confirmed production publish with live verification"
      : `Runs today but classification is: ${bestStatus}`,
    date_bucket,
    runs_today: runs.length,
    classification: latestClassification,
  };
}

// ── Write helpers ───────────────────────────────────────────────────

/**
 * Write the publish_decision.json artifact.
 * This is the source-of-truth for the latest run.
 */
export function writePublishDecision(decision) {
  const p = resolveFromRoot("artifacts", "publish_decision.json");
  fs.mkdirSync(resolveFromRoot("artifacts"), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(decision, null, 2));
  return p;
}

/**
 * Append a run summary to publish_run_history.json.
 * Creates the file if it doesn't exist.
 */
export function appendPublishRunHistory(runSummary) {
  const p = resolveFromRoot("artifacts", "publish_run_history.json");
  fs.mkdirSync(resolveFromRoot("artifacts"), { recursive: true });

  let history;
  try {
    history = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    history = { runs: [] };
  }

  history.runs.push(runSummary);
  fs.writeFileSync(p, JSON.stringify(history, null, 2));
  return p;
}

/**
 * Write published_pages_latest.json with exact page lists.
 */
export function writePublishedPagesLatest({ runId, timestamp, liveIndexablePages, liveNoindexPages, blockedPages }) {
  const p = resolveFromRoot("artifacts", "published_pages_latest.json");
  fs.mkdirSync(resolveFromRoot("artifacts"), { recursive: true });

  const data = {
    run_id: runId,
    timestamp: timestamp || new Date().toISOString(),
    live_indexable_pages: liveIndexablePages || [],
    live_noindex_pages: liveNoindexPages || [],
    blocked_pages: blockedPages || [],
  };

  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

/**
 * Build and write the publish_confirmation_report.json.
 *
 * This is the human-readable summary used by dashboard and email.
 */
export function buildPublishConfirmationReport({ publishDecision, publishedPages, liveVerification } = {}) {
  const decision = publishDecision || loadLatestPublishDecision();
  const pages = publishedPages || loadPublishedPagesLatest();
  const verification = liveVerification || loadLivePageVerification();
  const config = loadAuditConfig();

  if (!decision) {
    return {
      run_id: "none",
      timestamp: new Date().toISOString(),
      confirmed_posted_today: false,
      date_bucket: todayInTimezone(),
      summary: {
        pages_attempted: 0,
        pages_generated: 0,
        pages_indexable: 0,
        pages_noindex: 0,
        pages_blocked: 0,
      },
      sample_live_urls: [],
      top_corridors: [],
      deploy: null,
      verification: null,
    };
  }

  // Classify this run using the classification layer
  const classification = classifyPublishRun(decision, verification);
  const isProductionConfirmed = isConfirmedProductionPublish(classification);

  const dateBucket = timestampToDateBucket(decision.timestamp);

  // Sample live URLs
  const sampleCount = config.sample_live_url_count || 20;
  const baseUrl = decision.site_base_url || "https://www.wearewarp.com";
  const sampleLiveUrls = (pages?.live_indexable_pages || [])
    .slice(0, sampleCount)
    .map(p => `${baseUrl}${p.page_path}`);

  // Top corridors
  const corridorMap = {};
  for (const p of (pages?.live_indexable_pages || [])) {
    const cid = p.corridor_id || "unknown";
    if (!corridorMap[cid]) corridorMap[cid] = { corridor_id: cid, pages_generated: 0, pages_indexable: 0 };
    corridorMap[cid].pages_generated++;
    corridorMap[cid].pages_indexable++;
  }
  for (const p of (pages?.live_noindex_pages || [])) {
    const cid = p.corridor_id || "unknown";
    if (!corridorMap[cid]) corridorMap[cid] = { corridor_id: cid, pages_generated: 0, pages_indexable: 0 };
    corridorMap[cid].pages_generated++;
  }
  const topCorridors = Object.values(corridorMap)
    .sort((a, b) => b.pages_generated - a.pages_generated)
    .slice(0, 10);

  // Verification
  let verificationWarning = false;
  if (verification) {
    const verConfig = loadJsonArtifact("config/publish-verification.json") || {};
    const maxFailed = verConfig.max_failed_before_warning ?? 2;
    verificationWarning = (verification.failed || 0) > maxFailed;
  }

  const report = {
    run_id: decision.run_id,
    timestamp: decision.timestamp,
    // Classification metadata — machine-enforced trust
    classification: classification.classification,
    display_status: classification.display_status,
    trust_level: classification.trust_level,
    confirmed_posted_today: isProductionConfirmed && dateBucket === todayInTimezone(),
    reason_codes: classification.reason_codes,
    date_bucket: dateBucket,
    summary: {
      pages_attempted: decision.pages_attempted || 0,
      pages_generated: decision.pages_generated || 0,
      pages_indexable: decision.pages_indexable || 0,
      pages_noindex: decision.pages_noindex || 0,
      pages_blocked: decision.pages_blocked || 0,
      verification_warning: verificationWarning,
    },
    verification_summary: verification ? {
      ran: true,
      checked: verification.checked || 0,
      passed: verification.passed || 0,
      failed: verification.failed || 0,
      verification_status: verification.verification_status || "unknown",
    } : {
      ran: false,
      checked: 0,
      passed: 0,
      failed: 0,
      verification_status: "not_run",
    },
    sample_live_urls: sampleLiveUrls,
    top_corridors: topCorridors,
    deploy: decision.deploy || null,
    verification: verification ? {
      checked: verification.checked,
      passed: verification.passed,
      failed: verification.failed,
    } : null,
  };

  // Write artifact
  const p = resolveFromRoot("artifacts", "publish_confirmation_report.json");
  fs.mkdirSync(resolveFromRoot("artifacts"), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(report, null, 2));

  return report;
}

// ── Build publish decision from pipeline data ───────────────────────

/**
 * Build a publish_decision object from pipeline results.
 * Called by ship_firstpage.js and publish_next.js after execution.
 */
export function buildPublishDecision({
  mode,
  environment,
  siteBaseUrl,
  deploy,
  lanes,
  blockedReasons,
  allowed,
  errors,
}) {
  const now = new Date();
  const runId = now.toISOString().replace(/[:.]/g, "-").replace("Z", "Z");

  // Compute page counts from lanes
  const laneList = lanes || [];
  const pagesAttempted = laneList.length;
  const indexable = laneList.filter(l => l.status === "indexed" || l.indexable);
  const noindex = laneList.filter(l => l.status === "noindex" || l.noindex);
  const blocked = laneList.filter(l => l.status === "blocked" || l.blocked);
  const generated = indexable.length + noindex.length;

  const decisionObj = {
    run_id: runId,
    timestamp: now.toISOString(),
    mode: mode || "dry",
    environment: environment || "local",
    site_base_url: siteBaseUrl || "https://www.wearewarp.com",
    deploy: deploy || {
      provider: "unknown",
      deployment_id: "unknown",
      deployment_url: "unknown",
      commit_sha: "unknown",
      branch: "unknown",
      status: "unknown",
    },
    pages_attempted: pagesAttempted,
    pages_generated: generated,
    pages_indexable: indexable.length,
    pages_noindex: noindex.length,
    pages_blocked: blocked.length,
    blocked_reasons: blockedReasons || [],
    allowed: allowed !== false,
    errors: errors || [],
  };

  // Attach classification metadata at build time
  const cls = classifyPublishRun(decisionObj, null);
  decisionObj.classification = cls.classification;
  decisionObj.display_status = cls.display_status;
  decisionObj.confirmed_posted_today = cls.confirmed_posted_today;
  decisionObj.trust_level = cls.trust_level;

  return decisionObj;
}

/**
 * Build published pages lists from lane registry.
 */
export function buildPublishedPagesFromRegistry({
  runId,
  timestamp,
  lanes,
  blockedReasons,
  siteBaseUrl,
}) {
  const laneList = lanes || [];
  const base = siteBaseUrl || "https://www.wearewarp.com";

  const liveIndexablePages = laneList
    .filter(l => l.status === "indexed" || l.indexable)
    .map(l => ({
      page_path: `/lanes/${l.lane_slug || l.slug}`,
      page_type: "lane",
      lane_slug: l.lane_slug || l.slug,
      corridor_id: l.corridor || "unknown",
    }));

  const liveNoindexPages = laneList
    .filter(l => l.status === "noindex" || l.noindex)
    .map(l => ({
      page_path: `/data/${l.lane_slug || l.slug}`,
      page_type: "data",
      lane_slug: l.lane_slug || l.slug,
      corridor_id: l.corridor || "unknown",
    }));

  const blockedPages = (blockedReasons || []).map(r => ({
    page_key: r.page_key || "unknown",
    rule_id: r.rule_id || "unknown",
  }));

  return {
    runId: runId,
    timestamp: timestamp || new Date().toISOString(),
    liveIndexablePages,
    liveNoindexPages,
    blockedPages,
  };
}

/**
 * Build a run summary for history append.
 */
export function buildRunSummary(publishDecision) {
  return {
    run_id: publishDecision.run_id,
    timestamp: publishDecision.timestamp,
    mode: publishDecision.mode,
    pages_generated: publishDecision.pages_generated,
    pages_indexable: publishDecision.pages_indexable,
    pages_noindex: publishDecision.pages_noindex,
    pages_blocked: publishDecision.pages_blocked,
    deploy_status: publishDecision.deploy?.status || "unknown",
    deployment_id: publishDecision.deploy?.deployment_id || "unknown",
    classification: publishDecision.classification || "unknown",
    trust_level: publishDecision.trust_level || "low",
  };
}
