/**
 * authority-page-validator.js — Quality Gates for Authority Pages
 *
 * Mirrors lane-page-validator.js assessPublishQuality() pattern:
 *   - Hard gates that block publish on failure
 *   - Weighted quality scoring across dimensions
 *   - Grade assignment (A/B/C/D/F)
 *   - publishable flag requires all hard gates + score >= 70%
 *
 * Hard Gates:
 *   AQ-STRUCT-01  All canonical sections present and non-empty
 *   AQ-STRUCT-02  SEO fields present (title, meta, canonical path)
 *   AQ-STRUCT-03  Entity relationships populated (not isolated)
 *   AQ-CONTENT-01 Hero headline contains entity label
 *   AQ-CONTENT-02 Minimum content lengths (body >= 200, primary HTML >= 500)
 *   AQ-CONTENT-03 No placeholder/lorem text
 *   AQ-CONTENT-04 FAQ items present (>= 3)
 *   AQ-SCHEMA-01  FAQ schema valid JSON-LD
 *   AQ-SCHEMA-02  Breadcrumb schema valid JSON-LD
 *   AQ-LINK-01    Internal links present (>= 1 cross-family link)
 *   AQ-QUALITY-01 Weighted quality score >= 70%
 *
 * Scoring Dimensions:
 *   SEO          (25%) — title length, meta description, canonical path
 *   Content      (25%) — body length, primary HTML length, section count
 *   Authority    (20%) — FAQ count, relationship density, operational language
 *   Linking      (15%) — cross-family links, bidirectional relationships
 *   Structure    (15%) — section ordering, field completeness
 *
 * @module authority-page-validator
 */

// ── Banned Content ───────────────────────────────────────────────────

const BANNED_PHRASES = [
  "lorem ipsum", "placeholder", "todo", "fixme", "coming soon",
  "insert text here", "sample text", "example content", "tbd",
  "your company", "acme corp", "click here to learn more",
];

const BANNED_MARKETING_PHRASES = [
  "revolutionize", "game-changing", "cutting-edge", "world-class",
  "best-in-class", "synergy", "leverage our", "unlock the power",
  "seamlessly integrate", "one-stop shop", "turnkey solution",
];

// ── Hard Gates ───────────────────────────────────────────────────────

/**
 * Assess publish quality for an authority page.
 *
 * @param {object} pageData - Canonical authority page data from buildAuthorityPageData()
 * @param {object} rendered - Rendered content from renderAuthorityPage()
 * @returns {object} Quality report: { publishable, grade, score, gates, dimensions, errors, warnings, gates_passed, gate_count }
 */
