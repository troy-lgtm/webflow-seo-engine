import { findDuplicates } from "@/lib/published-registry";

/**
 * Fixed ramp schedule: exact publish drops with dates and page counts.
 */
export const RAMP_DROPS = [
  { week: 0, date: "2026-03-04T04:30:00-08:00", pages: 1,  label: "Week 0 — First Page" },
  { week: 1, date: "2026-03-09T04:30:00-08:00", pages: 5,  label: "Week 1 — Drop 1" },
  { week: 1, date: "2026-03-11T04:30:00-08:00", pages: 5,  label: "Week 1 — Drop 2" },
  { week: 1, date: "2026-03-13T04:30:00-08:00", pages: 5,  label: "Week 1 — Drop 3" },
  { week: 2, date: "2026-03-16T04:30:00-08:00", pages: 10, label: "Week 2 — Drop 1" },
  { week: 2, date: "2026-03-18T04:30:00-08:00", pages: 10, label: "Week 2 — Drop 2" },
  { week: 2, date: "2026-03-20T04:30:00-08:00", pages: 10, label: "Week 2 — Drop 3" },
  { week: 3, date: "2026-03-23T04:30:00-08:00", pages: 25, label: "Week 3 — Drop 1" },
  { week: 3, date: "2026-03-25T04:30:00-08:00", pages: 25, label: "Week 3 — Drop 2" },
  { week: 3, date: "2026-03-27T04:30:00-08:00", pages: 25, label: "Week 3 — Drop 3" },
  { week: 4, date: "2026-03-30T04:30:00-08:00", pages: 50, label: "Week 4 — Drop 1" },
  { week: 4, date: "2026-04-01T04:30:00-08:00", pages: 50, label: "Week 4 — Drop 2" },
  { week: 4, date: "2026-04-03T04:30:00-08:00", pages: 50, label: "Week 4 — Drop 3" }
];

/**
 * Get the full ramp schedule with cumulative totals.
 */
export function getRampSchedule() {
  let cumulative = 0;
  return RAMP_DROPS.map((drop) => {
    cumulative += drop.pages;
    return { ...drop, cumulative };
  });
}

/**
 * Build a manifest for a specific drop.
 * Selects pages deterministically by priority score (descending).
 * Removes duplicates against publishedRegistry.
 *
 * @param {object} drop - A drop from RAMP_DROPS (with date, pages count)
 * @param {Array} candidatePages - All available pages sorted by priority
 * @param {Array} publishedRegistry - Already-published entries
 * @returns {object} manifest
 */
export function buildDropManifest(drop, candidatePages, publishedRegistry) {
  if (!candidatePages?.length) {
    return {
      drop_label: drop.label,
      drop_date: drop.date,
      target_count: drop.pages,
      selected_count: 0,
      pages: [],
      duplicates_removed: 0,
      errors: ["No candidate pages available"]
    };
  }

  // Sort candidates deterministically by priority score descending
  const sorted = [...candidatePages].sort(
    (a, b) => (b.priority?.score || 0) - (a.priority?.score || 0)
  );

  const selected = [];
  let duplicatesRemoved = 0;
  const usedSlugs = new Set();

  for (const page of sorted) {
    if (selected.length >= drop.pages) break;
    if (usedSlugs.has(page.slug)) continue;

    // Build candidate entry for duplicate check
    const candidate = {
      slug: page.slug,
      canonical_path: page.canonical_path || `/${page.slug}`,
      seo_title: page.seo_title,
      h1: page.h1,
      intro: page.intro
    };

    const dupes = findDuplicates(candidate, publishedRegistry);
    if (dupes.length > 0) {
      duplicatesRemoved++;
      continue;
    }

    usedSlugs.add(page.slug);
    selected.push({
      slug: page.slug,
      canonical_path: candidate.canonical_path,
      seo_title: page.seo_title,
      h1: page.h1,
      origin: page.lane?.origin || "",
      destination: page.lane?.destination || "",
      mode: page.lane?.mode || "",
      segment: page.target_segment || "smb",
      priority_score: page.priority?.score || 0
    });
  }

  return {
    drop_label: drop.label,
    drop_date: drop.date,
    drop_week: drop.week,
    target_count: drop.pages,
    selected_count: selected.length,
    pages: selected,
    duplicates_removed: duplicatesRemoved,
    generated_at: new Date().toISOString()
  };
}
