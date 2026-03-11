/**
 * authority-linker.js — Internal Linking Engine for Authority Pages
 *
 * Builds deterministic internal link graphs between authority pages
 * and lane pages. The linker uses the knowledge graph relationships
 * defined in authority-entities.json to generate contextual links.
 *
 * Link Types:
 *   1. Authority ↔ Authority: solution → concept, concept → equipment, etc.
 *   2. Authority → Lane: solution/concept/equipment → relevant lane pages
 *   3. Lane → Authority: lane pages link to relevant solutions/concepts/equipment
 *
 * All linking is deterministic and relevance-scored.
 *
 * @module authority-linker
 */

import {
  getAllEntities,
  getEntity,
  getRelatedEntities,
  getAuthorityLinksForLane,
  getSolutionsForArchetype,
} from "./authority-graph.js";

const SITE_BASE = "https://www.wearewarp.com";

// ── Stable Hash ──────────────────────────────────────────────────────

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

// ── Link Scoring ─────────────────────────────────────────────────────

/**
 * Score a link between two entities for relevance ranking.
 * Higher scores = more relevant links shown first.
 *
 * @param {object} source - Source entity
 * @param {object} target - Target entity
 * @param {string} relationshipType - "direct", "shared_concept", "mode_match"
 * @returns {number} Relevance score (0-100)
 */
function scoreLinkRelevance(source, target, relationshipType) {
  let score = 0;

  // Direct relationship is strongest
  if (relationshipType === "direct") score += 50;
  else if (relationshipType === "shared_concept") score += 30;
  else if (relationshipType === "mode_match") score += 20;

  // Same family boost (concept→concept is highly relevant)
  if (source.family === target.family) score += 10;

  // Cross-family links are valuable for graph density
  if (source.family !== target.family) score += 15;

  // Mode overlap
  const sourceModes = source.modes || source.applies_to_modes || [source.mode].filter(Boolean);
  const targetModes = target.modes || target.applies_to_modes || [target.mode].filter(Boolean);
  const sharedModes = sourceModes.filter(m => targetModes.includes(m));
  score += sharedModes.length * 5;

  // Deterministic tiebreaker
  score += stableHash(`${source.id}|${target.id}`) % 5;

  return Math.min(100, score);
}

// ── Authority-to-Authority Links ─────────────────────────────────────

/**
 * Build internal links from one authority page to all related authority pages.
 * Ranked by relevance score, limited to top N per family.
 *
 * @param {string} entityId - Source entity ID
 * @param {object} [opts]
 * @param {number} [opts.maxPerFamily=5] - Max links per target family
 * @returns {object[]} Sorted array of link objects: { href, text, family, relevance, score }
 */
export function buildAuthorityToAuthorityLinks(entityId, opts = {}) {
  const maxPerFamily = opts.maxPerFamily || 5;
  const entity = getEntity(entityId);
  if (!entity) return [];

  const related = getRelatedEntities(entityId);
  const links = [];

  // Direct relationships
  for (const group of [related.concepts, related.solutions, related.equipment]) {
    for (const target of group) {
      links.push({
        href: target.canonical_path,
        text: target.label,
        family: target.family,
        relevance: "direct",
        score: scoreLinkRelevance(entity, target, "direct"),
      });
    }
  }

  // Sort by score descending
  links.sort((a, b) => b.score - a.score);

  // Limit per family
  const counts = {};
  return links.filter(link => {
    counts[link.family] = (counts[link.family] || 0) + 1;
    return counts[link.family] <= maxPerFamily;
  });
}

// ── Authority-to-Lane Links ──────────────────────────────────────────

/**
 * Build links from an authority page to relevant lane pages.
 * Uses archetype affinity to find lanes that benefit from this
 * solution/concept/equipment.
 *
 * @param {string} entityId - Authority entity ID
 * @param {object[]} lanePages - Available lane pages with { slug, origin, destination, archetypeId, mode }
 * @param {object} [opts]
 * @param {number} [opts.maxLinks=8] - Maximum lane links
 * @returns {object[]} Array of lane links: { href, text, archetypeId, score }
 */
