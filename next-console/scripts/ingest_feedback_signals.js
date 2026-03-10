#!/usr/bin/env node
/**
 * Ingest Feedback Signals
 * Joins published page records with GSC, GA4, and AI scores
 * to compute page postmortem records.
 *
 * Usage: node scripts/ingest_feedback_signals.js
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { /* ignore */ }
  return null;
}

function loadCSV(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
    return lines.slice(1).map((line) => {
      const vals = line.split(",");
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i]?.trim() ?? ""; });
      return obj;
    });
  } catch { return []; }
}

function main() {
  console.log("=== Ingest Feedback Signals ===");

  // 1. Load published pages
  const published = loadJSON(path.join(ROOT, "data", "published_pages.json")) || [];
  console.log(`  Published pages: ${published.length}`);

  // 2. Load GSC data
  const gsc = loadCSV(path.join(ROOT, "data", "gsc_import_current.csv"));
  console.log(`  GSC rows: ${gsc.length}`);
  const gscByPage = {};
  for (const row of gsc) {
    const page = row.page || row.url || "";
    // Extract slug from URL
    const match = page.match(/\/lanes\/([a-z0-9-]+)/);
    if (match) gscByPage[match[1]] = row;
  }

  // 3. Load GA4 data
  const ga4 = loadCSV(path.join(ROOT, "data", "ga4_import_current.csv"));
  console.log(`  GA4 rows: ${ga4.length}`);
  const ga4ByPage = {};
  for (const row of ga4) {
    const page = row.page_path || row.page || row.url || "";
    const match = page.match(/\/lanes\/([a-z0-9-]+)/);
    if (match) ga4ByPage[match[1]] = row;
  }

  // 4. Load uniqueness report
  const uniquenessReport = loadJSON(path.join(ROOT, "artifacts", "uniqueness_report.json"));
  const uniquenessScores = {};
  if (uniquenessReport?.pages) {
    for (const p of uniquenessReport.pages) {
      uniquenessScores[p.slug] = p.uniqueness_score || p.score || null;
    }
  }

  // 5. Load usefulness report
  const usefulnessReport = loadJSON(path.join(ROOT, "artifacts", "usefulness_report.json"));
  const usefulnessScores = {};
  if (usefulnessReport?.pages) {
    for (const p of usefulnessReport.pages) {
      usefulnessScores[p.slug] = p.score || null;
    }
  }

  // 6. Load link verification
  const linkVerification = loadJSON(path.join(ROOT, "artifacts", "daily_publish_link_verification.json"));
  const verifiedSlugs = new Set();
  if (linkVerification?.results) {
    for (const r of linkVerification.results) {
      if (r.verified) verifiedSlugs.add(r.slug);
    }
  }

  // 7. Load layout audit
  const layoutReport = loadJSON(path.join(ROOT, "artifacts", "layout_audit_report.json"));
  const layoutScores = {};
  if (layoutReport?.pages) {
    for (const p of layoutReport.pages) {
      layoutScores[p.slug] = p.score || null;
    }
  }

  // 8. Build postmortems
  const postmortems = [];
  for (const p of published) {
    if (p.dry_run === true) continue;
    if (!p.slug) continue;

    const gscData = gscByPage[p.slug] || {};
    const ga4Data = ga4ByPage[p.slug] || {};

    // Compute signal confidence level
    const hasGSC = parseFloat(gscData.impressions) > 0;
    const hasGA4 = parseFloat(ga4Data.quote_starts || ga4Data.conversions || ga4Data.sessions) > 0;
    let signal_confidence;
    if (hasGSC) signal_confidence = "high";       // Real external GSC data
    else if (hasGA4) signal_confidence = "medium"; // GA4 data but no GSC
    else signal_confidence = "low";                // Internal signals only

    postmortems.push({
      slug: p.slug,
      published_at: p.published_at_iso || null,
      indexed: gscData.impressions ? parseFloat(gscData.impressions) > 0 : null,
      impressions: parseFloat(gscData.impressions) || 0,
      clicks: parseFloat(gscData.clicks) || 0,
      ctr: parseFloat(gscData.ctr) || 0,
      avg_position: parseFloat(gscData.position || gscData.avg_position) || 0,
      quote_starts: parseFloat(ga4Data.quote_starts || ga4Data.conversions) || 0,
      quote_completions: parseFloat(ga4Data.quote_completions) || 0,
      ai_extractability_score: p.ai_extractability_score || 0,
      uniqueness_score: uniquenessScores[p.slug] || 0,
      usefulness_score: usefulnessScores[p.slug] || 0,
      layout_score: layoutScores[p.slug] || 0,
      verification_passed: verifiedSlugs.has(p.slug) || null,
      signal_confidence,
      archetype_id: p.archetype_id || null,
      title_pattern_id: p.title_pattern_id || p.selected_title_pattern_id || null,
      intro_pattern_id: p.intro_pattern_id || p.selected_intro_pattern_id || null,
      faq_ids: p.faq_ids || p.selected_faq_ids || [],
      cta_pattern_id: p.cta_pattern_id || p.selected_cta_pattern_id || null,
      link_pattern_id: p.link_pattern_id || p.selected_link_pattern_id || null,
    });
  }

  // 9. Write postmortems
  const outPath = path.join(ROOT, "data", "page_postmortems.json");
  fs.writeFileSync(outPath, JSON.stringify(postmortems, null, 2));
  console.log(`\n  Postmortems written: ${postmortems.length}`);
  console.log(`    → ${outPath}`);

  // Print summary
  const indexed = postmortems.filter((p) => p.indexed === true).length;
  const withImpressions = postmortems.filter((p) => p.impressions > 0).length;
  const withClicks = postmortems.filter((p) => p.clicks > 0).length;
  const verified = postmortems.filter((p) => p.verification_passed === true).length;

  console.log(`\n  Summary:`);
  console.log(`    Indexed:          ${indexed}`);
  console.log(`    With impressions: ${withImpressions}`);
  console.log(`    With clicks:      ${withClicks}`);
  console.log(`    Verified live:    ${verified}`);
  console.log(`    Total postmortems: ${postmortems.length}`);
}

main();
