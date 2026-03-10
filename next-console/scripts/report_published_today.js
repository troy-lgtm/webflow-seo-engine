#!/usr/bin/env node

/**
 * Report: What was actually published today?
 *
 * Scans data/published_pages.json for real (non-dry-run) entries
 * published within the current local day (America/Los_Angeles).
 *
 * A row counts as "really published today" when ALL are true:
 *   - dry_run !== true
 *   - webflow_item_id exists and does NOT start with "dry-run"
 *   - published_at_iso falls within today's date bucket
 *
 * Outputs:
 *   artifacts/published_today_report.json
 *   artifacts/published_today_report.md
 *   stdout (human-readable table)
 *
 * Usage:
 *   node scripts/report_published_today.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = getProjectRoot();
const ARTIFACTS_DIR = path.join(ROOT, "artifacts");

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function todayDateString() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

function isoToDateBucket(iso) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(iso));
  } catch {
    return iso?.split("T")?.[0] || "unknown";
  }
}

function main() {
  const today = todayDateString();
  const published = loadJSON(path.join(ROOT, "data", "published_pages.json")) || [];
  const baseUrl = "https://www.wearewarp.com";
  const templatePath = process.env.WEBFLOW_LANES_TEMPLATE_PATH || "/lanes";

  // Filter to real publishes today
  const realToday = published.filter(p => {
    if (p.dry_run === true) return false;
    if (!p.webflow_item_id || String(p.webflow_item_id).startsWith("dry-run")) return false;
    if (!p.published_at_iso) return false;
    return isoToDateBucket(p.published_at_iso) === today;
  });

  // Build report
  const rows = realToday.map(p => ({
    slug: p.slug,
    title: p.seo_title || p.slug,
    webflow_item_id: p.webflow_item_id,
    published_at_iso: p.published_at_iso,
    live_url: `${baseUrl}${templatePath}/${p.slug}`,
    origin: `${p.origin_city || ""}, ${p.origin_state || ""}`,
    destination: `${p.destination_city || ""}, ${p.destination_state || ""}`,
    mode: p.mode || "unknown",
  }));

  const report = {
    date: today,
    total_real_published_today: rows.length,
    total_rows_in_registry: published.length,
    pages: rows,
    generated_at: new Date().toISOString(),
  };

  // Write JSON
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "published_today_report.json"),
    JSON.stringify(report, null, 2)
  );

  // Write Markdown
  let md = `# Published Today Report\n\n`;
  md += `**Date:** ${today}\n`;
  md += `**Total real pages published today:** ${rows.length}\n`;
  md += `**Total rows in registry:** ${published.length}\n\n`;

  if (rows.length === 0) {
    md += `No real pages were published today.\n`;
  } else {
    md += `| # | Slug | Mode | Webflow ID | Live URL |\n`;
    md += `|---|------|------|------------|----------|\n`;
    rows.forEach((r, i) => {
      md += `| ${i + 1} | ${r.slug} | ${r.mode} | ${r.webflow_item_id} | [link](${r.live_url}) |\n`;
    });
  }

  md += `\n---\n*Generated at ${report.generated_at}*\n`;

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "published_today_report.md"),
    md
  );

  // Print to stdout
  console.log(`=== Published Today Report ===`);
  console.log(`  Date:    ${today}`);
  console.log(`  Total:   ${rows.length} real pages published today`);
  console.log(`  Registry: ${published.length} total rows`);
  console.log("");

  if (rows.length === 0) {
    console.log("  No real pages were published today.");
    console.log("");
    // Show why — count excluded reasons
    let dryCount = 0, fakeIdCount = 0, wrongDayCount = 0;
    for (const p of published) {
      if (p.dry_run === true) { dryCount++; continue; }
      if (!p.webflow_item_id || String(p.webflow_item_id).startsWith("dry-run")) { fakeIdCount++; continue; }
      if (!p.published_at_iso || isoToDateBucket(p.published_at_iso) !== today) { wrongDayCount++; continue; }
    }
    if (dryCount > 0) console.log(`  Excluded: ${dryCount} rows with dry_run=true`);
    if (fakeIdCount > 0) console.log(`  Excluded: ${fakeIdCount} rows with missing/fake webflow_item_id`);
    if (wrongDayCount > 0) console.log(`  Excluded: ${wrongDayCount} rows from other days`);
  } else {
    for (const r of rows) {
      console.log(`  ${r.slug}`);
      console.log(`    Title: ${r.title}`);
      console.log(`    ID:    ${r.webflow_item_id}`);
      console.log(`    Time:  ${r.published_at_iso}`);
      console.log(`    URL:   ${r.live_url}`);
      console.log("");
    }
  }

  console.log(`  Artifacts:`);
  console.log(`    artifacts/published_today_report.json`);
  console.log(`    artifacts/published_today_report.md`);
}

main();
