/**
 * publishers/index.js — Publisher Adapter Registry
 *
 * Central registry for all publisher adapters. Provides a unified interface
 * for selecting and invoking adapters by ID.
 *
 * ARCHITECTURE:
 *   canonical data → publish contract → adapter registry → target output
 *
 * Current adapters:
 *   - "neutral"  → Structured JSON for Next.js route contract (PRIMARY path)
 *   - "webflow"  → Webflow CMS field payload (LEGACY — retained for migration)
 *
 * @module publishers
 */

export { buildPublishContract, validatePublishContract, contractToRenderedFields, CONTRACT_GROUPS } from "./publish-contract.js";

import * as webflow from "./webflow-adapter.js";
import * as neutral from "./neutral-adapter.js";

/**
 * All registered publisher adapters.
 * @type {Map<string, object>}
 */
const ADAPTERS = new Map([
  [webflow.ADAPTER_ID, webflow],
  [neutral.ADAPTER_ID, neutral],
]);

/**
 * Get an adapter by ID.
 * @param {string} adapterId - "webflow" or "neutral"
 * @returns {object} Adapter module
 * @throws {Error} If adapter not found
 */
export function getAdapter(adapterId) {
  const adapter = ADAPTERS.get(adapterId);
  if (!adapter) {
    const available = [...ADAPTERS.keys()].join(", ");
    throw new Error(`Unknown publisher adapter: "${adapterId}" (available: ${available})`);
  }
  return adapter;
}

/**
 * List all registered adapter IDs.
 * @returns {string[]}
 */
export function listAdapters() {
  return [...ADAPTERS.keys()];
}

/**
 * Adapt a publish contract for a specific target.
 * Convenience function that looks up the adapter and calls adaptForPublish().
 *
 * @param {string} adapterId - "webflow" or "neutral"
 * @param {object} contract - CMS-neutral publish contract
 * @param {object} [opts] - Adapter-specific options
 * @returns {object} Target-specific output
 */
export function adaptContract(adapterId, contract, opts) {
  const adapter = getAdapter(adapterId);
  return adapter.adaptForPublish(contract, opts);
}

// Re-export individual adapters for direct import
export { webflow, neutral };
