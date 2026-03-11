/**
 * authority-page-schema.js — Canonical Data Model for Authority Pages
 *
 * Builds canonical page data for each authority page type (solutions,
 * concepts, equipment). Mirrors the pattern of lane-page-schema.js
 * but for non-lane authority content.
 *
 * Each page type has a defined section structure:
 *   Solutions:  hero → overview → how_it_works → warp_approach → use_cases →
 *               equipment_fit → related_concepts → faq → cta
 *   Concepts:   hero → overview → how_it_works → warp_implementation →
 *               when_to_use → metrics → related → faq → cta
 *   Equipment:  hero → overview → specs → best_fit → not_ideal →
 *               related_solutions → related_concepts → faq → cta
 *
 * All outputs are deterministic. Same entity always produces same page data.
 *
 * @module authority-page-schema
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import {
  getEntity,
  getRelatedEntities,
  getRelatedByFamily,
  getSolutionsForArchetype,
} from "./authority-graph.js";

// ── Constants ────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = join(__dirname, "..", "artifacts", "authority", "entity_lanes");

const SITE_BASE = "https://www.wearewarp.com";
export const MAX_ASSOCIATED_LANES = 10;
const QUOTE_URL = `${SITE_BASE}/quote`;
const BOOK_URL = `${SITE_BASE}/book`;

/**
 * Canonical section orderings for each page type.
 * Quality gates enforce this ordering.
 */
export const SOLUTION_SECTIONS = [
  "hero", "overview", "how_it_works", "warp_approach",
  "use_cases", "equipment_fit", "related_concepts", "faq", "cta",
];

export const CONCEPT_SECTIONS = [
  "hero", "overview", "how_it_works", "warp_implementation",
  "when_to_use", "metrics", "related", "faq", "cta",
];

export const EQUIPMENT_SECTIONS = [
  "hero", "overview", "specs", "best_fit", "not_ideal",
  "related_solutions", "related_concepts", "faq", "cta",
];

// ── Helpers ──────────────────────────────────────────────────────────

function titleCase(s) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function buildCanonicalPath(entity) {
  return entity.canonical_path || `/${entity.family}/${entity.slug}`;
}

function buildSeoTitle(entity) {
  switch (entity.family) {
    case "solution":
      return `${entity.label} Freight Solutions | WARP`;
    case "concept":
      return `${entity.label} in Freight Logistics | WARP`;
    case "equipment":
      return `${entity.label} Freight Shipping | WARP`;
    default:
      return `${entity.label} | WARP`;
  }
}

function buildMetaDescription(entity) {
  const desc = entity.short_description || "";
  const suffix = "Get an instant quote from WARP.";
  const base = desc.endsWith(".") ? desc : `${desc}.`;
  const full = `${base} ${suffix}`;
  return full.length > 160 ? base.substring(0, 157) + "..." : full;
}

// ── Stable Hash (deterministic selection) ────────────────────────────

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

// ── Associated Lanes Loader ──────────────────────────────────────────

/**
 * Load associated lanes for an entity from the expansion artifacts.
 * Returns the strongest lanes sorted deterministically:
 *   1. Primary relationships first, then secondary
 *   2. Within same rank: score descending
 *   3. Within same score: lane_slug ascending (alphabetical)
 *
 * @param {string} entityId - Entity ID
 * @returns {object[]} Array of lane objects (max MAX_ASSOCIATED_LANES)
 */
