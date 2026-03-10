/**
 * GSC Data Store
 *
 * JSON-file-based storage for Google Search Console metrics.
 * Four tables: site, page, query, page_query — each stored as a JSON file
 * in data/gsc/. All writes are idempotent upserts keyed by unique composites.
 *
 * No database — follows the repo pattern of JSON artifact storage.
 */

import fs from "fs";
import path from "path";
import { resolveFromRoot } from "../fs/project-root.js";

const GSC_DIR = "data/gsc";

const TABLE_FILES = {
  site: "gsc_daily_site_metrics.json",
  page: "gsc_daily_page_metrics.json",
  query: "gsc_daily_query_metrics.json",
  page_query: "gsc_daily_page_query_metrics.json",
};

// ── Helpers ──────────────────────────────────────────────────────────

function ensureDir() {
  const dir = resolveFromRoot(GSC_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tablePath(table) {
  ensureDir();
  return resolveFromRoot(GSC_DIR, TABLE_FILES[table]);
}

function loadTable(table) {
  const fp = tablePath(table);
  if (!fs.existsSync(fp)) return [];
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    console.error(`[gsc-store] Failed to parse ${TABLE_FILES[table]}, returning empty`);
    return [];
  }
}

function saveTable(table, rows) {
  const fp = tablePath(table);
  fs.writeFileSync(fp, JSON.stringify(rows, null, 2));
}

// ── Key builders ─────────────────────────────────────────────────────

function siteKey(row) {
  return `${row.site_url}|${row.date}|${row.search_type}`;
}

function pageKey(row) {
  return `${row.site_url}|${row.date}|${row.page}|${row.search_type}`;
}

function queryKey(row) {
  return `${row.site_url}|${row.date}|${row.query}|${row.search_type}`;
}

function pageQueryKey(row) {
  return `${row.site_url}|${row.date}|${row.page}|${row.query}|${row.search_type}`;
}

const KEY_FNS = {
  site: siteKey,
  page: pageKey,
  query: queryKey,
  page_query: pageQueryKey,
};

// ── Upsert ───────────────────────────────────────────────────────────

/**
 * Upsert rows into a table. Existing rows with matching keys are updated.
 * New rows are appended. Fully idempotent.
 *
 * @param {string} table - site | page | query | page_query
 * @param {object[]} newRows - Rows to upsert
 * @returns {{ inserted: number, updated: number, total: number }}
 */
export function upsertRows(table, newRows) {
  if (!TABLE_FILES[table]) throw new Error(`[gsc-store] Unknown table: ${table}`);
  if (!newRows || newRows.length === 0) return { inserted: 0, updated: 0, total: 0 };

  const keyFn = KEY_FNS[table];
  const existing = loadTable(table);
  const index = new Map();
  for (let i = 0; i < existing.length; i++) {
    index.set(keyFn(existing[i]), i);
  }

  let inserted = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const row of newRows) {
    const key = keyFn(row);
    const existingIdx = index.get(key);
    const record = {
      ...row,
      updated_at: now,
    };

    if (existingIdx !== undefined) {
      record.id = existing[existingIdx].id;
      record.created_at = existing[existingIdx].created_at;
      existing[existingIdx] = record;
      updated++;
    } else {
      record.id = generateId();
      record.created_at = now;
      existing.push(record);
      index.set(key, existing.length - 1);
      inserted++;
    }
  }

  saveTable(table, existing);
  return { inserted, updated, total: existing.length };
}

// ── Queries ──────────────────────────────────────────────────────────

/**
 * Query rows from a table with optional filters.
 *
 * @param {string} table - site | page | query | page_query
 * @param {object} [filters] - { site_url, date, dateFrom, dateTo, page, query, search_type }
 * @returns {object[]}
 */
export function queryRows(table, filters = {}) {
  if (!TABLE_FILES[table]) throw new Error(`[gsc-store] Unknown table: ${table}`);
  let rows = loadTable(table);

  if (filters.site_url) rows = rows.filter(r => r.site_url === filters.site_url);
  if (filters.date) rows = rows.filter(r => r.date === filters.date);
  if (filters.dateFrom) rows = rows.filter(r => r.date >= filters.dateFrom);
  if (filters.dateTo) rows = rows.filter(r => r.date <= filters.dateTo);
  if (filters.page) rows = rows.filter(r => r.page === filters.page);
  if (filters.query) rows = rows.filter(r => r.query === filters.query);
  if (filters.search_type) rows = rows.filter(r => r.search_type === filters.search_type);

  return rows;
}

/**
 * Get all distinct dates in a table for a site.
 */
export function getDistinctDates(table, siteUrl) {
  const rows = queryRows(table, { site_url: siteUrl });
  return [...new Set(rows.map(r => r.date))].sort();
}

/**
 * Get row count for a table.
 */
export function getRowCount(table) {
  return loadTable(table).length;
}

/**
 * Get table stats summary.
 */
export function getTableStats() {
  return {
    site: getRowCount("site"),
    page: getRowCount("page"),
    query: getRowCount("query"),
    page_query: getRowCount("page_query"),
  };
}

/**
 * Clear all rows in a table (for testing).
 */
export function clearTable(table) {
  if (!TABLE_FILES[table]) throw new Error(`[gsc-store] Unknown table: ${table}`);
  saveTable(table, []);
}

// ── ID generator ─────────────────────────────────────────────────────

let _counter = 0;
function generateId() {
  _counter++;
  return `gsc_${Date.now()}_${_counter}_${Math.random().toString(36).slice(2, 8)}`;
}

export { TABLE_FILES, GSC_DIR };
