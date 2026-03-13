/**
 * authority-graph.js — Knowledge Graph Engine for Authority Pages
 *
 * Loads the entity registry and provides graph traversal, relationship
 * queries, and entity resolution for the authority page generation system.
 *
 * The graph encodes relationships between four entity families:
 *   - Solutions (store replenishment, pool distribution, etc.)
 *   - Network Concepts (cross-docking, middle mile, etc.)
 *   - Equipment (cargo van, box truck, 53-foot trailer)
 *   - Lanes (existing lane pages — connected via archetype affinity)
 *
 * All queries are deterministic. No randomness, no external calls.
 *
 * @module authority-graph
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve data dir: try import.meta.url path first, fall back to process.cwd()
// (Vercel serverless bundles compile modules into .next/server/, breaking __dirname-relative paths)
const _localDataDir = join(__dirname, "..", "data");
const DATA_DIR = existsSync(_localDataDir) ? _localDataDir : join(process.cwd(), "data");

// ── Lazy-loaded registry ────────────────────────────────────────────

let _registry = null;

function loadRegistry() {
  if (!_registry) {
    _registry = JSON.parse(
      readFileSync(join(DATA_DIR, "authority-entities.json"), "utf-8")
    );
  }
  return _registry;
}

// ── Entity Resolution ───────────────────────────────────────────────

/**
 * Get all entities across all families.
 * @returns {object[]} Flat array of entity objects
 */
export function getAllEntities() {
  const reg = loadRegistry();
  return [
    ...Object.values(reg.solutions || {}),
    ...Object.values(reg.concepts || {}),
    ...Object.values(reg.equipment || {}),
  ];
}

/**
 * Get all entities in a specific family.
 * @param {"solution"|"concept"|"equipment"} family
 * @returns {object[]}
 */
export function getEntitiesByFamily(family) {
  const reg = loadRegistry();
  const familyMap = {
    solution: reg.solutions,
    concept: reg.concepts,
    equipment: reg.equipment,
  };
  return Object.values(familyMap[family] || {});
}

/**
 * Get a single entity by ID (searches all families).
 * @param {string} id - Entity ID (e.g., "cross-docking", "box-truck")
 * @returns {object|null}
 */
export function getEntity(id) {
  const reg = loadRegistry();
  return reg.solutions?.[id] || reg.concepts?.[id] || reg.equipment?.[id] || null;
}

/**
 * Get a single entity by family and ID.
 * @param {"solution"|"concept"|"equipment"} family
 * @param {string} id
 * @returns {object|null}
 */
export function getEntityByFamily(family, id) {
  const reg = loadRegistry();
  const familyMap = {
    solution: reg.solutions,
    concept: reg.concepts,
    equipment: reg.equipment,
  };
  return familyMap[family]?.[id] || null;
}

// ── Graph Traversal ─────────────────────────────────────────────────

/**
 * Get all related entities for a given entity, grouped by relationship type.
 *
 * @param {string} entityId - Entity ID
 * @returns {{ concepts: object[], solutions: object[], equipment: object[] }}
 */
export function getRelatedEntities(entityId) {
  const entity = getEntity(entityId);
  if (!entity) return { concepts: [], solutions: [], equipment: [] };

  const result = { concepts: [], solutions: [], equipment: [] };

  // Resolve concept relationships
  const conceptIds = entity.related_concepts || entity.related_solutions
    ? (entity.family === "solution" ? entity.related_concepts :
       entity.family === "concept" ? entity.related_concepts :
       entity.related_concepts) || []
    : [];

  for (const cid of conceptIds) {
    const c = getEntity(cid);
    if (c) result.concepts.push(c);
  }

  // Resolve solution relationships
  const solutionIds = entity.related_solutions || [];
  for (const sid of solutionIds) {
    const s = getEntity(sid);
    if (s) result.solutions.push(s);
  }

  // Resolve equipment relationships
  const equipmentIds = entity.related_equipment || [];
  for (const eid of equipmentIds) {
    const e = getEntity(eid);
    if (e) result.equipment.push(e);
  }

  return result;
}

/**
 * Get the relationship index for fast lookups.
 * @returns {object} Pre-computed bidirectional relationship index
 */
export function getRelationshipIndex() {
  return loadRegistry()._relationship_index || {};
}

/**
 * Find all entities related to a given entity via a specific relationship type.
 *
 * @param {string} entityId
 * @param {"concept"|"solution"|"equipment"} targetFamily
 * @returns {object[]} Array of related entities in the target family
 */
export function getRelatedByFamily(entityId, targetFamily) {
  const entity = getEntity(entityId);
  if (!entity) return [];

  const idField = targetFamily === "concept" ? "related_concepts"
    : targetFamily === "solution" ? "related_solutions"
    : "related_equipment";

  const ids = entity[idField] || [];
  return ids.map(id => getEntity(id)).filter(Boolean);
}

/**
 * Compute the full neighborhood of an entity — all entities reachable
 * within one hop in the knowledge graph.
 *
 * @param {string} entityId
 * @returns {{ entity: object, neighbors: object[], depth: number }}
 */
export function getNeighborhood(entityId) {
  const entity = getEntity(entityId);
  if (!entity) return { entity: null, neighbors: [], depth: 1 };

  const seen = new Set([entityId]);
  const neighbors = [];

  const related = getRelatedEntities(entityId);
  for (const group of [related.concepts, related.solutions, related.equipment]) {
    for (const neighbor of group) {
      if (!seen.has(neighbor.id)) {
        seen.add(neighbor.id);
        neighbors.push(neighbor);
      }
    }
  }

  return { entity, neighbors, depth: 1 };
}

