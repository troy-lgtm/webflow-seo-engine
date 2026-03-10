/**
 * Layer 2: Indexing Firewall — Page Eligibility Gates
 *
 * Decides: index / noindex / do not generate
 * Runs at build time and publish time.
 *
 * 4 gates:
 *   Gate 1: Demand gate
 *   Gate 2: Content sufficiency gate
 *   Gate 3: Duplication gate
 *   Gate 4: Quality gate
 */

import { stableHash } from "@/lib/hash";

// ── Config Loading ───────────────────────────────────────────────────

let _configCache = null;

function loadConfig() {
  if (_configCache) return _configCache;
  try {
    // eslint-disable-next-line
    _configCache = require("@/../config/seo-engine.json");
  } catch {
    _configCache = {
      demandThresholds: { gscImpressionsMin: 50, portalQuoteFrequencyMin: 3, keywordDemandMin: 1 },
      similarityThreshold: 0.92,
      qualityThreshold: 65,
      qualityHardFloor: 40,
      contentMinimums: {
        laneServicePage: { minFaqCount: 4, minIntroWords: 20, minGuidanceWords: 30, minOperationalWords: 20 },
        laneDataPage: { requireNumericRanges: true, requireTimestamp: true, requireInterpretation: true },
      },
      internalLinking: { minRelatedLanes: 5, requireCorridorHub: true, requireToolLink: true },
    };
  }
  return _configCache;
}

// ── Demand Data Loading ──────────────────────────────────────────────

let _demandCache = null;

function loadDemandData() {
  if (_demandCache) return _demandCache;
  try {
    const gsc = require("@/../data/demand/gsc.json");
    const keywords = require("@/../data/demand/keywords.json");
    const portal = require("@/../data/demand/portal_quotes.json");
    _demandCache = { gsc, keywords, portal };
  } catch {
    _demandCache = { gsc: {}, keywords: {}, portal: {} };
  }
  return _demandCache;
}

// ── Text Fingerprinting for Duplication Detection ────────────────────

/**
 * Build a text fingerprint from headings + body sections.
 * Uses token hashing for deterministic, fast similarity checks.
 */
export function buildTextFingerprint(page) {
  const sections = [
    page.h1 || "",
    page.intro || "",
    page.problem_section || "",
    page.solution_section || "",
    page.proof_section || "",
    ...(page.faq || []).map(f => `${f.q} ${f.a}`),
  ];

  const text = sections.join(" ").toLowerCase();

  // Tokenize and remove stopwords
  const tokens = text
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2 && !SIMILARITY_STOPWORDS.has(t));

  // Build token frequency map
  const freq = new Map();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }

  return {
    tokens: [...freq.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    tokenCount: tokens.length,
    hash: String(stableHash(tokens.join("|"))),
  };
}

const SIMILARITY_STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was",
  "one", "our", "out", "with", "this", "that", "from", "have", "has", "been",
  "will", "your", "their", "they", "what", "when", "which", "how", "each",
  "she", "does", "these", "than", "its", "also", "into", "just", "more",
  "some", "such", "them", "then", "other", "about", "would", "make",
  "freight", "shipping", "lane", "warp", "team", "teams",
]);

/**
 * Calculate cosine similarity between two fingerprints.
 */
export function cosineSimilarity(fp1, fp2) {
  if (!fp1 || !fp2) return 0;

  const map1 = new Map(fp1.tokens);
  const map2 = new Map(fp2.tokens);

  let dot = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (const [token, freq] of map1) {
    mag1 += freq * freq;
    if (map2.has(token)) {
      dot += freq * map2.get(token);
    }
  }
  for (const [, freq] of map2) {
    mag2 += freq * freq;
  }

  mag1 = Math.sqrt(mag1);
  mag2 = Math.sqrt(mag2);

  if (mag1 === 0 || mag2 === 0) return 0;
  return dot / (mag1 * mag2);
}

// ── Gate Implementations ─────────────────────────────────────────────

/**
 * Gate 1: Demand gate.
 * Index only if search demand OR strategic corridor priority.
 */
