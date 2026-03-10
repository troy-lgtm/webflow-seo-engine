/**
 * Publish governor — enforces ramp policy, rate limits, and kill switch.
 * Reads data/ramp_policy.json for configuration.
 * Checks PUBLISH_KILL_SWITCH env var for emergency halt.
 */
import policy from "@/data/ramp_policy.json";

/**
 * Rule IDs:
 *   GOV-KILL-01:     Kill switch is active
 *   GOV-WAVE-01:     Current wave page limit exceeded
 *   GOV-DAILY-01:    Daily publish limit exceeded
 *   GOV-WEEKLY-01:   Weekly publish limit exceeded
 *   GOV-COOLDOWN-01: Cooldown period not elapsed
 *   GOV-INDEX-01:    Indexation threshold not met for next wave
 *   GOV-PREVIEW-01:  Preview verification required but not provided
 */

/**
 * Return the raw policy object (useful for tests and introspection).
 * @returns {object}
 */
export function getPolicy() {
  return policy;
}

/**
 * Check if the kill switch is active.
 * @returns {boolean}
 */
export function isKillSwitchActive() {
  const val = process.env.PUBLISH_KILL_SWITCH;
  return val === "true" || val === "1" || val === "yes";
}

/**
 * Determine the current wave based on published page count.
 * Waves are evaluated in descending order so the highest qualifying wave is
 * selected. If publishedCount is 0, wave 1 is returned.
 *
 * @param {number} publishedCount — number of currently published pages
 * @returns {{ wave: object, waveNumber: number, nextWave: object|null }}
 */
export function getCurrentWave(publishedCount) {
  const waves = policy.waves;

  // Walk backwards to find the highest wave whose maxPages we haven't exceeded
  // (or whose maxPages we are still filling).  Wave 1 is the floor.
  let matched = waves[0];
  for (let i = waves.length - 1; i >= 0; i--) {
    const prev = waves[i - 1];
    // If there is no previous wave we're at wave 1 — always matches.
    // Otherwise, the current wave applies once the previous wave's cap is met.
    if (!prev || publishedCount >= prev.maxPages) {
      matched = waves[i];
      break;
    }
  }

  const waveNumber = matched.wave;
  const nextWave = waves.find((w) => w.wave === waveNumber + 1) || null;

  return { wave: matched, waveNumber, nextWave };
}

/**
 * Run the full publish governor check.
 *
 * @param {object} context
 * @param {number} context.publishedCount     — total currently published pages
 * @param {number} context.newPageCount       — number of pages being published in this batch
 * @param {number} context.publishedToday     — pages published today
 * @param {number} context.publishedThisWeek  — pages published this week
 * @param {number} context.lastPublishTimestamp — Unix timestamp (ms) of last publish
 * @param {number} context.indexedCount       — number of indexed pages (from GSC or manual check)
 * @param {boolean} context.previewVerified   — whether staging preview was verified
 * @returns {{ pass: boolean, violations: Array<{rule_id: string, detail: string, severity: string}>, currentWave: object, policyVersion: string }}
 */
export function runGovernorCheck(context) {
  const {
    publishedCount,
    newPageCount,
    publishedToday,
    publishedThisWeek,
    lastPublishTimestamp,
    indexedCount,
    previewVerified,
  } = context;

  const violations = [];

  // ── GOV-KILL-01: Kill switch ──────────────────────────────────────────
  if (isKillSwitchActive()) {
    violations.push({
      rule_id: "GOV-KILL-01",
      detail: "Kill switch is active (PUBLISH_KILL_SWITCH env var is set). All publishing is halted.",
      severity: "block",
    });
  }

  // ── Determine current wave ────────────────────────────────────────────
  const { wave: currentWave, nextWave } = getCurrentWave(publishedCount);

  // ── GOV-WAVE-01: Wave page limit ─────────────────────────────────────
  if (publishedCount + newPageCount > currentWave.maxPages) {
    violations.push({
      rule_id: "GOV-WAVE-01",
      detail: `Publishing ${newPageCount} page(s) would bring total to ${publishedCount + newPageCount}, exceeding wave ${currentWave.wave} ("${currentWave.label}") limit of ${currentWave.maxPages}.`,
      severity: "block",
    });
  }

  // ── GOV-DAILY-01: Daily limit ─────────────────────────────────────────
  if (publishedToday + newPageCount > policy.limits.maxPublishPerDay) {
    violations.push({
      rule_id: "GOV-DAILY-01",
      detail: `Publishing ${newPageCount} page(s) would bring today's total to ${publishedToday + newPageCount}, exceeding daily limit of ${policy.limits.maxPublishPerDay}.`,
      severity: "block",
    });
  }

  // ── GOV-WEEKLY-01: Weekly limit ───────────────────────────────────────
  if (publishedThisWeek + newPageCount > policy.limits.maxPublishPerWeek) {
    violations.push({
      rule_id: "GOV-WEEKLY-01",
      detail: `Publishing ${newPageCount} page(s) would bring this week's total to ${publishedThisWeek + newPageCount}, exceeding weekly limit of ${policy.limits.maxPublishPerWeek}.`,
      severity: "block",
    });
  }

  // ── GOV-COOLDOWN-01: Cooldown ─────────────────────────────────────────
  if (lastPublishTimestamp) {
    const elapsed = Date.now() - lastPublishTimestamp;
    const cooldownMs = policy.limits.cooldownMinutes * 60 * 1000;
    if (elapsed < cooldownMs) {
      const remainingMin = Math.ceil((cooldownMs - elapsed) / 60_000);
      violations.push({
        rule_id: "GOV-COOLDOWN-01",
        detail: `Cooldown period has not elapsed. ${remainingMin} minute(s) remaining of the ${policy.limits.cooldownMinutes}-minute cooldown.`,
        severity: "warn",
      });
    }
  }

  // ── GOV-INDEX-01: Indexation threshold (informational) ────────────────
  if (nextWave && publishedCount > 0) {
    const indexedPct = indexedCount / publishedCount;
    if (indexedPct < policy.indexation.minIndexedPctForNextWave) {
      violations.push({
        rule_id: "GOV-INDEX-01",
        detail: `Indexation rate is ${(indexedPct * 100).toFixed(1)}% (${indexedCount}/${publishedCount}), below the ${policy.indexation.minIndexedPctForNextWave * 100}% threshold required to advance to wave ${nextWave.wave} ("${nextWave.label}").`,
        severity: "info",
      });
    }
  }

  // ── GOV-PREVIEW-01: Preview verification ──────────────────────────────
  if (policy.limits.requireVerifiedPreview && !previewVerified) {
    violations.push({
      rule_id: "GOV-PREVIEW-01",
      detail: "Staging preview verification is required before publishing but has not been completed.",
      severity: "block",
    });
  }

  // ── Verdict ───────────────────────────────────────────────────────────
  const pass = !violations.some((v) => v.severity === "block");

  return {
    pass,
    violations,
    currentWave,
    policyVersion: policy.version,
  };
}
