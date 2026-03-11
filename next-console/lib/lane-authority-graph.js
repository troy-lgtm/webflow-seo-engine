/**
 * lane-authority-graph.js — Bidirectional Lane-Authority Graph Manager
 *
 * Manages the bidirectional relationship graph between lanes and authority
 * entities. When a lane is classified, this module:
 *   1. Records lane → authority relationships
 *   2. Records authority → lane back-references
 *   3. Builds authority clusters
 *   4. Validates graph health
 *   5. Produces inspectable graph snapshots
 *
 * The graph state is held in memory during generation runs and can be
 * serialized to disk as an artifact for inspection.
 *
 * @module lane-authority-graph
 */

import { getEntity, getAllEntities, getGraphStats } from "./authority-graph.js";
import { classifyLaneAuthority, buildClassificationProfile } from "./lane-authority-classifier.js";

// ── Graph State ──────────────────────────────────────────────────────

/**
 * In-memory bidirectional graph.
 *
 * lane_to_authority: { [lane_slug]: relationship[] }
 * authority_to_lanes: { [entity_id]: lane_ref[] }
 * clusters: { [entity_id]: cluster_data }
 */
let _graph = {
  lane_to_authority: {},
  authority_to_lanes: {},
  clusters: {},
  _meta: {
    created_at: null,
    lane_count: 0,
    relationship_count: 0,
  },
};

// ── Graph Operations ─────────────────────────────────────────────────

/**
 * Reset the graph state. Used between generation runs and in tests.
 */
export function resetGraph() {
  _graph = {
    lane_to_authority: {},
    authority_to_lanes: {},
    clusters: {},
    _meta: {
      created_at: null,
      lane_count: 0,
      relationship_count: 0,
    },
  };
}

/**
 * Expand the authority graph by classifying a lane and recording
 * bidirectional relationships.
 *
 * This is the core expansion function. It:
 *   1. Classifies the lane's authority relationships
 *   2. Records lane → authority edges (forward)
 *   3. Records authority → lane edges (reverse)
 *   4. Updates cluster membership
 *
 * @param {object} laneKnowledge - Output of buildLaneKnowledge()
 * @param {object} extra - Additional context (archetype, corridor, city classes)
 * @returns {object} Classification result with graph update status
 */
export function expandWithLane(laneKnowledge, extra = {}) {
  const profile = buildClassificationProfile(laneKnowledge, extra);
  const classification = classifyLaneAuthority(profile);
  const slug = classification.lane_slug;

  if (!slug) {
    return { ...classification, graph_status: "skipped_no_slug" };
  }

  // Record creation time on first expansion
  if (!_graph._meta.created_at) {
    _graph._meta.created_at = new Date().toISOString();
  }

  // ── Forward edge: lane → authority ──────────────────────────────
  const activeRelationships = classification.relationships.filter(r => !r.blocked);
  _graph.lane_to_authority[slug] = activeRelationships.map(r => ({
    entity_id: r.entity_id,
    entity_family: r.entity_family,
    score: r.score,
    rank: r.rank,
    evidence: r.evidence,
  }));

  // ── Reverse edge: authority → lane ─────────────────────────────
  for (const rel of activeRelationships) {
    if (!_graph.authority_to_lanes[rel.entity_id]) {
      _graph.authority_to_lanes[rel.entity_id] = [];
    }

    // Avoid duplicates
    const existing = _graph.authority_to_lanes[rel.entity_id];
    const alreadyLinked = existing.some(l => l.lane_slug === slug);
    if (!alreadyLinked) {
      existing.push({
        lane_slug: slug,
        mode: profile.mode,
        origin: profile.origin,
        destination: profile.destination,
        distance_band: profile.distance_band,
        archetype: profile.archetype,
        score: rel.score,
        rank: rel.rank,
      });

      // Keep sorted by score descending
      existing.sort((a, b) => b.score - a.score);
    }
  }

  // ── Update clusters ────────────────────────────────────────────
  for (const rel of activeRelationships) {
    updateCluster(rel.entity_id, slug, rel);
  }

  // ── Update meta ────────────────────────────────────────────────
  _graph._meta.lane_count = Object.keys(_graph.lane_to_authority).length;
  _graph._meta.relationship_count = Object.values(_graph.lane_to_authority)
    .reduce((sum, rels) => sum + rels.length, 0);

  return {
    ...classification,
    graph_status: "expanded",
    active_relationships: activeRelationships.length,
  };
}

