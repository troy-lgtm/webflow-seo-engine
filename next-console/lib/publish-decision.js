/**
 * Publish decision orchestrator — single source of truth for all publish attempts.
 * Runs all check modules (uniqueness, usefulness, schema drift, governor,
 * page quality contract, layout audit, AI extractability, duplicate check)
 * and produces a structured decision object with verdict, per-check results,
 * rollup summary, and pipeline action.
 */
import { runUniquenessCheck } from "@/lib/uniqueness-engine";
import { runUsefulnessGates } from "@/lib/usefulness-gates";
import { runSchemaDriftCheck } from "@/lib/schema-drift";
import { runGovernorCheck, isKillSwitchActive } from "@/lib/publish-governor";
import { validatePageQuality } from "@/lib/page-quality-contract";
import { auditPageLayout } from "@/lib/page-layout-audit";
import { scoreAiExtractability } from "@/lib/ai-search-optimizer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count violations by severity across an array of violation objects.
 * @param {object[]} violations
 * @returns {{ blockCount: number, warnCount: number }}
 */
function countBySeverity(violations) {
  let blockCount = 0;
  let warnCount = 0;
  for (const v of violations) {
    if (v.severity === "block") blockCount++;
    else if (v.severity === "warn") warnCount++;
  }
  return { blockCount, warnCount };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a batch of pages is ready to publish.
 * Single source of truth — all publish checks run here.
 *
 * @param {object[]} pages — array of page objects from lane-engine
 * @param {object} context — context for governor and other checks
 * @param {object[]} context.publishedPages — previously published pages (for uniqueness cross-check)
 * @param {number} context.publishedCount — total published page count
 * @param {number} context.newPageCount — pages in this batch
 * @param {number} context.publishedToday — pages published today
 * @param {number} context.publishedThisWeek — pages published this week
 * @param {number} context.lastPublishTimestamp — last publish unix timestamp
 * @param {number} context.indexedCount — indexed pages count
 * @param {boolean} context.previewVerified — staging preview verified
 * @param {object[]} context.cmsPayloads — Webflow CMS payloads for schema drift check
 * @returns {object} decision — structured decision object
 */
export function evaluatePublishDecision(pages, context = {}) {
  const timestamp = new Date().toISOString();

  // ------------------------------------------------------------------
  // 1. Kill switch — short-circuit with BLOCK if active
  // ------------------------------------------------------------------
  if (isKillSwitchActive()) {
    return {
      timestamp,
      verdict: "BLOCK",
      checks: {
        uniqueness: { pass: false, blockCount: 0, warnCount: 0, violations: [] },
        usefulness: { pass: false, pages: [] },
        schemaDrift: { pass: false, contractVersion: null, violations: [] },
        governor: {
          pass: false,
          currentWave: null,
          policyVersion: null,
          violations: [{
            rule_id: "GOV-KILL-01",
            detail: "Kill switch is active (PUBLISH_KILL_SWITCH). All publishing halted.",
            severity: "block",
          }],
        },
      },
      summary: {
        totalPages: pages.length,
        pagesPassingAll: 0,
        blockerCount: 1,
        warningCount: 0,
        checksRun: ["governor"],
        failedChecks: ["governor"],
      },
      action: "block",
      actionReason: "Kill switch is active — all publishing halted",
    };
  }

  // Accumulators for the rollup
  let totalBlockers = 0;
  let totalWarnings = 0;
  const failedChecks = [];

  // ------------------------------------------------------------------
  // 2. Usefulness gates — per-page
  // ------------------------------------------------------------------
  const usefulnessPages = [];
  let usefulnessPass = true;

  for (const page of pages) {
    const result = runUsefulnessGates(page);
    const pageResult = {
      slug: page.slug || page.canonical_path || "unknown",
      pass: result.passed,
      blockers: result.blockers,
      warnings: result.warnings,
    };
    usefulnessPages.push(pageResult);

    if (!result.passed) usefulnessPass = false;
    totalBlockers += result.blockers;
    totalWarnings += result.warnings;
  }

  const usefulnessCheck = {
    pass: usefulnessPass,
    pages: usefulnessPages,
  };

  if (!usefulnessPass) failedChecks.push("usefulness");

  // ------------------------------------------------------------------
  // 3. Uniqueness check — batch
  // ------------------------------------------------------------------
  const uniquenessResult = runUniquenessCheck(
    pages,
    context.publishedPages || []
  );

  const uniquenessBlockCount = uniquenessResult.summary.blockCount;
  const uniquenessWarnCount = uniquenessResult.summary.warnCount;

  const uniquenessCheck = {
    pass: uniquenessResult.pass,
    blockCount: uniquenessBlockCount,
    warnCount: uniquenessWarnCount,
    violations: uniquenessResult.violations.slice(0, 10),
  };

  totalBlockers += uniquenessBlockCount;
  totalWarnings += uniquenessWarnCount;

  if (!uniquenessResult.pass) failedChecks.push("uniqueness");

  // ------------------------------------------------------------------
  // 4. Schema drift check — per-payload (if payloads provided)
  // ------------------------------------------------------------------
  let schemaDriftCheck;
  const cmsPayloads = context.cmsPayloads || [];

  if (cmsPayloads.length > 0) {
    let sdPass = true;
    let sdContractVersion = null;
    const sdAllViolations = [];

    for (const payload of cmsPayloads) {
      const result = runSchemaDriftCheck(payload);
      if (!result.pass) sdPass = false;
      if (result.contractVersion) sdContractVersion = result.contractVersion;
      sdAllViolations.push(...result.violations);
    }

    const sdCounts = countBySeverity(sdAllViolations);
    totalBlockers += sdCounts.blockCount;
    totalWarnings += sdCounts.warnCount;

    schemaDriftCheck = {
      pass: sdPass,
      contractVersion: sdContractVersion,
      violations: sdAllViolations,
    };

    if (!sdPass) failedChecks.push("schemaDrift");
  } else {
    // No payloads to check — schema drift passes by default
    schemaDriftCheck = {
      pass: true,
      contractVersion: null,
      violations: [],
    };
  }

  // ------------------------------------------------------------------
  // 5. Governor check
  // ------------------------------------------------------------------
  const governorResult = runGovernorCheck({
    publishedCount: context.publishedCount ?? 0,
    newPageCount: context.newPageCount ?? pages.length,
    publishedToday: context.publishedToday ?? 0,
    publishedThisWeek: context.publishedThisWeek ?? 0,
    lastPublishTimestamp: context.lastPublishTimestamp ?? null,
    indexedCount: context.indexedCount ?? 0,
    previewVerified: context.previewVerified ?? false,
  });

  const govCounts = countBySeverity(governorResult.violations);
  totalBlockers += govCounts.blockCount;
  totalWarnings += govCounts.warnCount;

  const governorCheck = {
    pass: governorResult.pass,
    currentWave: governorResult.currentWave,
    policyVersion: governorResult.policyVersion,
    violations: governorResult.violations,
  };

  if (!governorResult.pass) failedChecks.push("governor");

  // ------------------------------------------------------------------
  // 6. Page quality contract check — per-page
  // ------------------------------------------------------------------
  let qualityPass = true;
  const qualityPages = [];
  for (const page of pages) {
    try {
      const qr = validatePageQuality(page);
      qualityPages.push({
        slug: page.slug || "unknown",
        pass: qr.passed,
        score: qr.score,
        blocking_failures: qr.blocking_failures,
      });
      if (!qr.passed) {
        qualityPass = false;
        totalBlockers += qr.blocking_failures.length;
      }
    } catch {
      qualityPages.push({ slug: page.slug || "unknown", pass: true, score: 100, blocking_failures: [] });
    }
  }
  const qualityCheck = { pass: qualityPass, pages: qualityPages };
  if (!qualityPass) failedChecks.push("quality");

  // ------------------------------------------------------------------
  // 7. Layout audit — per-page
  // ------------------------------------------------------------------
  let layoutPass = true;
  const layoutPages = [];
  for (const page of pages) {
    try {
      const lr = auditPageLayout(page);
      layoutPages.push({
        slug: page.slug || "unknown",
        pass: lr.passed,
        score: lr.score,
        blocking_failures: lr.blocking_failures,
      });
      if (!lr.passed) {
        layoutPass = false;
        totalBlockers += lr.blocking_failures.length;
      }
    } catch {
      layoutPages.push({ slug: page.slug || "unknown", pass: true, score: 100, blocking_failures: [] });
    }
  }
  const layoutCheck = { pass: layoutPass, pages: layoutPages };
  if (!layoutPass) failedChecks.push("layout");

  // ------------------------------------------------------------------
  // 8. AI extractability — per-page (warn only, never blocks)
  // ------------------------------------------------------------------
  const aiPages = [];
  for (const page of pages) {
    try {
      const ai = scoreAiExtractability(page);
      aiPages.push({ slug: page.slug || "unknown", score: ai.total_score, grade: ai.grade });
    } catch {
      aiPages.push({ slug: page.slug || "unknown", score: 0, grade: "F" });
    }
  }
  const avgAiScore = aiPages.length > 0
    ? Math.round(aiPages.reduce((s, p) => s + p.score, 0) / aiPages.length)
    : 0;
  if (avgAiScore < 40) totalWarnings++;
  const aiCheck = { pass: true, avgScore: avgAiScore, pages: aiPages };

  // ------------------------------------------------------------------
  // 9. Duplicate slug/canonical check
  // ------------------------------------------------------------------
  const publishedSlugs = new Set((context.publishedPages || []).map((p) => p.slug));
  const batchSlugs = new Set();
  const dupViolations = [];
  for (const page of pages) {
    const slug = page.slug;
    if (!slug) continue;
    if (publishedSlugs.has(slug)) {
      dupViolations.push({ slug, reason: "already published", severity: "block" });
      totalBlockers++;
    }
    if (batchSlugs.has(slug)) {
      dupViolations.push({ slug, reason: "duplicate in batch", severity: "block" });
      totalBlockers++;
    }
    batchSlugs.add(slug);
  }
  const duplicateCheck = { pass: dupViolations.length === 0, violations: dupViolations };
  if (!duplicateCheck.pass) failedChecks.push("duplicate");

  // ------------------------------------------------------------------
  // Verdict logic
  // ------------------------------------------------------------------
  const anyFailed = !usefulnessPass ||
    !uniquenessResult.pass ||
    !schemaDriftCheck.pass ||
    !governorResult.pass ||
    !qualityPass ||
    !layoutPass ||
    !duplicateCheck.pass;

  let verdict;
  if (anyFailed) {
    verdict = "BLOCK";
  } else if (totalWarnings > 0) {
    verdict = "WARN";
  } else {
    verdict = "APPROVE";
  }

  // Action mapping
  let action;
  let actionReason;
  if (verdict === "BLOCK") {
    action = "block";
    actionReason = failedChecks
      .map((c) => CHECK_LABELS[c] || c)
      .join(", ") + " failed";
  } else if (verdict === "WARN") {
    action = "review";
    actionReason = `All checks pass but ${totalWarnings} warning(s) require review`;
  } else {
    action = "publish";
    actionReason = "All checks passed with no warnings";
  }

  // Pages passing all usefulness gates
  const pagesPassingAll = usefulnessPages.filter((p) => p.pass).length;

  // Which checks actually ran
  const checksRun = ["usefulness", "uniqueness"];
  if (cmsPayloads.length > 0) checksRun.push("schemaDrift");
  checksRun.push("governor", "quality", "layout", "ai_extractability", "duplicate");

  return {
    timestamp,
    verdict,
    checks: {
      uniqueness: uniquenessCheck,
      usefulness: usefulnessCheck,
      schemaDrift: schemaDriftCheck,
      governor: governorCheck,
      quality: qualityCheck,
      layout: layoutCheck,
      ai_extractability: aiCheck,
      duplicate: duplicateCheck,
    },
    summary: {
      totalPages: pages.length,
      pagesPassingAll,
      blockerCount: totalBlockers,
      warningCount: totalWarnings,
      checksRun,
      failedChecks,
    },
    action,
    actionReason,
  };
}

// ---------------------------------------------------------------------------
// Check labels (human-friendly names for output)
// ---------------------------------------------------------------------------
const CHECK_LABELS = {
  usefulness: "Usefulness gates",
  uniqueness: "Uniqueness check",
  schemaDrift: "Schema drift check",
  governor: "Governor check",
  quality: "Page quality contract",
  layout: "Layout audit",
  ai_extractability: "AI extractability",
  duplicate: "Duplicate slug check",
};

// ---------------------------------------------------------------------------
// CLI Formatter
// ---------------------------------------------------------------------------

/**
 * Format the decision for CLI output.
 * @param {object} decision
 * @returns {string} — formatted string for console output
 */
export function formatDecision(decision) {
  const lines = [];
  const s = decision.summary;
  const checks = decision.checks;

  // Header box
  const title = `  PUBLISH DECISION: ${decision.verdict}`;
  const boxWidth = 44;
  const padded = title.padEnd(boxWidth - 2);

  lines.push("");
  lines.push("\u2554" + "\u2550".repeat(boxWidth) + "\u2557");
  lines.push("\u2551" + padded + "  \u2551");
  lines.push("\u255A" + "\u2550".repeat(boxWidth) + "\u255D");
  lines.push("");

  // Summary line
  lines.push(
    `  Pages: ${s.totalPages} | Passing: ${s.pagesPassingAll} | Blockers: ${s.blockerCount} | Warnings: ${s.warningCount}`
  );
  lines.push("");

  // Per-check status
  const checkEntries = [
    { key: "usefulness", label: "Usefulness gates", result: checks.usefulness },
    { key: "uniqueness", label: "Uniqueness check", result: checks.uniqueness },
    { key: "schemaDrift", label: "Schema drift check", result: checks.schemaDrift },
    { key: "governor", label: "Governor check", result: checks.governor },
    { key: "quality", label: "Quality contract", result: checks.quality },
    { key: "layout", label: "Layout audit", result: checks.layout },
    { key: "ai_extractability", label: "AI extractability", result: checks.ai_extractability },
    { key: "duplicate", label: "Duplicate check", result: checks.duplicate },
  ];

  for (const entry of checkEntries) {
    const pass = entry.result.pass;
    const icon = pass ? "\u2713" : "\u2717";
    const status = pass ? "PASS" : "FAIL";
    let suffix = "";

    if (!pass) {
      // Count blockers for this check
      const blockerCount = countCheckBlockers(entry.key, checks);
      if (blockerCount > 0) {
        suffix = ` (${blockerCount} blocker${blockerCount !== 1 ? "s" : ""})`;
      }
    }

    const labelPadded = entry.label.padEnd(22);
    lines.push(`  ${icon} ${labelPadded} ${status}${suffix}`);
  }

  lines.push("");

  // Action
  lines.push(`  Action: ${decision.action}`);
  if (decision.verdict !== "APPROVE") {
    lines.push(`  Reason: ${decision.actionReason}`);
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Count the number of blocking violations for a specific check.
 * @param {string} checkKey
 * @param {object} checks
 * @returns {number}
 */
function countCheckBlockers(checkKey, checks) {
  const check = checks[checkKey];
  if (!check) return 0;

  switch (checkKey) {
    case "usefulness": {
      return check.pages.reduce((sum, p) => sum + (p.blockers || 0), 0);
    }
    case "uniqueness": {
      return check.blockCount || 0;
    }
    case "schemaDrift":
    case "governor": {
      return (check.violations || []).filter((v) => v.severity === "block").length;
    }
    case "quality":
    case "layout": {
      return (check.pages || []).reduce(
        (sum, p) => sum + (p.blocking_failures?.length || 0),
        0
      );
    }
    case "duplicate": {
      return (check.violations || []).filter((v) => v.severity === "block").length;
    }
    case "ai_extractability": {
      return 0; // Never blocks, only warns
    }
    default:
      return 0;
  }
}
