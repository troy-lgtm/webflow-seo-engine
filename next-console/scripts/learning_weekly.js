#!/usr/bin/env node
/**
 * Weekly Learning Update
 * Ingests feedback signals, updates learning weights,
 * writes learning state, history, and recommendations.
 *
 * Usage: node scripts/learning_weekly.js
 * npm run learning:weekly
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");

function loadJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { /* ignore */ }
  return null;
}

async function main() {
  console.log("=== Weekly Learning Update ===\n");

  // 1. Run feedback signal ingestion first
  console.log("  Step 1: Ingesting feedback signals...");
  try {
    const { execSync } = await import("child_process");
    execSync("node scripts/ingest_feedback_signals.js", { cwd: ROOT, stdio: "inherit" });
  } catch (err) {
    console.log(`  ⚠  Feedback ingestion had issues: ${err.message}`);
  }

  // 2. Load postmortems
  const postmortems = loadJSON(path.join(ROOT, "data", "page_postmortems.json")) || [];
  console.log(`\n  Step 2: Loaded ${postmortems.length} postmortems`);

  // 3. Load manual feedback
  const manualFeedback = loadJSON(path.join(ROOT, "data", "manual_feedback.json")) || [];
  console.log(`  Step 3: Loaded ${manualFeedback.length} manual feedback entries`);

  // 4. Run learning update
  console.log("\n  Step 4: Updating learning weights...");
  const { applyLearningUpdate } = await import("../lib/learning-updater.js");
  const report = applyLearningUpdate(postmortems, manualFeedback);

  console.log(`    Archetypes updated:    ${report.archetypes_updated}`);
  console.log(`    Title patterns:        ${report.title_patterns_updated}`);
  console.log(`    FAQ weights:           ${report.faq_weights_updated}`);
  console.log(`    CTA weights:           ${report.cta_weights_updated}`);
  console.log(`    Intro patterns:        ${report.intro_patterns_updated}`);
  console.log(`    Link patterns:         ${report.link_patterns_updated}`);
  console.log(`    Manual feedback:       ${report.manual_feedback_processed}`);
  console.log(`    Recommendations:       ${report.recommendations_count}`);

  // 5. Load the freshly written state for the report
  const { loadLearningState } = await import("../lib/learning-store.js");
  const state = loadLearningState();

  // 6. Build markdown report
  const { scoreArchetypes, scorePattern } = await import("../lib/learning-scoring.js");
  const archetypeScores = scoreArchetypes(postmortems);

  const lines = [];
  lines.push("# Weekly Learning Report");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Content Version:** ${state.content_version}`);
  lines.push(`**Postmortems analyzed:** ${postmortems.length}`);
  lines.push("");

  // Archetype performance
  lines.push("## Archetype Performance");
  lines.push("| Archetype | Published | Indexed | Avg CTR | Avg Position | AI Score | Recommendation |");
  lines.push("|-----------|-----------|---------|---------|-------------|----------|----------------|");
  for (const a of archetypeScores.sort((x, y) => y.avg_ctr - x.avg_ctr)) {
    lines.push(`| ${a.archetype_id} | ${a.pages_published} | ${a.pages_indexed} | ${(a.avg_ctr * 100).toFixed(2)}% | ${a.avg_position || "—"} | ${a.ai_extraction_score_avg || "—"} | ${a.recommendation} |`);
  }
  lines.push("");

  // Title patterns
  const titlePatternIds = [...new Set(postmortems.map((p) => p.title_pattern_id).filter(Boolean))];
  if (titlePatternIds.length > 0) {
    lines.push("## Title Pattern Performance");
    lines.push("| Pattern | Pages | Avg Score | Win Rate | Recommendation |");
    lines.push("|---------|-------|-----------|----------|----------------|");
    const titleScores = titlePatternIds.map((id) => scorePattern(id, postmortems, "title_pattern_id"));
    for (const ts of titleScores.sort((a, b) => b.avg_score - a.avg_score)) {
      lines.push(`| ${ts.pattern_id} | ${ts.pages_count} | ${ts.avg_score} | ${(ts.win_rate * 100).toFixed(0)}% | ${ts.recommendation} |`);
    }
    lines.push("");
  }

  // FAQ performance
  const faqEntries = Object.entries(state.faq_weights || {});
  if (faqEntries.length > 0) {
    const toPromote = faqEntries.filter(([, v]) => v.recommendation === "promote");
    const toRetire = faqEntries.filter(([, v]) => v.recommendation === "retire");
    const toDemote = faqEntries.filter(([, v]) => v.recommendation === "demote");

    lines.push("## FAQ Updates");
    if (toPromote.length > 0) {
      lines.push("### FAQs to Promote");
      for (const [id, v] of toPromote) {
        lines.push(`- **${id}**: score=${v.avg_score}, used=${v.times_used}x`);
      }
    }
    if (toRetire.length > 0) {
      lines.push("### FAQs to Retire");
      for (const [id, v] of toRetire) {
        lines.push(`- **${id}**: score=${v.avg_score}, used=${v.times_used}x`);
      }
    }
    if (toDemote.length > 0) {
      lines.push("### FAQs to Demote");
      for (const [id, v] of toDemote) {
        lines.push(`- **${id}**: score=${v.avg_score}, used=${v.times_used}x`);
      }
    }
    lines.push("");
  }

  // Pages needing attention
  const poorCtr = postmortems
    .filter((p) => p.indexed && p.impressions > 50 && p.ctr < 0.02)
    .sort((a, b) => a.ctr - b.ctr)
    .slice(0, 10);
  if (poorCtr.length > 0) {
    lines.push("## Pages: Indexed but Poor CTR");
    for (const p of poorCtr) {
      lines.push(`- **${p.slug}**: ${p.impressions} impressions, ${(p.ctr * 100).toFixed(2)}% CTR, position ${p.avg_position}`);
    }
    lines.push("");
  }

  const goodCtrLowConversion = postmortems
    .filter((p) => p.ctr > 0.05 && p.quote_starts === 0 && p.clicks > 10)
    .slice(0, 10);
  if (goodCtrLowConversion.length > 0) {
    lines.push("## Pages: Good CTR but No Conversions");
    for (const p of goodCtrLowConversion) {
      lines.push(`- **${p.slug}**: ${(p.ctr * 100).toFixed(2)}% CTR, ${p.clicks} clicks, 0 quote starts`);
    }
    lines.push("");
  }

  // AI extractability
  const lowAi = postmortems
    .filter((p) => p.ai_extractability_score > 0 && p.ai_extractability_score < 50)
    .sort((a, b) => a.ai_extractability_score - b.ai_extractability_score)
    .slice(0, 10);
  if (lowAi.length > 0) {
    lines.push("## Pages: Poor AI Extractability");
    for (const p of lowAi) {
      lines.push(`- **${p.slug}**: AI score ${p.ai_extractability_score}`);
    }
    lines.push("");
  }

  // Recommendations
  const recs = loadJSON(path.join(ARTIFACTS, "learning_recommendations.json")) || [];
  if (recs.length > 0) {
    lines.push("## Recommendations Requiring Human Approval");
    for (const r of recs) {
      lines.push(`- **${r.proposed_change}**: ${r.evidence} (risk: ${r.risk})`);
    }
    lines.push("");
  }

  // Learning notes
  if (report.notes && report.notes.length > 0) {
    lines.push("## Learning Notes");
    for (const n of report.notes.slice(0, 20)) {
      lines.push(`- ${n}`);
    }
    lines.push("");
  }

  // Write report
  const reportMd = lines.join("\n");
  if (!fs.existsSync(ARTIFACTS)) fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS, "learning_report.md"), reportMd);
  console.log(`\n  Step 5: Report written`);
  console.log(`    → artifacts/learning_report.md`);
  console.log(`    → artifacts/learning_state.json`);
  console.log(`    → data/learning_history.json`);
  if (report.recommendations_count > 0) {
    console.log(`    → artifacts/learning_recommendations.json (${report.recommendations_count} items)`);
  }

  console.log("\n  ✓ Weekly learning update complete");
}

main().catch((err) => {
  console.error("  ✗ Learning update failed:", err.message);
  process.exit(1);
});
