/**
 * Lane Page Validator
 *
 * Hard validation for lane page content before publish.
 * Enforces the lane page contract (docs/lane-page-contract.md)
 * and banned content registry (config/lane-page-banned-content.json).
 *
 * Exports:
 *   validateLanePageFields(pageData)     — checks required fields
 *   validateLanePageHtml(html, pageData) — checks rendered HTML structure
 *   scanForBannedLaneContent(html)       — scans for banned phrases/embeds
 *   computeLanePageQualityScore(pageData, html) — 0-100 quality score
 *   runFullValidation(pageData, html)    — runs all checks, returns gate results
 *   detectGenericMarketingTone(pageData, html)    — checks for marketing patterns vs operational phrasing
 *   detectFallbackTemplateLeakage(html)           — detects generic template content leaking through
 *   validateLanePageForPublish(pageData, html)    — master publish gate (runs all checks)
 *
 * Used by: publish_next.js, ship_firstpage.js, patch_published_pages.js,
 *          audit_existing_lane_pages.js
 *
 * NOTE: This file must work in raw Node.js scripts (no @/ aliases).
 *       Import with relative paths from scripts/.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scorePageQuality, scoreFaqSet } from "./page-quality-scorer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Load banned content config ---
let _bannedConfig = null;
function loadBannedConfig() {
  if (_bannedConfig) return _bannedConfig;
  const localPath = path.join(__dirname, "..", "config", "lane-page-banned-content.json");
  const configPath = fs.existsSync(localPath) ? localPath : path.join(process.cwd(), "config", "lane-page-banned-content.json");
  try {
    _bannedConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    _bannedConfig = {
      banned_phrases: [],
      banned_section_headings: [],
      banned_embed_patterns: [],
      banned_html_selectors: [],
      required_sections: [],
      quality_thresholds: { min_faq_count: 4, min_quality_score: 70, min_body_content_length: 500 },
      gate_rule_ids: {},
    };
  }
  return _bannedConfig;
}

// ── REQUIRED FIELDS ─────────────────────────────────────────────────

const REQUIRED_PAGE_FIELDS = [
  "slug",
  "canonical_path",
  "seo_title",
  "meta_description",
  "h1",
  "intro",
  "lane",
  "lane_stats",
  "network_proof",
  "faq",
  "proof_section",
];

const REQUIRED_LANE_SUB_FIELDS = ["origin", "destination", "mode"];

/**
 * Validate that all required content fields are present and non-empty.
 * Returns { valid, errors, warnings }
 */
