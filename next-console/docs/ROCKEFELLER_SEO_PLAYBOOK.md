# Rockefeller SEO Domination Playbook

## Wave Publishing Strategy

### Four-Wave Rollout
| Wave | Lane Pairs | Quality Threshold | Purpose |
|------|-----------|-------------------|---------|
| Wave 1 — Beachhead | 500 | 70 | High-value corridors, prove indexing |
| Wave 2 — Expansion | 1,500 | 65 | Regional coverage, build authority |
| Wave 3 — Saturation | 5,000 | 60 | Cross-region, long-tail capture |
| Wave 4 — Domination | 15,000 | 55 | Full network coverage |

### How It Works
- `lib/waves.js` defines wave definitions with lane pair limits and quality thresholds
- `selectWaveLanes(allLanes, waveId)` picks lanes up to the wave limit
- `wavePageCount(lanePairCount, modes, segments)` calculates total page output (lanes x modes x segments)
- `buildWaveManifest(pages, waveId)` exports a JSON manifest for each wave
- `waveQualityGate(pages, waveId)` validates pages meet threshold before publish

### Quality Gate Checks
1. Title uniqueness (no duplicate page titles)
2. Meta description length (120-160 chars)
3. Estimate presence (every page has rate data)
4. Disclaimer presence (legal compliance)
5. Internal links (>= 12 related lanes)
6. FAQ count (>= 3 per page)

### Crawl Budget Management
Each wave definition includes `crawl_budget_note` guiding sitemap throttling. Wave 1 is fully crawlable; later waves use sitemap segmentation to prevent overwhelming Googlebot.

---

## Freight Reference Layer Strategy

### Four Index Pages
| Page | Path | Purpose |
|------|------|---------|
| Freight Lanes Directory | `/indexes/freight-lanes` | All city pairs by region, links to lane pages |
| Freight Class Guide | `/indexes/freight-class` | NMFC class table, rate multipliers |
| Accessorials Reference | `/indexes/accessorials` | 14 common surcharges with costs |
| Transit Times Reference | `/indexes/transit-times` | Per-mode transit bands, sample corridors |

### SEO Architecture
- Each index page has **BreadcrumbList** and **Article** structured data (JSON-LD)
- **Quick Answers** blocks provide concise Q&A for LLM extraction (Google AI Overviews)
- Cross-links between index pages in "Related References" section
- Every lane page links to all 4 index pages via `related_indexes`
- Index pages link back to lane pages (freight lanes directory, transit time corridors)

### Content Generation
- `lib/index-builders.js` generates all index data deterministically from seed data
- No external API calls — everything derived from `cities.json` and `estimate-config.js`
- `getIndexSlugs()` returns slugs for `generateStaticParams()` (SSG at build time)
- `getIndexLinks()` returns link objects consumed by `lib/link-graph.js`

---

## Workflow Lock-in Strategy

### Spreadsheet Template Export
The builder exports a Google Sheets-friendly CSV template with columns:
- Origin, Destination, Mode, Segment, Est Low, Est High, Confidence, Notes, Status

### Pipeline Flow
1. Shipper downloads spreadsheet template from builder
2. Fills in lane requirements (origin/destination/mode)
3. System generates estimates for each lane
4. Shipper reviews estimates, requests quotes through Warp
5. Quote feedback feeds back into the data flywheel

### Estimate Tool Widget
Each lane preview includes an interactive estimate panel showing:
- Rate range with confidence level
- Distance and transit time
- How-it-works accordion explaining methodology
- Disclaimer block for legal compliance

---

## Contrast Testing Strategy

### Warp vs Legacy Process
`lib/contrast-copy.js` generates comparison blocks showing Warp advantage across 5 steps:

| Step | Legacy Process | Warp Process |
|------|---------------|-------------|
| Quote | Phone calls, 2-4 hours | Instant digital quotes |
| Compare | Manual spreadsheets | Side-by-side dashboard |
| Book | Email chains, 24-48h | One-click booking |
| Track | Call for updates | Real-time GPS tracking |
| Exceptions | Phone tag with carrier | Automated exception handling |

