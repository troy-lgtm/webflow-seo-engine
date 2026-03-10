/**
 * Approval Gate — Canonical Approval State for Lane Pages
 *
 * Single source of truth for which lane pages are approved and eligible
 * to publish. Lives in data/approval_state.json as a standalone ledger,
 * separate from lane data and publish history.
 *
 * States:
 *   draft                          — in inventory, not reviewed (implicit default)
 *   ready_for_review               — content generated, pending human review
 *   approved                       — human approved, eligible to publish
 *   published_pending_verification — sent to Webflow, awaiting live check
 *   verified_live                  — HTTP 200 + identity confirmed
 *   failed                         — publish attempt failed
 *   blocked                        — excluded by rule or explicitly
 *
 * Eligibility rule:
 *   A page is publishable ONLY if state === "approved" AND slug is NOT
 *   already in webflow_existing_slugs.json or published_pages.json.
 *
 * Never uses process.cwd(). All paths resolved via project-root.
 */

import fs from "fs";
import path from "path";
import { resolveFromRoot } from "./fs/project-root.js";
import { loadRegistry } from "./publish-registry-disk.js";

// ── Constants ──────────────────────────────────────────────────────────

const APPROVAL_STATE_PATH = "data/approval_state.json";
const BACKUP_DIR_REL = "data/registry_backups";
const MAX_BACKUPS = 10;

export const VALID_STATES = [
  "draft",
  "ready_for_review",
  "approved",
  "manufactured",
  "published_pending_verification",
  "verified_live",
  "failed",
  "blocked",
];

/**
 * Allowed state transitions. Key = from state, value = Set of allowed target states.
 */
const TRANSITIONS = {
  draft:                          new Set(["ready_for_review", "approved", "manufactured", "blocked"]),
  ready_for_review:               new Set(["approved", "blocked", "draft"]),
  approved:                       new Set(["published_pending_verification", "manufactured", "blocked", "draft"]),
  manufactured:                   new Set(["published_pending_verification", "blocked", "failed"]),
  published_pending_verification: new Set(["verified_live", "failed"]),
  verified_live:                  new Set(["draft", "blocked"]),
  failed:                         new Set(["approved", "manufactured", "blocked", "draft"]),
  blocked:                        new Set(["draft", "approved", "manufactured"]),
};

// ── Load ───────────────────────────────────────────────────────────────

/**
 * Load approval_state.json from disk. Always returns an array.
 * Never throws — returns [] on any failure.
 *
 * @returns {{ entries: object[], warnings: string[], path: string }}
 */
export function loadApprovalState() {
  const absPath = resolveFromRoot(APPROVAL_STATE_PATH);
  const warnings = [];

  if (!fs.existsSync(absPath)) {
    return { entries: [], warnings, path: absPath };
  }

  let raw;
  try {
    raw = fs.readFileSync(absPath, "utf-8");
  } catch (err) {
    warnings.push(`Failed to read approval state: ${err.message}`);
    return { entries: [], warnings, path: absPath };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    warnings.push(`Approval state JSON parse error: ${err.message}`);
    return { entries: [], warnings, path: absPath };
  }

  if (!Array.isArray(parsed)) {
    warnings.push(`Approval state is not an array (type: ${typeof parsed})`);
    return { entries: [], warnings, path: absPath };
  }

  // Validate entries
  const validEntries = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!entry || typeof entry !== "object") {
      warnings.push(`Entry ${i} is not an object`);
      continue;
    }
    if (!entry.slug) {
      warnings.push(`Entry ${i} has no slug — skipped`);
      continue;
    }
    if (entry.state && !VALID_STATES.includes(entry.state)) {
      warnings.push(`Entry ${i} (${entry.slug}) has invalid state "${entry.state}" — kept as-is`);
    }
    validEntries.push(entry);
  }

  return { entries: validEntries, warnings, path: absPath };
}

// ── Write ──────────────────────────────────────────────────────────────

