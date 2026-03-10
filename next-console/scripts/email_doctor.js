#!/usr/bin/env node

/**
 * Email Doctor — validate email environment and SMTP connectivity.
 *
 * Usage:
 *   npm run email:doctor
 *
 * Checks:
 * 1. .env.local exists
 * 2. EMAIL_USER is set
 * 3. EMAIL_APP_PASSWORD is set
 * 4. EMAIL_TO is set
 * 5. nodemailer transport.verify() succeeds
 *
 * Exit 0 on success, exit 1 on failure.
 * Never prints secrets.
 */

import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

// Load .env.local
const envPath = path.join(ROOT, ".env.local");
config({ path: envPath });

let failures = 0;

function check(label, ok, hint) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}`);
    if (hint) console.log(`    → ${hint}`);
    failures++;
  }
}

async function main() {
  console.log("=== EMAIL DOCTOR ===\n");

  // 1. .env.local exists
  const envExists = fs.existsSync(envPath);
  check(".env.local exists", envExists, `Create ${envPath} with EMAIL_USER, EMAIL_APP_PASSWORD, EMAIL_TO`);

  // 2–4. Env vars
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  const to = process.env.EMAIL_TO;

  check("EMAIL_USER is set", !!user, "Add EMAIL_USER=your@gmail.com to .env.local");
  check("EMAIL_APP_PASSWORD is set", !!pass, "Add EMAIL_APP_PASSWORD=xxxx to .env.local (Google app password, not your login password)");
  check("EMAIL_TO is set", !!to, "Add EMAIL_TO=recipient@example.com to .env.local");

  // Show masked values (never reveal secrets)
  if (user) console.log(`    EMAIL_USER = ${user.slice(0, 3)}***`);
  if (to) console.log(`    EMAIL_TO   = ${to.slice(0, 3)}***`);

  // 5. SMTP verify — only if all env vars present
  if (user && pass) {
    console.log("\n  Connecting to smtp.gmail.com:465...");
    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user, pass }
      });
      await transport.verify();
      check("SMTP transport.verify()", true);
    } catch (err) {
      check("SMTP transport.verify()", false, err.message);
    }
  } else {
    console.log("\n  Skipping SMTP verify (missing credentials).");
    failures++;
  }

  // Result
  console.log("");
  if (failures === 0) {
    console.log("=== ALL CHECKS PASSED ===");
    console.log("  Ready to send email with: npm run ship:firstpage -- --send-email");
    process.exit(0);
  } else {
    console.log(`=== ${failures} CHECK(S) FAILED ===`);
    console.log("  Fix the issues above, then re-run: npm run email:doctor");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nUnexpected error: ${err.message}`);
  process.exit(1);
});
