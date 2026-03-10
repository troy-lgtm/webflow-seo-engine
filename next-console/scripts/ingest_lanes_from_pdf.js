#!/usr/bin/env node

/**
 * Lane Data Ingestion Pipeline
 *
 * Extracts lanes from raw PDF/CSV/text input, normalizes city names using
 * data/cities.json, generates canonical slugs, detects duplicates (exact,
 * reversed, partial), and builds a canonical lane registry.
 *
 * Usage:
 *   node scripts/ingest_lanes_from_pdf.js <path-to-file>
 *   node scripts/ingest_lanes_from_pdf.js --stdin   (pipe text from stdin)
 *   node scripts/ingest_lanes_from_pdf.js --csv "Chicago,IL,Dallas,TX\nHouston,TX,Miami,FL"
 *
 * Outputs:
 *   data/raw_lanes.json             — All lanes as extracted (before normalization)
 *   data/lanes_canonical.json       — Deduplicated, normalized canonical lane registry
 *   data/lanes_duplicates_report.json — All duplicates detected with reasons
 *
 * Normalization:
 *   - City names matched against data/cities.json (fuzzy + exact)
 *   - State abbreviations standardized to 2-letter uppercase
 *   - Unicode characters cleaned
 *   - Zip codes stripped
 *   - "City, ST" canonical format enforced
 *   - Reversed lanes detected (A→B == B→A for duplicate purposes)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

// Output paths
const RAW_OUTPUT = path.join(ROOT, "data", "raw_lanes.json");
const CANONICAL_OUTPUT = path.join(ROOT, "data", "lanes_canonical.json");
const DUPES_OUTPUT = path.join(ROOT, "data", "lanes_duplicates_report.json");

// ── City normalization using cities.json ──────────────────────────────

const citiesData = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "cities.json"), "utf-8")
);

// Build lookup maps
const CITY_KEYS = Object.keys(citiesData); // e.g. "los angeles, ca"
const CITY_NAME_MAP = new Map(); // lowercase city name → canonical key
const CITY_ALIAS_MAP = new Map(); // common aliases

for (const key of CITY_KEYS) {
  const [city, state] = key.split(",").map(s => s.trim());
  CITY_NAME_MAP.set(city, key);
  CITY_NAME_MAP.set(key, key);
  // Also index without state
  if (!CITY_NAME_MAP.has(city)) {
    CITY_NAME_MAP.set(city, key);
  }
}

// Common aliases and abbreviations
const ALIASES = {
  "la": "los angeles",
  "sf": "san francisco",
  "nyc": "new york",
  "ny": "new york",
  "lv": "las vegas",
  "slc": "salt lake city",
  "kc": "kansas city",
  "stl": "st. louis",
  "st louis": "st. louis",
  "saint louis": "st. louis",
  "ft worth": "fort worth",
  "ft. worth": "fort worth",
  "jax": "jacksonville",
  "philly": "philadelphia",
  "phx": "phoenix",
  "indy": "indianapolis",
  "det": "detroit",
  "msp": "minneapolis",
  "atl": "atlanta",
  "mia": "miami",
  "hou": "houston",
  "dal": "dallas",
  "chi": "chicago",
  "sea": "seattle",
  "pdx": "portland",
  "den": "denver",
  "bos": "boston",
  "clt": "charlotte",
  "orl": "orlando",
  "tpa": "tampa",
  "mem": "memphis",
  "nas": "nashville",
  "san diego": "san diego",
  "long beach": "long beach",
};

// State name → abbreviation
const STATE_ABBREVS = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
  "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
  "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
  "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
  "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
  "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
  "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
  "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
  "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
  "wisconsin": "WI", "wyoming": "WY"
};

/**
 * Clean a raw string: strip unicode, zips, extra whitespace.
 */
