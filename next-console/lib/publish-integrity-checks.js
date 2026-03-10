/**
 * Publish Integrity Checks — Trust verification layer
 *
 * Rules:
 *   - Never show fake numbers if source is not connected
 *   - If SEO momentum cannot be computed, show insufficient_data
 *   - If live URL verification not run, show unverified
 *   - If only staging deployed, do not claim production post
 *   - If deploy status unknown, do not claim success
 *   - If page counts conflict across artifacts, surface red integrity warning
 *   - confirmed_posted_today true but classification != production_confirmed => HIGH
 *   - trust_level high but live verification missing => HIGH
 *   - production_confirmed but deployment_id missing => HIGH
 *   - production_confirmed but site_base_url not in production allowlist => HIGH
 *   - local_simulation with confirmed_posted_today => HIGH
 *   - staging_publish with "posted today" wording => HIGH
 *
 * Never uses process.cwd().
 */

import fs from "fs";
import { resolveFromRoot } from "./fs/project-root.js";
import { loadJsonArtifact } from "./artifacts/load-artifact.js";
import {
  classifyPublishRun,
  isConfirmedProductionPublish,
  CLASSIFICATIONS,
} from "./publish-classification.js";

/**
 * Run all publish integrity checks.
 *
 * Compares artifacts for consistency, validates classification trust,
 * and flags issues. Returns { issues, summary, overall_status }.
 */
