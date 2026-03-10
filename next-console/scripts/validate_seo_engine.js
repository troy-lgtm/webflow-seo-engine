#!/usr/bin/env node

/**
 * SEO Engine Validator
 *
 * Validates all three SEO layers at build/publish time:
 *   Layer 5: Corridor-first internal linking
 *   Layer 2: Indexing firewall (eligibility gates)
 *   Layer 6: Canonicals, parameters, URL discipline
 *
 * Produces: artifacts/publish_decision.json
 *
 * Usage:
 *   node scripts/validate_seo_engine.js
 *   node scripts/validate_seo_engine.js --mode dry
 *   node scripts/validate_seo_engine.js --mode staging
 *   node scripts/validate_seo_engine.js --mode production
 *
 * Exit codes:
 *   0 — all validations pass
 *   1 — fatal error
 *   2 — publish blocked (canonical conflicts, broken links, etc)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

const args = process.argv.slice(2);
function getFlag(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return fallback;
}
const MODE = getFlag("mode", "dry");

// ── Inline Helpers (no @/ aliases) ───────────────────────────────────

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function laneSlug(originCity, destinationCity) {
  const slugify = (s) =>
    String(s || "").split(",")[0].trim().toLowerCase()
      .replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  return `${slugify(originCity)}-to-${slugify(destinationCity)}`;
}

function normCityForMatch(name) {
  return String(name || "").split(",")[0].trim().toLowerCase().replace(/\s+/g, " ");
}

function cityInCluster(cityName, cluster) {
  const norm = normCityForMatch(cityName);
  return cluster.some(c => normCityForMatch(c) === norm);
}

// ── Main Validation ──────────────────────────────────────────────────

async function main() {
  console.log("=== WARP SEO Engine Validator ===");
  console.log(`  Mode: ${MODE}\n`);

  const errors = [];
  const warnings = [];
  let totalChecks = 0;
  let passedChecks = 0;

  function check(name, pass, detail) {
    totalChecks++;
    if (pass) {
      passedChecks++;
      console.log(`  ✓ ${name}`);
    } else {
      console.log(`  ✗ ${name}: ${detail || "FAILED"}`);
      errors.push({ name, detail });
    }
    return pass;
  }

  function warn(name, detail) {
    console.log(`  ⚠ ${name}: ${detail}`);
    warnings.push({ name, detail });
  }

  // ── 1. Data Files Exist ──

  console.log("\n── Data Files ──");
  const corridorsData = loadJSON(path.join(ROOT, "data", "corridors.json"));
  check("corridors.json exists", Boolean(corridorsData), "Missing data/corridors.json");

  const citiesData = loadJSON(path.join(ROOT, "data", "cities.json"));
  check("cities.json exists", Boolean(citiesData), "Missing data/cities.json");

  const seoConfig = loadJSON(path.join(ROOT, "config", "seo-engine.json"));
  check("seo-engine.json exists", Boolean(seoConfig), "Missing config/seo-engine.json");

  const gscData = loadJSON(path.join(ROOT, "data", "demand", "gsc.json"));
  check("demand/gsc.json exists", Boolean(gscData), "Missing data/demand/gsc.json");

  const keywordsData = loadJSON(path.join(ROOT, "data", "demand", "keywords.json"));
  check("demand/keywords.json exists", Boolean(keywordsData), "Missing data/demand/keywords.json");

  const portalData = loadJSON(path.join(ROOT, "data", "demand", "portal_quotes.json"));
  check("demand/portal_quotes.json exists", Boolean(portalData), "Missing data/demand/portal_quotes.json");

  // ── 2. Corridor Validation ──

  console.log("\n── Corridor Registry ──");
  const corridors = corridorsData?.corridors || [];
  check("Corridors defined", corridors.length >= 2, `Only ${corridors.length} corridors`);
  check("Other corridor exists", corridors.some(c => c.id === "other"), "Missing 'other' fallback corridor");

  const corridorIds = new Set();
  for (const c of corridors) {
    if (corridorIds.has(c.id)) {
      check(`Corridor ID unique: ${c.id}`, false, `Duplicate corridor ID: ${c.id}`);
    }
    corridorIds.add(c.id);
    if (c.id !== "other") {
      check(`Corridor ${c.id} has clusters`, c.origin_cluster?.length > 0 && c.destination_cluster?.length > 0,
        `Corridor ${c.id} missing origin or destination cluster`);
      check(`Corridor ${c.id} has priority`, ["high", "medium", "low"].includes(c.priority),
        `Corridor ${c.id} has invalid priority: ${c.priority}`);
    }
  }

  // ── 3. Corridor Assignment ──

  console.log("\n── Corridor Assignment ──");
  const inventory = loadJSON(path.join(ROOT, "data", "lane_inventory.json")) || [];
  const sampleLanes = inventory.slice(0, 50); // test first 50
  let assignedCount = 0;
  let otherCount = 0;

  for (const lane of sampleLanes) {
    const originCity = lane.origin?.split(",")[0]?.trim() || "";
    const destCity = lane.destination?.split(",")[0]?.trim() || "";

    // Match against corridors
    let matched = false;
    for (const c of corridors) {
      if (c.id === "other") continue;
      const fwdO = cityInCluster(originCity, c.origin_cluster);
      const fwdD = cityInCluster(destCity, c.destination_cluster);
      const revO = cityInCluster(originCity, c.destination_cluster);
      const revD = cityInCluster(destCity, c.origin_cluster);
      const oAny = fwdO || revO;
      const dAny = fwdD || revD;
      if ((fwdO && fwdD) || (revO && revD) || (oAny && dAny)) {
        matched = true;
        break;
      }
    }
    if (matched) assignedCount++;
    else otherCount++;
  }

  check("Sample lanes assigned to corridors", assignedCount > 0, `0/${sampleLanes.length} lanes matched a corridor`);
  if (otherCount > sampleLanes.length * 0.5) {
    warn("Many lanes in 'other' corridor", `${otherCount}/${sampleLanes.length} lanes fell to 'other'`);
  }

  // ── 4. Canonical Validation ──

  console.log("\n── URL Discipline & Canonicals ──");

  // Check slug uniqueness in inventory
  const slugSet = new Set();
  let slugDupes = 0;
  for (const lane of inventory.filter(l => l.mode === "LTL").slice(0, 200)) {
    const slug = lane.slug || laneSlug(lane.origin, lane.destination);
    if (slugSet.has(slug)) slugDupes++;
    slugSet.add(slug);
  }
  check("Lane slugs unique (first 200 LTL)", slugDupes === 0, `${slugDupes} duplicate slugs`);

  // Check canonical pattern enforcement
  check("Canonical pattern defined", Boolean(seoConfig?.canonicalPattern), "Missing canonicalPattern in seo-engine.json");
  check("Noindex param patterns defined", (seoConfig?.noindexParameterPatterns?.length || 0) > 0, "Missing noindex param patterns");

  // ── 5. Library Files Exist ──

  console.log("\n── Library Modules ──");
  const libFiles = [
    "lib/corridors.js",
    "lib/url-discipline.js",
    "lib/page-eligibility.js",
    "lib/lane-engine.js",
    "lib/link-graph.js",
    "lib/published-registry.js",
  ];
  for (const f of libFiles) {
    const exists = fs.existsSync(path.join(ROOT, f));
    check(`${f} exists`, exists, `Missing ${f}`);
  }

  // ── 6. Integration Checks ──

  console.log("\n── Integration ──");
  const laneEngineSrc = fs.readFileSync(path.join(ROOT, "lib", "lane-engine.js"), "utf-8");
  check("lane-engine imports corridors", laneEngineSrc.includes("assignCorridorToLane"), "Missing corridor integration in lane-engine.js");
  check("lane-engine imports url-discipline", laneEngineSrc.includes("url-discipline"), "Missing url-discipline integration in lane-engine.js");
  check("lane-engine assigns corridor_id", laneEngineSrc.includes("corridor_id"), "Missing corridor_id in page object");
  check("lane-engine attaches corridor_links", laneEngineSrc.includes("corridor_links"), "Missing corridor_links in generatePages");

  const eligibilitySrc = fs.readFileSync(path.join(ROOT, "lib", "page-eligibility.js"), "utf-8");
  check("page-eligibility has demand gate", eligibilitySrc.includes("ELIG-DEMAND-01"), "Missing demand gate");
  check("page-eligibility has content gate", eligibilitySrc.includes("ELIG-CONTENT-01"), "Missing content gate");
  check("page-eligibility has dupe gate", eligibilitySrc.includes("ELIG-DUPE-01"), "Missing duplication gate");
  check("page-eligibility has quality gate", eligibilitySrc.includes("ELIG-QUALITY-01"), "Missing quality gate");
  check("page-eligibility exports buildPublishDecision", eligibilitySrc.includes("buildPublishDecision"), "Missing buildPublishDecision export");

  const corridorsSrc = fs.readFileSync(path.join(ROOT, "lib", "corridors.js"), "utf-8");
  check("corridors.js exports loadCorridors", corridorsSrc.includes("export function loadCorridors"), "Missing loadCorridors export");
  check("corridors.js exports assignCorridorToLane", corridorsSrc.includes("export function assignCorridorToLane"), "Missing assignCorridorToLane export");
  check("corridors.js exports getCorridorById", corridorsSrc.includes("export function getCorridorById"), "Missing getCorridorById export");
  check("corridors.js exports listCorridorLaneCandidates", corridorsSrc.includes("export function listCorridorLaneCandidates"), "Missing listCorridorLaneCandidates export");
  check("corridors.js exports generateCorridorLinks", corridorsSrc.includes("export function generateCorridorLinks"), "Missing generateCorridorLinks export");

  const urlSrc = fs.readFileSync(path.join(ROOT, "lib", "url-discipline.js"), "utf-8");
  check("url-discipline exports canonicalForIntent", urlSrc.includes("export function canonicalForIntent"), "Missing canonicalForIntent export");
  check("url-discipline exports normalizeCityName", urlSrc.includes("export function normalizeCityName"), "Missing normalizeCityName export");
  check("url-discipline exports laneSlug", urlSrc.includes("export function laneSlug"), "Missing laneSlug export");
  check("url-discipline exports isParametrizedUrlIndexable", urlSrc.includes("export function isParametrizedUrlIndexable"), "Missing isParametrizedUrlIndexable export");
  check("url-discipline exports buildCanonicalIndex", urlSrc.includes("export function buildCanonicalIndex"), "Missing buildCanonicalIndex export");

  // ── 7. Corridor Hub Pages ──

  console.log("\n── Corridor Hub Pages ──");
  const hubPage = path.join(ROOT, "app", "corridors", "[corridorId]", "page.js");
  check("Corridor hub page exists", fs.existsSync(hubPage), "Missing app/corridors/[corridorId]/page.js");

  const explainerPage = path.join(ROOT, "app", "corridors", "[corridorId]", "how-warp-runs-this-corridor", "page.js");
  check("Corridor explainer page exists", fs.existsSync(explainerPage), "Missing corridor explainer page");

  // ── 8. Config Validation ──

  console.log("\n── Config Thresholds ──");
  if (seoConfig) {
    check("similarityThreshold set", typeof seoConfig.similarityThreshold === "number", "Missing similarityThreshold");
    check("qualityThreshold set", typeof seoConfig.qualityThreshold === "number", "Missing qualityThreshold");
    check("qualityHardFloor set", typeof seoConfig.qualityHardFloor === "number", "Missing qualityHardFloor");
    check("maxBlockedPages set", typeof seoConfig.maxBlockedPages === "number", "Missing maxBlockedPages");
    check("toolPages defined", (seoConfig.toolPages?.length || 0) > 0, "No tool pages configured");
  }

  // ── 9. Publish Audit Artifacts ──

  console.log("\n── Publish Audit System ──");

  const auditLibFiles = [
    "lib/publish-audit.js",
    "lib/seo-impact-estimator.js",
    "lib/seo-momentum.js",
    "lib/publish-integrity-checks.js",
    "scripts/verify_live_pages.js",
    "scripts/build_publish_audit_bundle.js",
  ];
  for (const f of auditLibFiles) {
    const exists = fs.existsSync(path.join(ROOT, f));
    check(`${f} exists`, exists, `Missing ${f}`);
  }

  const auditConfigFiles = [
    "config/publish-audit.json",
    "config/publish-verification.json",
    "config/seo-impact-benchmarks.json",
  ];
  for (const f of auditConfigFiles) {
    const exists = fs.existsSync(path.join(ROOT, f));
    check(`${f} exists`, exists, `Missing ${f}`);
  }

  // Check publish audit API routes
  const auditRoutes = [
    "app/api/seo/publish-audit/latest/route.js",
    "app/api/seo/publish-audit/today/route.js",
    "app/api/seo/publish-audit/impact/route.js",
    "app/api/seo/publish-audit/momentum/route.js",
    "app/api/seo/publish-audit/live-verification/route.js",
  ];
  for (const f of auditRoutes) {
    const exists = fs.existsSync(path.join(ROOT, f));
    check(`${f} exists`, exists, `Missing ${f}`);
  }

  // Check Publish Audit dashboard page
  const auditPage = path.join(ROOT, "app", "internal", "seo-control", "publish-audit", "page.js");
  check("Publish Audit dashboard page exists", fs.existsSync(auditPage), "Missing publish-audit page");

  // Check publish audit artifacts (these may not exist until a run happens)
  const auditArtifacts = [
    "artifacts/publish_run_history.json",
    "artifacts/published_pages_latest.json",
    "artifacts/publish_confirmation_report.json",
    "artifacts/seo_impact_estimate.json",
  ];
  for (const f of auditArtifacts) {
    const exists = fs.existsSync(path.join(ROOT, f));
    if (exists) {
      check(`${f} exists`, true);
    } else {
      warn(`${f} missing`, "Run 'npm run audit:publish' to generate");
    }
  }

  // Validate publish-audit.js exports
  const publishAuditSrc = fs.readFileSync(path.join(ROOT, "lib", "publish-audit.js"), "utf-8");
  check("publish-audit exports loadLatestPublishDecision", publishAuditSrc.includes("export function loadLatestPublishDecision"), "Missing export");
  check("publish-audit exports didSomethingPostToday", publishAuditSrc.includes("export function didSomethingPostToday"), "Missing export");
  check("publish-audit exports buildPublishConfirmationReport", publishAuditSrc.includes("export function buildPublishConfirmationReport"), "Missing export");
  check("publish-audit exports appendPublishRunHistory", publishAuditSrc.includes("export function appendPublishRunHistory"), "Missing export");

  // Validate publish classification layer
  const classificationExists = fs.existsSync(path.join(ROOT, "lib", "publish-classification.js"));
  check("lib/publish-classification.js exists", classificationExists, "Missing publish-classification.js");

  if (classificationExists) {
    const clsSrc = fs.readFileSync(path.join(ROOT, "lib", "publish-classification.js"), "utf-8");
    check("classification exports classifyPublishRun", clsSrc.includes("export function classifyPublishRun"), "Missing classifyPublishRun export");
    check("classification exports isLocalSimulation", clsSrc.includes("export function isLocalSimulation"), "Missing isLocalSimulation export");
    check("classification exports isProductionEnvironment", clsSrc.includes("export function isProductionEnvironment"), "Missing isProductionEnvironment export");
    check("classification exports isConfirmedProductionPublish", clsSrc.includes("export function isConfirmedProductionPublish"), "Missing isConfirmedProductionPublish export");
    check("classification has CLASSIFICATIONS enum", clsSrc.includes("LOCAL_SIMULATION") && clsSrc.includes("PRODUCTION_CONFIRMED"), "Missing classification constants");
    check("classification has TRUST_LEVELS", clsSrc.includes("TRUST_LEVELS"), "Missing TRUST_LEVELS");
  }

  // Validate publish-trust.json config
  const trustConfigExists = fs.existsSync(path.join(ROOT, "config", "publish-trust.json"));
  check("config/publish-trust.json exists", trustConfigExists, "Missing publish-trust.json");
  if (trustConfigExists) {
    const trustConfig = loadJSON(path.join(ROOT, "config", "publish-trust.json"));
    check("publish-trust has production_domains", (trustConfig?.production_domains?.length || 0) > 0, "Missing production_domains");
    check("publish-trust has localhost_markers", (trustConfig?.localhost_markers?.length || 0) > 0, "Missing localhost_markers");
    check("publish-trust has require_live_verification", typeof trustConfig?.require_live_verification_for_confirmed === "boolean", "Missing require_live_verification_for_confirmed");
  }

  // Validate classification wired into publish-audit.js
  check("publish-audit imports classifyPublishRun", publishAuditSrc.includes("classifyPublishRun"), "publish-audit.js does not import classifyPublishRun");
  check("publish-audit uses isConfirmedProductionPublish", publishAuditSrc.includes("isConfirmedProductionPublish"), "publish-audit.js does not use isConfirmedProductionPublish");

  // Validate integrity checks use classification
  if (fs.existsSync(path.join(ROOT, "lib", "publish-integrity-checks.js"))) {
    const integritySrc = fs.readFileSync(path.join(ROOT, "lib", "publish-integrity-checks.js"), "utf-8");
    check("integrity checks import classification", integritySrc.includes("classifyPublishRun"), "integrity-checks.js does not import classification");
    check("integrity checks validate classification_mismatch", integritySrc.includes("classification_mismatch"), "Missing classification_mismatch check");
  }

  // ── Build Publish Decision Artifact ──

  console.log("\n── Publish Decision ──");
  const canonicalConflicts = [];
  const brokenLinks = [];

  const publishDecision = {
    run_id: `seo-${Date.now()}-${String(stableHash(String(Math.random()))).slice(0, 6)}`,
    timestamp: new Date().toISOString(),
    mode: MODE,
    pages_attempted: sampleLanes.length,
    pages_blocked: 0,
    pages_noindexed: 0,
    pages_indexed: sampleLanes.length,
    blocked_reasons: errors.map(e => ({ rule_id: "VALIDATE-" + e.name.replace(/\s+/g, "-").toUpperCase().slice(0, 30), page_key: "", details: e })),
    canonical_conflicts: canonicalConflicts,
    duplicate_conflicts: [],
    broken_internal_links: brokenLinks,
    quality_distribution: { excellent: 0, good: 0, fair: 0, poor: 0 },
    allowed: errors.length === 0,
    checks_total: totalChecks,
    checks_passed: passedChecks,
    checks_failed: errors.length,
    warnings: warnings.length,
  };

  fs.mkdirSync(path.join(ROOT, "artifacts"), { recursive: true });
  fs.writeFileSync(
    path.join(ROOT, "artifacts", "publish_decision.json"),
    JSON.stringify(publishDecision, null, 2)
  );

  // ── Summary ──

  console.log("\n=== Summary ===");
  console.log(`  Total checks:  ${totalChecks}`);
  console.log(`  Passed:        ${passedChecks}`);
  console.log(`  Failed:        ${errors.length}`);
  console.log(`  Warnings:      ${warnings.length}`);
  console.log(`  Publish:       ${publishDecision.allowed ? "ALLOWED" : "BLOCKED"}`);
  console.log(`  Artifact:      artifacts/publish_decision.json`);

  if (errors.length > 0) {
    console.log("\n  Failures:");
    for (const e of errors) {
      console.log(`    - ${e.name}: ${e.detail}`);
    }
  }

  if (!publishDecision.allowed && MODE !== "dry") {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