export function buildAuthorityToLaneLinks(entityId, lanePages, opts = {}) {
  const maxLinks = opts.maxLinks || 8;
  const entity = getEntity(entityId);
  if (!entity || !lanePages?.length) return [];

  // Determine which archetypes this entity has affinity for
  const affinityArchetypes = new Set(entity.lane_archetype_affinity || []);
  const entityModes = entity.modes || entity.applies_to_modes || [entity.mode].filter(Boolean);

  const scored = [];
  for (const lane of lanePages) {
    let score = 0;

    // Archetype affinity match
    if (affinityArchetypes.has(lane.archetypeId)) score += 40;

    // Mode match
    if (entityModes.includes(lane.mode)) score += 30;

    // Deterministic tiebreaker
    score += stableHash(`${entityId}|${lane.slug}`) % 10;

    if (score > 0) {
      scored.push({
        href: `/lanes/${lane.slug}`,
        text: `${lane.origin} to ${lane.destination} Freight`,
        archetypeId: lane.archetypeId,
        mode: lane.mode,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxLinks);
}

// ── Lane-to-Authority Links ──────────────────────────────────────────

/**
 * Build links from a lane page to relevant authority pages.
 * Wraps the graph engine's getAuthorityLinksForLane() and formats
 * as link objects ready for rendering.
 *
 * @param {object} params
 * @param {string} params.archetypeId - Lane's assigned archetype
 * @param {string} params.mode - Lane's shipping mode
 * @param {object} [opts]
 * @param {number} [opts.maxLinks=6] - Maximum authority links
 * @returns {object[]} Array of links: { href, text, family, relevance }
 */
export function buildLaneToAuthorityLinks({ archetypeId, mode }, opts = {}) {
  const maxLinks = opts.maxLinks || 6;
  const raw = getAuthorityLinksForLane({ archetypeId, mode });

  const links = [];

  for (const s of raw.solutions) {
    links.push({
      href: s.path,
      text: `${s.label} Solutions`,
      family: "solution",
      relevance: s.relevance,
    });
  }

  for (const c of raw.concepts) {
    links.push({
      href: c.path,
      text: c.label,
      family: "concept",
      relevance: c.relevance,
    });
  }

  for (const e of raw.equipment) {
    links.push({
      href: e.path,
      text: `${e.label} Shipping`,
      family: "equipment",
      relevance: e.relevance,
    });
  }

  return links.slice(0, maxLinks);
}

// ── Full Link Graph ──────────────────────────────────────────────────

/**
 * Build the complete internal link graph across all authority pages.
 * Returns a map of entityId → outbound links.
 *
 * @returns {object} Map of entityId → link array
 */
export function buildFullLinkGraph() {
  const entities = getAllEntities();
  const graph = {};

  for (const entity of entities) {
    graph[entity.id] = buildAuthorityToAuthorityLinks(entity.id);
  }

  return graph;
}

/**
 * Validate the link graph for completeness.
 * Checks that:
 *   - Every entity has outbound links
 *   - No broken links (all hrefs resolve to existing entities)
 *   - Cross-family linking is present
 *
 * @returns {{ valid: boolean, errors: string[], stats: object }}
 */
export function validateLinkGraph() {
  const graph = buildFullLinkGraph();
  const errors = [];
  const allIds = new Set(getAllEntities().map(e => e.id));

  let totalLinks = 0;
  let crossFamilyLinks = 0;
  let entitiesWithLinks = 0;

  for (const [entityId, links] of Object.entries(graph)) {
    if (links.length === 0) {
      errors.push(`${entityId}: no outbound links`);
    } else {
      entitiesWithLinks++;
    }

    for (const link of links) {
      totalLinks++;
      // Verify link target exists
      const targetSlug = link.href.split("/").pop();
      if (!allIds.has(targetSlug)) {
        // Check by canonical path
        const found = getAllEntities().some(e => e.canonical_path === link.href);
        if (!found) {
          errors.push(`${entityId}: broken link to ${link.href}`);
        }
      }
      if (link.family) {
        const entity = getEntity(entityId);
        if (entity && link.family !== entity.family) {
          crossFamilyLinks++;
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      entities: Object.keys(graph).length,
      entities_with_links: entitiesWithLinks,
      total_links: totalLinks,
      cross_family_links: crossFamilyLinks,
      avg_links_per_entity: (totalLinks / Object.keys(graph).length).toFixed(1),
    },
  };
}