function cleanRaw(s) {
  return String(s || "")
    .replace(/[\u2013\u2014\u2010\u2011\u2012\u2015\u00AD]/g, "-") // unicode hyphens
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')                   // smart quotes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")                   // smart apostrophes
    .replace(/\b\d{5}(-\d{4})?\b/g, "")                            // strip ZIP codes
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize state: convert full names or lowercase to 2-letter uppercase.
 */
function normalizeState(raw) {
  const s = String(raw || "").trim();
  if (/^[A-Z]{2}$/.test(s)) return s;
  const upper = s.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const lower = s.toLowerCase();
  return STATE_ABBREVS[lower] || upper.slice(0, 2);
}

/**
 * Normalize a city name using the cities.json lookup.
 * Returns { city, state, canonical, matched } or null.
 */
function normalizeCity(rawCity, rawState) {
  const city = cleanRaw(rawCity).toLowerCase().replace(/[^a-z\s.-]/g, "").trim();
  const state = normalizeState(rawState);

  // 1. Try exact match: "city, state"
  const exactKey = `${city}, ${state.toLowerCase()}`;
  if (citiesData[exactKey]) {
    const parts = exactKey.split(",");
    return {
      city: titleCase(parts[0].trim()),
      state: parts[1].trim().toUpperCase(),
      canonical: `${titleCase(parts[0].trim())}, ${parts[1].trim().toUpperCase()}`,
      matched: true,
    };
  }

  // 2. Try alias resolution
  const alias = ALIASES[city];
  if (alias) {
    const aliasKey = `${alias}, ${state.toLowerCase()}`;
    if (citiesData[aliasKey]) {
      const parts = aliasKey.split(",");
      return {
        city: titleCase(parts[0].trim()),
        state: parts[1].trim().toUpperCase(),
        canonical: `${titleCase(parts[0].trim())}, ${parts[1].trim().toUpperCase()}`,
        matched: true,
      };
    }
    // Try alias without state constraint
    for (const key of CITY_KEYS) {
      if (key.startsWith(alias + ",")) {
        const parts = key.split(",");
        return {
          city: titleCase(parts[0].trim()),
          state: parts[1].trim().toUpperCase(),
          canonical: `${titleCase(parts[0].trim())}, ${parts[1].trim().toUpperCase()}`,
          matched: true,
        };
      }
    }
  }

  // 3. Try fuzzy match: city name only (match first hit by state if multiple)
  for (const key of CITY_KEYS) {
    const [kCity] = key.split(",").map(s => s.trim());
    if (kCity === city) {
      const parts = key.split(",");
      return {
        city: titleCase(parts[0].trim()),
        state: parts[1].trim().toUpperCase(),
        canonical: `${titleCase(parts[0].trim())}, ${parts[1].trim().toUpperCase()}`,
        matched: true,
      };
    }
  }

  // 4. No match — use as-is with warning
  return {
    city: titleCase(city),
    state: state.toUpperCase(),
    canonical: `${titleCase(city)}, ${state.toUpperCase()}`,
    matched: false,
  };
}

function titleCase(s) {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Build a canonical slug from origin/destination.
 */
function buildSlug(origin, destination) {
  const citySlug = (s) =>
    s.split(",")[0].trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `${citySlug(origin)}-to-${citySlug(destination)}`;
}

// ── Lane extraction from raw text ──────────────────────────────

/**
 * Parse raw text into lane objects.
 * Handles multiple formats:
 *   - CSV: origin_city,origin_state,destination_city,destination_state,...
 *   - Arrow: "Chicago, IL → Dallas, TX"
 *   - "to" separator: "Chicago IL to Dallas TX"
 *   - Tab-separated
 */
function extractLanes(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const lanes = [];

  // Detect format from first non-empty line
  const firstLine = lines[0].toLowerCase();
  const isCSV = firstLine.includes("origin") && firstLine.includes("destination");

  if (isCSV) {
    // CSV with header
    const headers = lines[0].split(/[,\t]/).map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
    const colMap = {};
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (h.includes("origin") && h.includes("city")) colMap.origin_city = i;
      else if (h.includes("origin") && h.includes("state")) colMap.origin_state = i;
      else if (h.includes("dest") && h.includes("city")) colMap.dest_city = i;
      else if (h.includes("dest") && h.includes("state")) colMap.dest_state = i;
      else if (h === "origin_city") colMap.origin_city = i;
      else if (h === "origin_state") colMap.origin_state = i;
      else if (h === "destination_city") colMap.dest_city = i;
      else if (h === "destination_state") colMap.dest_state = i;
      else if (h === "lane_set") colMap.lane_set = i;
      else if (h === "mode") colMap.mode = i;
    }

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(/[,\t]/).map(c => c.trim());
      if (cols.length < 4) continue;

      const oc = cols[colMap.origin_city ?? 0] || "";
      const os = cols[colMap.origin_state ?? 1] || "";
      const dc = cols[colMap.dest_city ?? 2] || "";
      const ds = cols[colMap.dest_state ?? 3] || "";

      if (!oc || !dc) continue;

      lanes.push({
        raw_origin: `${oc}, ${os}`,
        raw_destination: `${dc}, ${ds}`,
        origin_city: oc,
        origin_state: os,
        destination_city: dc,
        destination_state: ds,
        lane_set: cols[colMap.lane_set] || "",
        mode: cols[colMap.mode] || "",
        line_number: i + 1,
      });
    }
  } else {
    // Free-form text: try arrow/to patterns
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Try arrow pattern: "City, ST → City, ST" or "City, ST -> City, ST"
      const arrowMatch = line.match(
        /([A-Za-z\s.'-]+),?\s*([A-Z]{2})?\s*[→\->]+\s*([A-Za-z\s.'-]+),?\s*([A-Z]{2})?/i
      );
      if (arrowMatch) {
        lanes.push({
          raw_origin: `${arrowMatch[1].trim()}, ${arrowMatch[2] || ""}`.trim(),
          raw_destination: `${arrowMatch[3].trim()}, ${arrowMatch[4] || ""}`.trim(),
          origin_city: arrowMatch[1].trim(),
          origin_state: arrowMatch[2] || "",
          destination_city: arrowMatch[3].trim(),
          destination_state: arrowMatch[4] || "",
          lane_set: "",
          mode: "",
          line_number: i + 1,
        });
        continue;
      }

      // Try "to" pattern: "City ST to City ST" or "City, ST to City, ST"
      const toMatch = line.match(
        /([A-Za-z\s.'-]+),?\s*([A-Z]{2})?\s+to\s+([A-Za-z\s.'-]+),?\s*([A-Z]{2})?/i
      );
      if (toMatch) {
        lanes.push({
          raw_origin: `${toMatch[1].trim()}, ${toMatch[2] || ""}`.trim(),
          raw_destination: `${toMatch[3].trim()}, ${toMatch[4] || ""}`.trim(),
          origin_city: toMatch[1].trim(),
          origin_state: toMatch[2] || "",
          destination_city: toMatch[3].trim(),
          destination_state: toMatch[4] || "",
          lane_set: "",
          mode: "",
          line_number: i + 1,
        });
        continue;
      }

      // Try 4-column tab/comma: "City\tST\tCity\tST"
      const cols = line.split(/[,\t]+/).map(c => c.trim());
      if (cols.length >= 4) {
        const potentialState1 = cols[1];
        const potentialState2 = cols[3];
        if (/^[A-Z]{2}$/i.test(potentialState1) && /^[A-Z]{2}$/i.test(potentialState2)) {
          lanes.push({
            raw_origin: `${cols[0]}, ${cols[1]}`,
            raw_destination: `${cols[2]}, ${cols[3]}`,
            origin_city: cols[0],
            origin_state: cols[1],
            destination_city: cols[2],
            destination_state: cols[3],
            lane_set: cols[4] || "",
            mode: cols[5] || "",
            line_number: i + 1,
          });
        }
      }
    }
  }

  return lanes;
}

