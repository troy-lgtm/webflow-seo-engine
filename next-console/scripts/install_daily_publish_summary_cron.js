#!/usr/bin/env node

/**
 * Install Daily Publish Summary Cron
 *
 * Prints (and optionally installs) a cron entry that runs every day at 7:00 PM
 * local time, sending the daily publish summary email.
 *
 * Usage:
 *   node scripts/install_daily_publish_summary_cron.js           (print only)
 *   node scripts/install_daily_publish_summary_cron.js --install (install to crontab)
 *
 * The cron job:
 *   1) sets PATH for node/npm
 *   2) cd into repo
 *   3) runs the summary script
 *   4) appends logs to artifacts/cron_daily_publish_summary.log
 */

import { fileURLToPath } from "url";
import path from "path";
import { execSync } from "child_process";
import { getProjectRoot } from "../lib/fs/project-root.js";

const ROOT = getProjectRoot();
const INSTALL = process.argv.includes("--install");

// Detect node path
const nodePath = process.execPath;
const nodeBinDir = path.dirname(nodePath);

// Build cron line: 7:00 PM every day = minute 0, hour 19
const cronSchedule = "0 19 * * *";
const logFile = path.join(ROOT, "artifacts", "cron_daily_publish_summary.log");
const scriptPath = path.join(ROOT, "scripts", "send_daily_publish_summary.js");

const cronLine = `${cronSchedule} cd ${ROOT} && PATH=${nodeBinDir}:$PATH node ${scriptPath} >> ${logFile} 2>&1`;

const cronComment = "# Warp SEO Daily Publish Summary — 7:00 PM local";

console.log("=== Warp SEO Daily Publish Summary — Cron Setup ===");
console.log("");
console.log("Schedule: Every day at 7:00 PM local time");
console.log("");
console.log("Add this line to your crontab (crontab -e):");
console.log("");
console.log(cronComment);
console.log(cronLine);
console.log("");
console.log("Log output: " + logFile);
console.log("");

if (INSTALL) {
  try {
    // Get existing crontab
    let existing = "";
    try {
      existing = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
    } catch {
      existing = "";
    }

    // Check if already installed
    if (existing.includes("send_daily_publish_summary")) {
      console.log("✓ Cron entry already exists. No changes made.");
      process.exit(0);
    }

    // Append new entry
    const newCrontab = existing.trimEnd() + "\n" + cronComment + "\n" + cronLine + "\n";
    execSync(`echo '${newCrontab.replace(/'/g, "'\\''")}' | crontab -`, {
      encoding: "utf-8",
    });
    console.log("✓ Cron entry installed successfully.");
    console.log("  Verify with: crontab -l");
  } catch (err) {
    console.error(`✗ Failed to install cron: ${err.message}`);
    console.error("  Install manually by running: crontab -e");
    console.error("  Then paste the cron line shown above.");
    process.exit(1);
  }
} else {
  console.log("To install automatically, run:");
  console.log("  npm run cron:install:daily-summary -- --install");
  console.log("");
  console.log("Or manually: crontab -e, then paste the line above.");
}
