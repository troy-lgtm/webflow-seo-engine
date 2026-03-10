#!/usr/bin/env node
/**
 * ⚠️  DEPRECATED — Use lanes_auto_publish.js with --cluster flag instead.
 *
 *   npm run lanes:factory -- --count=N --cluster=chicago-dallas-atlanta --notify=troy@wearewarp.com
 *
 * This script is retained for backward compatibility only.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Publish Cluster
 * Publishes lanes from the launch cluster in priority order.
 * Wraps publish_next.js with cluster-first targeting.
 *
 * Usage:
 *   node scripts/publish_cluster.js [--count N] [--dry-run]
 *   npm run publish:cluster
 *   npm run publish:cluster:dry
 */

import "dotenv/config";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DRY_RUN = process.argv.includes("--dry-run");
const countIdx = process.argv.indexOf("--count");
const COUNT = countIdx >= 0 ? parseInt(process.argv[countIdx + 1], 10) || 15 : 15;

function main() {
  console.log("=== Publish Cluster ===");
  console.log(`  Count:   ${COUNT}`);
  console.log(`  Mode:    ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log("");

  const args = [
    `--count ${COUNT}`,
    "--cluster chicago-dallas-atlanta",
    DRY_RUN ? "--dry-run" : "",
    "--allow-empty-webflow-slugs",
  ].filter(Boolean).join(" ");

  const cmd = `node scripts/publish_next.js ${args}`;
  console.log(`  Running: ${cmd}`);
  console.log("");

  try {
    execSync(cmd, { cwd: ROOT, stdio: "inherit", timeout: 300000 });
  } catch (err) {
    if (err.status === 2) {
      console.log("\n  ⚠  Inventory exhausted before reaching target count.");
    } else {
      console.error("\n  ✗ Publish failed:", err.message);
      process.exit(1);
    }
  }

  // Run report
  console.log("\n  Running published-today report...");
  try {
    execSync("node scripts/report_published_today.js", { cwd: ROOT, stdio: "inherit" });
  } catch { /* non-fatal */ }
}

main();
