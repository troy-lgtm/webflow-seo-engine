#!/usr/bin/env node

/**
 * check-artifacts — Quick sanity check for artifact file system assumptions
 *
 * Validates:
 *   1. Project root can be resolved
 *   2. Key artifact files exist and parse as JSON
 *   3. Prints absolute paths and status
 *
 * Usage:
 *   node scripts/check-artifacts.js
 *   npm run check:artifacts
 */

import { getProjectRoot, resolveFromRoot } from "../lib/fs/project-root.js";
import { probeArtifact } from "../lib/artifacts/load-artifact.js";

function main() {
  console.log("=== Artifact Sanity Check ===\n");

  // 1. Project root
  let root;
  try {
    root = getProjectRoot();
    console.log(`  Project root:  ${root}`);
  } catch (err) {
    console.error(`  ✗ Project root: FAILED\n    ${err.message}`);
    process.exit(1);
  }

  console.log(`  process.cwd(): ${process.cwd()}\n`);

  // 2. Probe key artifacts
  const files = [
    "artifacts/publish_decision.json",
    "artifacts/lane_registry_snapshot.json",
    "artifacts/corridor_snapshot.json",
    "config/seo-engine.json",
    "data/corridors.json",
    "data/lane_inventory.json",
    "data/demand/gsc.json",
    "data/demand/keywords.json",
    "data/demand/portal_quotes.json",
  ];

  let allOk = true;

  for (const rel of files) {
    const probe = probeArtifact(rel);
    const status = probe.exists
      ? probe.parsed
        ? `✓ exists, valid JSON (${probe.bytes} bytes)`
        : `⚠ exists but invalid JSON (${probe.bytes} bytes)`
      : `✗ missing`;
    const icon = probe.exists && probe.parsed ? "  " : "  ";
    console.log(`${icon}${rel}`);
    console.log(`     ${status}`);
    console.log(`     ${probe.path}`);
    console.log();

    if (!probe.exists) allOk = false;
  }

  // 3. Summary
  console.log("─────────────────────────────────────────────────────");
  if (allOk) {
    console.log("  All artifacts found and valid.");
  } else {
    console.log("  Some artifacts missing. Run 'npm run snapshots:seo' to generate.");
  }
  console.log();
}

main();
