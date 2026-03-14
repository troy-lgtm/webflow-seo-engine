/**
 * lane-artifact-contract.js — Canonical Lane Artifact Contract
 *
 * Defines the shared artifact format that the Mac Studio (producer) publishes
 * to Vercel Blob and the Mac laptop (consumer/main site) reads at build time.
 *
 * The artifact is the single source of truth for lane page data flowing
 * from the SEO engine to the production site.
 *
 * ARCHITECTURE:
 *   lane identity → buildLaneKnowledge → buildCanonicalLanePageData
 *     → buildRouteContract → quality gate → artifact entry
 *     → buildLaneArtifact → publish to Blob
 *
 * @module lane-artifact-contract
 */

import { buildLaneKnowledge } from "../lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lane-page-schema.js";
import { buildRouteContract } from "../route-contract.js";

/** Current artifact contract version. Bump on breaking changes. */
export const ARTIFACT_VERSION = "1.0.0";

/** Required fields on every lane entry. */
const REQUIRED_LANE_FIELDS = ["slug", "publishable", "qualityScore", "qualityGrade", "gatesPassed", "gatesTotal", "routeContract"];

/**
 * Build a single lane artifact entry from a lane identity.
 *
 * Runs the full canonical pipeline:
 *   buildLaneKnowledge → buildCanonicalLanePageData → buildRouteContract → quality gate
 *
 * @param {{ origin: string, destination: string, mode?: string }} lane
 * @returns {{ slug: string, publishable: boolean, qualityScore: number, qualityGrade: string, gatesPassed: number, gatesTotal: number, routeContract: object, errors: string[] }}
 */
export function buildLaneEntry(lane) {
  const { origin, destination, mode = "LTL" } = lane;

  const knowledge = buildLaneKnowledge({ origin, destination, mode });
  const canonical = buildCanonicalLanePageData(knowledge, {});
  const { payload, quality, publishable } = buildRouteContract(canonical);

  return {
    slug: payload.slug,
    publishable,
    qualityScore: quality.score,
    qualityGrade: quality.grade,
    gatesPassed: quality.gates_passed,
    gatesTotal: quality.gate_count,
    routeContract: payload,
    errors: quality.errors || [],
  };
}

/**
 * Build a complete lane artifact from an array of lane identities.
 *
 * Only publishable lanes (quality gate passed) are included.
 * Duplicate slugs are rejected.
 *
 * @param {Array<{ origin: string, destination: string, mode?: string }>} lanes
 * @param {{ source?: string }} [opts]
 * @returns {{ version: string, generatedAt: string, source: string, laneCount: number, lanes: object[], rejected: object[] }}
 */
export function buildLaneArtifact(lanes, opts = {}) {
  const { source = "mac-studio-engine" } = opts;
  const generatedAt = new Date().toISOString();

  const entries = lanes.map((lane) => buildLaneEntry(lane));

  // Enforce uniqueness — reject duplicate slugs
  const seenSlugs = new Set();
  const accepted = [];
  const rejected = [];

  for (const entry of entries) {
    if (seenSlugs.has(entry.slug)) {
      rejected.push({ ...entry, rejectReason: `duplicate slug: ${entry.slug}` });
      continue;
    }
    seenSlugs.add(entry.slug);

    if (!entry.publishable) {
      rejected.push({ ...entry, rejectReason: `quality gate failed: score ${entry.qualityScore}, grade ${entry.qualityGrade}` });
      continue;
    }

    accepted.push(entry);
  }

  return {
    version: ARTIFACT_VERSION,
    generatedAt,
    source,
    laneCount: accepted.length,
    lanes: accepted,
    rejected,
  };
}

/**
 * Validate a lane artifact object.
 *
 * @param {object} artifact
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateLaneArtifact(artifact) {
  const errors = [];

  if (!artifact) {
    return { valid: false, errors: ["Artifact is null or undefined."] };
  }
  if (artifact.version !== ARTIFACT_VERSION) {
    errors.push(`Version mismatch: expected "${ARTIFACT_VERSION}", got "${artifact.version}".`);
  }
  if (!artifact.generatedAt || typeof artifact.generatedAt !== "string") {
    errors.push("Missing or invalid generatedAt.");
  }
  if (!artifact.source || typeof artifact.source !== "string") {
    errors.push("Missing or invalid source.");
  }
  if (typeof artifact.laneCount !== "number" || artifact.laneCount < 0) {
    errors.push("Missing or invalid laneCount.");
  }
  if (!Array.isArray(artifact.lanes)) {
    errors.push("lanes must be an array.");
  } else {
    if (artifact.lanes.length !== artifact.laneCount) {
      errors.push(`laneCount (${artifact.laneCount}) does not match lanes.length (${artifact.lanes.length}).`);
    }

    const slugs = new Set();
    for (let i = 0; i < artifact.lanes.length; i++) {
      const lane = artifact.lanes[i];
      for (const field of REQUIRED_LANE_FIELDS) {
        if (lane[field] === undefined || lane[field] === null) {
          errors.push(`Lane [${i}] missing required field: ${field}`);
        }
      }
      if (!lane.publishable) {
        errors.push(`Lane [${i}] (${lane.slug}) is not publishable but was included.`);
      }
      if (lane.slug && slugs.has(lane.slug)) {
        errors.push(`Duplicate slug in artifact: ${lane.slug}`);
      }
      if (lane.slug) slugs.add(lane.slug);
      if (lane.routeContract && !lane.routeContract._route_contract_version) {
        errors.push(`Lane [${i}] (${lane.slug}) routeContract missing _route_contract_version.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
