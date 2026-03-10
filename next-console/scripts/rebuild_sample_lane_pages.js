#!/usr/bin/env node

/**
 * Rebuild Sample Lane Pages — New Architecture Pipeline
 *
 * Uses the extracted modules (lane-knowledge → lane-page-schema → render-lane-page → validator)
 * to generate 10 specific sample lane pages and produce proof artifacts.
 *
 * Pipeline:
 *   1. buildLaneKnowledge(lane) — build structured lane knowledge
 *   2. buildCanonicalLanePageData(knowledge, relatedLinks) — build canonical page data
 *   3. validateLanePageSchema(pageData) — schema validation
 *   4. renderWebflowFields(pageData) — render Webflow CMS fields
 *   5. Validate with publish gate — full validation check
 *   6. Write artifacts
 *
 * Output:
 *   artifacts/sample_rebuild/{slug}/ — per-lane artifacts
 *   artifacts/sample_lane_page_rebuild_report.json — summary report
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

// New architecture imports
import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData, validateLanePageSchema } from "../lib/lane-page-schema.js";
import {
  renderLanePageBody,
  renderFaqSchemaEmbed,
  renderBreadcrumbSchemaEmbed,
  renderWebflowFields,
} from "../lib/render-lane-page.js";
import {
  runFullValidation,
  computeLanePageQualityScore,
  scanForBannedLaneContent,
} from "../lib/lane-page-validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

// ── The 10 specific sample lanes ──────────────────────────────────────
const SAMPLE_LANES = [
  { origin: "Miami, FL", destination: "Atlanta, GA", mode: "LTL", segment: "smb" },
  { origin: "Dallas, TX", destination: "Chicago, IL", mode: "LTL", segment: "smb" },
  { origin: "Chicago, IL", destination: "Dallas, TX", mode: "LTL", segment: "smb" },
  { origin: "Los Angeles, CA", destination: "Phoenix, AZ", mode: "LTL", segment: "smb" },
  { origin: "Atlanta, GA", destination: "Orlando, FL", mode: "LTL", segment: "smb" },
  { origin: "Houston, TX", destination: "Dallas, TX", mode: "LTL", segment: "smb" },
  { origin: "Chicago, IL", destination: "Atlanta, GA", mode: "LTL", segment: "smb" },
  { origin: "Phoenix, AZ", destination: "Los Angeles, CA", mode: "LTL", segment: "smb" },
  { origin: "Miami, FL", destination: "Orlando, FL", mode: "LTL", segment: "smb" },
  { origin: "Dallas, TX", destination: "Atlanta, GA", mode: "LTL", segment: "smb" },
];

/**
 * Map canonical page data to the legacy page format expected by the validator.
 */
