/**
 * Approve Lane — Set lane approval state from the command line
 *
 * Usage:
 *   node scripts/approve_lane.js --slug chicago-to-dallas --mode LTL --by troy
 *   node scripts/approve_lane.js --slug chicago-to-dallas --mode LTL --by troy --note "Priority corridor"
 *   node scripts/approve_lane.js --slug chicago-to-dallas --mode LTL --state blocked --reason "duplicate content" --by troy
 *   node scripts/approve_lane.js --batch --file data/approved_batch.txt --by troy
 *   node scripts/approve_lane.js --batch --file data/approved_batch.txt --by troy --note "Wave 1 batch"
 *
 * Batch file format (one per line):
 *   chicago-to-dallas LTL
 *   atlanta-to-houston LTL
 *   los-angeles-to-phoenix FTL
 *
 * npm shortcuts:
 *   npm run approve:lane -- --slug chicago-to-dallas --mode LTL --by troy
 *   npm run approve:lane:batch -- --file data/approved_batch.txt --by troy
 */

import fs from "fs";
import { transitionState, batchTransitionState, VALID_STATES } from "../lib/approval-gate.js";

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--slug" && args[i + 1]) { opts.slug = args[++i]; continue; }
    if (arg === "--mode" && args[i + 1]) { opts.mode = args[++i]; continue; }
    if (arg === "--by" && args[i + 1]) { opts.by = args[++i]; continue; }
    if (arg === "--note" && args[i + 1]) { opts.note = args[++i]; continue; }
    if (arg === "--state" && args[i + 1]) { opts.state = args[++i]; continue; }
    if (arg === "--reason" && args[i + 1]) { opts.reason = args[++i]; continue; }
    if (arg === "--rule-id" && args[i + 1]) { opts.rule_id = args[++i]; continue; }
    if (arg === "--file" && args[i + 1]) { opts.file = args[++i]; continue; }
    if (arg === "--batch") { opts.batch = true; continue; }
  }

  return opts;
}

function main() {
  const opts = parseArgs(process.argv);
  const targetState = opts.state || "approved";

  if (!opts.by) {
    console.error("ERROR: --by is required (who is approving)");
    console.error("  Example: --by troy");
    process.exit(1);
  }

  if (!VALID_STATES.includes(targetState)) {
    console.error(`ERROR: Invalid state "${targetState}". Valid: ${VALID_STATES.join(", ")}`);
    process.exit(1);
  }

  // ── Batch mode ──
  if (opts.batch) {
    if (!opts.file) {
      console.error("ERROR: --batch requires --file <path>");
      console.error("  Example: --batch --file data/approved_batch.txt");
      process.exit(1);
    }
    if (!fs.existsSync(opts.file)) {
      console.error(`ERROR: File not found: ${opts.file}`);
      process.exit(1);
    }

    const lines = fs.readFileSync(opts.file, "utf-8")
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"));

    const lanes = lines.map(line => {
      const parts = line.split(/\s+/);
      return { slug: parts[0], mode: parts[1] || "LTL" };
    });

    if (lanes.length === 0) {
      console.error("ERROR: No lanes found in batch file");
      process.exit(1);
    }

    console.log(`\nBatch ${targetState}: ${lanes.length} lanes (by ${opts.by})`);
    const result = batchTransitionState(lanes, targetState, {
      by: opts.by,
      note: opts.note || "",
    });

    console.log(`  Updated: ${result.updated}`);
    console.log(`  Skipped: ${result.skipped}`);
    if (result.warnings.length > 0) {
      for (const w of result.warnings) {
        console.log(`  WARNING: ${w}`);
      }
    }
    console.log("");
    return;
  }

  // ── Single lane mode ──
  if (!opts.slug) {
    console.error("ERROR: --slug is required");
    console.error("  Example: --slug chicago-to-dallas --mode LTL --by troy");
    console.error("  Batch:   --batch --file data/approved_batch.txt --by troy");
    process.exit(1);
  }

  const mode = opts.mode || "LTL";
  console.log(`\nTransition: ${opts.slug} (${mode}) → ${targetState} (by ${opts.by})`);

  const result = transitionState(opts.slug, mode, targetState, {
    by: opts.by,
    note: opts.note || "",
    reason: opts.reason || "",
    rule_id: opts.rule_id || "",
  });

  if (result.success) {
    console.log(`  OK: ${result.entry.slug} (${result.entry.mode}) → ${result.entry.state}`);
    if (result.entry.approved_at) {
      console.log(`  Approved at: ${result.entry.approved_at}`);
    }
    if (result.entry.approval_note) {
      console.log(`  Note: ${result.entry.approval_note}`);
    }
  } else {
    console.error(`  FAILED: ${result.warnings.join("; ")}`);
    process.exit(1);
  }

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.log(`  WARNING: ${w}`);
    }
  }
  console.log("");
}

main();
