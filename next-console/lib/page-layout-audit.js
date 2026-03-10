/**
 * Page Layout Audit
 * Enforces structural template consistency across lane pages.
 * Does not redesign — only validates structural completeness.
 */

import fs from "fs";
import path from "path";

function countWords(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

// ── Layout Checks ──────────────────────────────────────────────────

const LAYOUT_CHECKS = [
  {
    id: "LAYOUT-01",
    label: "Hero / title block",
    severity: "block",
    check: (p) => !!p.h1 && (!!p.intro || !!p.quick_answer),
    fix_hint: "Add h1 and intro/quick_answer fields",
  },
  {
    id: "LAYOUT-02",
    label: "Quick answer above the fold",
    severity: "block",
    check: (p) => {
      if (p.quick_answer && countWords(p.quick_answer) >= 10) return true;
      if (p.intro && countWords(p.intro) >= 20) return true;
      return false;
    },
    fix_hint: "Add a quick_answer field with at least 10 words",
  },
  {
    id: "LAYOUT-03",
    label: "Structured cards for transit + cost",
    severity: "block",
    check: (p) => !!p.lane_stats?.transit_days_range && !!p.lane_stats?.rate_range_usd,
    fix_hint: "Ensure lane_stats has transit_days_range and rate_range_usd",
  },
  {
    id: "LAYOUT-04",
    label: "Readable section spacing",
    severity: "warn",
    check: (p) => {
      const sections = [p.intro, p.quick_answer, p.problem, p.solution, p.lane_insight, p.cost_drivers].filter(Boolean);
      return !sections.some((s) => countWords(s) > 300);
    },
    fix_hint: "Break sections exceeding 300 words into subsections with headings",
  },
  {
    id: "LAYOUT-05",
    label: "FAQ section",
    severity: "block",
    check: (p) => Array.isArray(p.faq) && p.faq.length >= 5 && p.faq.every((f) => f.q && f.a),
    fix_hint: "Add at least 5 FAQ items with both q and a fields",
  },
  {
    id: "LAYOUT-06",
    label: "CTA block",
    severity: "block",
    check: (p) => !!p.cta_label && !!p.cta_url && !/localhost/i.test(p.cta_url),
    fix_hint: "Set cta_label and cta_url (not localhost)",
  },
  {
    id: "LAYOUT-07",
    label: "Internal link section",
    severity: "block",
    check: (p) => Array.isArray(p.related_lanes) && p.related_lanes.length >= 5,
    fix_hint: "Attach at least 5 related_lanes via link-graph.js",
  },
  {
    id: "LAYOUT-08",
    label: "Visual cards present",
    severity: "warn",
    check: (p) => Array.isArray(p.visual_cards) && p.visual_cards.length >= 2,
    fix_hint: "Add visual_cards array with at least 2 items",
  },
  {
    id: "LAYOUT-09",
    label: "Schema JSON-LD present",
    severity: "warn",
    check: (p) => Array.isArray(p.schema_jsonld) && p.schema_jsonld.length > 0,
    fix_hint: "Generate schema_jsonld via ai-search-optimizer.js",
  },
  {
    id: "LAYOUT-10",
    label: "Cost drivers section",
    severity: "block",
    check: (p) => !!p.cost_drivers && countWords(typeof p.cost_drivers === "string" ? p.cost_drivers : "") >= 10,
    fix_hint: "Add cost_drivers text (minimum 10 words)",
  },
  {
    id: "LAYOUT-11",
    label: "Lane insight section",
    severity: "block",
    check: (p) => !!p.lane_insight && countWords(typeof p.lane_insight === "string" ? p.lane_insight : "") >= 10,
    fix_hint: "Add lane_insight text (minimum 10 words)",
  },
  {
    id: "LAYOUT-12",
    label: "Meta fields complete",
    severity: "block",
    check: (p) => {
      const titleLen = (p.seo_title || "").length;
      const descLen = (p.meta_description || "").length;
      return titleLen >= 30 && titleLen <= 70 && descLen >= 80 && descLen <= 170;
    },
    fix_hint: "seo_title: 30-70 chars, meta_description: 80-170 chars",
  },
];

// ── Single Page Audit ──────────────────────────────────────────────

export function auditPageLayout(page) {
  if (!page) {
    return {
      passed: false,
      score: 0,
      checks: [],
      blocking_failures: ["page object is null/undefined"],
      warnings: [],
    };
  }

  const results = [];
  const blocking = [];
  const warnings = [];

  for (const c of LAYOUT_CHECKS) {
    let passed = false;
    try {
      passed = c.check(page);
    } catch {
      passed = false;
    }

    results.push({
      check_id: c.id,
      label: c.label,
      passed,
      severity: c.severity,
      detail: passed ? "pass" : `failed — ${c.fix_hint}`,
      fix_hint: c.fix_hint,
    });

    if (!passed) {
      if (c.severity === "block") {
        blocking.push(`${c.id}: ${c.label}`);
      } else {
        warnings.push(`${c.id}: ${c.label}`);
      }
    }
  }

  const totalChecks = results.length;
  const passedChecks = results.filter((r) => r.passed).length;
  const scoreVal = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;

  return {
    passed: blocking.length === 0,
    score: scoreVal,
    checks: results,
    blocking_failures: blocking,
    warnings,
  };
}

// ── Batch Audit ────────────────────────────────────────────────────

export function auditBatch(pages) {
  const results = [];
  const issueCounts = {};

  for (const page of pages) {
    const r = auditPageLayout(page);
    results.push({
      slug: page.slug || "unknown",
      passed: r.passed,
      score: r.score,
      blocking_failures: r.blocking_failures,
      warnings: r.warnings,
    });

    for (const c of r.checks) {
      if (!c.passed) {
        issueCounts[c.check_id] = (issueCounts[c.check_id] || 0) + 1;
      }
    }
  }

  const common_issues = Object.entries(issueCounts)
    .map(([check_id, failure_count]) => ({ check_id, failure_count }))
    .sort((a, b) => b.failure_count - a.failure_count);

  return {
    total: pages.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    pages: results,
    common_issues,
  };
}

// ── Report Writer ──────────────────────────────────────────────────

export function writeLayoutAuditReport(batchResult, artifactsDir) {
  const dir = artifactsDir || path.join(process.cwd(), "artifacts");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, "layout_audit_report.json");
  fs.writeFileSync(filePath, JSON.stringify({ ...batchResult, generated_at: new Date().toISOString() }, null, 2));
  return filePath;
}