### Integration Points
- `generateContrastBlock(origin, destination, mode)` — full comparison table for preview
- `generateContrastSummary(origin, destination, mode)` — compact 4-point comparison for page JSON
- Contrast data included in every lane page export via `lane-engine.js`
- `ContrastPreview` component renders comparison table in builder preview

---

## Data Flywheel Strategy

### Quote Feedback Loop
1. Lane pages generate estimates from deterministic model
2. Real quotes come back via CSV import (quote feedback importer)
3. Extended columns capture: pallets, weight, freight class, quote date
4. System recalculates confidence levels based on observation count
5. Rate ranges tighten as more data points accumulate
6. Higher confidence unlocks "quote-verified" badge

### Confidence Tiers
| Observations | Confidence | Badge |
|-------------|------------|-------|
| 0 | modeled | Modeled Estimate |
| 1-4 | low | Low Confidence |
| 5-19 | medium | Market-Verified |
| 20+ | high | High Confidence |

### Flywheel Effect
More pages → more traffic → more quote requests → more feedback data → better estimates → higher rankings → more pages. Each iteration improves data quality across the entire network.

---

## Internal Link Dominance

### Link Budget Per Lane Page
| Category | Minimum | Source |
|----------|---------|--------|
| Related lanes | 12 | `lib/link-graph.js` |
| Guide links | 6 | `lib/link-graph.js` |
| Index page links | 2 | `lib/link-graph.js` |
| **Total internal links** | **20+** | |

### Link Diversity Rules
- At least 2 reverse/near-reverse lane links
- At least 4 same-origin or same-destination links
- At least 2 region hub links
- Mode-specific and segment-specific guide links
- All 4 index pages linked from every lane page

### Link Graph Architecture
```
Index Pages (4) ←→ Lane Pages (up to 15,000)
      ↕                    ↕
Guide Pages (9) ←→ Lane Pages
```

---

## Metrics and Guardrails

### Quality Metrics
- **Wave quality score**: weighted average of 6 checks, must exceed wave threshold
- **Publish readiness**: 17-check panel (existing) validates individual pages
- **Batch quality score**: per-batch scoring for size-based splits within waves

### Non-Negotiable Rules
1. Never claim exact prices — always show ranges with disclaimers
2. Deterministic outputs — same inputs produce same pages (seeded PRNG via djb2)
3. No database — all state in localStorage + exported JSON files
4. No external API calls at build time — everything generated from seed data
5. Every feature testable with Playwright (42 tests and counting)

### Content Guardrails
- Meta descriptions: 120-160 characters
- Page titles: unique across entire corpus
- Estimates: always include confidence level and disclaimer
- FAQ blocks: minimum 3 per page
- Internal links: minimum 20 per page

---

## File Map

### Core Libraries
| File | Purpose |
|------|---------|
| `lib/waves.js` | Wave definitions, lane selection, quality gates |
| `lib/index-builders.js` | Index page content generation |
| `lib/contrast-copy.js` | Warp vs legacy comparison blocks |
| `lib/link-graph.js` | Internal link assignment (lanes + guides + indexes) |
| `lib/lane-engine.js` | Lane page generation with estimates |
| `lib/estimate-model.js` | Deterministic freight rate estimation |
| `lib/hash.js` | Seeded PRNG for deterministic outputs |

### Routes
| Route | Type | Purpose |
|-------|------|---------|
| `/` | SSG | Dashboard |
| `/builder` | CSR | Page builder and preview |
| `/indexes/[slug]` | SSG | 4 freight reference pages |
| `/guides/[slug]` | SSG | 9 guide pages |
| `/sitemap.xml` | Dynamic | XML sitemap |
| `/robots.txt` | Dynamic | Robots directives |
| `/rss.xml` | Dynamic | RSS feed for new lanes |
| `/api/seed-lanes` | API | Seed CSV endpoint |

### Tests
- `tests/dashboard-builder.spec.js` — 42 Playwright e2e tests covering all features
