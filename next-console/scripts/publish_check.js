#!/usr/bin/env node
/**
 * Publish Check — runs all quality gates without publishing.
 *
 * Usage: npm run publish:check
 *
 * Checks:
 * 1. Kill switch check (PUBLISH_KILL_SWITCH env var)
 * 2. Required data files exist and are valid
 * 3. Test page structure validation
 * 4. CMS field contract compliance
 * 5. Ramp policy validation
 * 6. Summary output
 *
 * This script runs with Node directly (not Next.js) and cannot use @/ imports.
 * All checks are performed inline using fs and JSON parsing.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

// Load .env.local if present
config({ path: path.join(ROOT, ".env.local") });

// ---- Inline helpers (no @/ aliases available in scripts) ----

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function buildLaneSlug(origin, destination) {
  const citySlug = (s) =>
    s.split(",")[0].trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `${citySlug(origin)}-to-${citySlug(destination)}`;
}

/**
 * Build the same test page used by ship_firstpage.js (Chicago -> Dallas LTL).
 */
function buildPackageData() {
  const origin = "Chicago, IL";
  const destination = "Dallas, TX";
  const mode = "LTL";
  const segment = "smb";
  const slug = buildLaneSlug(origin, destination);
  const canonicalPath = `/${slug}`;
  const seoTitle = `${origin} to ${destination} ${mode} Freight Quotes | WARP`;
  const h1 = `${origin} to ${destination} ${mode} freight quotes`;
  const intro =
    "Small and mid-size shipping teams moving LTL freight from Chicago, IL to Dallas, TX can use this lane-specific workflow to compare options, reduce manual quote cycles, and book faster with stronger service visibility.";
  const metaDescription = `Compare LTL freight options from ${origin} to ${destination}. Small and mid-size shipping teams get lane-specific estimated pricing.`;

  const fp = String(
    stableHash([canonicalPath, seoTitle, h1, intro.slice(0, 200)].join("|"))
  );

  return {
    page: {
      slug,
      canonical_path: canonicalPath,
      seo_title: seoTitle,
      h1,
      intro,
      meta_description: metaDescription,
      problem_section:
        "LTL shippers struggle with inconsistent transit times, opaque pricing, and fragmented visibility across multiple carriers.",
      solution_section:
        "WARP unifies LTL lane quoting, carrier selection, and exception management into a single operational workflow.",
      proof_section:
        "Shippers on the Chicago-Dallas corridor have reduced quote cycle time and improved rate visibility through WARP's lane-specific workflow.",
      cta_primary: "Book 15-min Fit Call",
      cta_secondary: "Get Instant Quote",
      cta_primary_url: "https://www.wearewarp.com/book",
      cta_secondary_url: "https://www.wearewarp.com/quote",
      visual_cards: [
        { label: "Consolidation", value: "Optimized shared loads", insight: "Reduce per-unit shipping costs by sharing truck space." },
        { label: "Flexibility", value: "Ship any pallet count", insight: "Scale from one pallet to partial truckloads." },
        { label: "Visibility", value: "Shipment-level tracking", insight: "Track each LTL shipment with real-time status." }
      ],
      faq: [
        { q: "How fast can we launch a LTL pilot from Chicago, IL to Dallas, TX?", a: "Most small and mid-size shipping teams can define lane scope and start pilot quoting within days." },
        { q: "What makes LTL shipping different on the Chicago, IL to Dallas, TX lane?", a: "Each lane has unique volume patterns, carrier availability, and transit windows." },
        { q: "Can we start with just the Chicago, IL to Dallas, TX lane before expanding?", a: "Yes. A lane-first rollout lets you validate performance before scaling." },
        { q: "What metrics should we track on this LTL lane?", a: "Focus on quote response time, transit predictability, exception rate, and cost-per-shipment trends." },
        { q: "Do we need to migrate our entire process?", a: "No. Start this single lane, measure results, and expand based on quick ROI evidence." }
      ],
      contrast: {
        headline: "Why WARP vs Legacy Process",
        points: [
          { metric: "Get Quote", legacy: "Phone calls, 2-4 hours", warp: "Instant digital quotes" },
          { metric: "Compare Options", legacy: "Manual spreadsheets", warp: "Side-by-side dashboard" },
          { metric: "Book Shipment", legacy: "Email chains, 24-48h", warp: "One-click booking" },
          { metric: "Track Status", legacy: "Call for updates", warp: "Real-time GPS tracking" }
        ],
        bottom_line: "WARP compresses days of manual freight operations into minutes."
      },
      lane: { origin, destination, mode },
      lane_stats: {
        estimated_distance_miles: 920,
        estimated_transit_days_range: { min: 3, max: 5 },
        estimated_rate_range_usd: { low: 680, high: 1150 },
        confidence: { transit: "medium", rate: "medium" },
        disclaimers: [
          "These are modeled estimates, not guaranteed quotes.",
          "Actual rates depend on freight details, accessorials, and current market conditions."
        ]
      },
      target_segment: segment
    },
    canonicalPath,
    quickAnswers: [
      {
        question: "How much does LTL freight from Chicago to Dallas cost?",
        answer:
          "Estimated LTL rates range from approximately $680 to $1,150 depending on freight class, pallet count, and shipment weight. These are modeled estimates."
      },
      {
        question: "How long does LTL transit take from Chicago to Dallas?",
        answer:
          "Estimated transit time is 3-5 business days for standard LTL service on this ~920-mile corridor."
      }
    ],
    contentFingerprint: fp,
    origin,
    destination,
    mode,
    segment
  };
}