/**
 * Write approval_state.json atomically (write-to-tmp then rename).
 * Creates backup before writing.
 *
 * @param {object[]} entries
 * @param {{ backup?: boolean, source?: string }} opts
 * @returns {{ path: string, count: number, warnings: string[] }}
 */
export function writeApprovalState(entries, { backup = true, source = "unknown" } = {}) {
  const absPath = resolveFromRoot(APPROVAL_STATE_PATH);
  const warnings = [];

  if (!Array.isArray(entries)) {
    throw new Error("[approval-gate] writeApprovalState received non-array data");
  }

  // Create backup before writing
  if (backup && fs.existsSync(absPath)) {
    try {
      const backupDir = resolveFromRoot(BACKUP_DIR_REL);
      fs.mkdirSync(backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(backupDir, `approval_state_${timestamp}.json`);
      fs.copyFileSync(absPath, backupPath);

      // Cleanup old backups (keep only MAX_BACKUPS)
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith("approval_state_") && f.endsWith(".json"))
        .sort()
        .reverse();
      for (const old of backups.slice(MAX_BACKUPS)) {
        fs.unlinkSync(path.join(backupDir, old));
      }
    } catch (err) {
      warnings.push(`Backup failed: ${err.message}`);
    }
  }

  // Ensure data directory exists
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });

  // Write atomically (write to tmp, then rename)
  // Use PID in tmp filename to avoid race conditions when parallel processes write
  const tmpPath = absPath + `.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2) + "\n");
  fs.renameSync(tmpPath, absPath);

  return { path: absPath, count: entries.length, warnings };
}

// ── Query ──────────────────────────────────────────────────────────────

/**
 * Build the composite key for a slug+mode pair.
 * @param {string} slug
 * @param {string} mode
 * @returns {string}
 */
function compositeKey(slug, mode) {
  return `${(slug || "").toLowerCase().trim()}::${(mode || "LTL").trim()}`;
}

/**
 * Get the approval entry for a specific slug+mode combo.
 * Returns null if no entry exists (meaning state = "draft" implicitly).
 *
 * @param {string} slug
 * @param {string} mode
 * @returns {object|null}
 */
export function getApprovalEntry(slug, mode) {
  const { entries } = loadApprovalState();
  const key = compositeKey(slug, mode);
  return entries.find(e => compositeKey(e.slug, e.mode) === key) || null;
}

// ── State Transitions ──────────────────────────────────────────────────

/**
 * Transition a lane's approval state. Validates transitions,
 * records state_history, and persists.
 *
 * @param {string} slug
 * @param {string} mode
 * @param {string} newState - must be in VALID_STATES
 * @param {{ by?: string, note?: string, reason?: string, rule_id?: string }} meta
 * @returns {{ success: boolean, entry: object, warnings: string[] }}
 */
export function transitionState(slug, mode, newState, { by = "system", note = "", reason = "", rule_id = "" } = {}) {
  const warnings = [];

  if (!VALID_STATES.includes(newState)) {
    return { success: false, entry: null, warnings: [`Invalid state: "${newState}"`] };
  }

  const { entries } = loadApprovalState();
  const key = compositeKey(slug, mode);
  let entry = entries.find(e => compositeKey(e.slug, e.mode) === key);

  const now = new Date().toISOString();
  const currentState = entry?.state || "draft";

  // Validate transition
  const allowed = TRANSITIONS[currentState];
  if (allowed && !allowed.has(newState)) {
    return {
      success: false,
      entry: entry || null,
      warnings: [`Invalid transition: ${currentState} → ${newState}. Allowed: ${[...allowed].join(", ")}`],
    };
  }

  const historyRecord = {
    from: currentState,
    to: newState,
    at: now,
    by,
    ...(note ? { note } : {}),
    ...(reason ? { reason } : {}),
  };

  if (entry) {
    // Update existing entry
    entry.state = newState;
    entry.state_changed_at = now;
    if (!entry.state_history) entry.state_history = [];
    entry.state_history.push(historyRecord);

    // Set approval metadata on approve
    if (newState === "approved") {
      entry.approved_by = by;
      entry.approved_at = now;
      entry.approval_note = note || entry.approval_note || "";
      entry.excluded_reason = null;
      entry.blocked_rule_id = null;
    }
    if (newState === "manufactured") {
      entry.manufactured_by = by;
      entry.manufactured_at = now;
      entry.manufacture_note = note || "";
      entry.excluded_reason = null;
      entry.blocked_rule_id = null;
    }
    if (newState === "blocked") {
      entry.excluded_reason = reason || note || "";
      entry.blocked_rule_id = rule_id || null;
    }
    if (newState === "failed") {
      entry.excluded_reason = reason || "";
    }
  } else {
    // Create new entry
    entry = {
      slug,
      mode: mode || "LTL",
      state: newState,
      approved_by: newState === "approved" ? by : null,
      approved_at: newState === "approved" ? now : null,
      approval_note: newState === "approved" ? (note || "") : "",
      manufactured_by: newState === "manufactured" ? by : null,
      manufactured_at: newState === "manufactured" ? now : null,
      manufacture_note: newState === "manufactured" ? (note || "") : "",
      excluded_reason: newState === "blocked" ? (reason || note || "") : null,
      blocked_rule_id: newState === "blocked" ? (rule_id || null) : null,
      state_changed_at: now,
      state_history: [historyRecord],
    };
    entries.push(entry);
  }

  // Persist
  const { warnings: writeWarnings } = writeApprovalState(entries, {
    backup: true,
    source: `transitionState:${by}`,
  });
  warnings.push(...writeWarnings);

  return { success: true, entry, warnings };
}

/**
 * Batch-set state for multiple slug+mode combos.
 *
 * @param {{ slug: string, mode: string }[]} lanes
 * @param {string} newState
 * @param {{ by?: string, note?: string }} meta
 * @returns {{ updated: number, skipped: number, warnings: string[] }}
 */
export function batchTransitionState(lanes, newState, { by = "system", note = "" } = {}) {
  const warnings = [];

  if (!VALID_STATES.includes(newState)) {
    return { updated: 0, skipped: 0, warnings: [`Invalid state: "${newState}"`] };
  }

  const { entries } = loadApprovalState();
  const now = new Date().toISOString();
  let updated = 0;
  let skipped = 0;

  for (const lane of lanes) {
    const key = compositeKey(lane.slug, lane.mode);
    let entry = entries.find(e => compositeKey(e.slug, e.mode) === key);

    const currentState = entry?.state || "draft";
    const allowed = TRANSITIONS[currentState];
    if (allowed && !allowed.has(newState)) {
      warnings.push(`Skipped ${lane.slug} (${lane.mode}): cannot transition ${currentState} → ${newState}`);
      skipped++;
      continue;
    }

    const historyRecord = {
      from: currentState,
      to: newState,
      at: now,
      by,
      ...(note ? { note } : {}),
    };

    if (entry) {
      entry.state = newState;
      entry.state_changed_at = now;
      if (!entry.state_history) entry.state_history = [];
      entry.state_history.push(historyRecord);
      if (newState === "approved") {
        entry.approved_by = by;
        entry.approved_at = now;
        entry.approval_note = note || entry.approval_note || "";
        entry.excluded_reason = null;
        entry.blocked_rule_id = null;
      }
    } else {
      entries.push({
        slug: lane.slug,
        mode: lane.mode || "LTL",
        state: newState,
        approved_by: newState === "approved" ? by : null,
        approved_at: newState === "approved" ? now : null,
        approval_note: newState === "approved" ? (note || "") : "",
        excluded_reason: null,
        blocked_rule_id: null,
        state_changed_at: now,
        state_history: [historyRecord],
      });
    }
    updated++;
  }

  // Persist once for the whole batch
  const { warnings: writeWarnings } = writeApprovalState(entries, {
    backup: true,
    source: `batchTransition:${by}`,
  });
  warnings.push(...writeWarnings);

  return { updated, skipped, warnings };
}

// ── Eligibility Computation ────────────────────────────────────────────

/**
 * Load the lane inventory (expanded by mode).
 * Prefers lane_registry.json, falls back to lane_inventory.json.
 * Matches the loading logic in publish_next.js lines 644-661.
 *
 * @returns {object[]}
 */
function loadInventory() {
  const registryPath = resolveFromRoot("data/lane_registry.json");
  const inventoryPath = resolveFromRoot("data/lane_inventory.json");

  if (fs.existsSync(registryPath)) {
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
    const expanded = [];
    for (const lane of registry) {
      for (const mode of (lane.modes || ["LTL"])) {
        expanded.push({
          origin: lane.origin,
          destination: lane.destination,
          mode,
          slug: lane.slug || lane.lane_slug,
          lane_set: lane.lane_set,
          order: lane.order,
          origin_city: lane.origin_city,
          destination_city: lane.destination_city,
          corridor_id: lane.corridor_id,
          distance_miles: lane.distance_miles,
        });
      }
    }
    return expanded;
  }

  if (fs.existsSync(inventoryPath)) {
    return JSON.parse(fs.readFileSync(inventoryPath, "utf-8"));
  }

  return [];
}

/**
 * Load webflow_existing_slugs.json.
 * @returns {Set<string>}
 */
function loadWebflowSlugs() {
  const absPath = resolveFromRoot("data/webflow_existing_slugs.json");
  if (!fs.existsSync(absPath)) return new Set();
  try {
    const slugs = JSON.parse(fs.readFileSync(absPath, "utf-8"));
    return new Set(slugs.map(s => String(s).toLowerCase().trim()));
  } catch {
    return new Set();
  }
}

/**
 * Compute publish eligibility for all lanes in inventory.
 *
 * Joins: approval_state.json + lane_registry.json + published_pages.json + webflow_existing_slugs.json
 *
 * A lane is publishable ONLY if ALL of these are true:
 *   1. state === "approved"
 *   2. slug NOT in webflow_existing_slugs.json
 *   3. slug NOT in published_pages.json
 *   4. NOT blocked or failed
 *
 * @returns {{
 *   approved_eligible: object[],
 *   excluded: object[],
 *   already_live: object[],
 *   blocked: object[],
 *   failed: object[],
 *   pending_verification: object[],
 *   draft: number,
 *   ready_for_review: number,
 *   totals: object
 * }}
 */
export function computePublishEligibility() {
  // 1. Load all data sources
  const { entries: approvalEntries } = loadApprovalState();
  const approvalMap = new Map();
  for (const e of approvalEntries) {
    approvalMap.set(compositeKey(e.slug, e.mode), e);
  }

  const webflowSlugSet = loadWebflowSlugs();

  const { entries: published } = loadRegistry();
  const publishedSlugSet = new Set(published.map(p => (p.slug || "").toLowerCase().trim()));

  const inventory = loadInventory();

  // 2. Classify each inventory entry
  const approved_eligible = [];
  const manufactured_eligible = [];
  const excluded = [];
  const already_live = [];
  const blocked = [];
  const failed = [];
  const pending_verification = [];
  let draftCount = 0;
  let readyForReviewCount = 0;

  // Track which approval entries were matched to inventory
  const processedKeys = new Set();

  for (const lane of inventory) {
    const key = compositeKey(lane.slug, lane.mode);
    const approval = approvalMap.get(key);
    const state = approval?.state || "draft";
    processedKeys.add(key);

    if (state === "draft") { draftCount++; continue; }
    if (state === "ready_for_review") { readyForReviewCount++; continue; }
    if (state === "verified_live") { already_live.push({ ...lane, ...approval }); continue; }
    if (state === "blocked") { blocked.push({ ...lane, ...approval }); continue; }
    if (state === "failed") { failed.push({ ...lane, ...approval }); continue; }
    if (state === "published_pending_verification") { pending_verification.push({ ...lane, ...approval }); continue; }

    // state === "approved" or "manufactured" — check exclusion conditions
    const slugLower = (lane.slug || "").toLowerCase().trim();
    if (webflowSlugSet.has(slugLower)) {
      excluded.push({ ...lane, ...approval, exclusion_reason: "slug already exists in Webflow CMS" });
      continue;
    }
    if (publishedSlugSet.has(slugLower)) {
      excluded.push({ ...lane, ...approval, exclusion_reason: "slug already in published_pages registry" });
      continue;
    }

    if (state === "manufactured") {
      manufactured_eligible.push({ ...lane, ...approval });
    } else {
      approved_eligible.push({ ...lane, ...approval });
    }
  }

  // 3. Process "orphan" approval entries (in approval_state but not in inventory)
  //    These can exist if lanes were manually approved or if the registry changed.
  for (const [key, approval] of approvalMap) {
    if (processedKeys.has(key)) continue;
    const state = approval.state || "draft";
    if (state === "draft") { draftCount++; continue; }
    if (state === "ready_for_review") { readyForReviewCount++; continue; }
    if (state === "verified_live") { already_live.push({ ...approval }); continue; }
    if (state === "blocked") { blocked.push({ ...approval }); continue; }
    if (state === "failed") { failed.push({ ...approval }); continue; }
    if (state === "published_pending_verification") { pending_verification.push({ ...approval }); continue; }

    // state === "approved" or "manufactured" — check exclusion conditions
    const slugLower = (approval.slug || "").toLowerCase().trim();
    if (webflowSlugSet.has(slugLower)) {
      excluded.push({ ...approval, exclusion_reason: "slug already exists in Webflow CMS" });
      continue;
    }
    if (publishedSlugSet.has(slugLower)) {
      excluded.push({ ...approval, exclusion_reason: "slug already in published_pages registry" });
      continue;
    }

    if (state === "manufactured") {
      manufactured_eligible.push({ ...approval });
    } else {
      approved_eligible.push({ ...approval });
    }
  }

  return {
    approved_eligible,
    manufactured_eligible,
    excluded,
    already_live,
    blocked,
    failed,
    pending_verification,
    draft: draftCount,
    ready_for_review: readyForReviewCount,
    totals: {
      approved: approved_eligible.length,
      manufactured: manufactured_eligible.length,
      excluded: excluded.length,
      live: already_live.length,
      blocked: blocked.length,
      failed: failed.length,
      draft: draftCount,
      ready_for_review: readyForReviewCount,
      pending_verification: pending_verification.length,
    },
  };
}

/**
 * Get the set of slugs that are approved and eligible for publish.
 * This replaces the ad-hoc exclusion set building in publish_next.js.
 *
 * @param {{ filterMode?: string }} opts
 * @returns {{ eligible: object[], excludedSlugs: Set<string>, reasons: Map<string, string> }}
 */
export function getApprovedPublishSet({ filterMode = null } = {}) {
  const result = computePublishEligibility();

  // Build exclusion set from all non-eligible sources
  const excludedSlugs = new Set();
  const reasons = new Map();

  for (const e of result.excluded) {
    excludedSlugs.add(e.slug);
    reasons.set(e.slug, e.exclusion_reason);
  }
  for (const e of result.already_live) {
    excludedSlugs.add(e.slug);
    reasons.set(e.slug, "already verified live");
  }
  for (const e of result.blocked) {
    excludedSlugs.add(e.slug);
    reasons.set(e.slug, e.excluded_reason || "blocked");
  }
  for (const e of result.pending_verification) {
    excludedSlugs.add(e.slug);
    reasons.set(e.slug, "published, pending verification");
  }

  let eligible = result.approved_eligible;
  if (filterMode) {
    eligible = eligible.filter(e => e.mode === filterMode);
  }

  return { eligible, excludedSlugs, reasons };
}

// ── Factory Inventory ──────────────────────────────────────────────────

/**
 * Compute the full lane page factory inventory.
 *
 * Joins all data sources to classify every registry lane into one status:
 *   already_live            — slug in webflow_existing_slugs.json
 *   already_published       — slug in published_pages.json (non-dry-run), not yet in webflow
 *   ready_to_manufacture    — in registry, NOT in webflow/published, state=draft/no-entry, not blocked/failed
 *   manufactured            — state = "manufactured" in approval_state
 *   approved                — state = "approved" (manually approved, ready to produce)
 *   blocked                 — state = "blocked"
 *   produced_pending_verify — state = "published_pending_verification"
 *   verified_live           — state = "verified_live"
 *   failed                  — state = "failed"
 *
 * @param {{ filterMode?: string }} opts
 * @returns {{
 *   already_live: object[], already_published: object[],
 *   ready_to_manufacture: object[], manufactured: object[],
 *   approved: object[], blocked: object[],
 *   produced_pending_verify: object[], verified_live: object[],
 *   failed: object[], totals: object,
 *   by_corridor: object
 * }}
 */
export function computeFactoryInventory({ filterMode = null } = {}) {
  // 1. Load all data sources
  const { entries: approvalEntries } = loadApprovalState();
  const approvalMap = new Map();
  for (const e of approvalEntries) {
    approvalMap.set((e.slug || "").toLowerCase().trim(), e);
  }

  const webflowSlugSet = loadWebflowSlugs();

  const { entries: published } = loadRegistry();
  const publishedSlugSet = new Set(
    published.filter(p => !p.dry_run).map(p => (p.slug || "").toLowerCase().trim())
  );

  let inventory = loadInventory();
  if (filterMode) {
    inventory = inventory.filter(lane => lane.mode === filterMode);
  }

  // 2. Classify each lane
  const results = {
    already_live: [],
    already_published: [],
    ready_to_manufacture: [],
    manufactured: [],
    approved: [],
    blocked: [],
    produced_pending_verify: [],
    verified_live: [],
    failed: [],
  };

  const corridorCounts = {};

  for (const lane of inventory) {
    const slugLower = (lane.slug || "").toLowerCase().trim();
    const approval = approvalMap.get(slugLower);
    const state = approval?.state || "draft";

    // Already in Webflow CMS
    if (webflowSlugSet.has(slugLower)) {
      results.already_live.push({ ...lane, computed_status: "already_live", state });
      continue;
    }

    // Already published (non-dry-run) but not yet in webflow export
    if (publishedSlugSet.has(slugLower)) {
      results.already_published.push({ ...lane, computed_status: "already_published", state });
      continue;
    }

    // Check explicit approval states
    if (state === "manufactured") {
      results.manufactured.push({ ...lane, ...approval, computed_status: "manufactured" });
      continue;
    }
    if (state === "approved") {
      results.approved.push({ ...lane, ...approval, computed_status: "approved" });
      continue;
    }
    if (state === "blocked") {
      results.blocked.push({ ...lane, ...approval, computed_status: "blocked" });
      continue;
    }
    if (state === "failed") {
      results.failed.push({ ...lane, ...approval, computed_status: "failed" });
      continue;
    }
    if (state === "published_pending_verification") {
      results.produced_pending_verify.push({ ...lane, ...approval, computed_status: "produced_pending_verify" });
      continue;
    }
    if (state === "verified_live") {
      results.verified_live.push({ ...lane, ...approval, computed_status: "verified_live" });
      continue;
    }

    // draft or ready_for_review — eligible for autonomous manufacturing
    results.ready_to_manufacture.push({ ...lane, computed_status: "ready_to_manufacture", state });

    // Track by corridor for inventory report
    const corridor = lane.corridor_id || "unknown";
    corridorCounts[corridor] = (corridorCounts[corridor] || 0) + 1;
  }

  // 3. Build totals
  const totals = {
    registry: inventory.length,
    webflow_existing: webflowSlugSet.size,
    overlap: results.already_live.length,
    already_published: results.already_published.length,
    ready_to_manufacture: results.ready_to_manufacture.length,
    manufactured: results.manufactured.length,
    approved: results.approved.length,
    blocked: results.blocked.length,
    produced_pending_verify: results.produced_pending_verify.length,
    verified_live: results.verified_live.length,
    failed: results.failed.length,
  };

  // 4. Sort corridor counts descending
  const by_corridor = Object.entries(corridorCounts)
    .sort((a, b) => b[1] - a[1])
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

  return { ...results, totals, by_corridor };
}