function loadAssociatedLanes(entityId) {
  try {
    const filePath = join(ARTIFACTS_DIR, `${entityId}.json`);
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    const lanes = data.lanes || [];

    // Rank ordering: primary first, then secondary, then tertiary
    const rankOrder = { primary: 0, secondary: 1, tertiary: 2 };

    // Filter to primary + secondary only, then sort deterministically
    const eligible = lanes
      .filter(l => l.rank === "primary" || l.rank === "secondary")
      .sort((a, b) => {
        // 1. Rank: primary before secondary
        const ra = rankOrder[a.rank] ?? 9;
        const rb = rankOrder[b.rank] ?? 9;
        if (ra !== rb) return ra - rb;
        // 2. Score descending
        if (b.score !== a.score) return b.score - a.score;
        // 3. Slug ascending (alphabetical tiebreaker)
        return a.lane_slug.localeCompare(b.lane_slug);
      })
      .slice(0, MAX_ASSOCIATED_LANES);

    return eligible.map(l => ({
      slug: l.lane_slug,
      label: `${l.origin} → ${l.destination} ${l.mode}`,
      distance_band: l.distance_band || null,
      mode: l.mode,
      rank: l.rank,
      score: l.score,
    }));
  } catch {
    // Artifact missing or malformed — safe fallback
    return [];
  }
}

// ── FAQ Builders ─────────────────────────────────────────────────────

function buildSolutionFaqs(entity, related) {
  const faqs = [];
  const label = entity.label;
  const modes = (entity.modes || []).join(" and ");

  faqs.push({
    q: `What is ${label.toLowerCase()} in freight logistics?`,
    a: entity.short_description || `${label} is a freight logistics solution offered by WARP.`,
  });

  faqs.push({
    q: `What shipping modes does WARP use for ${label.toLowerCase()}?`,
    a: `WARP operates ${label.toLowerCase()} programs using ${modes} modes, matching the right vehicle and routing to each shipper's volume and delivery requirements.`,
  });

  if (entity.warp_differentiators?.length > 0) {
    faqs.push({
      q: `How does WARP handle ${label.toLowerCase()} differently?`,
      a: entity.warp_differentiators.slice(0, 3).join(". ") + ".",
    });
  }

  if (entity.primary_use_cases?.length > 0) {
    faqs.push({
      q: `When should I use ${label.toLowerCase()}?`,
      a: entity.primary_use_cases.join(". ") + ".",
    });
  }

  if (related.equipment.length > 0) {
    const eqNames = related.equipment.map(e => e.label.toLowerCase()).join(", ");
    faqs.push({
      q: `What equipment does WARP use for ${label.toLowerCase()}?`,
      a: `WARP deploys ${eqNames} for ${label.toLowerCase()} programs, matching vehicle size to load requirements at each stop.`,
    });
  }

  return faqs;
}

function buildConceptFaqs(entity) {
  const faqs = [];
  const label = entity.label;
  const depth = entity.technical_depth || {};

  faqs.push({
    q: `What is ${label.toLowerCase()} in freight?`,
    a: entity.short_description || `${label} is a logistics concept used in freight operations.`,
  });

  if (depth.how_it_works) {
    faqs.push({
      q: `How does ${label.toLowerCase()} work?`,
      a: depth.how_it_works,
    });
  }

  if (depth.when_to_use) {
    faqs.push({
      q: `When should a shipper use ${label.toLowerCase()}?`,
      a: depth.when_to_use,
    });
  }

  if (entity.warp_implementation?.length > 0) {
    faqs.push({
      q: `How does WARP implement ${label.toLowerCase()}?`,
      a: entity.warp_implementation.slice(0, 3).join(". ") + ".",
    });
  }

  if (depth.key_metrics?.length > 0) {
    faqs.push({
      q: `What metrics matter for ${label.toLowerCase()}?`,
      a: `Key performance metrics include ${depth.key_metrics.join(", ")}.`,
    });
  }

  return faqs;
}

function buildEquipmentFaqs(entity) {
  const faqs = [];
  const label = entity.label;
  const specs = entity.specs || {};

  faqs.push({
    q: `What freight fits in a ${label.toLowerCase()}?`,
    a: entity.best_fit_freight?.slice(0, 2).join(". ") + "." || `A ${label.toLowerCase()} is suitable for various freight types.`,
  });

  if (specs.capacity_pallets) {
    faqs.push({
      q: `How many pallets can a ${label.toLowerCase()} carry?`,
      a: `A ${label.toLowerCase()} typically handles ${specs.capacity_pallets} pallets with a max weight capacity of ${specs.capacity_lbs || "varies"} lbs.`,
    });
  }

  if (entity.not_ideal_for?.length > 0) {
    faqs.push({
      q: `When should I NOT use a ${label.toLowerCase()}?`,
      a: entity.not_ideal_for.slice(0, 2).join(". ") + ".",
    });
  }

  faqs.push({
    q: `Does WARP offer ${label.toLowerCase()} shipping?`,
    a: `Yes. WARP operates a fleet that includes ${label.toLowerCase()} capacity, matched to shipment size through our right-sized asset approach.`,
  });

  return faqs;
}