// ---- Check runners ----

const results = [];
let failCount = 0;

function check(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    const detail = fn();
    console.log(`PASS${detail ? ` (${detail})` : ""}`);
    results.push({ name, passed: true, detail });
  } catch (err) {
    failCount++;
    console.log(`FAIL`);
    console.error(`    ${err.message}`);
    results.push({ name, passed: false, detail: err.message });
  }
}

// ---- Main ----

console.log("=== WARP Publish Check ===");
console.log("");

// 1. Kill switch
check("Kill switch", () => {
  const val = process.env.PUBLISH_KILL_SWITCH;
  if (val === "true" || val === "1" || val === "yes") {
    throw new Error(
      `PUBLISH_KILL_SWITCH is active (value: "${val}"). All publishing is halted.`
    );
  }
  return val ? `set to "${val}" (inactive)` : "not set (inactive)";
});

// 2. Required data files
const requiredFiles = [
  { rel: "data/webflow_lanes_contract.json", label: "CMS field contract" },
  { rel: "data/ramp_policy.json", label: "Ramp policy" },
  { rel: "data/cities.json", label: "Cities database" }
];

for (const { rel, label } of requiredFiles) {
  check(`Required file: ${label}`, () => {
    const filePath = path.join(ROOT, rel);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${rel}`);
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    JSON.parse(raw); // throws if invalid JSON
    const size = Buffer.byteLength(raw, "utf-8");
    return `${rel} (${size} bytes, valid JSON)`;
  });
}

// 3. Required lib modules exist
const requiredModules = [
  { rel: "lib/estimate-config.js", label: "Estimate config" },
  { rel: "lib/usefulness-gates.js", label: "Usefulness gates" },
  { rel: "lib/schema-drift.js", label: "Schema drift" },
  { rel: "lib/publish-governor.js", label: "Publish governor" },
  { rel: "lib/lane-engine.js", label: "Lane engine" },
  { rel: "lib/uniqueness-engine.js", label: "Uniqueness engine" }
];

for (const { rel, label } of requiredModules) {
  check(`Required module: ${label}`, () => {
    const filePath = path.join(ROOT, rel);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Module not found: ${rel}`);
    }
    const stat = fs.statSync(filePath);
    return `${rel} (${stat.size} bytes)`;
  });
}

// 4. Test page structure
check("Test page structure", () => {
  const pkg = buildPackageData();
  const page = pkg.page;
  const missing = [];

  // Required top-level package fields
  const pkgFields = ["canonicalPath", "contentFingerprint", "origin", "destination", "mode", "segment"];
  for (const f of pkgFields) {
    if (!pkg[f]) missing.push(`package.${f}`);
  }

  // Required page fields
  const pageFields = [
    "slug", "canonical_path", "seo_title", "h1", "intro", "meta_description",
    "problem_section", "solution_section", "cta_primary", "cta_secondary",
    "cta_primary_url", "cta_secondary_url"
  ];
  for (const f of pageFields) {
    if (!page[f]) missing.push(`page.${f}`);
  }

  // Array fields
  if (!Array.isArray(page.faq) || page.faq.length === 0) missing.push("page.faq (empty or missing)");
  if (!Array.isArray(page.visual_cards) || page.visual_cards.length === 0) missing.push("page.visual_cards (empty or missing)");
  if (!Array.isArray(pkg.quickAnswers) || pkg.quickAnswers.length === 0) missing.push("package.quickAnswers (empty or missing)");

  // Lane stats
  if (!page.lane_stats) missing.push("page.lane_stats");
  if (!page.lane) missing.push("page.lane");

  // Contrast section
  if (!page.contrast || !Array.isArray(page.contrast.points)) missing.push("page.contrast.points");

  if (missing.length > 0) {
    throw new Error(`Missing fields: ${missing.join(", ")}`);
  }
  return `all ${pageFields.length + pkgFields.length}+ fields present`;
});

