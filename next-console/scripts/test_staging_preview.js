#!/usr/bin/env node

/**
 * Test Staging Preview — verifies the staging URL from the latest job is HTTP 200
 * AND is not a Webflow soft-404 page.
 *
 * Usage:
 *   npm run test:staging-preview
 *
 * Reads the newest job from data/approval_jobs.json, extracts staging_url,
 * performs an HTTP GET with retries (up to 30s for Webflow publish propagation),
 * and passes only if the response is 200 AND the body does NOT contain 404 markers.
 *
 * Exit codes:
 *   0 — staging URL is reachable (HTTP 200, real page)
 *   1 — staging URL missing, unreachable, non-200, or soft-404
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

const jobsPath = path.join(ROOT, "data", "approval_jobs.json");
const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 2000;

/** Markers that indicate a Webflow soft-404 page */
const SOFT_404_MARKERS = [
  "This Page Has Moved or Does Not Exist",
  "Page not found",
];

console.log("=== WARP Staging Preview Test ===");
console.log("");

// 1. Read jobs
let jobs;
try {
  jobs = JSON.parse(fs.readFileSync(jobsPath, "utf-8"));
} catch (err) {
  console.error("  FAIL: Cannot read data/approval_jobs.json");
  console.error(`  Error: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(jobs) || jobs.length === 0) {
  console.error("  FAIL: No jobs found in data/approval_jobs.json");
  console.error("  No staging_url found. Run ship:firstpage with --publish-staging.");
  process.exit(1);
}

// 2. Get newest job (last in array)
const job = jobs[jobs.length - 1];
const stagingUrl = job.staging_url;

if (!stagingUrl) {
  console.error("  FAIL: Latest job has no staging_url.");
  console.error(`  Job approval_id: ${job.approval_id || "(unknown)"}`);
  console.error("  No staging_url found. Run ship:firstpage with --publish-staging.");
  process.exit(1);
}

// Guard: never accept localhost URLs
if (stagingUrl.includes("localhost") || stagingUrl.includes("127.0.0.1")) {
  console.error("  FAIL: staging_url is a localhost URL. Only Webflow staging URLs are accepted.");
  console.error(`  URL: ${stagingUrl}`);
  process.exit(1);
}

console.log(`  STAGING_URL=${stagingUrl}`);
console.log(`  Retries: up to ${MAX_RETRIES} attempts (${(MAX_RETRIES * RETRY_DELAY_MS) / 1000}s max)`);
console.log("");

// 3. HTTP GET with retries + soft-404 body check
const headers = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

let lastStatus = 0;
let lastSoft404 = false;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    const res = await fetch(stagingUrl, { method: "GET", headers, redirect: "follow" });
    lastStatus = res.status;

    if (res.status === 200) {
      const body = await res.text();
      const isSoft404 = SOFT_404_MARKERS.some((marker) => body.includes(marker));

      if (!isSoft404) {
        console.log(`  HTTP_STATUS=${res.status}`);
        console.log("");
        console.log("  PASS: Staging preview is live and returns HTTP 200.");
        console.log(`  URL: ${stagingUrl}`);
        process.exit(0);
      }

      // Soft 404 — page exists but shows "does not exist" message
      lastSoft404 = true;
      if (attempt < MAX_RETRIES) {
        console.log(`  Attempt ${attempt}/${MAX_RETRIES}: HTTP 200 but soft-404 detected, retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      } else {
        console.log(`  Attempt ${attempt}/${MAX_RETRIES}: HTTP 200 but soft-404 detected`);
      }
    } else {
      lastSoft404 = false;
      if (attempt < MAX_RETRIES) {
        console.log(`  Attempt ${attempt}/${MAX_RETRIES}: HTTP ${res.status}, retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      } else {
        console.log(`  Attempt ${attempt}/${MAX_RETRIES}: HTTP ${res.status}`);
      }
    }
  } catch (err) {
    lastStatus = 0;
    lastSoft404 = false;
    if (attempt < MAX_RETRIES) {
      console.log(`  Attempt ${attempt}/${MAX_RETRIES}: network error (${err.message}), retrying...`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    } else {
      console.log(`  Attempt ${attempt}/${MAX_RETRIES}: network error (${err.message})`);
    }
  }
}

// All retries exhausted
console.log("");
console.log(`  HTTP_STATUS=${lastStatus}`);

if (lastSoft404) {
  console.error("  FAIL: HTTP 200 but page is a Webflow soft-404.");
  console.error("  The page returned 'This Page Has Moved or Does Not Exist'.");
  console.error("  The CMS collection template path is likely wrong or the template page does not exist.");
  console.error(`  URL: ${stagingUrl}`);
  console.error("");
  console.error("  Fix: Create a Collection Template page for the Lanes collection in Webflow Designer.");
  console.error("  Or set WEBFLOW_LANES_TEMPLATE_PATH=/correct-path in .env.local");
} else if (lastStatus === 404) {
  console.error("  FAIL: HTTP 404 after all retries.");
  console.error("  Check template path WEBFLOW_LANES_TEMPLATE_PATH and ensure collection template exists in Webflow Designer.");
  console.error(`  Current URL: ${stagingUrl}`);
  console.error("  The Webflow CMS collection needs a template page bound to this URL path.");
  console.error("");
  console.error("  Recommended override: Set WEBFLOW_LANES_TEMPLATE_PATH=/correct-path in .env.local");
} else if (lastStatus === 401 || lastStatus === 403) {
  console.error("  FAIL: HTTP 401/403. Staging might be disabled or unpublished.");
  console.error(`  URL: ${stagingUrl}`);
  console.error("  Ensure --publish-staging was used and the site published to the staging subdomain.");
} else {
  console.error(`  FAIL: HTTP ${lastStatus} after ${MAX_RETRIES} retries.`);
  console.error(`  URL: ${stagingUrl}`);
}

process.exit(1);