// ── Page Data Builders ───────────────────────────────────────────────

/**
 * Build canonical page data for a solution entity.
 *
 * @param {string} entityId - Solution entity ID
 * @returns {object} Canonical page data with all sections
 */
export function buildSolutionPageData(entityId) {
  const entity = getEntity(entityId);
  if (!entity || entity.family !== "solution") {
    throw new Error(`buildSolutionPageData: invalid solution entity "${entityId}"`);
  }

  const related = getRelatedEntities(entityId);
  const canonicalPath = buildCanonicalPath(entity);

  return {
    page_type: "solution",
    entity_id: entity.id,
    slug: entity.slug,
    canonical_path: canonicalPath,
    page_title: buildSeoTitle(entity),
    meta_description: buildMetaDescription(entity),
    modes: entity.modes || [],
    segments: entity.segments || [],

    // ── Hero ──────────────────────────────────────────────────────
    hero: {
      headline: `${entity.label} Freight Solutions`,
      subhead: entity.short_description,
      primary_cta: { label: "Get Instant Quote", url: QUOTE_URL },
      secondary_cta: { label: "Book a Fit Call", url: BOOK_URL },
    },

    // ── Overview ──────────────────────────────────────────────────
    overview: {
      heading: `What Is ${entity.label}?`,
      content: entity.short_description,
      modes: entity.modes || [],
    },

    // ── How It Works ──────────────────────────────────────────────
    how_it_works: {
      heading: `How ${entity.label} Works`,
      steps: entity.primary_use_cases || [],
    },

    // ── WARP Approach ─────────────────────────────────────────────
    warp_approach: {
      heading: `How WARP Runs ${entity.label}`,
      differentiators: entity.warp_differentiators || [],
    },

    // ── Use Cases ─────────────────────────────────────────────────
    use_cases: {
      heading: `${entity.label} Use Cases`,
      cases: entity.primary_use_cases || [],
    },

    // ── Equipment Fit ─────────────────────────────────────────────
    equipment_fit: {
      heading: "Equipment for This Solution",
      equipment: related.equipment.map(e => ({
        id: e.id,
        label: e.label,
        path: e.canonical_path,
        description: e.short_description,
        specs: e.specs || {},
      })),
    },

    // ── Related Concepts ──────────────────────────────────────────
    related_concepts: {
      heading: "Related Network Capabilities",
      concepts: related.concepts.map(c => ({
        id: c.id,
        label: c.label,
        path: c.canonical_path,
        description: c.short_description,
      })),
    },

    // ── FAQ ───────────────────────────────────────────────────────
    faq: {
      heading: `${entity.label} FAQ`,
      items: buildSolutionFaqs(entity, related),
    },

    // ── CTA ───────────────────────────────────────────────────────
    cta: {
      heading: `Ship Smarter with ${entity.label}`,
      primary: { label: "Get Instant Quote", url: QUOTE_URL },
      secondary: { label: "Book a Fit Call", url: BOOK_URL },
    },

    // ── Section ordering (for quality gate) ───────────────────────
    _section_order: SOLUTION_SECTIONS,

    // ── Associated lanes (reverse link: authority → lanes) ────────
    associated_lanes: loadAssociatedLanes(entityId),

    // ── Internal linking data ─────────────────────────────────────
    internal_links: {
      concepts: related.concepts.map(c => ({
        href: c.canonical_path,
        text: c.label,
        family: "concept",
      })),
      equipment: related.equipment.map(e => ({
        href: e.canonical_path,
        text: e.label,
        family: "equipment",
      })),
    },
  };
}