function demandGate({ lane, corridor, laneSlug: slug }) {
  const config = loadConfig();
  const thresholds = config.demandThresholds;
  const demand = loadDemandData();
  const reasons = [];

  // Check corridor priority
  const corridorPriority = corridor?.priority;
  if (corridorPriority === "high" || corridorPriority === "medium") {
    return { passed: true, reasons: [] };
  }

  // Check GSC impressions
  const gscKey = slug || "";
  const gscData = demand.gsc[gscKey];
  if (gscData && gscData.impressions >= thresholds.gscImpressionsMin) {
    return { passed: true, reasons: [] };
  }

  // Check keyword demand
  const kwData = demand.keywords[gscKey];
  if (kwData && kwData.length >= thresholds.keywordDemandMin) {
    return { passed: true, reasons: [] };
  }

  // Check portal quote frequency
  const portalData = demand.portal[gscKey];
  if (portalData && portalData.monthly_quotes >= thresholds.portalQuoteFrequencyMin) {
    return { passed: true, reasons: [] };
  }

  reasons.push({
    ruleId: "ELIG-DEMAND-01",
    details: `No demand signal found for lane ${slug}. GSC: ${gscData?.impressions || 0}, Keywords: ${kwData?.length || 0}, Portal: ${portalData?.monthly_quotes || 0}`,
  });

  return { passed: false, reasons };
}

/**
 * Gate 2: Content sufficiency gate.
 */
function contentSufficiencyGate({ pageType, content }) {
  const config = loadConfig();
  const reasons = [];

  if (pageType === "lane_service" || pageType === "lane") {
    const mins = config.contentMinimums.laneServicePage;

    // FAQ count
    const faqCount = content.faq?.length || 0;
    if (faqCount < mins.minFaqCount) {
      reasons.push({
        ruleId: "ELIG-CONTENT-01",
        details: `FAQ count ${faqCount} < minimum ${mins.minFaqCount}`,
      });
    }

    // Intro word count
    const introWords = (content.intro || "").split(/\s+/).filter(Boolean).length;
    if (introWords < mins.minIntroWords) {
      reasons.push({
        ruleId: "ELIG-CONTENT-02",
        details: `Intro word count ${introWords} < minimum ${mins.minIntroWords}`,
      });
    }

    // Guidance / problem section
    const guidanceWords = (content.problem_section || "").split(/\s+/).filter(Boolean).length;
    if (guidanceWords < mins.minGuidanceWords) {
      reasons.push({
        ruleId: "ELIG-CONTENT-03",
        details: `Problem/guidance section ${guidanceWords} words < minimum ${mins.minGuidanceWords}`,
      });
    }

    // Operational / solution section
    const opsWords = (content.solution_section || "").split(/\s+/).filter(Boolean).length;
    if (opsWords < mins.minOperationalWords) {
      reasons.push({
        ruleId: "ELIG-CONTENT-04",
        details: `Solution/operational section ${opsWords} words < minimum ${mins.minOperationalWords}`,
      });
    }

    // Check if intro is boilerplate (same as a template with no city specifics)
    const introLower = (content.intro || "").toLowerCase();
    const originCity = (content.lane?.origin || "").split(",")[0].trim().toLowerCase();
    const destCity = (content.lane?.destination || "").split(",")[0].trim().toLowerCase();
    if (originCity && !introLower.includes(originCity)) {
      reasons.push({
        ruleId: "ELIG-CONTENT-05",
        details: `Intro does not mention origin city "${originCity}" — likely boilerplate`,
      });
    }
    if (destCity && !introLower.includes(destCity)) {
      reasons.push({
        ruleId: "ELIG-CONTENT-06",
        details: `Intro does not mention destination city "${destCity}" — likely boilerplate`,
      });
    }
  }

  if (pageType === "lane_data") {
    const mins = config.contentMinimums.laneDataPage;
    if (mins.requireNumericRanges && !content.lane_stats?.estimated_rate_range_usd) {
      reasons.push({ ruleId: "ELIG-CONTENT-07", details: "Lane data page missing numeric ranges" });
    }
    if (mins.requireTimestamp && !content.data_updated_at) {
      reasons.push({ ruleId: "ELIG-CONTENT-08", details: "Lane data page missing updated timestamp" });
    }
  }

  return { passed: reasons.length === 0, reasons };
}

/**
 * Gate 3: Duplication gate.
 * Block pages with high similarity to existing pages.
 */
