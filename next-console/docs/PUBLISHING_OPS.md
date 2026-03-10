# Publishing Operations Guide

## Canonical URL Rules

Every lane page follows this canonical format:

```
/{mode}-freight-{origin}-to-{destination}
```

Examples:
- `/ltl-freight-chicago-to-dallas`
- `/ftl-freight-los-angeles-to-new-york`
- `/shared-freight-houston-to-atlanta`

Rules:
- Mode comes first (ltl, ftl, shared)
- All lowercase, hyphens only
- City names normalized (spaces → hyphens, special chars removed)
- State abbreviations excluded from the canonical path
- Never deviate from this format

## Using published_pages.json

### Location
`data/published_pages.json` — the source of truth for every page published to Webflow.

### Schema
```json
{
  "canonical_path": "/ltl-freight-chicago-to-dallas",
  "slug": "chicago-il-to-dallas-tx-ltl",
  "seo_title": "Chicago, IL to Dallas, TX LTL Freight Quotes | WARP",
  "h1": "Chicago, IL to Dallas, TX LTL freight quotes",
  "origin_city": "Chicago",
  "origin_state": "IL",
  "destination_city": "Dallas",
  "destination_state": "TX",
  "mode": "LTL",
  "segment": "smb",
  "published_at_iso": "2026-03-04T04:30:00-08:00",
  "wave_id": "wave-1",
  "content_fingerprint": "stable-hash-string"
}
```

### Content Fingerprint
A stable hash of: `canonical_path + seo_title + h1 + first 200 chars of intro`. Used to detect content-level duplicates even when slugs differ.

### Workflow
1. Generate pages in the Builder
2. Run Duplicate Check before export
3. Export manifest
4. Publish to Webflow
5. Add entry to `published_pages.json` (manually or via script)
6. Commit the updated JSON file

## Ramp Schedule

### Fixed Drop Dates

| Week | Date | Pages | Cumulative |
|------|------|-------|------------|
| 0 | 2026-03-04 | 1 | 1 |
| 1 | 2026-03-09 | 5 | 6 |
| 1 | 2026-03-11 | 5 | 11 |
| 1 | 2026-03-13 | 5 | 16 |
| 2 | 2026-03-16 | 10 | 26 |
| 2 | 2026-03-18 | 10 | 36 |
| 2 | 2026-03-20 | 10 | 46 |
| 3 | 2026-03-23 | 25 | 71 |
| 3 | 2026-03-25 | 25 | 96 |
| 3 | 2026-03-27 | 25 | 121 |
| 4 | 2026-03-30 | 50 | 171 |
| 4 | 2026-04-01 | 50 | 221 |
| 4 | 2026-04-03 | 50 | 271 |

All drops at 4:30am PST.

### How to Use
1. Open Builder → Advanced → Ramp Schedule panel
2. Generate pages into the queue
3. Click "Export" on each drop row to get a manifest JSON
4. The manifest selects pages by priority score, skipping duplicates
5. Use the manifest to publish exactly that set in Webflow

## Duplicate Prevention

### How It Works
Before any export, the system checks each candidate page against `published_pages.json` on 5 dimensions:

1. **Slug match** — identical slug
2. **Canonical match** — identical canonical path
3. **SEO title match** — case-insensitive exact match
4. **H1 match** — case-insensitive exact match
5. **Intro prefix match** — first 200 characters match

If any check triggers, the page is blocked from export.

### Override
An override checkbox exists in the Builder UI. When checked, blocked pages are included in the export. Use this only when you intentionally want to republish (e.g., content update).

### Safe Export Flow
1. Click "Check Duplicates" to see the full report
2. Review blocked pages and reasons
3. Click "Safe Export" — this only exports clean pages
4. If needed, enable override checkbox for intentional republishes

## Publishing in Webflow Without Duplicates

### Pre-publish checklist
1. Generate pages in Builder
2. Run Duplicate Check — confirm 0 blocked
3. Export drop manifest for the target date
4. In Webflow CMS, search for each canonical path before creating
5. Create new collection items from the manifest
6. Set slugs to match the canonical format exactly
7. Stage all items, do not publish yet
8. Review each staged page in preview
9. Publish all at the scheduled time
10. Update `published_pages.json` with new entries
11. Commit and push the updated file

### If a duplicate is found in Webflow
- Do NOT create a second page
- Update the existing page content instead
- Keep the same canonical URL
- Update `published_pages.json` with new fingerprint

## Google Search Console Weekly Checks

### Week 1 (after first publish)
- [ ] Verify page is indexed (URL Inspection tool)
- [ ] Check for crawl errors
- [ ] Verify no "Excluded" status on submitted URLs
- [ ] Confirm sitemap was processed

### Weeks 2-4 (ramp phase)
- [ ] Check Index Coverage report — all submitted URLs should be "Valid"
- [ ] Monitor "Discovered - currently not indexed" for new pages
- [ ] Watch for duplicate content warnings
- [ ] Review Core Web Vitals for published pages
- [ ] Track impressions per page in Performance report

### Ongoing (weekly)
- [ ] Impressions trending up week-over-week
- [ ] CTR by page — identify low CTR pages for title/description improvements
- [ ] Average position — track ranking progress
- [ ] Check for new crawl errors
- [ ] Review "Pages with issues" in Experience report
- [ ] Export GSC data and import into Builder for performance-based ranking