// ── Duplicate detection ──────────────────────────────

function detectDuplicates(canonicalLanes) {
  const seen = new Map(); // slug → first entry
  const reverseSeen = new Map(); // reversed slug → first entry
  const duplicates = [];

  for (const lane of canonicalLanes) {
    const slug = lane.slug;
    const reverseSlug = buildSlug(lane.destination, lane.origin);

    // Exact duplicate
    if (seen.has(slug)) {
      duplicates.push({
        lane,
        duplicate_of: seen.get(slug),
        reason: "exact_duplicate",
        rule_id: "INGEST-DUP-01",
      });
      continue;
    }

    // Reversed duplicate (A→B when B→A exists)
    if (seen.has(reverseSlug)) {
      duplicates.push({
        lane,
        duplicate_of: seen.get(reverseSlug),
        reason: "reversed_lane",
        rule_id: "INGEST-DUP-02",
      });
      continue;
    }

    // Check reverse map too
    if (reverseSeen.has(slug)) {
      duplicates.push({
        lane,
        duplicate_of: reverseSeen.get(slug),
        reason: "reversed_lane",
        rule_id: "INGEST-DUP-02",
      });
      continue;
    }

    seen.set(slug, lane);
    reverseSeen.set(reverseSlug, lane);
  }

  return { unique: [...seen.values()], duplicates };
}

