#!/usr/bin/env node

/**
 * Generate Lane Page Validation Report
 *
 * Reads all dry-run webflow_payload.json artifacts from publish_next
 * and produces a validation report showing quality scores, section
 * presence, banned content checks, and field completeness.
 *
 * Output: artifacts/lane_page_validation_report.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const dir = path.join(ROOT, "artifacts", "publish_next");
const slugs = fs.readdirSync(dir).filter(d => {
  try { return fs.statSync(path.join(dir, d)).isDirectory(); } catch { return false; }
});

const results = [];
for (const slug of slugs) {
  const payloadPath = path.join(dir, slug, "webflow_payload.json");
  if (!fs.existsSync(payloadPath)) continue;
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf-8"));
  const fields = payload.fields || {};
  const bodyContent = fields["body-content"] || "";
  const faqSchema = fields["faq-schema"] || "";

  // Check required sections
  const hasLaneOverview = bodyContent.includes("Lane Overview:");
  const hasWarpFit = bodyContent.includes("Why WARP Fits");
  const hasOperatingDetails = bodyContent.includes("Operating Details:");
  const hasPricing = bodyContent.includes("Pricing:");
  const hasValidate = bodyContent.includes("Validate This Lane");
  const hasFaqs = faqSchema.includes("FAQPage");
  const hasBreadcrumb = (fields["breadcrumb-schema"] || "").includes("BreadcrumbList");

  // Check for banned content
  const banned = ["STEP 1", "Book Freight Instantly", "Why Shippers Choose", "Stop Paying for a Broken", "Schedule a demo"];
  const bannedFound = banned.filter(b => bodyContent.toLowerCase().includes(b.toLowerCase()));

  // Count FAQs
  const faqMatches = faqSchema.match(/acceptedAnswer/g) || [];

  results.push({
    slug,
    quality_score: payload.quality_score || 0,
    validation_result: payload.validation_result || "unknown",
    body_content_length: bodyContent.length,
    sections: { hasLaneOverview, hasWarpFit, hasOperatingDetails, hasPricing, hasValidate, hasFaqs, hasBreadcrumb },
    faq_count: faqMatches.length,
    banned_content_found: bannedFound,
    all_fields_present: !!(fields.origin && fields.destination && fields.mode && fields.segment && fields["proof-section"] && fields["cta-primary-text"] && fields["breadcrumb-schema"]),
  });
}

const report = {
  timestamp: new Date().toISOString(),
  total_validated: results.length,
  passed: results.filter(r => r.validation_result === "passed").length,
  failed: results.filter(r => r.validation_result !== "passed").length,
  avg_quality_score: results.length > 0 ? Math.round(results.reduce((s, r) => s + r.quality_score, 0) / results.length) : 0,
  sections_summary: {
    lane_overview: results.filter(r => r.sections.hasLaneOverview).length,
    warp_fit: results.filter(r => r.sections.hasWarpFit).length,
    operating_details: results.filter(r => r.sections.hasOperatingDetails).length,
    pricing: results.filter(r => r.sections.hasPricing).length,
    validate: results.filter(r => r.sections.hasValidate).length,
    faqs: results.filter(r => r.sections.hasFaqs).length,
    breadcrumb: results.filter(r => r.sections.hasBreadcrumb).length,
  },
  all_fields_complete: results.filter(r => r.all_fields_present).length,
  banned_content_pages: results.filter(r => r.banned_content_found.length > 0).length,
  results,
};

const outPath = path.join(ROOT, "artifacts", "lane_page_validation_report.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log("=== Lane Page Validation Report ===");
console.log(`  Total validated:       ${report.total_validated}`);
console.log(`  Passed:                ${report.passed}`);
console.log(`  Failed:                ${report.failed}`);
console.log(`  Avg quality score:     ${report.avg_quality_score}`);
console.log(`  All fields complete:   ${report.all_fields_complete}/${report.total_validated}`);
console.log(`  Banned content pages:  ${report.banned_content_pages}`);
console.log("");
console.log("  Sections present:");
for (const [key, count] of Object.entries(report.sections_summary)) {
  console.log(`    ${key.padEnd(20)} ${count}/${report.total_validated}`);
}
console.log("");
console.log(`  Report: ${outPath}`);
