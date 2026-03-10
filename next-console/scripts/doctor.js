#!/usr/bin/env node

/**
 * Pipeline Doctor — comprehensive health check for the lane factory.
 *
 * Usage:
 *   npm run doctor
 *
 * Validates:
 *   1. .env.local exists and required env vars are present
 *   2. Email config is normalized (no conflicting SMTP_ vs EMAIL_ vars)
 *   3. Webflow config is present
 *   4. SMTP transport can connect and authenticate
 *   5. Data/manifest/receipt directories exist and are writable
 *   6. Required data files exist
 *   7. Archived scripts are not on active npm script paths
 *   8. Canonical modules exist (config.js, email-sender.js, etc.)
 *   9. No inline nodemailer in active publish scripts
 *
 * Exit 0 on success, exit 1 on failure.
 * Never prints secrets.
 */

import { config } from "dotenv";
import path from "path";
import fs from "fs";
import { getProjectRoot, resolveFromRoot } from "../lib/fs/project-root.js";

const ROOT = getProjectRoot();

// Load .env.local
config({ path: path.join(ROOT, ".env.local") });

// Dynamic imports after env loaded
const { loadConfig, validateConfig, detectConfigConflicts } = await import("../lib/config.js");

let failures = 0;
let warnings = 0;

function pass(label) {
  console.log(`  \u2713 ${label}`);
}

function fail(label, hint) {
  console.log(`  \u2717 ${label}`);
  if (hint) console.log(`    \u2192 ${hint}`);
  failures++;
}

function warn(label, hint) {
  console.log(`  \u26A0 ${label}`);
  if (hint) console.log(`    \u2192 ${hint}`);
  warnings++;
}