// ── Main ──────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let rawText = "";

  if (args.includes("--csv")) {
    const idx = args.indexOf("--csv");
    rawText = args[idx + 1] || "";
  } else if (args.includes("--stdin")) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    rawText = Buffer.concat(chunks).toString("utf-8");
  } else if (args[0] && !args[0].startsWith("-")) {
    const filePath = path.resolve(args[0]);
    if (!fs.existsSync(filePath)) {
      console.error(`ERROR: File not found: ${filePath}`);
      process.exit(1);
    }
    rawText = fs.readFileSync(filePath, "utf-8");
  } else {
    // If no input, use the seed CSV as default input
    const seedPath = path.join(ROOT, "data", "warp_top_2000_lanes_seed.csv");
    if (fs.existsSync(seedPath)) {
      console.log("No input file specified — using data/warp_top_2000_lanes_seed.csv as default.");
      rawText = fs.readFileSync(seedPath, "utf-8");
    } else {
      console.log("Usage:");
      console.log("  node scripts/ingest_lanes_from_pdf.js <path-to-file>");
      console.log("  node scripts/ingest_lanes_from_pdf.js --stdin");
      console.log('  node scripts/ingest_lanes_from_pdf.js --csv "City,ST,City,ST"');
      process.exit(0);
    }
  }

  console.log("=== Lane Data Ingestion Pipeline ===\n");

  // Step 1: Extract raw lanes
  const rawLanes = extractLanes(rawText);
  console.log(`  Step 1: Extracted ${rawLanes.length} raw lanes`);

  // Write raw_lanes.json
  fs.writeFileSync(RAW_OUTPUT, JSON.stringify(rawLanes, null, 2));
  console.log(`    → ${RAW_OUTPUT}`);

  // Step 2: Normalize city names
  console.log("  Step 2: Normalizing city names...");
  let matchedCount = 0;
  let unmatchedCount = 0;
  const unmatched = [];

  const normalizedLanes = rawLanes.map((lane, idx) => {
    const origin = normalizeCity(lane.origin_city, lane.origin_state);
    const dest = normalizeCity(lane.destination_city, lane.destination_state);

    if (origin.matched) matchedCount++;
    else {
      unmatchedCount++;
      unmatched.push({ type: "origin", raw: lane.raw_origin, line: lane.line_number });
    }

    if (dest.matched) matchedCount++;
    else {
      unmatchedCount++;
      unmatched.push({ type: "destination", raw: lane.raw_destination, line: lane.line_number });
    }

    const slug = buildSlug(origin.canonical, dest.canonical);

    return {
      origin: origin.canonical,
      destination: dest.canonical,
      slug,
      origin_matched: origin.matched,
      destination_matched: dest.matched,
      lane_set: lane.lane_set || "imported",
      mode: lane.mode || "",
      raw_origin: lane.raw_origin,
      raw_destination: lane.raw_destination,
      line_number: lane.line_number,
      order: idx,
    };
  });

  console.log(`    Matched: ${matchedCount} cities | Unmatched: ${unmatchedCount} cities`);
  if (unmatched.length > 0 && unmatched.length <= 20) {
    for (const u of unmatched) {
      console.log(`    ⚠ ${u.type}: "${u.raw}" (line ${u.line})`);
    }
  } else if (unmatched.length > 20) {
    console.log(`    ⚠ ${unmatched.length} unmatched cities (showing first 10):`);
    for (const u of unmatched.slice(0, 10)) {
      console.log(`      ${u.type}: "${u.raw}" (line ${u.line})`);
    }
  }

  // Step 3: Self-lane exclusion
  const nonSelfLanes = normalizedLanes.filter(l => {
    const oCity = l.origin.split(",")[0].trim().toLowerCase();
    const dCity = l.destination.split(",")[0].trim().toLowerCase();
    return oCity !== dCity;
  });
  const selfLaneCount = normalizedLanes.length - nonSelfLanes.length;
  console.log(`  Step 3: Self-lane exclusion — removed ${selfLaneCount} self-lanes`);

  // Step 4: Detect duplicates
  console.log("  Step 4: Detecting duplicates...");
  const { unique, duplicates } = detectDuplicates(nonSelfLanes);

  const exactDupes = duplicates.filter(d => d.reason === "exact_duplicate").length;
  const reversedDupes = duplicates.filter(d => d.reason === "reversed_lane").length;
  console.log(`    Exact duplicates: ${exactDupes}`);
  console.log(`    Reversed duplicates: ${reversedDupes}`);
  console.log(`    Unique canonical lanes: ${unique.length}`);

  // Step 5: Build canonical registry
  const canonical = unique.map((lane, idx) => ({
    origin: lane.origin,
    destination: lane.destination,
    slug: lane.slug,
    lane_set: lane.lane_set,
    order: idx,
  }));

  // Write outputs
  fs.writeFileSync(CANONICAL_OUTPUT, JSON.stringify(canonical, null, 2));
  console.log(`\n    → ${CANONICAL_OUTPUT} (${canonical.length} lanes)`);

  const dupReport = {
    generated_at: new Date().toISOString(),
    summary: {
      total_raw: rawLanes.length,
      self_lanes_removed: selfLaneCount,
      exact_duplicates: exactDupes,
      reversed_duplicates: reversedDupes,
      total_duplicates: duplicates.length,
      canonical_unique: unique.length,
      unmatched_cities: unmatchedCount,
    },
    unmatched_cities: unmatched,
    duplicates: duplicates.map(d => ({
      slug: d.lane.slug,
      origin: d.lane.origin,
      destination: d.lane.destination,
      reason: d.reason,
      rule_id: d.rule_id,
      duplicate_of_slug: d.duplicate_of.slug,
      line_number: d.lane.line_number,
    })),
  };

  fs.writeFileSync(DUPES_OUTPUT, JSON.stringify(dupReport, null, 2));
  console.log(`    → ${DUPES_OUTPUT}`);

  // Summary
  console.log("\n=== Summary ===");
  console.log(`  Raw lanes extracted:     ${rawLanes.length}`);
  console.log(`  Self-lanes removed:      ${selfLaneCount}`);
  console.log(`  Exact duplicates:        ${exactDupes}`);
  console.log(`  Reversed duplicates:     ${reversedDupes}`);
  console.log(`  Canonical unique lanes:  ${unique.length}`);
  console.log(`  Unmatched cities:        ${unmatchedCount}`);
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
