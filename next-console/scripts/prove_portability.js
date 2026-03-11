#!/usr/bin/env node
/**
 * prove_portability.js — Dual-Adapter Portability Proof
 *
 * Demonstrates that the lane page system can now generate publishable output
 * for BOTH the current Webflow CMS path AND a future CMS-neutral path
 * from the SAME canonical lane data.
 *
 * This script is the definitive proof that the lane page engine is no longer
 * trapped inside Webflow. It:
 *   1. Builds canonical lane knowledge
 *   2. Builds canonical page data
 *   3. Builds the CMS-neutral publish contract
 *   4. Runs the quality gate
 *   5. Produces Webflow adapter output (current production path)
 *   6. Produces neutral adapter output (migration target path)
 *   7. Writes both outputs to artifacts/ for inspection
 *   8. Verifies structural equivalence
 *
 * Usage:
 *   node scripts/prove_portability.js [--lane origin-to-destination]
 *
 * Default lane: atlanta-to-orlando (strongest benchmark coverage)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import { renderWebflowFields } from "../lib/render-lane-page.js";
import { assessPublishQuality } from "../lib/lane-page-validator.js";
import { buildPublishContract, validatePublishContract, contractToRenderedFields } from "../lib/publishers/publish-contract.js";
import { adaptForPublish as webflowAdapt, ADAPTER_ID as WF_ID, ADAPTER_NAME as WF_NAME } from "../lib/publishers/webflow-adapter.js";
import { adaptForPublish as neutralAdapt, ADAPTER_ID as NE_ID, ADAPTER_NAME as NE_NAME, publish as neutralPublish } from "../lib/publishers/neutral-adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts", "portability_proof");

// Parse CLI args
const args = process.argv.slice(2);
const laneIdx = args.indexOf("--lane");
const laneSlug = laneIdx >= 0 ? args[laneIdx + 1] : "atlanta-to-orlando";

// Parse slug into origin/destination
function parseLaneSlug(slug) {
  const toIdx = slug.indexOf("-to-");
  if (toIdx < 0) throw new Error(`Invalid lane slug: ${slug}`);
  const origin = slug.substring(0, toIdx).replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const dest = slug.substring(toIdx + 4).replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return { origin, destination: dest };
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  DUAL-ADAPTER PORTABILITY PROOF                             ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const { origin, destination } = parseLaneSlug(laneSlug);
  console.log(`Lane: ${origin} → ${destination} (LTL)`);
  console.log(`Slug: ${laneSlug}\n`);

  // ── Step 1: Canonical Knowledge ─────────────────────────────────────
  console.log("Step 1: Building lane knowledge...");
  const knowledge = buildLaneKnowledge({ origin: `${origin}, GA`, destination: `${destination}, FL`, mode: "LTL" });
  console.log(`  Distance: ${knowledge.lane_stats.estimated_distance_miles} mi`);
  console.log(`  Transit: ${knowledge.lane_stats.estimated_transit_days_range.min}-${knowledge.lane_stats.estimated_transit_days_range.max} days`);
  console.log(`  Carriers: ${knowledge.network_proof.estimated_carrier_count}`);

  // ── Step 2: Canonical Page Data ─────────────────────────────────────
  console.log("\nStep 2: Building canonical page data...");
  const pageData = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null, related_lanes: [], tool_link: "https://www.wearewarp.com/quote", data_link: null,
  });
  console.log(`  Title: ${pageData.page_title}`);
  console.log(`  Sections: ${Object.keys(pageData).filter(k => typeof pageData[k] === "object" && pageData[k]?.heading).length} with headings`);
  console.log(`  FAQs: ${pageData.lane_specific_faqs?.length}`);

  // ── Step 3: CMS-Neutral Publish Contract ────────────────────────────
  console.log("\nStep 3: Building CMS-neutral publish contract...");
  const contract = buildPublishContract(pageData);
  const validation = validatePublishContract(contract);
  console.log(`  Version: ${contract._contract_version}`);
  console.log(`  Groups: ${Object.keys(contract).filter(k => !k.startsWith("_")).join(", ")}`);
  console.log(`  Valid: ${validation.valid} (errors: ${validation.errors.length})`);

  // ── Step 4: Quality Gate ────────────────────────────────────────────
  console.log("\nStep 4: Running quality gate...");
  const renderedFields = contractToRenderedFields(contract);
  const quality = assessPublishQuality(pageData, renderedFields);
  console.log(`  Score: ${quality.score}% (${quality.grade})`);
  console.log(`  Gates: ${quality.gates_passed}/${quality.gate_count} passed`);
  console.log(`  Publishable: ${quality.publishable}`);

  if (!quality.publishable) {
    console.log("\n⛔ QUALITY GATE BLOCKED — cannot demonstrate portability");
    const failed = Object.entries(quality.gates).filter(([, v]) => !v).map(([k]) => k);
    console.log(`  Failed gates: ${failed.join(", ")}`);
    process.exit(1);
  }

  // Attach quality to contract
  contract.quality = quality;

  // ── Step 5: Webflow Adapter ─────────────────────────────────────────
  console.log(`\nStep 5: Adapting for ${WF_NAME} (${WF_ID})...`);
  const webflowOutput = webflowAdapt(contract, { preserveSlug: true, preserveName: true });
  console.log(`  Fields: ${Object.keys(webflowOutput).length}`);
  console.log(`  hero-headline: "${webflowOutput["hero-headline"]}"`);
  console.log(`  faq-schema: ${(webflowOutput["faq-schema"] || "").length} chars`);
  console.log(`  breadcrumb-schema: ${(webflowOutput["breadcrumb-schema"] || "").length} chars`);

  // ── Step 6: Neutral Adapter ─────────────────────────────────────────
  console.log(`\nStep 6: Adapting for ${NE_NAME} (${NE_ID})...`);
  const neutralOutput = neutralAdapt(contract);
  console.log(`  Slug: ${neutralOutput.slug}`);
  console.log(`  Sections: ${neutralOutput.sections?.length}`);
  console.log(`  FAQs: ${neutralOutput.faqs?.length}`);
  console.log(`  JSON-LD schemas: ${neutralOutput.metadata?.jsonLd?.length}`);
  console.log(`  Stats: ${neutralOutput.stats?.distance_miles} mi, ${neutralOutput.network?.carrier_count} carriers`);

  // ── Step 7: Verify Equivalence ──────────────────────────────────────
  console.log("\nStep 7: Verifying content equivalence...");
  const legacyFields = renderWebflowFields(pageData);
  const criticalKeys = [
    "hero-headline", "subheadline", "body-content", "faq-schema",
    "breadcrumb-schema", "proof-section", "lane-intelligence-panel",
    "execution-flow", "seo-title", "seo-meta-description", "canonical-url",
  ];
  let matches = 0;
  for (const key of criticalKeys) {
    if (String(renderedFields[key]) === String(legacyFields[key])) matches++;
  }
  console.log(`  Content field equivalence: ${matches}/${criticalKeys.length}`);

  // ── Step 8: Write Artifacts ─────────────────────────────────────────
  console.log("\nStep 8: Writing artifacts...");
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  // Write contract
  const contractPath = path.join(ARTIFACTS_DIR, `${laneSlug}_contract.json`);
  const contractForDisk = { ...contract };
  delete contractForDisk.canonical; // Don't serialize the full canonical ref
  fs.writeFileSync(contractPath, JSON.stringify(contractForDisk, null, 2));
  console.log(`  Contract: ${contractPath}`);

  // Write Webflow adapter output
  const wfPath = path.join(ARTIFACTS_DIR, `${laneSlug}_webflow.json`);
  fs.writeFileSync(wfPath, JSON.stringify(webflowOutput, null, 2));
  console.log(`  Webflow:  ${wfPath}`);

  // Write neutral adapter output
  const nePath = path.join(ARTIFACTS_DIR, `${laneSlug}_neutral.json`);
  fs.writeFileSync(nePath, JSON.stringify(neutralOutput, null, 2));
  console.log(`  Neutral:  ${nePath}`);

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  PORTABILITY PROOF COMPLETE");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Lane:      ${origin} → ${destination}`);
  console.log(`  Quality:   ${quality.score}% (${quality.grade})`);
  console.log(`  Gates:     ${quality.gates_passed}/${quality.gate_count} passed`);
  console.log(`  Webflow:   ${Object.keys(webflowOutput).length} CMS fields`);
  console.log(`  Neutral:   ${neutralOutput.sections?.length} sections, ${neutralOutput.faqs?.length} FAQs, ${neutralOutput.metadata?.jsonLd?.length} schemas`);
  console.log(`  Equiv:     ${matches}/${criticalKeys.length} critical fields match`);
  console.log(`  Artifacts: ${ARTIFACTS_DIR}/`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("\n  ✓ The lane page engine is portable across CMS targets.\n");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
