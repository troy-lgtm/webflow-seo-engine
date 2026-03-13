#!/usr/bin/env node
/**
 * deploy_and_verify.js — One-Command Vercel Deploy + Route Verification
 *
 * Prerequisites:
 *   1. Vercel CLI installed: npm i -g vercel
 *   2. Logged in: vercel login
 *   3. Project linked: vercel link (or first deploy will prompt)
 *
 * Usage:
 *   node scripts/deploy_and_verify.js              # Preview deployment
 *   node scripts/deploy_and_verify.js --prod        # Production deployment
 *   node scripts/deploy_and_verify.js --skip-deploy --base-url https://your-app.vercel.app
 *
 * What it does:
 *   1. Verifies Vercel CLI auth (vercel whoami)
 *   2. Runs production build
 *   3. Deploys to Vercel (preview or production)
 *   4. Extracts deployment URL
 *   5. Runs verify_deployment_routes.js against live URL
 *   6. Reports pass/fail summary
 */

import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const isProd = args.includes("--prod");
const skipDeploy = args.includes("--skip-deploy");
const baseUrlArg = args.find((a, i) => args[i - 1] === "--base-url");

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8", stdio: opts.silent ? "pipe" : "inherit", ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf-8" }).trim();
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  VERCEL DEPLOY & ROUTE VERIFICATION");
  console.log(`  Mode: ${isProd ? "PRODUCTION" : "PREVIEW"}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  let deployUrl = baseUrlArg;

  if (!skipDeploy) {
    // Step 1: Verify Vercel auth
    console.log("── Step 1: Verify Vercel Auth ──");
    try {
      const who = runCapture("vercel whoami 2>/dev/null");
      console.log(`  Logged in as: ${who}\n`);
    } catch {
      console.error("  ✗ Not logged into Vercel. Run: vercel login");
      process.exit(1);
    }

    // Step 2: Build
    console.log("── Step 2: Production Build ──");
    run("npm run build");
    console.log("  ✓ Build succeeded\n");

    // Step 3: Deploy
    console.log(`── Step 3: Deploy to Vercel (${isProd ? "production" : "preview"}) ──`);
    const deployCmd = isProd ? "vercel --prod --yes" : "vercel --yes";
    try {
      const output = runCapture(deployCmd);
      // Vercel CLI outputs the URL as the last line
      const lines = output.split("\n").filter(Boolean);
      deployUrl = lines[lines.length - 1].trim();
      // Ensure it's a URL
      if (!deployUrl.startsWith("http")) {
        // Try to find URL in output
        const urlMatch = output.match(/https:\/\/[^\s]+\.vercel\.app[^\s]*/);
        deployUrl = urlMatch ? urlMatch[0] : null;
      }
      console.log(`  ✓ Deployed to: ${deployUrl}\n`);
    } catch (err) {
      console.error("  ✗ Deployment failed");
      console.error(err.message);
      process.exit(1);
    }
  }

  if (!deployUrl) {
    console.error("  ✗ No deployment URL available. Use --base-url or deploy first.");
    process.exit(1);
  }

  // Step 4: Verify routes
  console.log("── Step 4: Verify Live Routes ──");
  console.log(`  Target: ${deployUrl}\n`);

  try {
    run(`node scripts/verify_deployment_routes.js --base-url ${deployUrl}`);
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("  ✓ DEPLOYMENT VERIFIED SUCCESSFULLY");
    console.log(`  URL: ${deployUrl}`);
    console.log("═══════════════════════════════════════════════════════════════");
  } catch {
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("  ✗ SOME ROUTE CHECKS FAILED");
    console.log(`  URL: ${deployUrl}`);
    console.log("  Review output above for details.");
    console.log("═══════════════════════════════════════════════════════════════");
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