async function main() {
  console.log("=== PIPELINE DOCTOR ===\n");

  // ── 1. .env.local ────────────────────────────────────────────────
  console.log("  --- Environment ---");
  const envPath = path.join(ROOT, ".env.local");
  const envExists = fs.existsSync(envPath);
  envExists ? pass(".env.local exists") : fail(".env.local exists", `Create ${envPath}`);

  // ── 2. Config loader ─────────────────────────────────────────────
  const cfg = loadConfig();

  // ── 3. Email config ──────────────────────────────────────────────
  console.log("\n  --- Email Config ---");
  const emailCheck = validateConfig(cfg, "email");
  emailCheck.ok
    ? pass("EMAIL_USER + EMAIL_APP_PASSWORD present")
    : fail("Email config complete", `Missing: ${emailCheck.missing.join(", ")}`);

  cfg.email.to
    ? pass(`EMAIL_TO is set`)
    : warn("EMAIL_TO is not set", "Email will fail without a recipient");

  if (cfg.email.user) console.log(`    EMAIL_USER = ${cfg.email.user.slice(0, 3)}***`);
  if (cfg.email.to) console.log(`    EMAIL_TO   = ${cfg.email.to.slice(0, 3)}***`);

  // ── 4. Config conflicts ──────────────────────────────────────────
  console.log("\n  --- Config Conflicts ---");
  const conflicts = detectConfigConflicts();
  if (conflicts.length === 0) {
    pass("No conflicting env var names");
  } else {
    for (const c of conflicts) {
      warn(c);
    }
  }

  // ── 5. Webflow config ────────────────────────────────────────────
  console.log("\n  --- Webflow Config ---");
  const wfCheck = validateConfig(cfg, "webflow");
  wfCheck.ok
    ? pass("WEBFLOW_API_TOKEN + COLLECTION_ID + SITE_ID present")
    : fail("Webflow config complete", `Missing: ${wfCheck.missing.join(", ")}`);

  // ── 6. SMTP verify ──────────────────────────────────────────────
  console.log("\n  --- SMTP Connection ---");
  if (cfg.email.user && cfg.email.password) {
    try {
      const { createTransportFromEnv, verifyTransport } = await import("../lib/email-sender.js");
      const transport = await createTransportFromEnv();
      const result = await verifyTransport(transport);
      result.ok
        ? pass("SMTP transport.verify() succeeded")
        : fail("SMTP transport.verify()", result.error);
    } catch (err) {
      fail("SMTP transport creation", err.message);
    }
  } else {
    fail("SMTP verify skipped", "Missing email credentials");
  }

  // ── 7. Directories ──────────────────────────────────────────────
  console.log("\n  --- Directories ---");
  const requiredDirs = [
    "data",
    "manifests",
    "artifacts/publish-receipts",
    "artifacts/ship",
  ];
  for (const dir of requiredDirs) {
    const absDir = resolveFromRoot(dir);
    try {
      fs.mkdirSync(absDir, { recursive: true });
      fs.accessSync(absDir, fs.constants.W_OK);
      pass(`${dir}/ writable`);
    } catch {
      fail(`${dir}/ writable`, `Cannot write to ${absDir}`);
    }
  }

  // ── 8. Required data files ──────────────────────────────────────
  console.log("\n  --- Data Files ---");
  const requiredFiles = [
    "data/lane_registry.json",
    "data/published_pages.json",
    "data/approval_state.json",
  ];
  for (const f of requiredFiles) {
    const abs = resolveFromRoot(f);
    fs.existsSync(abs) ? pass(`${f} exists`) : fail(`${f} exists`, `Create ${abs}`);
  }

  // ── 9. Canonical modules ────────────────────────────────────────
  console.log("\n  --- Canonical Modules ---");
  const canonicalModules = [
    "lib/config.js",
    "lib/email-sender.js",
    "lib/publish-receipt.js",
    "lib/publish-manifest.js",
    "lib/publish-registry-disk.js",
    "lib/lane-factory.js",
    "lib/webflow-client.js",
    "scripts/lanes_auto_publish.js",
  ];
  for (const m of canonicalModules) {
    const abs = resolveFromRoot(m);
    fs.existsSync(abs) ? pass(`${m}`) : fail(`${m} exists`, `Missing canonical module`);
  }

  // ── 10. Archived scripts not in active paths ────────────────────
  console.log("\n  --- Archive Safety ---");
  const pkgPath = resolveFromRoot("package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const scriptValues = Object.values(pkg.scripts || {}).join(" ");
  const archivedDir = resolveFromRoot("scripts/_archived");
  if (fs.existsSync(archivedDir)) {
    const archived = fs.readdirSync(archivedDir).filter(f => f.endsWith(".js"));
    let archiveClean = true;
    for (const a of archived) {
      if (scriptValues.includes(a)) {
        fail(`Archived script ${a} referenced in npm scripts`);
        archiveClean = false;
      }
    }
    if (archiveClean) pass("No archived scripts in active npm paths");
  } else {
    pass("No _archived directory (nothing to check)");
  }

  // ── 11. No inline nodemailer in active publish scripts ─────────
  console.log("\n  --- Email Drift Check ---");
  const publishScripts = [
    "scripts/lanes_auto_publish.js",
    "app/api/approval/route.js",
  ];
  let driftClean = true;
  for (const script of publishScripts) {
    const abs = resolveFromRoot(script);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, "utf-8");
    // Check for inline createTransport (not via email-sender.js)
    const inlineTransport = src.match(/nodemailer\.(default\.)?createTransport\s*\(/g);
    if (inlineTransport) {
      fail(`${script} has inline nodemailer.createTransport()`, "Must use lib/email-sender.js");
      driftClean = false;
    }
  }
  if (driftClean) pass("Active publish scripts use canonical email path");

  // ── Result ──────────────────────────────────────────────────────
  console.log("");
  if (failures === 0 && warnings === 0) {
    console.log("=== ALL CHECKS PASSED ===");
    console.log("  Pipeline is healthy. Ready to run: npm run lanes:factory");
  } else if (failures === 0) {
    console.log(`=== PASSED with ${warnings} WARNING(S) ===`);
    console.log("  Pipeline is functional but review warnings above.");
  } else {
    console.log(`=== ${failures} CHECK(S) FAILED, ${warnings} WARNING(S) ===`);
    console.log("  Fix failures above, then re-run: npm run doctor");
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nUnexpected error: ${err.message}`);
  process.exit(1);
});
