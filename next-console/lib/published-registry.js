import { stableHash } from "@/lib/hash";

const STORAGE_KEY = "warp_published_pages_v1";

/**
 * Build a content fingerprint from canonical_path + seo_title + h1 + first 200 chars of intro.
 */
export function contentFingerprint(entry) {
  const raw = [
    entry.canonical_path || "",
    entry.seo_title || "",
    entry.h1 || "",
    (entry.intro || "").slice(0, 200)
  ].join("|");
  return String(stableHash(raw));
}

/**
 * Build a canonical path from mode + origin + destination.
 * Always follows: /{mode}-freight-{origin}-to-{destination}
 */
export function buildCanonicalPath(origin, destination, mode) {
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `/${slug(mode)}-freight-${slug(origin)}-to-${slug(destination)}`;
}

/**
 * Load published pages from localStorage (client) or return empty array (server).
 */
export function loadPublished() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Append a published entry and persist to localStorage.
 */
export function appendPublished(entry) {
  const list = loadPublished();
  // Prevent exact duplicate canonical_path
  if (list.some((p) => p.canonical_path === entry.canonical_path)) return list;
  const enriched = {
    ...entry,
    content_fingerprint: entry.content_fingerprint || contentFingerprint(entry)
  };
  list.push(enriched);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
  return list;
}

/**
 * Find duplicates for a candidate entry against the published registry.
 * Returns array of { reason, existing } objects. Empty means no duplicates.
 */
export function findDuplicates(candidateEntry, publishedList) {
  const published = publishedList || loadPublished();
  if (!published.length) return [];
  const dupes = [];
  const candidateSlug = candidateEntry.slug || "";
  const candidateCanonical = candidateEntry.canonical_path || "";
  const candidateTitle = (candidateEntry.seo_title || "").toLowerCase().trim();
  const candidateH1 = (candidateEntry.h1 || "").toLowerCase().trim();
  const candidateIntro = (candidateEntry.intro || "").slice(0, 200).toLowerCase().trim();

  for (const existing of published) {
    if (existing.slug && existing.slug === candidateSlug) {
      dupes.push({ reason: "slug match", existing_canonical: existing.canonical_path });
    }
    if (existing.canonical_path && existing.canonical_path === candidateCanonical) {
      dupes.push({ reason: "canonical match", existing_canonical: existing.canonical_path });
    }
    if (candidateTitle && existing.seo_title && existing.seo_title.toLowerCase().trim() === candidateTitle) {
      dupes.push({ reason: "seo_title match", existing_canonical: existing.canonical_path });
    }
    if (candidateH1 && existing.h1 && existing.h1.toLowerCase().trim() === candidateH1) {
      dupes.push({ reason: "h1 match", existing_canonical: existing.canonical_path });
    }
    if (candidateIntro && existing.intro) {
      const existingIntro = existing.intro.slice(0, 200).toLowerCase().trim();
      if (existingIntro === candidateIntro) {
        dupes.push({ reason: "intro prefix match", existing_canonical: existing.canonical_path });
      }
    }
  }

  // Deduplicate by reason + canonical
  const seen = new Set();
  return dupes.filter((d) => {
    const key = `${d.reason}|${d.existing_canonical}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Load published pages from disk (Node.js scripts only — not available in browser).
 * Uses dynamic import so the fs module is not bundled for client-side code.
 * Falls back to empty array if file doesn't exist.
 * @param {string} [filePath] — path to published_pages.json
 * @returns {Promise<object[]>}
 */
export async function loadPublishedFromDisk(filePath) {
  if (typeof window !== "undefined") return []; // not available in browser
  try {
    const fs = await import(/* webpackIgnore: true */ "fs");
    const pathMod = await import(/* webpackIgnore: true */ "path");
    const urlMod = await import(/* webpackIgnore: true */ "url");
    // Resolve from this file's location (lib/) — never process.cwd()
    const thisDir = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
    const defaultPath = pathMod.resolve(thisDir, "..", "data", "published_pages.json");
    const resolvedPath = filePath || defaultPath;
    const raw = fs.readFileSync(resolvedPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Build a published entry from a generated page object.
 */
export function pageToPublishedEntry(page, waveId) {
  const origin = page.lane?.origin || "";
  const dest = page.lane?.destination || "";
  const mode = page.lane?.mode || "LTL";
  const canonical = buildCanonicalPath(origin, dest, mode);
  const entry = {
    canonical_path: canonical,
    slug: page.slug,
    seo_title: page.seo_title,
    h1: page.h1,
    intro: page.intro,
    origin_city: origin.replace(/,.*/, "").trim(),
    origin_state: (origin.match(/,\s*([A-Z]{2})/) || [])[1] || "",
    destination_city: dest.replace(/,.*/, "").trim(),
    destination_state: (dest.match(/,\s*([A-Z]{2})/) || [])[1] || "",
    mode,
    segment: page.target_segment || "smb",
    published_at_iso: new Date().toISOString(),
    wave_id: waveId || "wave-1"
  };
  entry.content_fingerprint = contentFingerprint(entry);
  return entry;
}
