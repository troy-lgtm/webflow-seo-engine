# WARP SEO Engine Upgrades

Upgrade from page generator to a data-rich, internally linked, self-optimizing programmatic SEO engine.

## Architecture Overview

```
data/hubs.json + cities.json     ← Geographic seed data (22 hubs, 36 cities)
lib/lane-intelligence.js         ← Distance, transit, rates, equipment, network proof
lib/link-graph.js                ← Internal linking (related lanes + guide links)
lib/graph-model.js               ← Knowledge graph (nodes, edges, metrics)
lib/seo-feedback.js              ← GSC/GA4 CSV parsing, copy upgrades, ranking
lib/lane-engine.js               ← Core engine (now integrates all above)
app/guides/[slug]/page.js        ← 9 static guide pages with schema markup
app/builder/page.js              ← Builder UI with all new panels
app/page.js                      ← Dashboard with graph health widget
```

## P0: Lane Intelligence Layer

**File:** `lib/lane-intelligence.js`

Every generated lane page is automatically enriched with:

- **Estimated distance** (Haversine + 1.18x road factor) using `data/cities.json`
- **Transit time range** (based on distance bands)
- **Rate range** with disclaimer (mode-specific: LTL per CWT, FTL per mile, Shared per pallet)
- **Freight class range** (LTL only, NMFC-based)
- **Common equipment types** (mode-specific)
- **Seasonality notes** (seeded PRNG for deterministic variation)
- **Network proof:** carrier count estimate, nearest cross-dock hubs, origin/destination regions, service notes

Usage: `enrichLane(page)` is called automatically inside `makeLanePage()`.

## P0: Internal Linking Graph

**File:** `lib/link-graph.js`

After generating pages, `attachLinks(pages)` adds to each page:

- `related_lanes` (up to 10): reverse lanes, same-origin, same-destination, same-region links
- `related_guides` (up to 6): mode guides, segment guides, topical guides

Link strategies:
1. **Reverse lane** — if you have LA→NYC, link to NYC→LA
2. **Same origin** — other lanes from the same origin city
3. **Same destination** — other lanes to the same destination
4. **Same region** — lanes in the same geographic region

## P0: Freight Knowledge Graph

**File:** `lib/graph-model.js`

`buildGraph(pages)` creates an in-memory knowledge graph with:

- **Node types:** City, Region, Lane, Mode, Segment
- **Edge types:** from, to, uses_mode, targets, in_region
- **Metrics:** total_nodes, total_edges, total_lanes, top_hubs (by degree), top_regions

Visible on both the dashboard (Graph Health widget) and builder (advanced mode).

## P0: Guide Pages

**File:** `app/guides/[slug]/page.js`

9 static guide pages with unique freight content:

| Slug | Topic |
|------|-------|
| `ltl` | LTL Freight Shipping |
| `ftl` | FTL Freight Shipping |
| `shared` | Shared Truckload |
| `smb` | SMB Freight Buyer's Guide |
| `enterprise` | Enterprise Logistics |
| `midmarket` | Midmarket Freight |
| `freight-class` | Freight Classification |
| `damage-prevention` | Freight Damage Prevention |
| `tendering` | Freight Tendering |

Each guide has:
- `generateStaticParams()` for static export
- `generateMetadata()` for SEO
- BreadcrumbList + Article JSON-LD
- Related guides grid linking to other guides

## P1: GSC + GA4 Import Panel

**File:** `lib/seo-feedback.js`

Paste CSV exports from Google Search Console and GA4 directly into the builder sidebar.

### How to use:
1. Open builder, click "Show Advanced"
2. Find the "GSC + GA4 Import" panel in the left sidebar
3. Paste your GSC CSV (columns: query, page, clicks, impressions, ctr, position)
4. Paste your GA4 CSV (columns: page_path, sessions, conversions, conversion_rate)
5. Data is saved to localStorage and persists across sessions

### What it enables:
- **Performance-based ranking:** Switch rank mode to "Live Performance Data" or "Blended"
- **SEO copy upgrades:** Per-page suggestions based on position, CTR, impression volume, and query gaps
- **Fuzzy query matching:** Queries are matched to lane pages by slug, origin, destination, mode tokens

### Ranking modes:
- **Strategic** (default): Ranks by expected monthly revenue and strategic priority
- **Performance**: Ranks by clicks * 2 + impressions * 0.01 + conversions * 10
- **Blended**: 50/50 mix of strategic and performance scores

## P2: Content Uniqueness Checks

**File:** `lib/lane-engine.js` → `checkUniqueness(pages)`

After generating pages, the engine checks for content overlap:
- Compares seo_title, meta_description, h1, intro across all pages
- Flags pages with >60% token overlap on any field
- Warnings displayed in the builder under "Content Uniqueness Warnings"

## P2: Expanded Structured Data

Each generated lane page now includes:
- `schema_jsonld` — FAQPage schema
- `schema_breadcrumb` — BreadcrumbList (WARP > Freight > Lane)
- `schema_organization` — Organization schema for WARP
- `schema_service` — Service schema for the specific shipping mode

## Publish Readiness (15 checks)

The publish readiness panel now validates:

1. Slug present
2. SEO title (30-60 chars)
3. Meta description (80-160 chars)
4. H1 present
5. Intro (50+ chars)
6. Proof section present
7. Mermaid diagram present
8. FAQ has 3+ entries
9. Schema JSON-LD valid
10. CTA URLs valid
11. Visual cards present
12. LLM snippets present
13. Lane stats enriched
14. Network proof present
15. Internal links present

## CSV Export Fields

The CSV manifest now includes additional columns:
- `distance_miles`, `transit_days`, `rate_low`, `rate_high`
- `carrier_count`, `origin_region`, `destination_region`
- `related_lane_count`, `related_guide_count`

## Testing

```bash
# Run all 16 e2e tests
npm run test:e2e

# Run build
npm run build

# Start dev server
npm run dev
```

### Test coverage:
- Dashboard to builder navigation
- Easy mode generate/save/export
- Advanced mode queue and flow check
- CSV export
- Publish readiness (15 checks)
- Lane stats panel visibility
- Network proof panel visibility
- Internal links panel visibility
- Dashboard graph health widget
- Builder graph metrics
- Guide page loading with schema
- Guide page related guides
- Guide 404 handling
- GSC/GA4 CSV import and parsing
- Rank mode toggle
- Flow diagram rendering

## Non-breaking Changes

- No Tailwind added — all vanilla CSS with custom properties
- No database — all data is JSON files + localStorage
- Dark theme preserved — all design tokens intact
- All existing routes (`/`, `/builder`) unchanged
- New routes added (`/guides/[slug]`) without breaking existing
- All 16 tests pass clean
