/**
 * List Approved Pages — Publish Eligibility Report
 *
 * Shows exactly which lane pages are eligible to publish, which are excluded,
 * and why. One command, no ambiguity.
 *
 * Usage:
 *   npm run publish:approved:list                 # human-readable report
 *   npm run publish:approved:list -- --json       # machine-readable JSON
 *   npm run publish:approved:list -- --mode LTL   # filter by mode
 */

import { computePublishEligibility } from "../lib/approval-gate.js";

function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const modeIdx = args.indexOf("--mode");
  const modeFilter = modeIdx >= 0 && args[modeIdx + 1] ? args[modeIdx + 1] : null;

  const result = computePublishEligibility();

  // Apply mode filter if specified
  if (modeFilter) {
    result.approved_eligible = result.approved_eligible.filter(e => e.mode === modeFilter);
    result.excluded = result.excluded.filter(e => e.mode === modeFilter);
    result.already_live = result.already_live.filter(e => e.mode === modeFilter);
    result.blocked = result.blocked.filter(e => e.mode === modeFilter);
    result.failed = result.failed.filter(e => e.mode === modeFilter);
    result.pending_verification = result.pending_verification.filter(e => e.mode === modeFilter);
    // Recalculate totals after filter
    result.totals = {
      approved: result.approved_eligible.length,
      excluded: result.excluded.length,
      live: result.already_live.length,
      blocked: result.blocked.length,
      failed: result.failed.length,
      draft: result.draft,
      ready_for_review: result.ready_for_review,
      pending_verification: result.pending_verification.length,
    };
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // ── Human-readable report ──

  console.log("");
  console.log("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
  console.log("\u2551  PUBLISH ELIGIBILITY REPORT                      \u2551");
  if (modeFilter) {
    console.log(`\u2551  Mode filter: ${modeFilter.padEnd(35)}\u2551`);
  }
  console.log("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");

  // Section 1: Approved & Eligible
  console.log("");
  console.log(`\u2500\u2500 Approved & Eligible to Publish (${result.approved_eligible.length}) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  if (result.approved_eligible.length === 0) {
    console.log("  (none)");
  } else {
    for (const p of result.approved_eligible) {
      const approver = p.approved_by ? `approved by ${p.approved_by}` : "approved";
      const date = p.approved_at ? ` at ${p.approved_at.split("T")[0]}` : "";
      const note = p.approval_note ? ` \u2014 ${p.approval_note}` : "";
      console.log(`  ${p.slug} (${p.mode})    ${approver}${date}${note}`);
    }
  }

  // Section 2: Excluded (approved but blocked by duplicates)
  if (result.excluded.length > 0) {
    console.log("");
    console.log(`\u2500\u2500 Excluded (${result.excluded.length}) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    for (const p of result.excluded) {
      console.log(`  ${p.slug} (${p.mode})    ${p.exclusion_reason}`);
    }
  }

  // Section 3: Already Live
  if (result.already_live.length > 0) {
    console.log("");
    console.log(`\u2500\u2500 Already Live (${result.already_live.length}) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    for (const p of result.already_live) {
      const since = p.state_changed_at ? `verified_live since ${p.state_changed_at.split("T")[0]}` : "verified_live";
      console.log(`  ${p.slug} (${p.mode})    ${since}`);
    }
  }

  // Section 4: Pending Verification
  if (result.pending_verification.length > 0) {
    console.log("");
    console.log(`\u2500\u2500 Pending Verification (${result.pending_verification.length}) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    for (const p of result.pending_verification) {
      console.log(`  ${p.slug} (${p.mode})    published, awaiting live check`);
    }
  }

  // Section 5: Blocked
  if (result.blocked.length > 0) {
    console.log("");
    console.log(`\u2500\u2500 Blocked (${result.blocked.length}) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    for (const p of result.blocked) {
      const reason = p.excluded_reason || "blocked";
      const ruleId = p.blocked_rule_id ? ` [${p.blocked_rule_id}]` : "";
      console.log(`  ${p.slug} (${p.mode})    ${reason}${ruleId}`);
    }
  }

  // Section 6: Failed
  if (result.failed.length > 0) {
    console.log("");
    console.log(`\u2500\u2500 Failed (${result.failed.length}) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    for (const p of result.failed) {
      const reason = p.excluded_reason || "publish failed";
      console.log(`  ${p.slug} (${p.mode})    ${reason}`);
    }
  }

  // Section 7: Totals
  console.log("");
  console.log("\u2500\u2500 Totals \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  const t = result.totals;
  console.log(`  draft                    ${String(t.draft).padStart(6)}`);
  console.log(`  ready_for_review         ${String(t.ready_for_review).padStart(6)}`);
  console.log(`  approved (eligible)      ${String(t.approved).padStart(6)}`);
  console.log(`  approved (excluded)      ${String(t.excluded).padStart(6)}`);
  console.log(`  pending_verification     ${String(t.pending_verification).padStart(6)}`);
  console.log(`  verified_live            ${String(t.live).padStart(6)}`);
  console.log(`  failed                   ${String(t.failed).padStart(6)}`);
  console.log(`  blocked                  ${String(t.blocked).padStart(6)}`);
  console.log("");
}

main();
