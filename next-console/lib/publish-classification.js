/**
 * Publish Classification Layer
 *
 * Machine-enforced distinction between:
 *   - local_simulation     — artifact generated locally, never deployed
 *   - staging_publish      — deployed to staging/preview, not production
 *   - production_unverified — deployed to production but not live-verified
 *   - production_confirmed — deployed to production AND live URLs verified
 *   - production_failed    — production deploy failed
 *   - unknown              — cannot determine
 *
 * A local run can NEVER set confirmed_posted_today = true.
 * Only production_confirmed can.
 *
 * Never uses process.cwd(). All paths resolved via project-root.
 */

import { loadJsonArtifact } from "./artifacts/load-artifact.js";

// ── Classification constants ────────────────────────────────────────

export const CLASSIFICATIONS = {
  LOCAL_SIMULATION: "local_simulation",
  STAGING_PUBLISH: "staging_publish",
  PRODUCTION_UNVERIFIED: "production_unverified",
  PRODUCTION_CONFIRMED: "production_confirmed",
  PRODUCTION_FAILED: "production_failed",
  UNKNOWN: "unknown",
};

export const DISPLAY_LABELS = {
  local_simulation: "Simulated local audit",
  staging_publish: "Staging publish",
  production_unverified: "Production publish unverified",
  production_confirmed: "Confirmed production publish",
  production_failed: "Production publish failed",
  unknown: "Unknown",
};

export const TRUST_LEVELS = {
  local_simulation: "low",
  staging_publish: "medium",
  production_unverified: "medium",
  production_confirmed: "high",
  production_failed: "low",
  unknown: "low",
};

// ── Config loader ───────────────────────────────────────────────────

function loadTrustConfig() {
  return loadJsonArtifact("config/publish-trust.json") || {
    production_domains: ["www.wearewarp.com", "wearewarp.com"],
    production_environment_markers: ["production", "vercel-production"],
    staging_environment_markers: ["staging", "preview", "vercel-preview"],
    localhost_markers: ["localhost", "127.0.0.1", "0.0.0.0"],
    require_live_verification_for_confirmed: true,
  };
}

// ── Domain validation ───────────────────────────────────────────────

/**
 * Check if a URL points to localhost.
 */
function isLocalhostUrl(url) {
  if (!url) return true;
  const config = loadTrustConfig();
  const lower = String(url).toLowerCase();
  return config.localhost_markers.some(m => lower.includes(m));
}

/**
 * Check if a URL is a production domain per config.
 */
function isProductionDomain(url) {
  if (!url) return false;
  const config = loadTrustConfig();
  const lower = String(url).toLowerCase();
  if (isLocalhostUrl(url)) return false;
  return config.production_domains.some(d => lower.includes(d));
}

// ── Environment detection ───────────────────────────────────────────

/**
 * Check if the environment string indicates production.
 */
export function isProductionEnvironment(value) {
  if (!value) return false;
  const config = loadTrustConfig();
  const lower = String(value).toLowerCase();
  return config.production_environment_markers.some(m => lower.includes(m));
}

/**
 * Check if the environment string indicates staging.
 */
function isStagingEnvironment(value) {
  if (!value) return false;
  const config = loadTrustConfig();
  const lower = String(value).toLowerCase();
  return config.staging_environment_markers.some(m => lower.includes(m));
}

/**
 * Check if a publish decision represents a local simulation.
 */
export function isLocalSimulation(publishDecision) {
  if (!publishDecision) return true;

  const mode = String(publishDecision.mode || "").toLowerCase();
  const env = String(publishDecision.environment || "").toLowerCase();
  const deploy = publishDecision.deploy || {};
  const siteUrl = String(publishDecision.site_base_url || "").toLowerCase();

  // Explicit local/dry modes
  if (mode === "dry" || mode === "local") return true;

  // Environment contains local/dev markers
  if (env === "local" || env === "dev" || env === "development") return true;
  if (env.includes("local")) return true;

  // No deploy provider — no real deploy happened
  if (!deploy.provider || deploy.provider === "unknown" || deploy.provider === "local") return true;

  // No deployment_id and no production marker — simulation
  if ((!deploy.deployment_id || deploy.deployment_id === "unknown" || deploy.deployment_id === "local-audit") &&
      !isProductionEnvironment(env)) {
    return true;
  }

  // Site URL points to localhost
  if (isLocalhostUrl(siteUrl)) return true;

  // Explicit manual_audit_bundle marker
  if (publishDecision._source === "manual_audit_bundle") return true;

  return false;
}