function duplicationGate({ content, existingPagesIndex }) {
  const config = loadConfig();
  const threshold = config.similarityThreshold;
  const reasons = [];

  if (!existingPagesIndex || existingPagesIndex.length === 0) {
    return { passed: true, reasons: [], similarityScore: 0 };
  }

  const candidateFp = buildTextFingerprint(content);
  let maxSimilarity = 0;
  let mostSimilarPage = null;

  for (const existing of existingPagesIndex) {
    const sim = cosineSimilarity(candidateFp, existing.fingerprint);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      mostSimilarPage = existing.slug || existing.key;
    }
  }

  if (maxSimilarity >= threshold) {
    reasons.push({
      ruleId: "ELIG-DUPE-01",
      details: `Similarity ${(maxSimilarity * 100).toFixed(1)}% >= threshold ${(threshold * 100).toFixed(1)}% against page "${mostSimilarPage}"`,
    });
  }

  return { passed: reasons.length === 0, reasons, similarityScore: maxSimilarity };
}

/**
 * Gate 4: Quality gate.
 * Score 0-100 based on content quality indicators.
 */
function qualityGate({ content, corridor, corridorLinks }) {
  const config = loadConfig();
  let score = 0;
  const reasons = [];

  // Uniqueness of content (not boilerplate)
  const introWords = (content.intro || "").split(/\s+/).filter(Boolean).length;
  if (introWords >= 30) score += 15;
  else if (introWords >= 20) score += 10;
  else score += 5;

  // Number of structured sections
  const sections = ["problem_section", "solution_section", "proof_section", "executive_summary"]
    .filter(s => content[s] && content[s].length > 20);
  score += Math.min(sections.length * 7, 28);

  // FAQ presence and depth
  const faqCount = content.faq?.length || 0;
  score += Math.min(faqCount * 3, 15);

  // Lane specifics (cities, corridor mention)
  const allText = [
    content.h1, content.intro, content.problem_section, content.solution_section,
  ].filter(Boolean).join(" ").toLowerCase();
  const originCity = (content.lane?.origin || "").split(",")[0].trim().toLowerCase();
  const destCity = (content.lane?.destination || "").split(",")[0].trim().toLowerCase();
  if (originCity && allText.includes(originCity)) score += 5;
  if (destCity && allText.includes(destCity)) score += 5;
  if (corridor && corridor.id !== "other" && allText.includes(corridor.name.toLowerCase().slice(0, 15))) score += 3;

  // Internal link completeness
  if (corridorLinks) {
    if (corridorLinks.corridorHub) score += 5;
    if (corridorLinks.relatedLanes?.length >= 5) score += 7;
    else if (corridorLinks.relatedLanes?.length >= 1) score += 3;
    if (corridorLinks.toolLink) score += 5;
    if (corridorLinks.dataPageLink) score += 2;
  } else {
    // No links at all
    score += 0;
  }

  // Data presence
  if (content.lane_stats?.estimated_rate_range_usd) score += 5;
  if (content.lane_stats?.estimated_transit_days_range) score += 3;
  if (content.schema_jsonld) score += 2;

  // Cap at 100
  score = Math.min(score, 100);

  if (score < config.qualityHardFloor) {
    reasons.push({
      ruleId: "ELIG-QUALITY-01",
      details: `Quality score ${score} below hard floor ${config.qualityHardFloor} — block generation`,
    });
  } else if (score < config.qualityThreshold) {
    reasons.push({
      ruleId: "ELIG-QUALITY-02",
      details: `Quality score ${score} below threshold ${config.qualityThreshold} — noindex`,
    });
  }

  return { score, reasons };
}

// ── Main Evaluation ──────────────────────────────────────────────────

/**
 * Evaluate page eligibility through all 4 gates.
 *
 * @param {{
 *   pageType: string,
 *   lane?: object,
 *   corridor?: object,
 *   content: object,
 *   demandSignals?: object,
 *   existingPagesIndex?: object[],
 *   corridorLinks?: object,
 *   laneSlug?: string
 * }} params
 *
 * @returns {{
 *   allowedToGenerate: boolean,
 *   allowedToIndex: boolean,
 *   blockedReasons: object[],
 *   qualityScore: number,
 *   similarityScore: number,
 *   gateResults: object
 * }}
 */