// ── Lane Integration ────────────────────────────────────────────────

/**
 * Find which solutions are relevant to a given lane archetype.
 *
 * @param {string} archetypeId - Lane archetype ID (e.g., "short_haul_metro")
 * @returns {object[]} Solutions with affinity to this archetype
 */
export function getSolutionsForArchetype(archetypeId) {
  const solutions = getEntitiesByFamily("solution");
  return solutions.filter(s =>
    s.lane_archetype_affinity?.includes(archetypeId)
  );
}

/**
 * Find which equipment types apply to a given mode.
 *
 * @param {string} mode - "LTL", "FTL", or "Cargo Van / Box Truck"
 * @returns {object[]}
 */
export function getEquipmentForMode(mode) {
  const equipment = getEntitiesByFamily("equipment");
  return equipment.filter(e => {
    if (e.mode === mode) return true;
    // Check if the entity's related solutions operate in this mode
    const relatedSolutions = (e.related_solutions || [])
      .map(id => getEntity(id))
      .filter(Boolean);
    return relatedSolutions.some(s => s.modes?.includes(mode));
  });
}

/**
 * Build internal links from a lane page to relevant authority pages.
 * Links are determined by archetype affinity and mode.
 *
 * @param {object} params
 * @param {string} params.archetypeId - Lane's archetype
 * @param {string} params.mode - Lane's mode
 * @returns {{ solutions: object[], concepts: object[], equipment: object[] }}
 *   Each item: { id, label, path, relevance }
 */
export function getAuthorityLinksForLane({ archetypeId, mode }) {
  const solutions = getSolutionsForArchetype(archetypeId)
    .filter(s => s.modes?.includes(mode))
    .map(s => ({
      id: s.id,
      label: s.label,
      path: s.canonical_path,
      relevance: "archetype_affinity",
    }));

  // Collect concepts from matched solutions
  const conceptIds = new Set();
  for (const sol of solutions) {
    const entity = getEntity(sol.id);
    for (const cid of entity?.related_concepts || []) {
      conceptIds.add(cid);
    }
  }

  const concepts = [...conceptIds]
    .map(id => getEntity(id))
    .filter(Boolean)
    .filter(c => c.applies_to_modes?.includes(mode))
    .map(c => ({
      id: c.id,
      label: c.label,
      path: c.canonical_path,
      relevance: "solution_related",
    }));

  const equipment = getEquipmentForMode(mode)
    .map(e => ({
      id: e.id,
      label: e.label,
      path: e.canonical_path,
      relevance: "mode_match",
    }));

  return { solutions, concepts, equipment };
}

// ── Graph Statistics ────────────────────────────────────────────────

/**
 * Compute graph statistics for validation and reporting.
 * @returns {object}
 */
export function getGraphStats() {
  const all = getAllEntities();
  const solutions = getEntitiesByFamily("solution");
  const concepts = getEntitiesByFamily("concept");
  const equipment = getEntitiesByFamily("equipment");

  let totalEdges = 0;
  let isolatedEntities = 0;

  for (const entity of all) {
    const related = getRelatedEntities(entity.id);
    const edgeCount = related.concepts.length + related.solutions.length + related.equipment.length;
    totalEdges += edgeCount;
    if (edgeCount === 0) isolatedEntities++;
  }

  return {
    entity_count: all.length,
    solution_count: solutions.length,
    concept_count: concepts.length,
    equipment_count: equipment.length,
    total_edges: totalEdges / 2, // Bidirectional edges counted twice
    isolated_entities: isolatedEntities,
    avg_edges_per_entity: (totalEdges / all.length).toFixed(1),
  };
}

/**
 * Validate the knowledge graph for structural integrity.
 *
 * Checks:
 *   - No dangling references (all relationship IDs resolve)
 *   - No isolated entities (every entity has at least 1 relationship)
 *   - All required fields present per family
 *   - Bidirectional consistency (if A→B exists, B→A should exist)
 *
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateGraph() {
  const errors = [];
  const warnings = [];
  const all = getAllEntities();
  const allIds = new Set(all.map(e => e.id));

  for (const entity of all) {
    // Check required fields
    if (!entity.id) errors.push(`Entity missing id`);
    if (!entity.family) errors.push(`${entity.id}: missing family`);
    if (!entity.slug) errors.push(`${entity.id}: missing slug`);
    if (!entity.canonical_path) errors.push(`${entity.id}: missing canonical_path`);
    if (!entity.label) errors.push(`${entity.id}: missing label`);

    // Check dangling references
    const refFields = ["related_concepts", "related_solutions", "related_equipment"];
    for (const field of refFields) {
      for (const refId of entity[field] || []) {
        if (!allIds.has(refId)) {
          errors.push(`${entity.id}: dangling reference ${field} → ${refId}`);
        }
      }
    }

    // Check isolation
    const related = getRelatedEntities(entity.id);
    const edgeCount = related.concepts.length + related.solutions.length + related.equipment.length;
    if (edgeCount === 0) {
      warnings.push(`${entity.id}: isolated entity (no relationships)`);
    }

    // Check bidirectional consistency
    for (const concept of related.concepts) {
      const reverse = getRelatedEntities(concept.id);
      const hasReverse = reverse.solutions.some(s => s.id === entity.id)
        || reverse.concepts.some(c => c.id === entity.id)
        || reverse.equipment.some(e => e.id === entity.id);
      if (!hasReverse) {
        warnings.push(`${entity.id} → ${concept.id}: missing reverse relationship`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Registry Reload (for tests) ─────────────────────────────────────

/**
 * Clear cached registry to force reload on next access.
 * Used in tests to inject modified registry data.
 */
export function _resetCache() {
  _registry = null;
}