function mapCanonicalToLegacyPage(pageData) {
  const proofHtml = pageData.lane_relevant_cta?.body || "";
  return {
    slug: pageData.lane_slug,
    canonical_path: pageData.canonical_path,
    seo_title: pageData.page_title,
    h1: pageData.hero?.headline || "",
    intro: pageData.hero?.subhead || "",
    meta_description: pageData.meta_description,
    target_segment: pageData.segment || "smb",
    lane: {
      origin: pageData.origin,
      destination: pageData.destination,
      mode: pageData.mode,
    },
    lane_stats: pageData.lane_stats,
    network_proof: pageData.network_proof,
    faq: (pageData.lane_specific_faqs || []).map((f) => ({
      q: f.question,
      a: f.answer,
    })),
    proof_section: `Validate this lane with a controlled pilot: ${pageData.origin} to ${pageData.destination}. Track quote response time, transit predictability, and exception rate across ${pageData.network_proof?.estimated_carrier_count || 0} active carriers on this ${pageData.lane_stats?.estimated_distance_miles || 0}-mile corridor. Start with this single lane, measure results, and expand based on data.`,
    cta_primary: pageData.hero?.primary_cta?.label || "Get Instant Quote",
    cta_secondary: pageData.hero?.secondary_cta?.label || "Book a Fit Call",
    cta_primary_url: pageData.hero?.primary_cta?.url || "",
    cta_secondary_url: pageData.hero?.secondary_cta?.url || "",
  };
}

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  console.log("=== Rebuild Sample Lane Pages (New Architecture) ===\n");

  // Pre-compute slugs for related links
  const laneSlugs = SAMPLE_LANES.map((l) => {
    const citySlug = (s) => s.split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return {
      slug: `${citySlug(l.origin)}-to-${citySlug(l.destination)}`,
      origin: l.origin.split(",")[0].trim(),
      destination: l.destination.split(",")[0].trim(),
    };
  });

  const results = [];
  let allPassed = true;

  for (const lane of SAMPLE_LANES) {
    const citySlug = (s) => s.split(",")[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const slug = `${citySlug(lane.origin)}-to-${citySlug(lane.destination)}`;

    process.stdout.write(`  ${slug} ... `);

    // Step 1: Build lane knowledge
    const knowledge = buildLaneKnowledge(lane);

    // Step 2: Build related links from other sample lanes
    const oRegion = (knowledge.region_profile?.origin || "unknown").toLowerCase().replace(/\s+/g, "-");
    const dRegion = (knowledge.region_profile?.destination || "unknown").toLowerCase().replace(/\s+/g, "-");
    const relatedLinks = {
      corridor_hub: `/corridors/${oRegion}-to-${dRegion}`,
      related_lanes: laneSlugs
        .filter((l) => l.slug !== slug)
        .slice(0, 8)
        .map((l) => ({ label: `${l.origin} to ${l.destination}`, path: `/lanes/${l.slug}` })),
      tool_link: "https://www.wearewarp.com/quote",
      data_link: null,
    };

    // Step 3: Build canonical page data
    // Set origin/destination on knowledge for the builder
    knowledge.origin = lane.origin;
    knowledge.destination = lane.destination;
    knowledge.segment = lane.segment;
    const pageData = buildCanonicalLanePageData(knowledge, relatedLinks);

    // Step 4: Schema validation
    const schemaResult = validateLanePageSchema(pageData);

    // Step 5: Render Webflow fields
    const webflowFields = renderWebflowFields(pageData);
    const bodyHtml = webflowFields["body-content"];
    const faqEmbed = webflowFields["faq-schema"];
    const breadcrumbEmbed = webflowFields["breadcrumb-schema"];

    // Step 6: Legacy validation via runFullValidation
    const legacyPage = mapCanonicalToLegacyPage(pageData);
    const validation = runFullValidation(legacyPage, bodyHtml, faqEmbed, breadcrumbEmbed);

    // Step 7: Banned content scan
    const allContent = [bodyHtml, faqEmbed, breadcrumbEmbed].join("\n");
    const banScan = scanForBannedLaneContent(allContent);

    const passed = schemaResult.valid && validation.valid && banScan.clean;
    if (!passed) allPassed = false;

    const result = {
      slug,
      origin: lane.origin,
      destination: lane.destination,
      mode: lane.mode,
      segment: lane.segment,
      schema_valid: schemaResult.valid,
      schema_errors: schemaResult.errors,
      schema_warnings: schemaResult.warnings || [],
      publish_valid: validation.valid,
      quality_score: validation.quality_score,
      quality_breakdown: validation.quality_breakdown,
      gates: validation.gates,
      gate_errors: validation.errors.map((e) => e.message || e),
      banned_content_found: banScan.violations.map((v) => v.found),
      body_content_length: bodyHtml.length,
      faq_count: (pageData.lane_specific_faqs || []).length,
      distance_miles: pageData.lane_stats?.estimated_distance_miles || 0,
      transit_days: pageData.lane_stats?.estimated_transit_days_range || {},
      rate_range: pageData.lane_stats?.estimated_rate_range_usd || {},
      carrier_count: pageData.network_proof?.estimated_carrier_count || 0,
      sections_present: {
        lane_overview: bodyHtml.includes("Lane Overview"),
        warp_fit: bodyHtml.includes("WARP Operates") || bodyHtml.includes("How WARP"),
        operating_details: bodyHtml.includes("Operating Details"),
        pricing: bodyHtml.includes("Pricing"),
        validate: bodyHtml.includes("Validate This Lane"),
      },
      all_fields_present: !!(
        webflowFields.origin &&
        webflowFields.destination &&
        webflowFields.mode &&
        webflowFields.segment &&
        webflowFields["proof-section"] &&
        webflowFields["cta-primary-text"] &&
        webflowFields["breadcrumb-schema"]
      ),
      passed,
    };
    results.push(result);

    if (passed) {
      console.log(`PASS (score: ${validation.quality_score}, ${bodyHtml.length} chars)`);
    } else {
      const reasons = [];
      if (!schemaResult.valid) reasons.push(`schema: ${schemaResult.errors.length} errors`);
      if (!validation.valid) {
        const failedGates = Object.entries(validation.gates).filter(([, v]) => !v).map(([k]) => k);
        reasons.push(`gates: ${failedGates.join(", ")}`);
      }
      if (!banScan.clean) reasons.push(`banned: ${banScan.violations.length}`);
      console.log(`FAIL (${reasons.join("; ")})`);
    }

    // Write per-lane artifacts
    const laneDir = path.join(ROOT, "artifacts", "sample_rebuild", slug);
    fs.mkdirSync(laneDir, { recursive: true });
    fs.writeFileSync(path.join(laneDir, "webflow_payload.json"), JSON.stringify({ fields: webflowFields, slug, quality_score: validation.quality_score, validation_result: passed ? "passed" : "failed", generated_at: new Date().toISOString() }, null, 2));
    fs.writeFileSync(path.join(laneDir, "canonical_page_data.json"), JSON.stringify(pageData, null, 2));
    fs.writeFileSync(path.join(laneDir, "lane_knowledge.json"), JSON.stringify(knowledge, null, 2));
    fs.writeFileSync(path.join(laneDir, "body_content.html"), bodyHtml);
  }

  // Summary report
  const avgScore = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.quality_score, 0) / results.length) : 0;
  const report = {
    timestamp: new Date().toISOString(),
    pipeline: "lane-knowledge → lane-page-schema → render-lane-page → validator",
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    all_passed: allPassed,
    avg_quality_score: avgScore,
    sections_summary: {
      lane_overview: results.filter((r) => r.sections_present.lane_overview).length,
      warp_fit: results.filter((r) => r.sections_present.warp_fit).length,
      operating_details: results.filter((r) => r.sections_present.operating_details).length,
      pricing: results.filter((r) => r.sections_present.pricing).length,
      validate: results.filter((r) => r.sections_present.validate).length,
    },
    all_fields_complete: results.filter((r) => r.all_fields_present).length,
    banned_content_pages: results.filter((r) => r.banned_content_found.length > 0).length,
    results,
  };

  const reportPath = path.join(ROOT, "artifacts", "sample_lane_page_rebuild_report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("\n=== Summary ===");
  console.log(`  Total:            ${report.total}`);
  console.log(`  Passed:           ${report.passed}`);
  console.log(`  Failed:           ${report.failed}`);
  console.log(`  All passed:       ${allPassed ? "YES" : "NO"}`);
  console.log(`  Avg quality:      ${avgScore}`);
  console.log(`  All fields:       ${report.all_fields_complete}/${report.total}`);
  console.log(`  Banned content:   ${report.banned_content_pages} pages`);
  console.log("");
  console.log("  Sections present:");
  for (const [key, count] of Object.entries(report.sections_summary)) {
    console.log(`    ${key.padEnd(20)} ${count}/${report.total}`);
  }
  console.log("");
  console.log(`  Report: ${reportPath}`);
  console.log(`  Artifacts: artifacts/sample_rebuild/*/`);

  if (!allPassed) {
    console.log("\n  ⚠ Some lanes FAILED — check report for details.");
    process.exit(1);
  }
}

main();