export function assessAuthorityQuality(pageData, rendered) {
  const pd = pageData;
  const rf = rendered || {};
  const errors = [];
  const warnings = [];
  const gates = {};

  if (!pd) {
    return {
      publishable: false,
      grade: "F",
      score: 0,
      gates: { "AQ-STRUCT-01": false },
      dimensions: {},
      errors: [{ gate: "AQ-STRUCT-01", message: "pageData is null" }],
      warnings: [],
      gates_passed: 0,
      gate_count: 1,
    };
  }

  const pageType = pd.page_type || "";
  const sectionOrder = pd._section_order || [];

  // ════════════════════════════════════════════════════════════════════
  // HARD GATES — Any single failure blocks publish
  // ════════════════════════════════════════════════════════════════════

  // ── AQ-STRUCT-01: Canonical sections present and non-empty ────────
  {
    const missingSections = [];
    for (const section of sectionOrder) {
      if (section === "cta") continue; // CTA always present by construction
      if (!pd[section]) {
        missingSections.push(section);
      } else if (typeof pd[section] === "object") {
        // Check section has some content
        const hasContent = Object.values(pd[section]).some(v =>
          (typeof v === "string" && v.trim().length > 0) ||
          (Array.isArray(v) && v.length > 0) ||
          (typeof v === "object" && v !== null && Object.keys(v).length > 0)
        );
        if (!hasContent) missingSections.push(section);
      }
    }
    gates["AQ-STRUCT-01"] = missingSections.length === 0;
    if (missingSections.length > 0) {
      errors.push({
        gate: "AQ-STRUCT-01",
        message: `Missing or empty sections: ${missingSections.join(", ")}`,
        missing: missingSections,
      });
    }
  }

  // ── AQ-STRUCT-02: SEO fields present and valid ────────────────────
  {
    const seoChecks = [];
    if (!pd.page_title || pd.page_title.length < 15) seoChecks.push("page_title");
    if (!pd.meta_description || pd.meta_description.length < 40) seoChecks.push("meta_description");
    if (!pd.canonical_path || pd.canonical_path.length < 5) seoChecks.push("canonical_path");
    if (!pd.slug) seoChecks.push("slug");
    gates["AQ-STRUCT-02"] = seoChecks.length === 0;
    if (seoChecks.length > 0) {
      errors.push({
        gate: "AQ-STRUCT-02",
        message: `SEO fields missing or invalid: ${seoChecks.join(", ")}`,
      });
    }
  }

  // ── AQ-STRUCT-03: Entity has relationships (not isolated) ─────────
  {
    const links = pd.internal_links || {};
    const totalLinks = (links.concepts?.length || 0) +
      (links.solutions?.length || 0) +
      (links.equipment?.length || 0);
    gates["AQ-STRUCT-03"] = totalLinks > 0;
    if (totalLinks === 0) {
      errors.push({
        gate: "AQ-STRUCT-03",
        message: "Entity has no relationships (isolated in knowledge graph)",
      });
    }
  }

  // ── AQ-CONTENT-01: Hero headline contains entity label ────────────
  {
    const headline = pd.hero?.headline || "";
    const label = pd.slug?.replace(/-/g, " ") || "";
    // Check headline contains a recognizable form of the entity name
    const headlineLower = headline.toLowerCase();
    const labelWords = label.toLowerCase().split(" ");
    const hasLabel = labelWords.every(w => headlineLower.includes(w));
    gates["AQ-CONTENT-01"] = hasLabel && headline.length >= 10;
    if (!gates["AQ-CONTENT-01"]) {
      errors.push({
        gate: "AQ-CONTENT-01",
        message: `Hero headline must contain entity label. Got: "${headline}"`,
      });
    }
  }

  // ── AQ-CONTENT-02: Minimum content lengths ────────────────────────
  {
    const bodyLen = (rf.body_text || "").length;
    const htmlLen = (rf.primary_content_html || "").length;
    const checks = [];
    if (bodyLen < 200) checks.push(`body_text: ${bodyLen} < 200`);
    if (htmlLen < 500) checks.push(`primary_content_html: ${htmlLen} < 500`);
    gates["AQ-CONTENT-02"] = checks.length === 0;
    if (checks.length > 0) {
      errors.push({
        gate: "AQ-CONTENT-02",
        message: `Content below minimum length: ${checks.join("; ")}`,
      });
    }
  }

  // ── AQ-CONTENT-03: No placeholder or banned content ───────────────
  {
    const allText = [
      rf.body_text || "",
      rf.primary_content_html || "",
      pd.hero?.headline || "",
      pd.hero?.subhead || "",
      pd.meta_description || "",
    ].join(" ").toLowerCase();

    const foundBanned = [];
    for (const phrase of BANNED_PHRASES) {
      if (allText.includes(phrase.toLowerCase())) {
        foundBanned.push(phrase);
      }
    }
    gates["AQ-CONTENT-03"] = foundBanned.length === 0;
    if (foundBanned.length > 0) {
      errors.push({
        gate: "AQ-CONTENT-03",
        message: `Banned content found: ${foundBanned.join(", ")}`,
      });
    }

    // Soft check: marketing language
    const foundMarketing = [];
    for (const phrase of BANNED_MARKETING_PHRASES) {
      if (allText.includes(phrase.toLowerCase())) {
        foundMarketing.push(phrase);
      }
    }
    if (foundMarketing.length > 0) {
      warnings.push({
        gate: "AQ-CONTENT-03",
        message: `Marketing language detected: ${foundMarketing.join(", ")}`,
      });
    }
  }

  // ── AQ-CONTENT-04: FAQ items present ──────────────────────────────
  {
    const faqCount = pd.faq?.items?.length || 0;
    gates["AQ-CONTENT-04"] = faqCount >= 3;
    if (faqCount < 3) {
      errors.push({
        gate: "AQ-CONTENT-04",
        message: `FAQ count ${faqCount} < minimum 3`,
      });
    }
  }

  // ── AQ-SCHEMA-01: FAQ schema valid JSON-LD ────────────────────────
  {
    const faqHtml = rf.faq_schema_html || "";
    let valid = false;
    if (faqHtml.includes("application/ld+json")) {
      try {
        const json = faqHtml
          .replace(/<script[^>]*>/, "")
          .replace(/<\/script>/, "");
        const parsed = JSON.parse(json);
        valid = parsed["@type"] === "FAQPage" && parsed.mainEntity?.length >= 3;
      } catch {
        valid = false;
      }
    }
    gates["AQ-SCHEMA-01"] = valid;
    if (!valid) {
      errors.push({
        gate: "AQ-SCHEMA-01",
        message: "FAQ schema is invalid or missing",
      });
    }
  }

  // ── AQ-SCHEMA-02: Breadcrumb schema valid JSON-LD ─────────────────
  {
    const bcHtml = rf.breadcrumb_schema_html || "";
    let valid = false;
    if (bcHtml.includes("application/ld+json")) {
      try {
        const json = bcHtml
          .replace(/<script[^>]*>/, "")
          .replace(/<\/script>/, "");
        const parsed = JSON.parse(json);
        valid = parsed["@type"] === "BreadcrumbList" &&
          parsed.itemListElement?.length >= 3;
      } catch {
        valid = false;
      }
    }
    gates["AQ-SCHEMA-02"] = valid;
    if (!valid) {
      errors.push({
        gate: "AQ-SCHEMA-02",
        message: "Breadcrumb schema is invalid or missing",
      });
    }
  }

  // ── AQ-LINK-01: Internal links present ────────────────────────────
  {
    const links = pd.internal_links || {};
    // Must have at least 1 link to a different entity family
    const families = new Set();
    for (const group of Object.values(links)) {
      for (const link of group || []) {
        if (link.family && link.family !== pd.page_type) {
          families.add(link.family);
        }
      }
    }
    gates["AQ-LINK-01"] = families.size >= 1;
    if (families.size < 1) {
      errors.push({
        gate: "AQ-LINK-01",
        message: "No cross-family internal links found",
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // QUALITY SCORING — Weighted dimensions
  // ════════════════════════════════════════════════════════════════════

  const dimensions = {};

  // ── SEO (25%) ─────────────────────────────────────────────────────
  {
    let seoScore = 0;
    const titleLen = (pd.page_title || "").length;
    const metaLen = (pd.meta_description || "").length;

    // Title: 30-60 chars ideal
    if (titleLen >= 30 && titleLen <= 60) seoScore += 35;
    else if (titleLen >= 20 && titleLen <= 70) seoScore += 25;
    else if (titleLen > 0) seoScore += 10;

    // Meta: 120-160 chars ideal
    if (metaLen >= 120 && metaLen <= 160) seoScore += 35;
    else if (metaLen >= 80 && metaLen <= 180) seoScore += 25;
    else if (metaLen > 0) seoScore += 10;

    // Canonical path present and valid
    if (pd.canonical_path?.startsWith("/")) seoScore += 15;

    // Slug matches expected pattern
    if (pd.slug?.length > 3) seoScore += 15;

    dimensions.seo = Math.min(100, seoScore);
  }

  // ── Content (25%) ─────────────────────────────────────────────────
  {
    let contentScore = 0;
    const bodyLen = (rf.body_text || "").length;
    const htmlLen = (rf.primary_content_html || "").length;

    // Body text length: 300+ is good
    if (bodyLen >= 400) contentScore += 30;
    else if (bodyLen >= 300) contentScore += 25;
    else if (bodyLen >= 200) contentScore += 15;

    // Primary HTML length: 1500+ is good
    if (htmlLen >= 2000) contentScore += 30;
    else if (htmlLen >= 1500) contentScore += 25;
    else if (htmlLen >= 500) contentScore += 15;

    // Section count
    const sectionCount = sectionOrder.length;
    if (sectionCount >= 8) contentScore += 20;
    else if (sectionCount >= 6) contentScore += 15;
    else if (sectionCount >= 4) contentScore += 10;

    // H2 headings present in HTML
    const h2Count = (rf.primary_content_html || "").match(/<h2>/g)?.length || 0;
    if (h2Count >= 5) contentScore += 20;
    else if (h2Count >= 3) contentScore += 15;
    else if (h2Count >= 1) contentScore += 10;

    dimensions.content = Math.min(100, contentScore);
  }

  // ── Authority (20%) ───────────────────────────────────────────────
  {
    let authScore = 0;
    const faqCount = pd.faq?.items?.length || 0;

    // FAQ count: 5+ is excellent
    if (faqCount >= 5) authScore += 30;
    else if (faqCount >= 4) authScore += 25;
    else if (faqCount >= 3) authScore += 15;

    // Relationship density
    const links = pd.internal_links || {};
    const totalLinks = Object.values(links).reduce((sum, arr) => sum + (arr?.length || 0), 0);
    if (totalLinks >= 6) authScore += 30;
    else if (totalLinks >= 4) authScore += 25;
    else if (totalLinks >= 2) authScore += 15;

    // Operational language presence
    const bodyLower = (rf.body_text || "").toLowerCase();
    const opTerms = ["freight", "shipment", "carrier", "pallet", "route", "delivery", "transit"];
    const opCount = opTerms.filter(t => bodyLower.includes(t)).length;
    if (opCount >= 4) authScore += 20;
    else if (opCount >= 2) authScore += 15;
    else if (opCount >= 1) authScore += 10;

    // No marketing language penalty
    const marketingCount = BANNED_MARKETING_PHRASES.filter(p => bodyLower.includes(p)).length;
    if (marketingCount === 0) authScore += 20;
    else authScore += Math.max(0, 20 - marketingCount * 5);

    dimensions.authority = Math.min(100, authScore);
  }

  // ── Linking (15%) ─────────────────────────────────────────────────
  {
    let linkScore = 0;
    const links = pd.internal_links || {};
    const linkGroups = Object.values(links).filter(arr => arr?.length > 0);

    // Cross-family link diversity
    const crossFamilyGroups = linkGroups.filter(arr =>
      arr.some(link => link.family && link.family !== pd.page_type)
    );
    if (crossFamilyGroups.length >= 2) linkScore += 40;
    else if (crossFamilyGroups.length >= 1) linkScore += 25;

    // Total link count
    const totalLinks = linkGroups.reduce((sum, arr) => sum + arr.length, 0);
    if (totalLinks >= 5) linkScore += 30;
    else if (totalLinks >= 3) linkScore += 20;
    else if (totalLinks >= 1) linkScore += 10;

    // Links have valid paths
    const validPaths = linkGroups.flat().filter(l => l.href?.startsWith("/")).length;
    if (validPaths >= 3) linkScore += 30;
    else if (validPaths >= 1) linkScore += 20;

    dimensions.linking = Math.min(100, linkScore);
  }

  // ── Structure (15%) ───────────────────────────────────────────────
  {
    let structScore = 0;

    // Section ordering matches canonical
    if (sectionOrder.length > 0) structScore += 25;

    // Page type recognized
    if (["solution", "concept", "equipment"].includes(pageType)) structScore += 25;

    // Entity ID present
    if (pd.entity_id) structScore += 25;

    // Canonical path matches expected pattern
    const pathPatterns = {
      solution: /^\/solutions\//,
      concept: /^\/network\//,
      equipment: /^\/equipment\//,
    };
    if (pathPatterns[pageType]?.test(pd.canonical_path)) structScore += 25;

    dimensions.structure = Math.min(100, structScore);
  }

  // ── Compute weighted score ────────────────────────────────────────
  const weights = {
    seo: 0.25,
    content: 0.25,
    authority: 0.20,
    linking: 0.15,
    structure: 0.15,
  };

  let score = 0;
  for (const [dim, weight] of Object.entries(weights)) {
    score += (dimensions[dim] || 0) * weight;
  }
  score = Math.round(score);

  // ── AQ-QUALITY-01: Minimum score gate ─────────────────────────────
  gates["AQ-QUALITY-01"] = score >= 70;
  if (score < 70) {
    errors.push({
      gate: "AQ-QUALITY-01",
      message: `Quality score ${score}% below minimum 70%`,
    });
  }

  // ── Compute final result ──────────────────────────────────────────
  const gateEntries = Object.entries(gates);
  const gatesPassed = gateEntries.filter(([, v]) => v).length;
  const gateCount = gateEntries.length;
  const allGatesPassed = gatesPassed === gateCount;

  const grade = score >= 90 ? "A"
    : score >= 80 ? "B"
    : score >= 70 ? "C"
    : score >= 60 ? "D"
    : "F";

  return {
    publishable: allGatesPassed,
    grade,
    score,
    gates,
    gates_passed: gatesPassed,
    gate_count: gateCount,
    dimensions,
    errors,
    warnings,
    page_type: pageType,
    entity_id: pd.entity_id || "",
  };
}