// 5. CMS field contract compliance
check("CMS field contract compliance", () => {
  const contractPath = path.join(ROOT, "data", "webflow_lanes_contract.json");
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
  const fields = contract.fields;
  const violations = [];

  // Check contract structure
  if (!fields || typeof fields !== "object") {
    throw new Error("Contract missing 'fields' object");
  }

  const requiredFieldNames = Object.entries(fields)
    .filter(([, spec]) => spec.required)
    .map(([name]) => name);

  if (requiredFieldNames.length === 0) {
    throw new Error("Contract has no required fields — suspect corrupt file");
  }

  // Validate seo-title length constraints from contract
  const seoTitleSpec = fields["seo-title"];
  const pkg = buildPackageData();
  if (seoTitleSpec) {
    const title = pkg.page.seo_title;
    if (seoTitleSpec.minLength && title.length < seoTitleSpec.minLength) {
      violations.push(`seo-title too short: ${title.length} < ${seoTitleSpec.minLength}`);
    }
    if (seoTitleSpec.maxLength && title.length > seoTitleSpec.maxLength) {
      violations.push(`seo-title too long: ${title.length} > ${seoTitleSpec.maxLength}`);
    }
  }

  // Validate meta-description length
  const metaSpec = fields["meta-description"];
  if (metaSpec) {
    const desc = pkg.page.meta_description;
    if (metaSpec.minLength && desc.length < metaSpec.minLength) {
      violations.push(`meta-description too short: ${desc.length} < ${metaSpec.minLength}`);
    }
    if (metaSpec.maxLength && desc.length > metaSpec.maxLength) {
      violations.push(`meta-description too long: ${desc.length} > ${metaSpec.maxLength}`);
    }
  }

  // Validate slug pattern
  const slugSpec = fields["slug"];
  if (slugSpec && slugSpec.pattern) {
    const re = new RegExp(slugSpec.pattern);
    if (!re.test(pkg.page.slug)) {
      violations.push(`slug "${pkg.page.slug}" does not match pattern ${slugSpec.pattern}`);
    }
  }

  if (violations.length > 0) {
    throw new Error(`${violations.length} violations: ${violations.join("; ")}`);
  }

  return `${requiredFieldNames.length} required fields defined, test page compliant`;
});

// 6. Ramp policy validation
check("Ramp policy validation", () => {
  const policyPath = path.join(ROOT, "data", "ramp_policy.json");
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf-8"));

  const issues = [];

  if (!Array.isArray(policy.waves) || policy.waves.length === 0) {
    issues.push("Missing or empty 'waves' array");
  } else {
    for (const wave of policy.waves) {
      if (typeof wave.wave !== "number") issues.push(`Wave missing 'wave' number`);
      if (typeof wave.maxPages !== "number") issues.push(`Wave ${wave.wave} missing 'maxPages'`);
      if (!wave.label) issues.push(`Wave ${wave.wave} missing 'label'`);
    }
  }

  if (!policy.limits) {
    issues.push("Missing 'limits' object");
  } else {
    if (typeof policy.limits.maxPublishPerDay !== "number") issues.push("Missing limits.maxPublishPerDay");
    if (typeof policy.limits.maxPublishPerWeek !== "number") issues.push("Missing limits.maxPublishPerWeek");
    if (typeof policy.limits.cooldownMinutes !== "number") issues.push("Missing limits.cooldownMinutes");
  }

  if (!policy.killSwitch || !policy.killSwitch.envVar) {
    issues.push("Missing killSwitch.envVar");
  }

  if (issues.length > 0) {
    throw new Error(`${issues.length} issues: ${issues.join("; ")}`);
  }

  return `${policy.waves.length} waves, limits OK, kill switch configured`;
});

// 7. Published pages registry (if exists)
check("Published pages registry", () => {
  const registryPath = path.join(ROOT, "data", "published_pages.json");
  if (!fs.existsSync(registryPath)) {
    return "file not found (OK for first publish)";
  }
  const pages = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  if (!Array.isArray(pages)) {
    throw new Error("published_pages.json is not an array");
  }
  return `${pages.length} pages in registry`;
});

// ---- Summary ----

console.log("");
console.log("─".repeat(50));

if (failCount === 0) {
  console.log(`  All ${results.length} checks passed — ready to publish`);
  console.log("");
  process.exit(0);
} else {
  console.log(`  ${failCount} of ${results.length} checks FAILED — see details above`);
  console.log("");
  const failed = results.filter((r) => !r.passed);
  for (const f of failed) {
    console.log(`    FAIL: ${f.name}`);
    console.log(`          ${f.detail}`);
  }
  console.log("");
  process.exit(1);
}
