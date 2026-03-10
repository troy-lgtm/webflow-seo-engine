#!/usr/bin/env node

/**
 * Validate All Real Lanes
 *
 * Reads all rendered lane payloads from artifacts/rendered_lanes/<slug>/webflow_payload.json
 * (falls back to artifacts/publish_next/<slug>/webflow_payload.json if rendered_lanes does not exist).
 *
 * For each payload, runs validation checks:
 *   - Required Webflow fields present
 *   - body-content length >= 500 characters
 *   - faq-schema contains "FAQPage"
 *   - breadcrumb-schema contains "BreadcrumbList"
 *   - No banned phrases in body-content
 *   - seo-title length 30-70 chars
 *   - seo-description length 80-170 chars
 *   - FAQ count >= 3
 *
 * Computes a quality score per page (0-100) and writes
 * artifacts/lane_page_validation_report.json.
 *
 * Output: artifacts/lane_page_validation_report.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = [
  "name",
  "slug",
  "seo-title",
  "seo-description",
  "body-content",
  "faq-schema",
  "breadcrumb-schema",
  "origin",
  "destination",
  "mode",
  "segment",
  "proof-section",
  "cta-primary-text",
  "cta-primary-url",
];

const BANNED_PHRASES = [
  "STEP 1",
  "Book Freight Instantly",
  "Why Shippers Choose",
  "Stop Paying for a Broken",
  "Schedule a demo",
];

// ---------------------------------------------------------------------------
// Resolve the payload directory
// ---------------------------------------------------------------------------

function resolvePayloadDir() {
  const rendered = path.join(ROOT, "artifacts", "rendered_lanes");
  if (fs.existsSync(rendered)) return rendered;

  const publishNext = path.join(ROOT, "artifacts", "publish_next");
  if (fs.existsSync(publishNext)) return publishNext;

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the seo-description value from the payload fields.
 * Some payloads use "seo-description", others use "seo-meta-description".
 */
function getSeoDescription(fields) {
  return fields["seo-description"] || fields["seo-meta-description"] || "";
}

/**
 * Check whether a required field is present and non-empty.
 * Special-case seo-description which may be stored under a different key.
 */