// ── Verification status helpers ─────────────────────────────────────

/**
 * Determine verification outcome from live_page_verification artifact.
 */
function getVerificationOutcome(liveVerification, config) {
  if (!liveVerification) return { status: "not_run", passed: false };

  const verStatus = liveVerification.verification_status;
  if (verStatus) {
    return {
      status: verStatus,
      passed: verStatus === "passed",
    };
  }

  // Legacy: compute from raw numbers
  const checked = liveVerification.checked || 0;
  const passed = liveVerification.passed || 0;
  const failed = liveVerification.failed || 0;

  if (checked === 0) return { status: "not_run", passed: false };

  const verConfig = config || loadJsonArtifact("config/publish-verification.json") || {};
  const maxFailed = verConfig.max_failed_before_warning ?? 2;

  if (passed === 0) return { status: "failed", passed: false };
  if (failed > maxFailed) return { status: "warning", passed: false };
  return { status: "passed", passed: true };
}

// ── Main classification function ────────────────────────────────────

/**
 * Classify a publish run with machine-enforced trust rules.
 *
 * @param {object} publishDecision — the publish_decision.json content
 * @param {object|null} liveVerification — the live_page_verification.json content
 * @param {object|null} config — optional verification config override
 * @returns {object} classification result
 */
export function classifyPublishRun(publishDecision, liveVerification, config) {
  const reasonCodes = [];
  const trustConfig = loadTrustConfig();

  if (!publishDecision) {
    return {
      run_id: "none",
      classification: CLASSIFICATIONS.UNKNOWN,
      confirmed_posted_today: false,
      reason_codes: ["no_publish_decision"],
      display_status: DISPLAY_LABELS.unknown,
      trust_level: TRUST_LEVELS.unknown,
    };
  }

  const mode = String(publishDecision.mode || "").toLowerCase();
  const env = String(publishDecision.environment || "").toLowerCase();
  const deploy = publishDecision.deploy || {};
  const siteUrl = publishDecision.site_base_url || "";
  const runId = publishDecision.run_id || "unknown";

  // ── Step 1: Check for local simulation ──

  if (isLocalSimulation(publishDecision)) {
    // Build reason codes
    if (mode === "dry" || mode === "local") reasonCodes.push("mode_is_" + mode);
    if (env === "local" || env === "dev" || env === "development" || env.includes("local")) {
      reasonCodes.push("environment_is_local");
    }
    if (!deploy.provider || deploy.provider === "unknown" || deploy.provider === "local") {
      reasonCodes.push("missing_deploy_provider");
    }
    if (!deploy.deployment_id || deploy.deployment_id === "unknown" || deploy.deployment_id === "local-audit") {
      reasonCodes.push("missing_deploy_id");
    }
    if (isLocalhostUrl(siteUrl)) reasonCodes.push("localhost_site_url");
    if (publishDecision._source === "manual_audit_bundle") reasonCodes.push("manual_audit_bundle_run");

    if (reasonCodes.length === 0) reasonCodes.push("local_simulation_detected");

    return {
      run_id: runId,
      classification: CLASSIFICATIONS.LOCAL_SIMULATION,
      confirmed_posted_today: false,
      reason_codes: reasonCodes,
      display_status: DISPLAY_LABELS.local_simulation,
      trust_level: TRUST_LEVELS.local_simulation,
    };
  }

  // ── Step 2: Check for staging ──

  if (mode === "staging" || isStagingEnvironment(env)) {
    reasonCodes.push("staging_mode_or_environment");
    if (!isProductionDomain(siteUrl)) reasonCodes.push("non_production_domain");

    return {
      run_id: runId,
      classification: CLASSIFICATIONS.STAGING_PUBLISH,
      confirmed_posted_today: false,
      reason_codes: reasonCodes,
      display_status: DISPLAY_LABELS.staging_publish,
      trust_level: TRUST_LEVELS.staging_publish,
    };
  }

  // ── Step 3: Must be production mode from here ──

  const isProductionMode = mode === "production";
  const isProductionEnv = isProductionEnvironment(env);

  if (!isProductionMode && !isProductionEnv) {
    reasonCodes.push("mode_not_production");
    reasonCodes.push("environment_not_production");
    return {
      run_id: runId,
      classification: CLASSIFICATIONS.UNKNOWN,
      confirmed_posted_today: false,
      reason_codes: reasonCodes,
      display_status: DISPLAY_LABELS.unknown,
      trust_level: TRUST_LEVELS.unknown,
    };
  }

  // ── Step 4: Production failed ──

  if (deploy.status === "failed") {
    reasonCodes.push("deploy_status_failed");
    return {
      run_id: runId,
      classification: CLASSIFICATIONS.PRODUCTION_FAILED,
      confirmed_posted_today: false,
      reason_codes: reasonCodes,
      display_status: DISPLAY_LABELS.production_failed,
      trust_level: TRUST_LEVELS.production_failed,
    };
  }

  // ── Step 5: Production deploy must be success ──

  if (deploy.status !== "success") {
    reasonCodes.push("deploy_status_not_success");
    return {
      run_id: runId,
      classification: CLASSIFICATIONS.PRODUCTION_UNVERIFIED,
      confirmed_posted_today: false,
      reason_codes: reasonCodes,
      display_status: DISPLAY_LABELS.production_unverified,
      trust_level: TRUST_LEVELS.production_unverified,
    };
  }

  // ── Step 6: Check remaining production_confirmed requirements ──

  let canConfirm = true;

  if (!deploy.deployment_id || deploy.deployment_id === "unknown") {
    reasonCodes.push("missing_deploy_id");
    canConfirm = false;
  }

  if (!deploy.provider || deploy.provider === "unknown" || deploy.provider === "local") {
    reasonCodes.push("missing_deploy_provider");
    canConfirm = false;
  }

  if (!isProductionDomain(siteUrl)) {
    reasonCodes.push("site_url_not_production_domain");
    canConfirm = false;
  }

  if (isLocalhostUrl(siteUrl)) {
    reasonCodes.push("localhost_site_url");
    canConfirm = false;
  }

  // ── Step 7: Live verification gate ──

  const verOutcome = getVerificationOutcome(liveVerification, config);

  if (trustConfig.require_live_verification_for_confirmed) {
    if (verOutcome.status === "not_run") {
      reasonCodes.push("live_verification_not_run");
      canConfirm = false;
    } else if (verOutcome.status === "failed") {
      reasonCodes.push("live_verification_failed");
      canConfirm = false;
    } else if (verOutcome.status === "warning") {
      reasonCodes.push("live_verification_warning");
      canConfirm = false;
    }
  }

  // ── Step 8: Final classification ──

  if (canConfirm) {
    return {
      run_id: runId,
      classification: CLASSIFICATIONS.PRODUCTION_CONFIRMED,
      confirmed_posted_today: true,
      reason_codes: [],
      display_status: DISPLAY_LABELS.production_confirmed,
      trust_level: TRUST_LEVELS.production_confirmed,
    };
  }

  return {
    run_id: runId,
    classification: CLASSIFICATIONS.PRODUCTION_UNVERIFIED,
    confirmed_posted_today: false,
    reason_codes: reasonCodes,
    display_status: DISPLAY_LABELS.production_unverified,
    trust_level: TRUST_LEVELS.production_unverified,
  };
}

/**
 * Convenience: check if a classification result is production_confirmed.
 */
export function isConfirmedProductionPublish(classification) {
  if (!classification) return false;
  return classification.classification === CLASSIFICATIONS.PRODUCTION_CONFIRMED
    && classification.confirmed_posted_today === true;
}