/**
 * Update cluster data when a lane is connected to an entity.
 */
function updateCluster(entityId, laneSlug, relationship) {
  if (!_graph.clusters[entityId]) {
    const entity = getEntity(entityId);
    _graph.clusters[entityId] = {
      entity_id: entityId,
      entity_family: entity?.family || relationship.entity_family,
      label: entity?.label || entityId,
      lanes: [],
      peer_entities: [],
      lane_count: 0,
      avg_score: 0,
    };
  }

  const cluster = _graph.clusters[entityId];

  // Add lane if not already present
  if (!cluster.lanes.some(l => l.slug === laneSlug)) {
    cluster.lanes.push({
      slug: laneSlug,
      score: relationship.score,
      rank: relationship.rank,
    });
    cluster.lane_count = cluster.lanes.length;
    cluster.avg_score = Math.round(
      cluster.lanes.reduce((s, l) => s + l.score, 0) / cluster.lanes.length
    );
  }

  // Update peer entities from authority graph
  const entity = getEntity(entityId);
  if (entity) {
    const peerIds = new Set([
      ...(entity.related_concepts || []),
      ...(entity.related_solutions || []),
      ...(entity.related_equipment || []),
    ]);
    cluster.peer_entities = [...peerIds].map(id => {
      const peer = getEntity(id);
      return peer ? { id: peer.id, family: peer.family, label: peer.label } : null;
    }).filter(Boolean);
  }
}

// ── Query Operations ─────────────────────────────────────────────────

/**
 * Get all authority relationships for a specific lane.
 *
 * @param {string} laneSlug
 * @returns {object[]} Array of relationship objects
 */
export function getLaneAuthority(laneSlug) {
  return _graph.lane_to_authority[laneSlug] || [];
}

/**
 * Get all lanes connected to a specific authority entity.
 *
 * @param {string} entityId
 * @returns {object[]} Array of lane references, sorted by score
 */
export function getAuthorityLanes(entityId) {
  return _graph.authority_to_lanes[entityId] || [];
}

/**
 * Get the cluster data for an authority entity.
 *
 * @param {string} entityId
 * @returns {object|null}
 */
export function getCluster(entityId) {
  return _graph.clusters[entityId] || null;
}

/**
 * Get all clusters, sorted by lane count descending.
 *
 * @returns {object[]}
 */
export function getAllClusters() {
  return Object.values(_graph.clusters)
    .sort((a, b) => b.lane_count - a.lane_count);
}

/**
 * Get internal links for a lane, combining lane-to-authority with
 * the authority graph's own internal links.
 *
 * @param {string} laneSlug
 * @returns {object[]} Array of link objects: { href, text, family, score, rank }
 */
export function getLaneAuthorityLinks(laneSlug) {
  const rels = getLaneAuthority(laneSlug);
  return rels.map(r => {
    const entity = getEntity(r.entity_id);
    if (!entity) return null;
    return {
      href: entity.canonical_path,
      text: entity.label,
      family: r.entity_family,
      score: r.score,
      rank: r.rank,
    };
  }).filter(Boolean);
}

/**
 * Get links from an authority entity to its connected lanes.
 *
 * @param {string} entityId
 * @param {object} [opts]
 * @param {number} [opts.maxLinks=10]
 * @returns {object[]} Array of lane links: { href, text, score, rank }
 */
export function getAuthorityLaneLinks(entityId, opts = {}) {
  const maxLinks = opts.maxLinks || 10;
  const lanes = getAuthorityLanes(entityId);
  return lanes.slice(0, maxLinks).map(l => ({
    href: `/lanes/${l.lane_slug}`,
    text: `${l.origin} to ${l.destination} Freight`,
    mode: l.mode,
    score: l.score,
    rank: l.rank,
  }));
}

// ── Graph Health ─────────────────────────────────────────────────────