function fieldPresent(fields, fieldName) {
  if (fieldName === "seo-description") {
    return getSeoDescription(fields).length > 0;
  }
  const val = fields[fieldName];
  return val !== undefined && val !== null && String(val).length > 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const dir = resolvePayloadDir();
  if (!dir) {
    console.error("ERROR: No payload directory found (artifacts/rendered_lanes or artifacts/publish_next).");
    process.exit(1);
  }

  console.log(`[validate_all_real_lanes] Reading payloads from ${path.relative(ROOT, dir)}/`);

  const slugDirs = fs.readdirSync(dir).filter((d) => {
    try {
      return fs.statSync(path.join(dir, d)).isDirectory();
    } catch {
      return false;
    }
  });

  const results = [];

  for (const slug of slugDirs) {
    const payloadPath = path.join(dir, slug, "webflow_payload.json");
    if (!fs.existsSync(payloadPath)) continue;

    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(payloadPath, "utf-8"));
    } catch {
      results.push({
        slug,
        score: 0,
        passed: false,
        issues: ["Invalid JSON in webflow_payload.json"],
      });
      continue;
    }

    // Support both flat payload format (from render_all_real_lanes) and nested { fields: {...} } format
    const fields = payload.fields || (payload["body-content"] ? payload : {});
    const bodyContent = fields["body-content"] || "";
    const faqSchema = fields["faq-schema"] || "";
    const breadcrumbSchema = fields["breadcrumb-schema"] || "";
    const seoTitle = fields["seo-title"] || "";
    const seoDescription = getSeoDescription(fields);

    const issues = [];
    let score = 0;

    // -----------------------------------------------------------------------
    // Check 1: All required fields present (20 pts)
    // -----------------------------------------------------------------------
    const missingFields = REQUIRED_FIELDS.filter((f) => !fieldPresent(fields, f));
    if (missingFields.length === 0) {
      score += 20;
    } else {
      issues.push(`Missing fields: ${missingFields.join(", ")}`);
    }

    // -----------------------------------------------------------------------
    // Check 2: body-content >= 500 chars (20 pts)
    // -----------------------------------------------------------------------
    if (bodyContent.length >= 500) {
      score += 20;
    } else {
      issues.push(`body-content too short (${bodyContent.length} chars, need >= 500)`);
    }

    // -----------------------------------------------------------------------
    // Check 3: No banned content (15 pts)
    // -----------------------------------------------------------------------
    const bannedFound = BANNED_PHRASES.filter((phrase) =>
      bodyContent.toLowerCase().includes(phrase.toLowerCase())
    );
    if (bannedFound.length === 0) {
      score += 15;
    } else {
      issues.push(`Banned content found: ${bannedFound.join("; ")}`);
    }

    // -----------------------------------------------------------------------
    // Check 4: FAQ count >= 4 (15 pts)
    // -----------------------------------------------------------------------
    const faqMatches = faqSchema.match(/acceptedAnswer/g) || [];
    const faqCount = faqMatches.length;
    if (faqCount >= 4) {
      score += 15;
    } else {
      issues.push(`FAQ count too low (${faqCount}, need >= 4)`);
    }

    // -----------------------------------------------------------------------
    // Check 5: seo-title length 30-70 chars (15 pts)
    // -----------------------------------------------------------------------
    if (seoTitle.length >= 30 && seoTitle.length <= 70) {
      score += 15;
    } else {
      issues.push(`seo-title length out of range (${seoTitle.length} chars, need 30-70)`);
    }

    // -----------------------------------------------------------------------
    // Check 6: seo-description length 80-170 chars (15 pts)
    // -----------------------------------------------------------------------
    if (seoDescription.length >= 80 && seoDescription.length <= 170) {
      score += 15;
    } else {
      issues.push(`seo-description length out of range (${seoDescription.length} chars, need 80-170)`);
    }

    // -----------------------------------------------------------------------
    // Required schema validation (spec: schema_valid, fallback_template)
    // -----------------------------------------------------------------------
    const schemaValid = faqSchema.includes("FAQPage") && breadcrumbSchema.includes("BreadcrumbList");
    if (!schemaValid) {
      if (!faqSchema.includes("FAQPage")) issues.push("faq-schema missing FAQPage");
      if (!breadcrumbSchema.includes("BreadcrumbList")) issues.push("breadcrumb-schema missing BreadcrumbList");
    }

    // fallback_template detection: check for generic Webflow template leakage
    const FALLBACK_MARKERS = ["Book Freight Instantly", "Why Shippers Choose", "Stop Paying for a Broken", "wistia-player"];
    const fallbackTemplate = FALLBACK_MARKERS.some((m) => bodyContent.includes(m));
    if (fallbackTemplate) {
      issues.push("Fallback template content detected in body-content");
    }

    // Use the payload's quality_score if present and we computed a perfect 100
    const finalScore = payload.quality_score !== undefined ? Math.min(payload.quality_score, score) : score;
    // Actually: prefer our computed score for consistency
    const computedScore = score;

    results.push({
      slug,
      score: computedScore,
      passed: computedScore >= 80,
      issues,
    });
  }

  // -------------------------------------------------------------------------
  // Aggregate statistics
  // -------------------------------------------------------------------------

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const avgScore =
    results.length > 0
      ? Math.round((results.reduce((sum, r) => sum + r.score, 0) / results.length) * 10) / 10
      : 0;

  const qualityDistribution = { "90-100": 0, "80-89": 0, "70-79": 0, "below-70": 0 };
  for (const r of results) {
    if (r.score >= 90) qualityDistribution["90-100"]++;
    else if (r.score >= 80) qualityDistribution["80-89"]++;
    else if (r.score >= 70) qualityDistribution["70-79"]++;
    else qualityDistribution["below-70"]++;
  }

  const bannedContentPages = results.filter((r) =>
    r.issues.some((i) => i.startsWith("Banned content found"))
  ).length;

  const missingFieldsPages = results.filter((r) =>
    r.issues.some((i) => i.startsWith("Missing fields"))
  ).length;

  // -------------------------------------------------------------------------
  // Write report
  // -------------------------------------------------------------------------

  const report = {
    timestamp: new Date().toISOString(),
    total_validated: results.length,
    passed,
    failed,
    avg_quality_score: avgScore,
    quality_distribution: qualityDistribution,
    banned_content_pages: bannedContentPages,
    missing_fields_pages: missingFieldsPages,
    results: results.sort((a, b) => a.score - b.score),
  };

  const outPath = path.join(ROOT, "artifacts", "lane_page_validation_report.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // -------------------------------------------------------------------------
  // Console summary
  // -------------------------------------------------------------------------

  console.log("");
  console.log("===== Lane Page Validation Report =====");
  console.log(`  Timestamp:            ${report.timestamp}`);
  console.log(`  Total validated:      ${report.total_validated}`);
  console.log(`  Passed (>= 80):      ${report.passed}`);
  console.log(`  Failed (< 80):       ${report.failed}`);
  console.log(`  Avg quality score:   ${report.avg_quality_score}`);
  console.log("");
  console.log("  Quality distribution:");
  console.log(`    90-100:  ${qualityDistribution["90-100"]}`);
  console.log(`    80-89:   ${qualityDistribution["80-89"]}`);
  console.log(`    70-79:   ${qualityDistribution["70-79"]}`);
  console.log(`    below-70: ${qualityDistribution["below-70"]}`);
  console.log("");
  console.log(`  Banned content pages: ${report.banned_content_pages}`);
  console.log(`  Missing fields pages: ${report.missing_fields_pages}`);
  console.log("");

  // Show the worst performers
  const failing = results.filter((r) => !r.passed);
  if (failing.length > 0) {
    console.log("  Failing pages:");
    for (const r of failing.slice(0, 20)) {
      console.log(`    ${r.slug} (score: ${r.score})`);
      for (const issue of r.issues) {
        console.log(`      - ${issue}`);
      }
    }
    if (failing.length > 20) {
      console.log(`    ... and ${failing.length - 20} more`);
    }
  }

  console.log("");
  console.log(`  Report: ${outPath}`);
  console.log("===== Done =====");
}

main();