/**
 * Build canonical page data for a network concept entity.
 *
 * @param {string} entityId - Concept entity ID
 * @returns {object} Canonical page data with all sections
 */
export function buildConceptPageData(entityId) {
  const entity = getEntity(entityId);
  if (!entity || entity.family !== "concept") {
    throw new Error(`buildConceptPageData: invalid concept entity "${entityId}"`);
  }

  const related = getRelatedEntities(entityId);
  const depth = entity.technical_depth || {};
  const canonicalPath = buildCanonicalPath(entity);

  return {
    page_type: "concept",
    entity_id: entity.id,
    slug: entity.slug,
    canonical_path: canonicalPath,
    page_title: buildSeoTitle(entity),
    meta_description: buildMetaDescription(entity),
    applies_to_modes: entity.applies_to_modes || [],

    // ── Hero ──────────────────────────────────────────────────────
    hero: {
      headline: `${entity.label} in Freight Logistics`,
      subhead: entity.short_description,
      primary_cta: { label: "Get Instant Quote", url: QUOTE_URL },
      secondary_cta: { label: "Book a Fit Call", url: BOOK_URL },
    },

    // ── Overview ──────────────────────────────────────────────────
    overview: {
      heading: `What Is ${entity.label}?`,
      content: entity.short_description,
      modes: entity.applies_to_modes || [],
    },

    // ── How It Works ──────────────────────────────────────────────
    how_it_works: {
      heading: `How ${entity.label} Works`,
      content: depth.how_it_works || "",
    },

    // ── WARP Implementation ───────────────────────────────────────
    warp_implementation: {
      heading: `How WARP Uses ${entity.label}`,
      points: entity.warp_implementation || [],
    },

    // ── When to Use ───────────────────────────────────────────────
    when_to_use: {
      heading: `When to Use ${entity.label}`,
      content: depth.when_to_use || "",
    },

    // ── Key Metrics ───────────────────────────────────────────────
    metrics: {
      heading: `${entity.label} Performance Metrics`,
      items: (depth.key_metrics || []).map(m => ({
        label: titleCase(m.replace(/_/g, " ")),
        description: m,
      })),
    },

    // ── Related ───────────────────────────────────────────────────
    related: {
      heading: "Related Solutions & Capabilities",
      solutions: related.solutions.map(s => ({
        id: s.id,
        label: s.label,
        path: s.canonical_path,
        description: s.short_description,
      })),
      equipment: related.equipment.map(e => ({
        id: e.id,
        label: e.label,
        path: e.canonical_path,
        description: e.short_description,
      })),
      concepts: related.concepts.map(c => ({
        id: c.id,
        label: c.label,
        path: c.canonical_path,
        description: c.short_description,
      })),
    },

    // ── FAQ ───────────────────────────────────────────────────────
    faq: {
      heading: `${entity.label} FAQ`,
      items: buildConceptFaqs(entity),
    },

    // ── CTA ───────────────────────────────────────────────────────
    cta: {
      heading: `Ship with ${entity.label}`,
      primary: { label: "Get Instant Quote", url: QUOTE_URL },
      secondary: { label: "Book a Fit Call", url: BOOK_URL },
    },

    // ── Section ordering ──────────────────────────────────────────
    _section_order: CONCEPT_SECTIONS,

    // ── Associated lanes (reverse link: authority → lanes) ────────
    associated_lanes: loadAssociatedLanes(entityId),

    // ── Internal linking data ─────────────────────────────────────
    internal_links: {
      solutions: related.solutions.map(s => ({
        href: s.canonical_path,
        text: s.label,
        family: "solution",
      })),
      equipment: related.equipment.map(e => ({
        href: e.canonical_path,
        text: e.label,
        family: "equipment",
      })),
      concepts: related.concepts.map(c => ({
        href: c.canonical_path,
        text: c.label,
        family: "concept",
      })),
    },
  };
}

/**
 * Build canonical page data for an equipment entity.
 *
 * @param {string} entityId - Equipment entity ID
 * @returns {object} Canonical page data with all sections
 */