/**
 * Validate the expanded graph for health issues.
 *
 * Checks:
 *   - No orphaned lanes (lanes with 0 authority connections)
 *   - No orphaned authority entities (entities with 0 lane connections)
 *   - Bidirectional consistency (forward→reverse match)
 *   - No over-assigned lanes (> 10 active relationships)
 *   - No under-assigned lanes (< 2 active relationships)
 *   - Cluster integrity
 *
 * @returns {{ valid: boolean, errors: string[], warnings: string[], stats: object }}
 */
export function validateExpansionGraph() {
  const errors = [];
  const warnings = [];

  const laneCount = Object.keys(_graph.lane_to_authority).length;
  const entityCount = Object.keys(_graph.authority_to_lanes).length;

  // Check for orphaned lanes
  for (const [slug, rels] of Object.entries(_graph.lane_to_authority)) {
    if (rels.length === 0) {
      errors.push(`Lane ${slug}: 0 authority connections (orphaned)`);
    }
    if (rels.length < 2) {
      warnings.push(`Lane ${slug}: only ${rels.length} authority connections (weak)`);
    }
    if (rels.length > 10) {
      warnings.push(`Lane ${slug}: ${rels.length} connections (possible over-assignment)`);
    }
  }

  // Check bidirectional consistency
  for (const [slug, rels] of Object.entries(_graph.lane_to_authority)) {
    for (const rel of rels) {
      const reverseRefs = _graph.authority_to_lanes[rel.entity_id] || [];
      const hasReverse = reverseRefs.some(r => r.lane_slug === slug);
      if (!hasReverse) {
        errors.push(`Bidirectional break: ${slug} → ${rel.entity_id} has no reverse`);
      }
    }
  }

  // Check authority entities that the base graph has but expansion hasn't touched
  const allEntities = getAllEntities();
  const touchedEntities = new Set(Object.keys(_graph.authority_to_lanes));
  const untouched = allEntities.filter(e => !touchedEntities.has(e.id));
  if (untouched.length > 0 && laneCount >= 5) {
    warnings.push(`${untouched.length} authority entities have no lane connections: ${untouched.map(e => e.id).join(", ")}`);
  }

  // Cluster integrity
  for (const [entityId, cluster] of Object.entries(_graph.clusters)) {
    if (cluster.lane_count === 0) {
      errors.push(`Cluster ${entityId}: empty (no lanes)`);
    }
    // Verify cluster lanes match authority_to_lanes
    const authorityLanes = (_graph.authority_to_lanes[entityId] || []).map(l => l.lane_slug);
    const clusterLanes = cluster.lanes.map(l => l.slug);
    const mismatched = clusterLanes.filter(s => !authorityLanes.includes(s));
    if (mismatched.length > 0) {
      errors.push(`Cluster ${entityId}: ${mismatched.length} lanes not in authority_to_lanes`);
    }
  }

  // Compute statistics
  const allRels = Object.values(_graph.lane_to_authority);
  const totalActive = allRels.reduce((s, r) => s + r.length, 0);
  const avgPerLane = laneCount > 0 ? (totalActive / laneCount).toFixed(1) : 0;

  const stats = {
    lane_count: laneCount,
    entity_count: entityCount,
    total_relationships: totalActive,
    avg_per_lane: parseFloat(avgPerLane),
    cluster_count: Object.keys(_graph.clusters).length,
    untouched_entities: untouched.length,
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

// ── Serialization ────────────────────────────────────────────────────

/**
 * Export the full graph state as a serializable object.
 *
 * @returns {object} Graph snapshot
 */
export function exportGraph() {
  return {
    _version: "1.0.0",
    _exported_at: new Date().toISOString(),
    _meta: _graph._meta,
    lane_to_authority: _graph.lane_to_authority,
    authority_to_lanes: _graph.authority_to_lanes,
    clusters: _graph.clusters,
  };
}

/**
 * Import a previously exported graph state.
 *
 * @param {object} data - Output of exportGraph()
 */
export function importGraph(data) {
  _graph = {
    lane_to_authority: data.lane_to_authority || {},
    authority_to_lanes: data.authority_to_lanes || {},
    clusters: data.clusters || {},
    _meta: data._meta || {
      created_at: null,
      lane_count: 0,
      relationship_count: 0,
    },
  };
}
