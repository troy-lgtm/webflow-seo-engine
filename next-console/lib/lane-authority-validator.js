/**
 * lane-authority-validator.js — Quality Gates for Lane-Authority Relationships
 *
 * Prevents weak, spammy, or semantically empty lane-authority connections.
 *
 * Validation Gates:
 *   LAG-SPEC-01  Relationship specificity (not assignable to every lane)
 *   LAG-SPEC-02  Evidence presence (at least 2 evidence items)
 *   LAG-OVER-01  Over-assignment check (max active relationships per lane)
 *   LAG-OVER-02  Primary concentration (max primaries per lane)
 *   LAG-EVID-01  Evidence diversity (not all from same rule type)
 *   LAG-DIST-01  Distance coherence (equipment/concept fits lane haul profile)
 *   LAG-BIDIR-01 Bidirectional integrity (forward→reverse consistency)
 *   LAG-GRAPH-01 Graph health (no orphans, balanced coverage)
 *
 * @module lane-authority-validator
 */

// ── Constants ────────────────────────────────────────────────────────

const MAX_ACTIVE_RELATIONSHIPS = 10;
const MAX_PRIMARY_PER_LANE = 5;
const MIN_EVIDENCE_ITEMS = 2;

// ── Single Relationship Validation ───────────────────────────────────

/**
 * Validate a single lane-authority relationship.
 *
 * @param {object} relationship - A single relationship from classifyLaneAuthority()
 * @param {object} profile - The lane classification profile
 * @returns {{ valid: boolean, gate_results: object, errors: string[], warnings: string[] }}
 */
export function validateRelationship(relationship, profile) {
  const errors = [];
  const warnings = [];
  const gates = {};

  // ── LAG-SPEC-01: Relationship specificity ─────────────────────
  // A relationship must have evidence from at least one non-generic rule.
  // "mode_fit" alone is too generic (every lane has a mode).
  {
    const specificRules = relationship.evidence.filter(e =>
      !["mode_fit"].includes(e.rule) && e.weight > 0
    );
    gates["LAG-SPEC-01"] = specificRules.length >= 1;
    if (!gates["LAG-SPEC-01"]) {
      errors.push(`${relationship.entity_id}: only generic evidence (mode_fit), no specific justification`);
    }
  }

  // ── LAG-SPEC-02: Evidence presence ────────────────────────────
  {
    const positiveEvidence = relationship.evidence.filter(e => e.weight > 0);
    gates["LAG-SPEC-02"] = positiveEvidence.length >= MIN_EVIDENCE_ITEMS;
    if (!gates["LAG-SPEC-02"]) {
      warnings.push(`${relationship.entity_id}: only ${positiveEvidence.length} positive evidence items`);
    }
  }

  // ── LAG-EVID-01: Evidence diversity ───────────────────────────
  {
    const ruleTypes = new Set(relationship.evidence.filter(e => e.weight > 0).map(e => e.rule));
    gates["LAG-EVID-01"] = ruleTypes.size >= 2;
    if (!gates["LAG-EVID-01"]) {
      warnings.push(`${relationship.entity_id}: evidence from only ${ruleTypes.size} rule types`);
    }
  }

  // ── LAG-DIST-01: Distance coherence ───────────────────────────
  // Catch obviously wrong distance/entity pairings
  {
    let coherent = true;
    if (relationship.entity_id === "cargo-van" && profile.distance_band === "long_haul") {
      coherent = false;
      errors.push(`cargo-van: incoherent with long_haul distance band`);
    }
    if (relationship.entity_id === "middle-mile" && profile.distance_band === "short_haul") {
      coherent = false;
      errors.push(`middle-mile: incoherent with short_haul distance band`);
    }
    if (relationship.entity_id === "zone-skipping" && profile.distance_band === "short_haul") {
      coherent = false;
      errors.push(`zone-skipping: incoherent with short_haul distance band`);
    }
    gates["LAG-DIST-01"] = coherent;
  }

  const allPassed = Object.values(gates).every(v => v);
  return {
    valid: allPassed,
    gate_results: gates,
    errors,
    warnings,
  };
}

// ── Lane-Level Validation ────────────────────────────────────────────

/**
 * Validate all relationships for a single lane.
 *
 * @param {object} classification - Output of classifyLaneAuthority()
 * @param {object} profile - Classification profile
 * @returns {{ valid: boolean, gates: object, errors: string[], warnings: string[] }}
 */