export function evaluatePageEligibility({
  pageType,
  lane,
  corridor,
  content,
  demandSignals,
  existingPagesIndex,
  corridorLinks,
  laneSlug: slug,
}) {
  const config = loadConfig();
  const allReasons = [];

  // Gate 1: Demand
  const demand = demandGate({ lane, corridor, laneSlug: slug });

  // Gate 2: Content sufficiency
  const sufficiency = contentSufficiencyGate({ pageType, content });

  // Gate 3: Duplication
  const duplication = duplicationGate({ content, existingPagesIndex });

  // Gate 4: Quality
  const quality = qualityGate({ content, corridor, corridorLinks });

  // Collect all blocked reasons
  allReasons.push(...demand.reasons, ...sufficiency.reasons, ...duplication.reasons, ...quality.reasons);

  // Determine final eligibility
  let allowedToGenerate = true;
  let allowedToIndex = true;

  // Duplication blocks generation entirely
  if (!duplication.passed) {
    allowedToGenerate = false;
    allowedToIndex = false;
  }

  // Quality hard floor blocks generation
  if (quality.score < config.qualityHardFloor) {
    allowedToGenerate = false;
    allowedToIndex = false;
  }

  // Weak demand: allow generation for corridor completeness, but noindex
  if (!demand.passed) {
    allowedToIndex = false;
  }

  // Content insufficiency: allow generation, but noindex
  if (!sufficiency.passed) {
    allowedToIndex = false;
  }

  // Quality below threshold: allow generation, but noindex
  if (quality.score < config.qualityThreshold && quality.score >= config.qualityHardFloor) {
    allowedToIndex = false;
  }

  return {
    allowedToGenerate,
    allowedToIndex,
    blockedReasons: allReasons,
    qualityScore: quality.score,
    similarityScore: duplication.similarityScore || 0,
    gateResults: {
      demand: { passed: demand.passed, reasons: demand.reasons },
      contentSufficiency: { passed: sufficiency.passed, reasons: sufficiency.reasons },
      duplication: { passed: duplication.passed, reasons: duplication.reasons, similarity: duplication.similarityScore },
      quality: { passed: quality.reasons.length === 0, score: quality.score, reasons: quality.reasons },
    },
  };
}

// ── Publish Decision Artifact ────────────────────────────────────────

/**
 * Build a publish decision artifact from eligibility evaluations.
 *
 * @param {{ evaluations: object[], mode: string, canonicalConflicts?: object[], brokenLinks?: object[] }} params
 * @returns {object} publish_decision artifact
 */
export function buildPublishDecision({ evaluations, mode, canonicalConflicts, brokenLinks }) {
  const config = loadConfig();

  const blocked = evaluations.filter(e => !e.allowedToGenerate);
  const noindexed = evaluations.filter(e => e.allowedToGenerate && !e.allowedToIndex);
  const indexed = evaluations.filter(e => e.allowedToGenerate && e.allowedToIndex);

  const blockedReasons = [];
  for (const e of blocked) {
    for (const r of e.blockedReasons) {
      blockedReasons.push({ rule_id: r.ruleId, page_key: e.pageKey || e.slug || "", details: r });
    }
  }

  const conflicts = canonicalConflicts || [];
  const broken = brokenLinks || [];

  // Duplicate conflicts among indexed pages
  const duplicateConflicts = evaluations
    .filter(e => e.similarityScore >= config.similarityThreshold && e.allowedToIndex)
    .map(e => ({ page_key: e.pageKey || e.slug || "", similarity: e.similarityScore }));

  // Determine if publish is allowed
  let allowed = true;
  if (conflicts.length > 0) allowed = false;
  if (broken.length > 0) allowed = false;
  if (duplicateConflicts.length > 0) allowed = false;
  if (blocked.length > config.maxBlockedPages && mode !== "dry") allowed = false;

  return {
    run_id: `seo-${Date.now()}-${String(stableHash(String(Math.random()))).slice(0, 6)}`,
    timestamp: new Date().toISOString(),
    mode: mode || "dry",
    pages_attempted: evaluations.length,
    pages_indexed: indexed.length,
    pages_blocked: blocked.length,
    pages_noindexed: noindexed.length,
    blocked_reasons: blockedReasons,
    canonical_conflicts: conflicts,
    duplicate_conflicts: duplicateConflicts,
    broken_internal_links: broken,
    quality_distribution: {
      excellent: evaluations.filter(e => e.qualityScore >= 80).length,
      good: evaluations.filter(e => e.qualityScore >= 65 && e.qualityScore < 80).length,
      fair: evaluations.filter(e => e.qualityScore >= 40 && e.qualityScore < 65).length,
      poor: evaluations.filter(e => e.qualityScore < 40).length,
    },
    allowed,
  };
}