export function runPublishIntegrityChecks() {
  const issues = [];
  const now = new Date();

  const decision = loadJsonArtifact("artifacts/publish_decision.json");
  const history = loadJsonArtifact("artifacts/publish_run_history.json");
  const pagesLatest = loadJsonArtifact("artifacts/published_pages_latest.json");
  const confirmation = loadJsonArtifact("artifacts/publish_confirmation_report.json");
  const verification = loadJsonArtifact("artifacts/live_page_verification.json");
  const impactEstimate = loadJsonArtifact("artifacts/seo_impact_estimate.json");
  const momentum = loadJsonArtifact("artifacts/seo_momentum_report.json");
  const metricsSnap = loadJsonArtifact("artifacts/metrics_snapshot.json");
  const trustConfig = loadJsonArtifact("config/publish-trust.json") || {};

  // Compute classification from live artifacts
  const classification = decision
    ? classifyPublishRun(decision, verification)
    : null;

  // ── Check 1: Required artifacts exist ──

  if (!decision) {
    issues.push({
      severity: "high",
      type: "missing_artifact",
      artifact: "publish_decision.json",
      message: "No publish decision artifact found — run the publish pipeline first",
    });
  }

  if (!history) {
    issues.push({
      severity: "medium",
      type: "missing_artifact",
      artifact: "publish_run_history.json",
      message: "No publish run history — first run may not have been recorded",
    });
  }

  if (!pagesLatest) {
    issues.push({
      severity: "medium",
      type: "missing_artifact",
      artifact: "published_pages_latest.json",
      message: "No published pages manifest — cannot verify exact page lists",
    });
  }

  // ── Check 2: Page count consistency ──

  if (decision && pagesLatest) {
    const decIndexable = decision.pages_indexable || 0;
    const decNoindex = decision.pages_noindex || 0;

    const pagesIndexable = pagesLatest.live_indexable_pages?.length || 0;
    const pagesNoindex = pagesLatest.live_noindex_pages?.length || 0;

    if (decIndexable !== pagesIndexable) {
      issues.push({
        severity: "high",
        type: "page_count_mismatch",
        field: "pages_indexable",
        decision_value: decIndexable,
        pages_value: pagesIndexable,
        message: `Indexable page count mismatch: decision says ${decIndexable}, pages manifest has ${pagesIndexable}`,
      });
    }

    if (decNoindex !== pagesNoindex) {
      issues.push({
        severity: "medium",
        type: "page_count_mismatch",
        field: "pages_noindex",
        decision_value: decNoindex,
        pages_value: pagesNoindex,
        message: `Noindex page count mismatch: decision says ${decNoindex}, pages manifest has ${pagesNoindex}`,
      });
    }
  }

  // ── Check 3: Run ID consistency ──

  if (decision && pagesLatest && decision.run_id !== pagesLatest.run_id) {
    issues.push({
      severity: "medium",
      type: "run_id_mismatch",
      decision_run_id: decision.run_id,
      pages_run_id: pagesLatest.run_id,
      message: "Run ID mismatch between publish decision and pages manifest — may be from different runs",
    });
  }

  if (decision && confirmation && decision.run_id !== confirmation.run_id) {
    issues.push({
      severity: "low",
      type: "run_id_mismatch",
      decision_run_id: decision.run_id,
      confirmation_run_id: confirmation.run_id,
      message: "Run ID mismatch between publish decision and confirmation report",
    });
  }

  // ── Check 4: Deploy status trust ──

  if (decision) {
    if (!decision.deploy || decision.deploy.status === "unknown") {
      issues.push({
        severity: "medium",
        type: "unknown_deploy_status",
        message: "Deploy status is unknown — cannot confirm pages are live in production",
      });
    }

    if (decision.mode === "staging" && confirmation?.confirmed_posted_today) {
      issues.push({
        severity: "high",
        type: "false_confirmation",
        message: "Confirmation report claims production post but mode is staging",
      });
    }
  }

  // ── Check 5: Live page verification ──

  if (!verification) {
    issues.push({
      severity: "low",
      type: "verification_not_run",
      message: "Live page verification has not been run — pages are unverified",
    });
  } else if (verification.failed > 0) {
    const failRate = verification.checked > 0 ? (verification.failed / verification.checked) : 0;
    if (failRate > 0.1) {
      issues.push({
        severity: "high",
        type: "high_verification_failure",
        checked: verification.checked,
        failed: verification.failed,
        message: `${verification.failed}/${verification.checked} sampled URLs failed verification (${(failRate * 100).toFixed(0)}% failure rate)`,
      });
    }
  }

  // ── Check 6: Metrics source trust ──

  if (metricsSnap) {
    const sources = metricsSnap.sources || {};
    for (const [name, info] of Object.entries(sources)) {
      if (name === "placeholders") continue;
      if (!info.connected && (info.coverage?.pages_with_data > 0 || info.coverage?.lanes_with_data > 0)) {
        issues.push({
          severity: "medium",
          type: "disconnected_source_with_data",
          source: name,
          message: `${name.toUpperCase()} is disconnected but has data — values may be stale`,
        });
      }
    }
  }

  // ── Check 7: Momentum data availability ──

  if (momentum?.status === "insufficient_data") {
    issues.push({
      severity: "low",
      type: "insufficient_momentum_data",
      message: "SEO momentum cannot be computed — insufficient data from connected sources",
    });
  }

  // ── Check 8: Classification trust violations ──

  if (classification) {
    // 8a: confirmed_posted_today true but classification not production_confirmed
    if (decision?.confirmed_posted_today === true &&
        classification.classification !== CLASSIFICATIONS.PRODUCTION_CONFIRMED) {
      issues.push({
        severity: "high",
        type: "classification_mismatch",
        message: `Artifact claims confirmed_posted_today=true but classification is "${classification.classification}" — trust violation`,
      });
    }

    if (confirmation?.confirmed_posted_today === true &&
        classification.classification !== CLASSIFICATIONS.PRODUCTION_CONFIRMED) {
      issues.push({
        severity: "high",
        type: "confirmation_classification_mismatch",
        message: `Confirmation report claims confirmed_posted_today=true but classification is "${classification.classification}" — trust violation`,
      });
    }

    // 8b: trust_level high but live verification missing
    if (classification.trust_level === "high" && !verification) {
      issues.push({
        severity: "high",
        type: "high_trust_no_verification",
        message: "Trust level is high but live page verification has not been run — cannot confirm pages are live",
      });
    }

    // 8c: production_confirmed but deployment_id missing
    if (classification.classification === CLASSIFICATIONS.PRODUCTION_CONFIRMED &&
        (!decision?.deploy?.deployment_id || decision.deploy.deployment_id === "unknown")) {
      issues.push({
        severity: "high",
        type: "confirmed_no_deployment_id",
        message: "Classification is production_confirmed but deployment_id is missing — trust violation",
      });
    }

    // 8d: production_confirmed but site_base_url not in production domain allowlist
    if (classification.classification === CLASSIFICATIONS.PRODUCTION_CONFIRMED) {
      const siteUrl = String(decision?.site_base_url || "").toLowerCase();
      const productionDomains = trustConfig.production_domains || [];
      const domainMatch = productionDomains.some(d => siteUrl.includes(d));
      if (!domainMatch) {
        issues.push({
          severity: "high",
          type: "confirmed_non_production_domain",
          message: `Classification is production_confirmed but site_base_url "${decision?.site_base_url}" is not in the production domain allowlist`,
        });
      }
    }

    // 8e: local_simulation claiming confirmed_posted_today
    if (classification.classification === CLASSIFICATIONS.LOCAL_SIMULATION &&
        (decision?.confirmed_posted_today === true || confirmation?.confirmed_posted_today === true)) {
      issues.push({
        severity: "high",
        type: "local_simulation_confirmed",
        message: "Local simulation is claiming confirmed_posted_today=true — this is a trust violation",
      });
    }

    // 8f: staging_publish with confirmed_posted_today
    if (classification.classification === CLASSIFICATIONS.STAGING_PUBLISH &&
        (decision?.confirmed_posted_today === true || confirmation?.confirmed_posted_today === true)) {
      issues.push({
        severity: "high",
        type: "staging_confirmed",
        message: "Staging publish is claiming confirmed_posted_today=true — staging is not production",
      });
    }
  }

  // ── Summary ──

  const summary = {
    high: issues.filter(i => i.severity === "high").length,
    medium: issues.filter(i => i.severity === "medium").length,
    low: issues.filter(i => i.severity === "low").length,
    total: issues.length,
  };

  const overall_status = summary.high > 0 ? "integrity_warning"
    : summary.medium > 0 ? "minor_issues"
    : "clean";

  const report = {
    timestamp: now.toISOString(),
    overall_status,
    classification: classification ? {
      classification: classification.classification,
      display_status: classification.display_status,
      trust_level: classification.trust_level,
      confirmed_posted_today: classification.confirmed_posted_today,
      reason_codes: classification.reason_codes,
    } : null,
    issues,
    summary,
  };

  // Write artifact
  const p = resolveFromRoot("artifacts", "publish_integrity_report.json");
  fs.mkdirSync(resolveFromRoot("artifacts"), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(report, null, 2));

  return report;
}