export function buildEquipmentPageData(entityId) {
  const entity = getEntity(entityId);
  if (!entity || entity.family !== "equipment") {
    throw new Error(`buildEquipmentPageData: invalid equipment entity "${entityId}"`);
  }

  const related = getRelatedEntities(entityId);
  const specs = entity.specs || {};
  const canonicalPath = buildCanonicalPath(entity);

  return {
    page_type: "equipment",
    entity_id: entity.id,
    slug: entity.slug,
    canonical_path: canonicalPath,
    page_title: buildSeoTitle(entity),
    meta_description: buildMetaDescription(entity),
    mode: entity.mode || "",

    // ── Hero ──────────────────────────────────────────────────────
    hero: {
      headline: `${entity.label} Freight Shipping`,
      subhead: entity.short_description,
      primary_cta: { label: "Get Instant Quote", url: QUOTE_URL },
      secondary_cta: { label: "Book a Fit Call", url: BOOK_URL },
    },

    // ── Overview ──────────────────────────────────────────────────
    overview: {
      heading: `${entity.label} Overview`,
      content: entity.short_description,
      mode: entity.mode || "",
    },

    // ── Specs ─────────────────────────────────────────────────────
    specs: {
      heading: `${entity.label} Specifications`,
      data: specs,
    },

    // ── Best Fit ──────────────────────────────────────────────────
    best_fit: {
      heading: `Best Fit Freight for ${entity.label}`,
      items: entity.best_fit_freight || [],
    },

    // ── Not Ideal For ─────────────────────────────────────────────
    not_ideal: {
      heading: `When to Choose a Different Vehicle`,
      items: entity.not_ideal_for || [],
    },

    // ── Related Solutions ─────────────────────────────────────────
    related_solutions: {
      heading: "Solutions Using This Equipment",
      solutions: related.solutions.map(s => ({
        id: s.id,
        label: s.label,
        path: s.canonical_path,
        description: s.short_description,
      })),
    },

    // ── Related Concepts ──────────────────────────────────────────
    related_concepts: {
      heading: "Related Network Capabilities",
      concepts: related.concepts.map(c => ({
        id: c.id,
        label: c.label,
        path: c.canonical_path,
        description: c.short_description,
      })),
    },

    // ── FAQ ───────────────────────────────────────────────────────
    faq: {
      heading: `${entity.label} FAQ`,
      items: buildEquipmentFaqs(entity),
    },

    // ── CTA ───────────────────────────────────────────────────────
    cta: {
      heading: `Ship with ${entity.label} Today`,
      primary: { label: "Get Instant Quote", url: QUOTE_URL },
      secondary: { label: "Book a Fit Call", url: BOOK_URL },
    },

    // ── Section ordering ──────────────────────────────────────────
    _section_order: EQUIPMENT_SECTIONS,

    // ── Associated lanes (reverse link: authority → lanes) ────────
    associated_lanes: loadAssociatedLanes(entityId),

    // ── Internal linking data ─────────────────────────────────────
    internal_links: {
      solutions: related.solutions.map(s => ({
        href: s.canonical_path,
        text: s.label,
        family: "solution",
      })),
      concepts: related.concepts.map(c => ({
        href: c.canonical_path,
        text: c.label,
        family: "concept",
      })),
    },
  };
}

/**
 * Build canonical page data for any entity by ID.
 * Dispatches to the correct builder based on entity family.
 *
 * @param {string} entityId
 * @returns {object} Canonical page data
 */
export function buildAuthorityPageData(entityId) {
  const entity = getEntity(entityId);
  if (!entity) {
    throw new Error(`buildAuthorityPageData: unknown entity "${entityId}"`);
  }

  switch (entity.family) {
    case "solution": return buildSolutionPageData(entityId);
    case "concept": return buildConceptPageData(entityId);
    case "equipment": return buildEquipmentPageData(entityId);
    default:
      throw new Error(`buildAuthorityPageData: unknown family "${entity.family}"`);
  }
}
