#!/usr/bin/env node

/**
 * Verify Live Pages — Post-publish URL verification
 *
 * Reads artifacts/published_pages_latest.json, builds absolute URLs,
 * checks a sample via HTTP HEAD/GET, and writes results.
 *
 * Usage:
 *   node scripts/verify_live_pages.js
 *   npm run verify:live-pages
 */

import fs from "fs";
import { getProjectRoot, resolveFromRoot } from "../lib/fs/project-root.js";
import { transitionState } from "../lib/approval-gate.js";

const ROOT = getProjectRoot();

function loadJSON(relPath) {
  try {
    return JSON.parse(fs.readFileSync(resolveFromRoot(relPath), "utf-8"));
  } catch {
    return null;
  }
}

async function checkUrl(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    return { url, status_code: res.status, ok: res.status >= 200 && res.status < 400 };
  } catch (err) {
    clearTimeout(timer);
    // Retry with GET if HEAD fails (some servers don't support HEAD)
    try {
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), timeoutMs);
      const res = await fetch(url, {
        method: "GET",
        signal: controller2.signal,
        redirect: "follow",
      });
      clearTimeout(timer2);
      return { url, status_code: res.status, ok: res.status >= 200 && res.status < 400 };
    } catch (err2) {
      return { url, status_code: 0, ok: false, error: err2.message || "network error" };
    }
  }
}

async function main() {
  console.log("=== Live Page Verification ===\n");

  // Load configs
  const verConfig = loadJSON("config/publish-verification.json") || {
    sample_size: 20,
    max_failed_before_warning: 2,
    timeout_ms: 10000,
  };

  const pagesLatest = loadJSON("artifacts/published_pages_latest.json");
  if (!pagesLatest) {
    console.error("  ERROR: artifacts/published_pages_latest.json not found.");
    console.error("  Run a publish pipeline first to generate this artifact.");
    process.exit(1);
  }

  const decision = loadJSON("artifacts/publish_decision.json");
  const baseUrl = decision?.site_base_url || "https://www.wearewarp.com";
  const runId = pagesLatest.run_id || decision?.run_id || "unknown";

  // Build URL list from indexable pages
  const indexablePages = pagesLatest.live_indexable_pages || [];
  const sampleSize = Math.min(verConfig.sample_size, indexablePages.length);

  if (sampleSize === 0) {
    console.log("  No indexable pages to verify.");
    const result = {
      run_id: runId,
      timestamp: new Date().toISOString(),
      verification_status: "not_run",
      checked: 0,
      passed: 0,
      failed: 0,
      results: [],
    };
    fs.writeFileSync(
      resolveFromRoot("artifacts", "live_page_verification.json"),
      JSON.stringify(result, null, 2)
    );
    console.log("  Written: artifacts/live_page_verification.json");
    return;
  }

  // Sample pages (take first N for determinism)
  const sample = indexablePages.slice(0, sampleSize);
  const urls = sample.map(p => `${baseUrl}${p.page_path}`);

  console.log(`  Base URL: ${baseUrl}`);
  console.log(`  Checking ${urls.length} of ${indexablePages.length} indexable pages\n`);

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const url of urls) {
    const result = await checkUrl(url, verConfig.timeout_ms);
    results.push(result);

    if (result.ok) {
      passed++;
      // Transition approval state → verified_live
      const slug = url.split("/lanes/")[1] || url.split("/").pop();
      if (slug) {
        transitionState(slug, "LTL", "verified_live", {
          by: "verify_live_pages.js",
          note: `HTTP ${result.status_code} at ${url}`,
        });
      }
      console.log(`  ✓ ${result.status_code} ${url}`);
    } else {
      failed++;
      console.log(`  ✗ ${result.status_code || "ERR"} ${url}${result.error ? ` (${result.error})` : ""}`);
    }
  }

  // Compute verification_status
  let verification_status;
  if (results.length === 0) {
    verification_status = "not_run";
  } else if (passed === 0) {
    verification_status = "failed";
  } else if (failed > verConfig.max_failed_before_warning) {
    verification_status = "warning";
  } else {
    verification_status = "passed";
  }

  const output = {
    run_id: runId,
    timestamp: new Date().toISOString(),
    verification_status,
    checked: results.length,
    passed,
    failed,
    results,
  };

  fs.mkdirSync(resolveFromRoot("artifacts"), { recursive: true });
  fs.writeFileSync(
    resolveFromRoot("artifacts", "live_page_verification.json"),
    JSON.stringify(output, null, 2)
  );

  console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${results.length} checked`);

  if (failed > verConfig.max_failed_before_warning) {
    console.log(`  ⚠ WARNING: ${failed} failures exceed threshold of ${verConfig.max_failed_before_warning}`);
  }

  console.log(`  Written: artifacts/live_page_verification.json\n`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
