/**
 * Canonical Config Loader
 *
 * SINGLE SOURCE OF TRUTH for all environment-driven configuration
 * in the lane factory pipeline. Every script that needs email, Webflow,
 * or publish config MUST import from here — never read process.env directly
 * for these domains.
 *
 * Supports legacy env var names for backward compatibility:
 *   SMTP_USER        → falls back to EMAIL_USER
 *   SMTP_PASS        → falls back to EMAIL_APP_PASSWORD
 *   SMTP_HOST        → defaults to smtp.gmail.com
 *   SMTP_PORT        → defaults to 465
 *   SMTP_FROM        → falls back to EMAIL_USER
 *
 * Usage:
 *   import { loadConfig, validateConfig } from "../lib/config.js";
 *   const cfg = loadConfig();
 *   const { ok, missing } = validateConfig(cfg, "email");
 */

// ── Loader ─────────────────────────────────────────────────────────────

/**
 * Load and normalize all pipeline config from process.env.
 * Call AFTER dotenv has been loaded.
 *
 * @returns {PipelineConfig}
 */
export function loadConfig() {
  const env = process.env;

  return Object.freeze({
    // ── Email ────────────────────────────────────────────────────────
    email: Object.freeze({
      user:     env.EMAIL_USER        || env.SMTP_USER  || "",
      password: env.EMAIL_APP_PASSWORD || env.SMTP_PASS  || "",
      to:       env.EMAIL_TO          || "",
      host:     env.SMTP_HOST         || "smtp.gmail.com",
      port:     parseInt(env.SMTP_PORT || "465", 10),
      secure:   (env.SMTP_PORT || "465") === "465",
      from:     env.SMTP_FROM         || env.EMAIL_USER  || env.SMTP_USER || "",
    }),

    // ── Webflow ──────────────────────────────────────────────────────
    webflow: Object.freeze({
      apiToken:     env.WEBFLOW_API_TOKEN             || "",
      collectionId: env.WEBFLOW_LANE_COLLECTION_ID    || "",
      siteId:       env.WEBFLOW_SITE_ID               || "",
      templatePath: env.WEBFLOW_LANES_TEMPLATE_PATH   || "/lanes",
    }),

    // ── Approval ─────────────────────────────────────────────────────
    approval: Object.freeze({
      webhookSecret: env.APPROVAL_WEBHOOK_SECRET || "",
    }),

    // ── Misc ─────────────────────────────────────────────────────────
    nodeEnv: env.NODE_ENV || "development",
  });
}

// ── Validator ──────────────────────────────────────────────────────────

/**
 * @typedef {"email" | "webflow" | "approval" | "publish"} ConfigDomain
 */

const REQUIRED_FIELDS = {
  email:    ["email.user", "email.password"],
  webflow:  ["webflow.apiToken", "webflow.collectionId", "webflow.siteId"],
  approval: ["approval.webhookSecret"],
  publish:  ["webflow.apiToken", "webflow.collectionId", "webflow.siteId", "email.user", "email.password"],
};

/**
 * Validate that required config fields are present for a given domain.
 *
 * @param {PipelineConfig} cfg - Config object from loadConfig()
 * @param {ConfigDomain | ConfigDomain[]} domains - Which domain(s) to validate
 * @returns {{ ok: boolean, missing: string[] }}
 */
export function validateConfig(cfg, domains) {
  const domainList = Array.isArray(domains) ? domains : [domains];
  const missing = [];

  for (const domain of domainList) {
    const fields = REQUIRED_FIELDS[domain] || [];
    for (const fieldPath of fields) {
      const parts = fieldPath.split(".");
      let val = cfg;
      for (const p of parts) {
        val = val?.[p];
      }
      if (!val) {
        missing.push(fieldPath);
      }
    }
  }

  return { ok: missing.length === 0, missing: [...new Set(missing)] };
}

// ── Conflict detector ─────────────────────────────────────────────────

/**
 * Detect potentially conflicting env var configurations.
 * Returns warnings (not errors) when both old and new names are set
 * to different values.
 *
 * @returns {string[]} Array of warning messages
 */
export function detectConfigConflicts() {
  const env = process.env;
  const warnings = [];

  // Email user: EMAIL_USER vs SMTP_USER
  if (env.EMAIL_USER && env.SMTP_USER && env.EMAIL_USER !== env.SMTP_USER) {
    warnings.push(
      `EMAIL_USER (${env.EMAIL_USER}) and SMTP_USER (${env.SMTP_USER}) are both set but differ. Using EMAIL_USER.`
    );
  }

  // Email password: EMAIL_APP_PASSWORD vs SMTP_PASS
  if (env.EMAIL_APP_PASSWORD && env.SMTP_PASS && env.EMAIL_APP_PASSWORD !== env.SMTP_PASS) {
    warnings.push(
      `EMAIL_APP_PASSWORD and SMTP_PASS are both set but differ. Using EMAIL_APP_PASSWORD.`
    );
  }

  // Check for deprecated SMTP_ vars that should be migrated
  const deprecated = ["SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_HOST", "SMTP_PORT"];
  for (const key of deprecated) {
    if (env[key]) {
      warnings.push(
        `Deprecated env var ${key} is set. Migrate to canonical names (EMAIL_USER, EMAIL_APP_PASSWORD, etc).`
      );
    }
  }

  return warnings;
}

// ── Convenience helpers ───────────────────────────────────────────────

/**
 * Get Webflow API headers using the canonical config.
 * Throws if WEBFLOW_API_TOKEN is missing.
 *
 * @param {PipelineConfig} [cfg] - Optional config (loads fresh if not provided)
 * @returns {{ Authorization: string, "Content-Type": string, accept: string }}
 */
export function getWebflowHeaders(cfg) {
  const config = cfg || loadConfig();
  if (!config.webflow.apiToken) {
    throw new Error("Missing WEBFLOW_API_TOKEN environment variable.");
  }
  return {
    Authorization: `Bearer ${config.webflow.apiToken}`,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}