export function validateLaneRelationships(classification, profile) {
  const errors = [];
  const warnings = [];
  const gates = {};

  const active = classification.relationships.filter(r => !r.blocked);

  // ── LAG-OVER-01: Over-assignment ──────────────────────────────
  {
    gates["LAG-OVER-01"] = active.length <= MAX_ACTIVE_RELATIONSHIPS;
    if (!gates["LAG-OVER-01"]) {
      errors.push(`Lane ${classification.lane_slug}: ${active.length} active relationships exceeds max ${MAX_ACTIVE_RELATIONSHIPS}`);
    }
  }

  // ── LAG-OVER-02: Primary concentration ────────────────────────
  {
    const primaryCount = active.filter(r => r.rank === "primary").length;
    gates["LAG-OVER-02"] = primaryCount <= MAX_PRIMARY_PER_LANE;
    if (!gates["LAG-OVER-02"]) {
      warnings.push(`Lane ${classification.lane_slug}: ${primaryCount} primary relationships (max ${MAX_PRIMARY_PER_LANE})`);
    }
  }

  // Validate each individual relationship
  for (const rel of active) {
    const relValidation = validateRelationship(rel, profile);
    errors.push(...relValidation.errors);
    warnings.push(...relValidation.warnings);
    // Only copy failed gates (don't override lane-level gates)
    for (const [gate, passed] of Object.entries(relValidation.gate_results)) {
      if (!passed) {
        gates[`${gate}:${rel.entity_id}`] = false;
      }
    }
  }

  const allPassed = !Object.values(gates).some(v => v === false);
  return { valid: allPassed, gates, errors, warnings };
}

// ── Graph-Level Validation ───────────────────────────────────────────

/**
 * Validate the full expansion graph for health and integrity.
 *
 * @param {object} graphExport - Output of exportGraph()
 * @returns {{ valid: boolean, gates: object, errors: string[], warnings: string[], stats: object }}
 */
export function validateExpansionGraphHealth(graphExport) {
  const errors = [];
  const warnings = [];
  const gates = {};

  const l2a = graphExport.lane_to_authority || {};
  const a2l = graphExport.authority_to_lanes || {};
  const clusters = graphExport.clusters || {};

  const laneCount = Object.keys(l2a).length;
  const entityCount = Object.keys(a2l).length;
  const totalRels = Object.values(l2a).reduce((s, r) => s + r.length, 0);

  // ── LAG-BIDIR-01: Bidirectional integrity ─────────────────────
  {
    let bidir = true;
    for (const [slug, rels] of Object.entries(l2a)) {
      for (const rel of rels) {
        const reverseRefs = a2l[rel.entity_id] || [];
        if (!reverseRefs.some(r => r.lane_slug === slug)) {
          bidir = false;
          errors.push(`Bidirectional break: ${slug} → ${rel.entity_id}`);
        }
      }
    }
    gates["LAG-BIDIR-01"] = bidir;
  }

  // ── LAG-GRAPH-01: Graph health ────────────────────────────────
  {
    let healthy = true;

    // Check for orphaned lanes
    for (const [slug, rels] of Object.entries(l2a)) {
      if (rels.length === 0) {
        healthy = false;
        errors.push(`Orphaned lane: ${slug}`);
      }
    }

    // Check average relationships per lane
    const avgPerLane = laneCount > 0 ? totalRels / laneCount : 0;
    if (avgPerLane < 2 && laneCount >= 3) {
      warnings.push(`Low average relationships per lane: ${avgPerLane.toFixed(1)}`);
    }
    if (avgPerLane > 10) {
      warnings.push(`High average relationships per lane: ${avgPerLane.toFixed(1)} (possible over-assignment)`);
    }

    gates["LAG-GRAPH-01"] = healthy;
  }

  // Statistics
  const familyCounts = {};
  for (const rels of Object.values(l2a)) {
    for (const rel of rels) {
      familyCounts[rel.entity_family] = (familyCounts[rel.entity_family] || 0) + 1;
    }
  }

  const stats = {
    lane_count: laneCount,
    entity_count: entityCount,
    total_relationships: totalRels,
    avg_per_lane: laneCount > 0 ? parseFloat((totalRels / laneCount).toFixed(1)) : 0,
    cluster_count: Object.keys(clusters).length,
    family_distribution: familyCounts,
  };

  const allPassed = Object.values(gates).every(v => v);
  return { valid: allPassed, gates, errors, warnings, stats };
}