export function validateLanePageFields(pageData) {
  const errors = [];
  const warnings = [];

  if (!pageData) {
    return { valid: false, errors: ["pageData is null or undefined"], warnings };
  }

  // Check top-level required fields
  for (const field of REQUIRED_PAGE_FIELDS) {
    const val = pageData[field];
    if (val === undefined || val === null) {
      errors.push({ rule_id: "LANE-CONTENT-01", field, message: `Missing required field: ${field}` });
    } else if (typeof val === "string" && val.trim() === "") {
      errors.push({ rule_id: "LANE-CONTENT-01", field, message: `Empty required field: ${field}` });
    }
  }

  // Check lane sub-fields
  if (pageData.lane) {
    for (const field of REQUIRED_LANE_SUB_FIELDS) {
      if (!pageData.lane[field]) {
        errors.push({ rule_id: "LANE-CONTENT-01", field: `lane.${field}`, message: `Missing lane field: ${field}` });
      }
    }
  }

  // Check lane_stats has real data (distance > 0)
  if (pageData.lane_stats) {
    const dist = pageData.lane_stats.estimated_distance_miles;
    if (!dist || dist <= 0) {
      errors.push({ rule_id: "LANE-CONTENT-01", field: "lane_stats.estimated_distance_miles", message: "Lane stats missing real distance data (enrichment likely failed)" });
    }
  }

  // Check FAQs
  const faqCount = Array.isArray(pageData.faq) ? pageData.faq.length : 0;
  const config = loadBannedConfig();
  const minFaq = config.quality_thresholds?.min_faq_count || 4;
  if (faqCount < minFaq) {
    errors.push({ rule_id: "LANE-FAQ-01", field: "faq", message: `Insufficient FAQ count: ${faqCount} (minimum ${minFaq})` });
  }

  // Check H1 contains origin, destination, and LTL/mode
  if (pageData.h1 && pageData.lane) {
    const h1Lower = pageData.h1.toLowerCase();
    const originCity = (pageData.lane.origin || "").split(",")[0].trim().toLowerCase();
    const destCity = (pageData.lane.destination || "").split(",")[0].trim().toLowerCase();
    const mode = (pageData.lane.mode || "").toLowerCase();

    if (originCity && !h1Lower.includes(originCity)) {
      warnings.push({ rule_id: "LANE-HTML-01", field: "h1", message: `H1 does not contain origin city: ${originCity}` });
    }
    if (destCity && !h1Lower.includes(destCity)) {
      warnings.push({ rule_id: "LANE-HTML-01", field: "h1", message: `H1 does not contain destination city: ${destCity}` });
    }
    if (mode && !h1Lower.includes(mode)) {
      warnings.push({ rule_id: "LANE-HTML-01", field: "h1", message: `H1 does not contain mode: ${mode}` });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── BANNED CONTENT SCAN ─────────────────────────────────────────────

/**
 * Scan HTML or text content for banned phrases, headings, and embeds.
 * Returns { clean, violations }
 */
export function scanForBannedLaneContent(content) {
  if (!content) return { clean: true, violations: [] };

  const config = loadBannedConfig();
  const violations = [];
  const contentLower = content.toLowerCase();

  // Check banned phrases
  for (const phrase of config.banned_phrases || []) {
    if (contentLower.includes(phrase.toLowerCase())) {
      violations.push({
        rule_id: "LANE-BANNED-01",
        type: "banned_phrase",
        found: phrase,
        message: `Banned phrase found: "${phrase}"`,
      });
    }
  }

  // Check banned section headings
  for (const heading of config.banned_section_headings || []) {
    // Look for heading in h1-h6 tags or as standalone text
    const headingLower = heading.toLowerCase();
    if (contentLower.includes(headingLower)) {
      // Verify it's actually used as a heading or section title, not just mentioned
      const headingPatterns = [
        `<h1[^>]*>${heading}`,
        `<h2[^>]*>${heading}`,
        `<h3[^>]*>${heading}`,
        `<h4[^>]*>${heading}`,
        `<h5[^>]*>${heading}`,
        `<h6[^>]*>${heading}`,
      ];
      const isHeading = headingPatterns.some(p => new RegExp(p, "i").test(content));
      if (isHeading) {
        violations.push({
          rule_id: "LANE-BANNED-01",
          type: "banned_heading",
          found: heading,
          message: `Banned section heading found: "${heading}"`,
        });
      }
    }
  }

  // Check banned embed patterns
  // Strip <style> blocks first — our CSS rules that HIDE banned elements
  // contain the strings themselves (e.g., "wistia-player{display:none}")
  // and should not trigger false positives.
  const contentWithoutStyles = content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  const contentWithoutStylesLower = contentWithoutStyles.toLowerCase();
  for (const pattern of config.banned_embed_patterns || []) {
    if (contentWithoutStylesLower.includes(pattern.toLowerCase())) {
      violations.push({
        rule_id: "LANE-BANNED-02",
        type: "banned_embed",
        found: pattern,
        message: `Banned embed pattern found: "${pattern}"`,
      });
    }
  }

  // Check banned HTML selectors (simple pattern matching)
  for (const selector of config.banned_html_selectors || []) {
    if (content.includes(selector.replace(/^\./, "class=\"").replace(/^\[/, "").replace(/\]$/, ""))) {
      // Simple check — not full CSS selector matching but catches most cases
    }
    // Direct element name check
    if (selector.startsWith("wistia-player") && contentLower.includes("<wistia-player")) {
      violations.push({
        rule_id: "LANE-BANNED-02",
        type: "banned_html_element",
        found: selector,
        message: `Banned HTML element found: ${selector}`,
      });
    }
  }

  return { clean: violations.length === 0, violations };
}

// ── HTML STRUCTURE VALIDATION ───────────────────────────────────────

/**
 * Section detection patterns for the required page structure.
 * Each section has identifying patterns to look for in the HTML.
 */
const SECTION_PATTERNS = {
  lane_overview: {
    headings: [/lane overview/i, /about this lane/i, /overview/i],
    contentPatterns: [/this (lane|corridor|route)/i, /freight (from|between|on)/i],
  },
  warp_fit: {
    headings: [/warp fit/i, /why warp/i, /warp.*this lane/i, /how warp operates/i, /how warp handles/i],
    contentPatterns: [/warp('s|'s|\s)?(carrier|network|platform)/i, /palletized/i, /appointment/i, /visibility/i],
  },
  operating_details: {
    headings: [/operat/i, /transit detail/i, /lane operations/i, /service detail/i],
    contentPatterns: [/(equipment|cross[- ]dock|transit|carrier)/i, /miles/i, /business days/i],
  },
  pricing_section: {
    headings: [/pric/i, /commercial/i, /cost/i, /rate/i],
    contentPatterns: [/\$/i, /per[- ](mile|pallet|shipment)/i, /rate/i, /cost factor/i],
  },
  faqs: {
    headings: [/faq/i, /frequently asked/i, /questions/i],
    contentPatterns: [/<details/i, /FAQPage/i, /acceptedAnswer/i],
  },
  related_links: {
    headings: [/related/i, /more lanes/i, /explore/i, /nearby/i],
    contentPatterns: [/\/lanes\//i, /corridor/i],
  },
};

/**
 * Validate rendered HTML against the lane page structure spec.
 * Returns { valid, sections_found, sections_missing, errors, warnings }
 */
export function validateLanePageHtml(html, pageData) {
  const errors = [];
  const warnings = [];
  const sectionsFound = {};
  const sectionsMissing = [];

  if (!html || html.trim().length === 0) {
    return {
      valid: false,
      sections_found: {},
      sections_missing: Object.keys(SECTION_PATTERNS),
      errors: [{ rule_id: "LANE-HTML-01", message: "HTML content is empty" }],
      warnings,
    };
  }

  // Combine all content sources for section detection
  // (body-content + faq-schema + breadcrumb-schema + subheadline)
  const fullContent = [
    html,
    pageData?.intro || "",
    pageData?.proof_section || "",
  ].join(" ");
  const fullContentLower = fullContent.toLowerCase();

  // Check for each required section
  for (const [sectionId, patterns] of Object.entries(SECTION_PATTERNS)) {
    const headingMatch = patterns.headings.some(p => p.test(fullContent));
    const contentMatch = patterns.contentPatterns.some(p => p.test(fullContent));

    if (headingMatch || contentMatch) {
      sectionsFound[sectionId] = true;
    } else {
      sectionsMissing.push(sectionId);
      // FAQs and related_links might be in separate embed fields
      if (sectionId !== "faqs" && sectionId !== "related_links") {
        errors.push({
          rule_id: "LANE-HTML-01",
          section: sectionId,
          message: `Required section missing: ${sectionId}`,
        });
      }
    }
  }

  // Check minimum content length
  const config = loadBannedConfig();
  const minLength = config.quality_thresholds?.min_body_content_length || 500;
  const textOnly = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (textOnly.length < minLength) {
    errors.push({
      rule_id: "LANE-HTML-01",
      message: `Body content too short: ${textOnly.length} chars (minimum ${minLength})`,
    });
  }

  // Check for lane-specific content (origin/destination city names)
  if (pageData?.lane) {
    const originCity = (pageData.lane.origin || "").split(",")[0].trim().toLowerCase();
    const destCity = (pageData.lane.destination || "").split(",")[0].trim().toLowerCase();
    if (originCity && !fullContentLower.includes(originCity)) {
      warnings.push({ rule_id: "LANE-TONE-01", message: `Content does not mention origin city: ${originCity}` });
    }
    if (destCity && !fullContentLower.includes(destCity)) {
      warnings.push({ rule_id: "LANE-TONE-01", message: `Content does not mention destination city: ${destCity}` });
    }
  }

  // Scan for banned content
  const banScan = scanForBannedLaneContent(fullContent);
  if (!banScan.clean) {
    for (const v of banScan.violations) {
      errors.push(v);
    }
  }

  return {
    valid: errors.length === 0,
    sections_found: sectionsFound,
    sections_missing: sectionsMissing,
    errors,
    warnings,
  };
}

// ── QUALITY SCORE ───────────────────────────────────────────────────

/**
 * Compute a 0-100 quality score for a lane page.
 *
 * Components:
 *   Required sections present:  30 pts
 *   FAQ count (4+):             10 pts
 *   Banned content absent:      20 pts
 *   Body content length:        10 pts
 *   Lane-specific terms:        10 pts
 *   Internal links present:     10 pts
 *   Structured data present:    10 pts
 */
export function computeLanePageQualityScore(pageData, html) {
  let score = 0;
  const breakdown = {};

  // 1. Required sections present (30 pts)
  const requiredSections = Object.keys(SECTION_PATTERNS);
  let sectionsPresent = 0;
  const fullContent = [html || "", pageData?.intro || "", pageData?.proof_section || ""].join(" ");

  for (const [sectionId, patterns] of Object.entries(SECTION_PATTERNS)) {
    const headingMatch = patterns.headings.some(p => p.test(fullContent));
    const contentMatch = patterns.contentPatterns.some(p => p.test(fullContent));
    if (headingMatch || contentMatch) sectionsPresent++;
  }
  const sectionScore = Math.round((sectionsPresent / requiredSections.length) * 30);
  score += sectionScore;
  breakdown.sections = { score: sectionScore, max: 30, found: sectionsPresent, total: requiredSections.length };

  // 2. FAQ count (10 pts)
  const faqCount = Array.isArray(pageData?.faq) ? pageData.faq.length : 0;
  const faqScore = faqCount >= 5 ? 10 : faqCount >= 4 ? 8 : faqCount >= 3 ? 5 : faqCount >= 1 ? 2 : 0;
  score += faqScore;
  breakdown.faqs = { score: faqScore, max: 10, count: faqCount };

  // 3. Banned content absent (20 pts)
  const banScan = scanForBannedLaneContent(fullContent);
  const banScore = banScan.clean ? 20 : Math.max(0, 20 - banScan.violations.length * 5);
  score += banScore;
  breakdown.banned_content = { score: banScore, max: 20, violations: banScan.violations.length };

  // 4. Body content length (10 pts)
  const textOnly = (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const lenScore = textOnly.length >= 2000 ? 10 : textOnly.length >= 1000 ? 7 : textOnly.length >= 500 ? 5 : textOnly.length >= 200 ? 2 : 0;
  score += lenScore;
  breakdown.content_length = { score: lenScore, max: 10, chars: textOnly.length };

  // 5. Lane-specific terms (10 pts)
  let laneTermScore = 0;
  if (pageData?.lane) {
    const contentLower = fullContent.toLowerCase();
    const originCity = (pageData.lane.origin || "").split(",")[0].trim().toLowerCase();
    const destCity = (pageData.lane.destination || "").split(",")[0].trim().toLowerCase();
    const mode = (pageData.lane.mode || "").toLowerCase();

    if (originCity && contentLower.includes(originCity)) laneTermScore += 3;
    if (destCity && contentLower.includes(destCity)) laneTermScore += 3;
    if (mode && contentLower.includes(mode)) laneTermScore += 2;
    if (contentLower.includes("mile")) laneTermScore += 1;
    if (contentLower.includes("carrier") || contentLower.includes("cross-dock")) laneTermScore += 1;
  }
  laneTermScore = Math.min(10, laneTermScore);
  score += laneTermScore;
  breakdown.lane_terms = { score: laneTermScore, max: 10 };

  // 6. Internal links present (10 pts)
  let linkScore = 0;
  if (fullContent.includes("/lanes/")) linkScore += 4;
  if (fullContent.includes("/corridors/") || fullContent.includes("corridor")) linkScore += 3;
  if (fullContent.includes("/guides/") || fullContent.includes("tool")) linkScore += 3;
  linkScore = Math.min(10, linkScore);
  score += linkScore;
  breakdown.internal_links = { score: linkScore, max: 10 };

  // 7. Structured data present (10 pts)
  let schemaScore = 0;
  if (fullContent.includes("BreadcrumbList")) schemaScore += 3;
  if (fullContent.includes("FAQPage")) schemaScore += 3;
  if (fullContent.includes('"@type":"Service"') || fullContent.includes('"@type": "Service"')) schemaScore += 2;
  if (fullContent.includes('"@type":"Organization"') || fullContent.includes('"@type": "Organization"')) schemaScore += 2;
  schemaScore = Math.min(10, schemaScore);
  score += schemaScore;
  breakdown.structured_data = { score: schemaScore, max: 10 };

  return { score, max: 100, breakdown };
}

// ── FULL VALIDATION (ALL GATES) ─────────────────────────────────────

/**
 * Run the complete validation suite for a lane page.
 * Returns a validation result with gate pass/fail for each rule.
 *
 * @param {Object} pageData — the page object from buildPackageForLane
 * @param {string} bodyHtml — the body-content HTML
 * @param {string} faqEmbed — the faq-schema code embed (optional, for banned content scan)
 * @param {string} breadcrumbEmbed — the breadcrumb-schema code embed (optional)
 * @returns {Object} { valid, quality_score, gates, errors, warnings }
 */
export function runFullValidation(pageData, bodyHtml, faqEmbed = "", breadcrumbEmbed = "") {
  const allContent = [bodyHtml || "", faqEmbed || "", breadcrumbEmbed || ""].join("\n");

  // 1. Field validation
  const fieldResult = validateLanePageFields(pageData);

  // 2. HTML validation
  const htmlResult = validateLanePageHtml(bodyHtml || "", pageData);

  // 3. Banned content scan on all embeds
  const banScan = scanForBannedLaneContent(allContent);

  // 4. Quality score
  const qualityResult = computeLanePageQualityScore(pageData, allContent);

  // Aggregate errors and warnings
  const allErrors = [...fieldResult.errors, ...htmlResult.errors];
  const allWarnings = [...fieldResult.warnings, ...htmlResult.warnings];

  // Add banned content violations that aren't already in htmlResult
  for (const v of banScan.violations) {
    if (!allErrors.some(e => e.found === v.found && e.rule_id === v.rule_id)) {
      allErrors.push(v);
    }
  }

  // Check quality threshold
  const config = loadBannedConfig();
  const minScore = config.quality_thresholds?.min_quality_score || 70;
  if (qualityResult.score < minScore) {
    allErrors.push({
      rule_id: "LANE-TONE-01",
      message: `Quality score ${qualityResult.score} below minimum threshold ${minScore}`,
    });
  }

  // Build gate results
  const gates = {
    "LANE-CONTENT-01": !allErrors.some(e => e.rule_id === "LANE-CONTENT-01"),
    "LANE-BANNED-01": !allErrors.some(e => e.rule_id === "LANE-BANNED-01"),
    "LANE-BANNED-02": !allErrors.some(e => e.rule_id === "LANE-BANNED-02"),
    "LANE-HTML-01": !allErrors.some(e => e.rule_id === "LANE-HTML-01"),
    "LANE-FAQ-01": !allErrors.some(e => e.rule_id === "LANE-FAQ-01"),
    "LANE-TONE-01": !allErrors.some(e => e.rule_id === "LANE-TONE-01"),
    "LANE-FALLBACK-01": !allErrors.some(e => e.rule_id === "LANE-FALLBACK-01"),
  };

  const valid = Object.values(gates).every(Boolean);

  return {
    valid,
    quality_score: qualityResult.score,
    quality_breakdown: qualityResult.breakdown,
    gates,
    sections_found: htmlResult.sections_found,
    sections_missing: htmlResult.sections_missing,
    faq_count: Array.isArray(pageData?.faq) ? pageData.faq.length : 0,
    banned_content_found: banScan.violations.map(v => v.found),
    errors: allErrors,
    warnings: allWarnings,
  };
}

// ── CLASSIFY EXISTING PAGE ──────────────────────────────────────────

/**
 * Classify an existing page for the audit script.
 * Returns one of:
 *   valid_lane_page | generic_template_page | fallback_content_page |
 *   thin_lane_page | banned_content_page
 */
export function classifyExistingPage(html, pageData) {
  const result = runFullValidation(pageData, html);
  const reasons = [];

  // Check for banned content → banned_content_page
  if (result.banned_content_found.length > 0) {
    reasons.push(...result.banned_content_found.map(f => `contains banned content: ${f}`));
    return { classification: "banned_content_page", reasons, quality_score: result.quality_score };
  }

  // Check for fallback template content
  const contentLower = (html || "").toLowerCase();
  const fallbackSignals = [
    contentLower.includes("step 1"),
    contentLower.includes("step 2"),
    contentLower.includes("book freight instantly"),
    contentLower.includes("why shippers choose"),
    contentLower.includes("stop paying for a broken"),
    contentLower.includes("<wistia-player"),
  ];
  const fallbackCount = fallbackSignals.filter(Boolean).length;

  if (fallbackCount >= 2) {
    if (contentLower.includes("step 1")) reasons.push("contains STEP 1 tutorial copy");
    if (contentLower.includes("<wistia-player")) reasons.push("contains video embed");
    if (contentLower.includes("book freight instantly")) reasons.push("contains Book Freight Instantly");
    return { classification: "fallback_content_page", reasons, quality_score: result.quality_score };
  }

  // Check for generic template page (missing lane-specific content)
  if (result.quality_score < 40) {
    if (result.sections_missing.length > 3) reasons.push(`missing ${result.sections_missing.length} required sections`);
    if (result.faq_count < 2) reasons.push("insufficient FAQs");
    reasons.push(`quality score: ${result.quality_score}`);
    return { classification: "generic_template_page", reasons, quality_score: result.quality_score };
  }

  // Check for thin lane page
  const textOnly = (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (textOnly.length < 500 || result.quality_score < 70) {
    if (textOnly.length < 500) reasons.push(`body content too short: ${textOnly.length} chars`);
    if (result.quality_score < 70) reasons.push(`quality score below threshold: ${result.quality_score}`);
    if (result.sections_missing.length > 0) reasons.push(`missing sections: ${result.sections_missing.join(", ")}`);
    return { classification: "thin_lane_page", reasons, quality_score: result.quality_score };
  }

  // Valid lane page
  return { classification: "valid_lane_page", reasons: [], quality_score: result.quality_score };
}

// ── COPY RULES CONFIG ───────────────────────────────────────────────

let _copyRulesConfig = null;
function loadCopyRulesConfig() {
  if (_copyRulesConfig) return _copyRulesConfig;
  const localPath = path.join(__dirname, "..", "config", "lane-page-copy-rules.json");
  const configPath = fs.existsSync(localPath) ? localPath : path.join(process.cwd(), "config", "lane-page-copy-rules.json");
  try {
    _copyRulesConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    _copyRulesConfig = {
      generic_marketing_patterns: [],
      operational_phrasing_patterns: [],
      maximum_marketing_pattern_count: 0,
      minimum_operational_term_count: 5,
    };
  }
  return _copyRulesConfig;
}

// ── GENERIC MARKETING TONE DETECTION ────────────────────────────────

/**
 * Detect generic marketing tone by comparing marketing pattern matches
 * against operational phrasing matches.
 *
 * Returns { clean, marketing_pattern_count, operational_term_count, violations, score }
 *   score: 0-100 where 100 = no marketing patterns, high operational terms
 */
export function detectGenericMarketingTone(pageData, html) {
  const copyRules = loadCopyRulesConfig();
  const violations = [];

  // Combine all textual content for scanning
  const fullText = [
    html || "",
    pageData?.intro || "",
    pageData?.proof_section || "",
    pageData?.h1 || "",
    pageData?.meta_description || "",
  ].join(" ");

  // Strip HTML tags for cleaner text matching
  const textOnly = fullText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const textLower = textOnly.toLowerCase();

  // Count marketing pattern matches
  let marketingPatternCount = 0;
  const marketingMatches = [];
  for (const pattern of copyRules.generic_marketing_patterns || []) {
    try {
      const regex = new RegExp(pattern, "gi");
      const matches = textOnly.match(regex);
      if (matches) {
        marketingPatternCount += matches.length;
        marketingMatches.push({ pattern, count: matches.length, samples: matches.slice(0, 3) });
      }
    } catch {
      // Skip invalid regex patterns
    }
  }

  // Count operational phrasing matches
  let operationalTermCount = 0;
  const operationalMatches = [];
  for (const pattern of copyRules.operational_phrasing_patterns || []) {
    try {
      const regex = new RegExp(pattern, "gi");
      const matches = textOnly.match(regex);
      if (matches) {
        operationalTermCount += matches.length;
        operationalMatches.push({ pattern, count: matches.length });
      }
    } catch {
      // Skip invalid regex patterns
    }
  }

  // Check thresholds
  const maxMarketing = copyRules.maximum_marketing_pattern_count ?? copyRules.copy_quality_thresholds?.max_generic_marketing_patterns ?? 0;
  const minOperational = copyRules.minimum_operational_term_count ?? 5;

  if (marketingPatternCount > maxMarketing) {
    violations.push({
      rule_id: "LANE-TONE-01",
      type: "generic_marketing_tone",
      message: `Found ${marketingPatternCount} generic marketing pattern(s) (max allowed: ${maxMarketing})`,
      matches: marketingMatches,
    });
  }

  if (operationalTermCount < minOperational) {
    violations.push({
      rule_id: "LANE-TONE-01",
      type: "insufficient_operational_terms",
      message: `Only ${operationalTermCount} operational term(s) found (minimum: ${minOperational})`,
      matches: operationalMatches,
    });
  }

  // Compute score: 0-100 where 100 = perfect (no marketing, high operational)
  // Marketing penalty: each marketing pattern reduces score
  const marketingPenalty = Math.min(50, marketingPatternCount * 10);
  // Operational bonus: more operational terms = higher score
  const operationalBonus = Math.min(50, (operationalTermCount / Math.max(minOperational, 1)) * 50);
  const score = Math.max(0, Math.min(100, Math.round(100 - marketingPenalty + (operationalBonus - 50))));

  return {
    clean: violations.length === 0,
    marketing_pattern_count: marketingPatternCount,
    operational_term_count: operationalTermCount,
    violations,
    score,
  };
}

// ── FALLBACK TEMPLATE LEAKAGE DETECTION ─────────────────────────────

/**
 * Detect content that looks like it came from the generic Webflow template
 * rather than the dedicated lane renderer.
 *
 * Returns { clean, leakage_signals, confidence }
 *   confidence: "none" | "low" | "medium" | "high"
 */
export function detectFallbackTemplateLeakage(html) {
  if (!html) return { clean: true, leakage_signals: [], confidence: "none" };

  const signals = [];

  // Strip <style> blocks to avoid matching CSS selectors/rules
  const htmlWithoutStyles = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  const htmlLower = htmlWithoutStyles.toLowerCase();

  // 1. <wistia-player> elements (NOT inside <style>)
  if (/<wistia-player/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "wistia_player_element", detail: "<wistia-player> element found in body" });
  }

  // 2. data-wistia-id attributes
  if (/data-wistia-id/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "wistia_data_attribute", detail: "data-wistia-id attribute found" });
  }

  // 3. Tutorial step indicators
  if (/\bSTEP\s+1\b/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "tutorial_step_1", detail: "STEP 1 indicator found" });
  }
  if (/\bSTEP\s+2\b/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "tutorial_step_2", detail: "STEP 2 indicator found" });
  }
  if (/\bSTEP\s+3\b/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "tutorial_step_3", detail: "STEP 3 indicator found" });
  }

  // 4. "Book Freight Instantly" as visible text (not CSS selector)
  if (/book\s+freight\s+instantly/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "book_freight_instantly", detail: "\"Book Freight Instantly\" text found" });
  }

  // 5. "Why Shippers Choose" as GENERIC heading text (not lane-specific)
  // Lane-specific headings like "Why Shippers Choose WARP for Dallas to Houston Freight" are OK.
  // Only flag the generic template version (e.g. "Why Shippers Choose Warp" without a city).
  if (/why\s+shippers\s+choose/i.test(htmlWithoutStyles) &&
      !/why\s+shippers\s+choose\s+warp\s+for\s+\w+/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "why_shippers_choose", detail: "\"Why Shippers Choose\" generic heading text found" });
  }

  // 6. "Stop Paying for a Broken Freight System" text
  if (/stop\s+paying\s+for\s+a\s+broken\s+freight\s+system/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "stop_paying_broken", detail: "\"Stop Paying for a Broken Freight System\" text found" });
  }

  // 7. iframe embeds (wistia, youtube, calendly)
  if (/iframe[^>]*src\s*=\s*["'][^"']*wistia/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "iframe_wistia", detail: "iframe with wistia src found" });
  }
  if (/iframe[^>]*src\s*=\s*["'][^"']*youtube/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "iframe_youtube", detail: "iframe with youtube src found" });
  }
  if (/iframe[^>]*src\s*=\s*["'][^"']*calendly/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "iframe_calendly", detail: "iframe with calendly src found" });
  }

  // 8. .wistia_embed class
  if (/class\s*=\s*["'][^"']*wistia_embed/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "wistia_embed_class", detail: ".wistia_embed class found" });
  }

  // 9. "Stay Updated with Warp" newsletter signup
  if (/stay\s+updated\s+with\s+warp/i.test(htmlWithoutStyles)) {
    signals.push({ signal: "newsletter_signup", detail: "\"Stay Updated with Warp\" newsletter text found" });
  }

  // 10. Generic hero sections with no lane data (no distance, no transit, no city names)
  //     Detect hero sections that lack specifics — look for hero divs without operational content
  const heroMatch = htmlWithoutStyles.match(/<(?:section|div)[^>]*(?:class|id)\s*=\s*["'][^"']*hero[^"']*["'][^>]*>[\s\S]*?<\/(?:section|div)>/gi);
  if (heroMatch) {
    for (const heroBlock of heroMatch) {
      const heroText = heroBlock.replace(/<[^>]+>/g, " ").toLowerCase();
      const hasDistance = /\d+[\s-]*miles?/i.test(heroText);
      const hasTransit = /\d+[\s-]*(?:business\s+)?days?/i.test(heroText);
      const hasCityNames = /(?:to|from)\s+[A-Z][a-z]+/i.test(heroBlock);
      if (!hasDistance && !hasTransit && !hasCityNames) {
        signals.push({ signal: "generic_hero_section", detail: "Hero section with no lane-specific data (no distance, transit, or city names)" });
        break; // Only flag once
      }
    }
  }

  // Determine confidence level
  const count = signals.length;
  let confidence;
  if (count === 0) {
    confidence = "none";
  } else if (count <= 1) {
    confidence = "low";
  } else if (count <= 3) {
    confidence = "medium";
  } else {
    confidence = "high";
  }

  return {
    clean: signals.length === 0,
    leakage_signals: signals,
    confidence,
  };
}

// ── MASTER PUBLISH GATE ─────────────────────────────────────────────

/**
 * Master publish gate function. Runs ALL validation checks in order and
 * returns a comprehensive publishability result.
 *
 * @param {Object} pageData — the page object from buildPackageForLane
 * @param {string} html — the body-content HTML
 * @returns {Object} Comprehensive validation result with publishable flag, gates, errors, and warnings
 */
export function validateLanePageForPublish(pageData, html) {
  const config = loadBannedConfig();

  // 1. Field validation
  const fieldResult = validateLanePageFields(pageData);

  // 2. HTML validation
  const htmlResult = validateLanePageHtml(html || "", pageData);

  // 3. Banned content scan
  const banScan = scanForBannedLaneContent(html || "");

  // 4. Marketing tone detection
  const toneResult = detectGenericMarketingTone(pageData, html);

  // 5. Fallback template leakage detection
  const fallbackResult = detectFallbackTemplateLeakage(html || "");

  // 6. Quality score
  const qualityResult = computeLanePageQualityScore(pageData, html);

  // Aggregate errors and warnings
  const errors = [];
  const warnings = [];

  // Field validation errors/warnings
  errors.push(...fieldResult.errors);
  warnings.push(...fieldResult.warnings);

  // HTML validation errors/warnings
  errors.push(...htmlResult.errors);
  warnings.push(...htmlResult.warnings);

  // Banned content violations (deduplicate against htmlResult)
  for (const v of banScan.violations) {
    if (!errors.some(e => e.found === v.found && e.rule_id === v.rule_id)) {
      errors.push(v);
    }
  }

  // Tone violations
  for (const v of toneResult.violations) {
    errors.push(v);
  }

  // Fallback leakage as errors (if detected)
  if (!fallbackResult.clean) {
    for (const sig of fallbackResult.leakage_signals) {
      errors.push({
        rule_id: "LANE-FALLBACK-01",
        type: "fallback_leakage",
        signal: sig.signal,
        message: `Fallback template leakage: ${sig.detail}`,
      });
    }
  }

  // ── GATE: LANE-TEMPLATE-01 ──
  // Passes if body HTML contains at least 3 of the canonical section headings
  const canonicalHeadings = [/lane\s+overview/i, /operating\s+details/i, /pricing/i];
  const canonicalHitCount = canonicalHeadings.filter(re => re.test(html || "")).length;
  const templateGatePassed = canonicalHitCount >= 3;
  if (!templateGatePassed) {
    errors.push({
      rule_id: "LANE-TEMPLATE-01",
      message: `Only ${canonicalHitCount}/3 canonical section headings found (Lane Overview, Operating Details, Pricing)`,
    });
  }

  // ── GATE: LANE-SCHEMA-01 ──
  // Passes if all required schema sections are detected in the HTML
  const requiredSchemaSections = config.required_sections || [];
  const missingSchemaSections = [];
  for (const section of requiredSchemaSections) {
    const sectionId = section.id;
    const patterns = SECTION_PATTERNS[sectionId];
    if (!patterns) continue; // Skip sections we don't have patterns for
    const fullContent = [html || "", pageData?.intro || "", pageData?.proof_section || ""].join(" ");
    const headingMatch = patterns.headings.some(p => p.test(fullContent));
    const contentMatch = patterns.contentPatterns.some(p => p.test(fullContent));
    if (!headingMatch && !contentMatch) {
      missingSchemaSections.push(sectionId);
    }
  }
  const schemaGatePassed = missingSchemaSections.length === 0;
  if (!schemaGatePassed) {
    errors.push({
      rule_id: "LANE-SCHEMA-01",
      message: `Missing required schema sections: ${missingSchemaSections.join(", ")}`,
    });
  }

  // ── GATE: LANE-QUALITY-01 ──
  // Passes if quality score >= configured min_quality_score threshold
  const minScore = config.quality_thresholds?.min_quality_score || 70;
  const qualityGatePassed = qualityResult.score >= minScore;
  if (!qualityGatePassed) {
    errors.push({
      rule_id: "LANE-QUALITY-01",
      message: `Quality score ${qualityResult.score} below minimum threshold ${minScore}`,
    });
  }

  // Build gate results
  const gates = {
    "LANE-TEMPLATE-01": templateGatePassed,
    "LANE-CONTENT-01": !errors.some(e => e.rule_id === "LANE-CONTENT-01"),
    "LANE-SCHEMA-01": schemaGatePassed,
    "LANE-BANNED-01": !errors.some(e => e.rule_id === "LANE-BANNED-01"),
    "LANE-BANNED-02": !errors.some(e => e.rule_id === "LANE-BANNED-02"),
    "LANE-HTML-01": !errors.some(e => e.rule_id === "LANE-HTML-01"),
    "LANE-FAQ-01": !errors.some(e => e.rule_id === "LANE-FAQ-01"),
    "LANE-TONE-01": !errors.some(e => e.rule_id === "LANE-TONE-01"),
    "LANE-FALLBACK-01": !errors.some(e => e.rule_id === "LANE-FALLBACK-01"),
    "LANE-QUALITY-01": qualityGatePassed,
  };

  const publishable = Object.values(gates).every(Boolean);

  return {
    publishable,
    quality_score: qualityResult.score,
    gates,
    errors,
    warnings,
    banned_content_found: banScan.violations.map(v => v.found),
    fallback_detected: !fallbackResult.clean,
    marketing_tone_score: toneResult.score,
  };
}

// ── UNIFIED PUBLISH QUALITY ASSESSMENT ──────────────────────────────
//
// This is the MASTER quality gate for the canonical pipeline.
// Works with CANONICAL page data (from buildCanonicalLanePageData)
// and RENDERED Webflow fields (from renderWebflowFields).
//
// Combines:
//   1. Hard fail gates — any single failure blocks publish
//   2. Weighted quality scoring — page-quality-scorer 5-dimension model
//   3. Ownership integrity checks — verifies section render ownership
//   4. Duplicate detection — catches duplicated content across CMS fields
//   5. Corridor specificity — ensures lane-specific vs generic content
//
// Called by: update_lane_content.js before CMS push
//
// Returns: { publishable, grade, score, gates, dimensions, errors, warnings }

/**
 * Assess the publish quality of a lane page using canonical data + rendered fields.
 *
 * This is the deterministic, unified quality gate. It does NOT guess, estimate,
 * or rely on subjective assessment. Every check is structural and reproducible.
 *
 * @param {object} canonicalPageData - From buildCanonicalLanePageData()
 * @param {object} renderedFields - From renderWebflowFields() — the CMS field payload
 * @returns {object} Comprehensive quality assessment result
 */
export function assessPublishQuality(canonicalPageData, renderedFields) {
  const pd = canonicalPageData;
  const rf = renderedFields || {};
  const errors = [];
  const warnings = [];
  const gates = {};

  if (!pd) {
    return {
      publishable: false,
      grade: "F",
      score: 0,
      gates: { "QG-STRUCT-01": false },
      dimensions: {},
      errors: [{ gate: "QG-STRUCT-01", message: "canonicalPageData is null" }],
      warnings: [],
    };
  }

  // ── Helper: extract city names ────────────────────────────────────
  const oCity = (pd.origin || "").split(",")[0].trim();
  const dCity = (pd.destination || "").split(",")[0].trim();
  const mode = pd.mode || "LTL";

  // ════════════════════════════════════════════════════════════════════
  // HARD GATES — Any single failure blocks publish
  // ════════════════════════════════════════════════════════════════════

  // ── QG-STRUCT-01: Canonical sections present ──────────────────────
  {
    const requiredSections = [
      { key: "hero", check: pd.hero?.headline },
      { key: "lane_overview", check: pd.lane_overview?.body },
      { key: "operating_details", check: pd.operating_details?.items?.length > 0 },
      { key: "pricing_and_commercial_framing", check: pd.pricing_and_commercial_framing?.body },
      { key: "lane_specific_faqs", check: pd.lane_specific_faqs?.length >= 4 },
      { key: "why_warp", check: pd.why_warp?.reasons?.length >= 3 },
      { key: "final_cta", check: pd.final_cta?.headline || pd.lane_relevant_cta?.headline },
    ];
    const missing = requiredSections.filter(s => !s.check).map(s => s.key);
    gates["QG-STRUCT-01"] = missing.length === 0;
    if (missing.length > 0) {
      errors.push({
        gate: "QG-STRUCT-01",
        message: `Missing canonical sections: ${missing.join(", ")}`,
        missing,
      });
    }
  }

  // ── QG-STRUCT-02: SEO fields present and valid ────────────────────
  {
    const seoChecks = [];
    if (!pd.page_title || pd.page_title.length < 20) seoChecks.push("page_title");
    if (!pd.meta_description || pd.meta_description.length < 60) seoChecks.push("meta_description");
    if (!pd.canonical_path || !pd.canonical_path.startsWith("/lanes/")) seoChecks.push("canonical_path");
    if (!pd.lane_slug) seoChecks.push("lane_slug");
    gates["QG-STRUCT-02"] = seoChecks.length === 0;
    if (seoChecks.length > 0) {
      errors.push({
        gate: "QG-STRUCT-02",
        message: `SEO fields missing or invalid: ${seoChecks.join(", ")}`,
        fields: seoChecks,
      });
    }
  }

  // ── QG-STRUCT-03: Lane stats have real enriched data ──────────────
  {
    const ls = pd.lane_stats || {};
    const np = pd.network_proof || {};
    const statChecks = [];
    if (!ls.estimated_distance_miles || ls.estimated_distance_miles <= 0) statChecks.push("distance");
    if (!ls.estimated_transit_days_range?.min || ls.estimated_transit_days_range.min <= 0) statChecks.push("transit_min");
    if (!ls.estimated_transit_days_range?.max || ls.estimated_transit_days_range.max <= 0) statChecks.push("transit_max");
    if (!np.estimated_carrier_count || np.estimated_carrier_count <= 0) statChecks.push("carrier_count");
    gates["QG-STRUCT-03"] = statChecks.length === 0;
    if (statChecks.length > 0) {
      errors.push({
        gate: "QG-STRUCT-03",
        message: `Lane stats missing real data (enrichment failed): ${statChecks.join(", ")}`,
        fields: statChecks,
      });
    }
  }

  // ── QG-CONTENT-01: No banned content in rendered fields ───────────
  {
    const allRendered = [
      rf["faq-schema"] || "",
      rf["body-content"] || "",
      rf["proof-section"] || "",
      rf["lane-intelligence-panel"] || "",
      rf["execution-flow"] || "",
      rf["hero-headline"] || "",
      rf["subheadline"] || "",
    ].join("\n");

    const banScan = scanForBannedLaneContent(allRendered);
    gates["QG-CONTENT-01"] = banScan.clean;
    if (!banScan.clean) {
      for (const v of banScan.violations) {
        errors.push({
          gate: "QG-CONTENT-01",
          message: v.message,
          found: v.found,
        });
      }
    }
  }

  // ── QG-CONTENT-02: No fallback template leakage ───────────────────
  {
    const allRendered = [
      rf["faq-schema"] || "",
      rf["body-content"] || "",
      rf["lane-intelligence-panel"] || "",
      rf["execution-flow"] || "",
    ].join("\n");

    const fallback = detectFallbackTemplateLeakage(allRendered);
    gates["QG-CONTENT-02"] = fallback.clean;
    if (!fallback.clean) {
      errors.push({
        gate: "QG-CONTENT-02",
        message: `Fallback template leakage detected (${fallback.confidence} confidence): ${fallback.leakage_signals.map(s => s.signal).join(", ")}`,
        signals: fallback.leakage_signals,
      });
    }
  }

  // ── QG-CONTENT-03: Corridor specificity — cities must appear ──────
  {
    const faqSchema = (rf["faq-schema"] || "").toLowerCase();
    const bodyContent = (rf["body-content"] || "").toLowerCase();
    const heroHeadline = (rf["hero-headline"] || "").toLowerCase();
    const allContent = faqSchema + " " + bodyContent + " " + heroHeadline;

    const oCityLower = oCity.toLowerCase();
    const dCityLower = dCity.toLowerCase();
    const cityChecks = [];
    if (oCityLower && !allContent.includes(oCityLower)) cityChecks.push(`origin "${oCity}"`);
    if (dCityLower && !allContent.includes(dCityLower)) cityChecks.push(`destination "${dCity}"`);
    gates["QG-CONTENT-03"] = cityChecks.length === 0;
    if (cityChecks.length > 0) {
      errors.push({
        gate: "QG-CONTENT-03",
        message: `Content lacks corridor specificity — missing: ${cityChecks.join(", ")}`,
      });
    }
  }

  // ── QG-CONTENT-04: Minimum FAQ count ──────────────────────────────
  {
    const faqCount = pd.lane_specific_faqs?.length || 0;
    gates["QG-CONTENT-04"] = faqCount >= 4;
    if (faqCount < 4) {
      errors.push({
        gate: "QG-CONTENT-04",
        message: `Insufficient FAQ count: ${faqCount} (minimum 4)`,
      });
    }
  }

  // ── QG-OWNER-01: KPI cards exclusively in lane-intelligence-panel ──
  {
    const faqSchema = rf["faq-schema"] || "";
    const KPI_LABELS = ["Lane Distance", "Transit Window", "Active Carriers"];
    const kpiCardPattern = /border-radius:12px;padding:16px/;
    const kpiGridPattern = /grid-template-columns:repeat\(auto-fit,minmax\(1[68]0px/;

    const leakedKpis = [];
    for (const label of KPI_LABELS) {
      const cardPattern = new RegExp(`<div[^>]*border-radius:12px;padding:16px[^>]*>[^<]*${label}`);
      if (cardPattern.test(faqSchema)) leakedKpis.push(label);
    }
    const gridLeak = kpiGridPattern.test(faqSchema);

    gates["QG-OWNER-01"] = leakedKpis.length === 0 && !gridLeak;
    if (leakedKpis.length > 0 || gridLeak) {
      errors.push({
        gate: "QG-OWNER-01",
        message: `KPI ownership violation: KPI cards found in faq-schema (must be exclusively in lane-intelligence-panel). Leaked: ${leakedKpis.join(", ")}${gridLeak ? " + KPI grid layout" : ""}`,
      });
    }
  }

  // ── QG-OWNER-02: Execution flow exclusively in execution-flow field ──
  {
    const faqSchema = rf["faq-schema"] || "";
    // Execution flow has a distinctive 5-stage pattern
    const execFlowPattern = /Origin Pickup.*?Cross-Dock.*?Linehaul.*?(?:Final|Destination)\s*Delivery/s;
    const execFlowHeading = /How Freight Moves/i;

    const hasExecInFaq = execFlowPattern.test(faqSchema) || execFlowHeading.test(faqSchema);
    gates["QG-OWNER-02"] = !hasExecInFaq;
    if (hasExecInFaq) {
      errors.push({
        gate: "QG-OWNER-02",
        message: "Execution flow ownership violation: execution flow content found in faq-schema (must be exclusively in execution-flow field)",
      });
    }
  }

  // ── QG-OWNER-03: No duplicate comparison tables ───────────────────
  {
    const faqSchema = rf["faq-schema"] || "";
    const compTableCount = (faqSchema.match(/Traditional.*?vs WARP/gi) || []).length;
    gates["QG-OWNER-03"] = compTableCount <= 1;
    if (compTableCount > 1) {
      errors.push({
        gate: "QG-OWNER-03",
        message: `Duplicate comparison tables in faq-schema: found ${compTableCount} (expected ≤1)`,
      });
    }
  }

  // ── QG-SCHEMA-01: JSON-LD schemas present ─────────────────────────
  {
    const breadcrumbField = rf["breadcrumb-schema"] || "";
    const schemaChecks = [];
    if (!breadcrumbField.includes("BreadcrumbList")) schemaChecks.push("BreadcrumbList");
    if (!breadcrumbField.includes('"Service"')) schemaChecks.push("Service");
    if (!breadcrumbField.includes('"Organization"')) schemaChecks.push("Organization");
    // FAQPage only required if we have FAQs
    if (pd.lane_specific_faqs?.length > 0 && !breadcrumbField.includes("FAQPage")) {
      schemaChecks.push("FAQPage");
    }
    gates["QG-SCHEMA-01"] = schemaChecks.length === 0;
    if (schemaChecks.length > 0) {
      errors.push({
        gate: "QG-SCHEMA-01",
        message: `Missing JSON-LD schemas in breadcrumb-schema: ${schemaChecks.join(", ")}`,
      });
    }
  }

  // ── QG-SCHEMA-02: JSON-LD FAQ questions match visible FAQ ─────────
  {
    const breadcrumbField = rf["breadcrumb-schema"] || "";
    const visibleFaqs = pd.lane_specific_faqs || [];
    let schemaFaqCount = 0;
    try {
      const faqPageMatch = breadcrumbField.match(/"@type"\s*:\s*"FAQPage"[^}]*"mainEntity"\s*:\s*\[([\s\S]*?)\]\s*\}/);
      if (faqPageMatch) {
        schemaFaqCount = (faqPageMatch[0].match(/"@type"\s*:\s*"Question"/g) || []).length;
      }
    } catch { /* safe to ignore parse errors */ }

    const countsMatch = visibleFaqs.length === 0 || schemaFaqCount === visibleFaqs.length;
    gates["QG-SCHEMA-02"] = countsMatch;
    if (!countsMatch) {
      errors.push({
        gate: "QG-SCHEMA-02",
        message: `FAQ count mismatch: ${visibleFaqs.length} visible FAQs vs ${schemaFaqCount} in JSON-LD schema`,
      });
    }
  }

  // ── QG-DUPLICATE-01: No duplicate section headings ────────────────
  {
    const faqSchema = rf["faq-schema"] || "";
    const h2Matches = faqSchema.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [];
    const headings = h2Matches.map(m => m.replace(/<[^>]+>/g, "").trim().toLowerCase());
    const seen = new Set();
    const dupes = [];
    for (const h of headings) {
      if (seen.has(h)) dupes.push(h);
      seen.add(h);
    }
    gates["QG-DUPLICATE-01"] = dupes.length === 0;
    if (dupes.length > 0) {
      errors.push({
        gate: "QG-DUPLICATE-01",
        message: `Duplicate section headings in faq-schema: "${dupes.join('", "')}"`,
      });
    }
  }

  // ── QG-RENDER-01: Rendered fields are non-empty ───────────────────
  {
    const requiredFields = [
      "hero-headline", "subheadline", "body-content", "faq-schema",
      "breadcrumb-schema", "proof-section", "lane-intelligence-panel",
      "execution-flow", "traditional-ltl", "warp-ltl",
      "seo-title", "seo-meta-description", "canonical-url",
    ];
    const emptyFields = requiredFields.filter(f => {
      const val = rf[f];
      return !val || (typeof val === "string" && val.trim().length === 0);
    });
    gates["QG-RENDER-01"] = emptyFields.length === 0;
    if (emptyFields.length > 0) {
      errors.push({
        gate: "QG-RENDER-01",
        message: `Empty rendered CMS fields: ${emptyFields.join(", ")}`,
        fields: emptyFields,
      });
    }
  }

  // ── QG-RENDER-02: Rendered content minimum length ─────────────────
  // Catches garbage/placeholder content that is technically non-empty but
  // substantively worthless. The quality scorer operates on canonical data,
  // NOT rendered fields — this gate verifies rendered output is real content.
  {
    const lengthViolations = [];

    // body-content: should be >= 400 chars of actual text (typical is 800+)
    const bodyText = (rf["body-content"] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (bodyText.length < 400) {
      lengthViolations.push(`body-content text too short: ${bodyText.length} chars (min 400)`);
    }

    // faq-schema: should be >= 5000 chars (typical is 25000+, contains most page content)
    const faqSchemaLen = (rf["faq-schema"] || "").length;
    if (faqSchemaLen < 5000) {
      lengthViolations.push(`faq-schema too short: ${faqSchemaLen} chars (min 5000)`);
    }

    // lane-intelligence-panel: should be >= 500 chars (contains KPI grid)
    const lipLen = (rf["lane-intelligence-panel"] || "").length;
    if (lipLen < 500) {
      lengthViolations.push(`lane-intelligence-panel too short: ${lipLen} chars (min 500)`);
    }

    // execution-flow: should be >= 500 chars (contains 5-stage flow)
    const efLen = (rf["execution-flow"] || "").length;
    if (efLen < 500) {
      lengthViolations.push(`execution-flow too short: ${efLen} chars (min 500)`);
    }

    // breadcrumb-schema: should be >= 200 chars (contains JSON-LD schemas)
    const bsLen = (rf["breadcrumb-schema"] || "").length;
    if (bsLen < 200) {
      lengthViolations.push(`breadcrumb-schema too short: ${bsLen} chars (min 200)`);
    }

    gates["QG-RENDER-02"] = lengthViolations.length === 0;
    if (lengthViolations.length > 0) {
      errors.push({
        gate: "QG-RENDER-02",
        message: `Rendered content too short (possible render failure or garbage): ${lengthViolations.join("; ")}`,
        violations: lengthViolations,
      });
    }
  }

  // ── QG-VEHICLE-01: Vehicle flexibility framing (WARNING ONLY) ─────
  // LTL pages must NOT contain FTL-only language implying single vehicle type.
  // This is a WARNING gate — violations produce warnings but do not block publish.
  // The gate value is always true (soft gate). It is NOT counted toward pass/fail.
  {
    const allContent = [
      rf["faq-schema"] || "",
      rf["body-content"] || "",
      rf["lane-intelligence-panel"] || "",
    ].join(" ").toLowerCase();

    const vehicleViolations = [];
    if (mode === "LTL") {
      if (!allContent.includes("pallet")) {
        vehicleViolations.push("LTL content missing 'pallet' reference");
      }
    }
    if (mode === "LTL" && /\bfull[- ]truckload\s+only\b/i.test(allContent)) {
      vehicleViolations.push("LTL page contains 'full truckload only' language");
    }

    // QG-VEHICLE-01 is a soft gate — always passes, only produces warnings
    gates["QG-VEHICLE-01"] = true;
    if (vehicleViolations.length > 0) {
      warnings.push({
        gate: "QG-VEHICLE-01",
        message: `Vehicle flexibility: ${vehicleViolations.join("; ")}`,
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // WEIGHTED QUALITY SCORING — 5-dimension page-quality-scorer
  // ════════════════════════════════════════════════════════════════════

  let qualityResult;
  try {
    qualityResult = scorePageQuality(pd);
  } catch {
    qualityResult = { total: 0, grade: "F", dimensions: {}, checks_summary: { total: 0, passing: 0, failing: 0 }, full_checks: {} };
  }

  // ── QG-QUALITY-01: Minimum weighted quality score ─────────────────
  {
    const MIN_QUALITY = 0.55; // D+ grade minimum — pages below this are structurally deficient
    gates["QG-QUALITY-01"] = qualityResult.total >= MIN_QUALITY;
    if (qualityResult.total < MIN_QUALITY) {
      errors.push({
        gate: "QG-QUALITY-01",
        message: `Quality score ${(qualityResult.total * 100).toFixed(1)}% below minimum threshold ${(MIN_QUALITY * 100).toFixed(1)}% (grade: ${qualityResult.grade})`,
      });
    }
  }

  // ── FAQ quality sub-score (informational, not a hard gate) ────────
  let faqQualityResult;
  try {
    faqQualityResult = scoreFaqSet(
      pd.lane_specific_faqs || [],
      oCity,
      dCity,
      mode
    );
  } catch {
    faqQualityResult = { score: 0, checks: [] };
  }

  // ════════════════════════════════════════════════════════════════════
  // AGGREGATE RESULT
  // ════════════════════════════════════════════════════════════════════

  const publishable = Object.values(gates).every(Boolean);

  // Convert 0-1 score to 0-100 for display
  const scorePercent = Math.round(qualityResult.total * 100);

  return {
    publishable,
    grade: qualityResult.grade,
    score: scorePercent,
    score_raw: qualityResult.total,
    gates,
    gate_count: Object.keys(gates).length,
    gates_passed: Object.values(gates).filter(Boolean).length,
    gates_failed: Object.values(gates).filter(v => !v).length,
    dimensions: qualityResult.dimensions,
    faq_quality: faqQualityResult,
    checks_summary: qualityResult.checks_summary,
    errors,
    warnings,
    lane: {
      origin: pd.origin,
      destination: pd.destination,
      mode: pd.mode,
      slug: pd.lane_slug,
      distance: pd.lane_stats?.estimated_distance_miles,
    },
  };
}

// ── MIGRATION NOTE ────────────────────────────────────────────────────
// To assess quality from a CMS-neutral publish contract:
//   1. Import { contractToRenderedFields } from "./publishers/publish-contract.js"
//   2. const renderedFields = contractToRenderedFields(contract);
//   3. const quality = assessPublishQuality(contract.canonical, renderedFields);
//
// The contract bridge (contractToRenderedFields) maps semantic contract
// fields to the Webflow-era field names that this gate still uses internally.
// See update_lane_content.js for the canonical usage pattern.
// ─────────────────────────────────────────────────────────────────────
