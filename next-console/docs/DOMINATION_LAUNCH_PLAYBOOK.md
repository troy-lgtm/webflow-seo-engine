# Domination Launch Playbook

Ship 2,000 lane pages safely, generate crawl/indexing assets, and scale to full coverage.

## Lane Seed Data

The seed CSV lives at `data/warp_top_2000_lanes_seed.csv` with 2,000 city pairs:

- **1,560 tier1_core** — highest-volume national corridors between major metro freight hubs
- **440 tier1_to_tier2_expansion** — expansion lanes connecting major hubs to growth markets

Lane set metadata is in `data/lane_sets.json`. Each set has priority, recommended batch size, and launch order.

## Page Generation Math

Each city pair generates pages across selected modes and segments:

- **Modes**: LTL, FTL, Shared (default: all 3)
- **Segments**: smb, midmarket, enterprise (default: smb + midmarket)

With defaults: 2,000 pairs x 3 modes x 2 segments = **12,000 pages**.

Toggle modes/segments in the Lane Set Import panel to adjust volume.

## Step-by-Step Launch

### 1. Import Lane Seed

Open Builder > Show Advanced > Lane Set Import panel:

- **Paste CSV** into the text area, or
- **Upload CSV** via file picker, or
- Click **Load Seed File** to pull from `data/warp_top_2000_lanes_seed.csv`

The import summary shows total pairs and tier breakdown.

### 2. Configure Generation

In the same panel:

- Check/uncheck **Mode** checkboxes (LTL, FTL, Shared)
- Check/uncheck **Segment** checkboxes (smb, midmarket, enterprise)
- The **Queue Preview** shows total page count before generation

### 3. Generate Pages

Click **Generate N Pages from Import**. This:

1. Creates a page for each (city pair x mode x segment) combination
2. Runs `attachLinks()` for internal link density (min 12 related lanes, min 6 guides)
3. Runs `checkUniqueness()` for content diversity
4. Creates publish batches automatically

### 4. Review Batches

The **Publish Batches** panel shows:

- Batch ID and page count
- Mode/segment distribution
- **Quality score** (0-100) with SAFE/UNSAFE badge

Quality scoring checks:
- Title uniqueness within batch (>10% duplicates = -15)
- Intro similarity (>30% high-overlap pairs = -20)
- FAQ diversity (>50% duplicate questions = -15)
- Transit range diversity (<3 unique ranges = -10)
- Rate range diversity (<5 unique ranges = -10)
- Meta description quality (>20% thin = -10)

**Safe threshold: 60/100.** Unsafe batches are blocked from export.

### 5. Export Batches

- Click **Export Batch** on individual safe batches
- Click **Export All Safe Batches** for bulk export
- Each batch exports as `batch-{id}-{date}.json`

### 6. Publish

Import batch JSON files into your CMS/Webflow using the import scripts. Each batch generates a published manifest entry in `data/published_pages.json`.

### 7. Verify Crawl Assets

After publishing:

- `/sitemap.xml` — auto-generates from `data/published_pages.json`, includes all indexable pages
- `/robots.txt` — allows all crawlers, points to sitemap

## Internal Linking Rules

Every page gets:

- **Min 12 related lanes** with diversity enforcement:
  - 2+ reverse/near-reverse lanes
  - 4+ same-origin lanes
  - 4+ same-destination lanes
  - 2+ region hub lanes
- **Min 6 related guides** covering:
  - Mode-specific guide (LTL/FTL/Shared)
  - Segment guide (SMB/Midmarket/Enterprise)
  - Problem guides (freight class, damage prevention, tendering)

## Quality Gates

### Publish Readiness (17 checks per page)

Every page must pass all 17 checks:
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
16. Estimate confidence present
17. Estimate disclaimers present

### Batch Quality (safe >= 60)

Batch-level scoring prevents publishing thin or duplicate content at scale.

### Content Uniqueness

Cross-page checks flag:
- High token similarity (>80% overlap) in titles, metas, H1s, intros
- Identical transit ranges (>40% of pages)
- Identical rate ranges (>30% of pages)

## Tool Panel

Each page includes a `tool_panel` schema for Webflow:
- **Inputs**: pallet count, weight, freight class
- **Outputs**: estimated rate range, transit days, confidence level
- **CTA**: links to real-time quote tool

## Architecture

```
data/warp_top_2000_lanes_seed.csv  <- 2,000 city pairs
data/lane_sets.json                <- tier metadata
lib/publish-batch.js               <- batch creation + quality scoring
lib/sitemap-utils.js               <- sitemap XML generation
lib/link-graph.js                  <- internal link density rules
lib/lane-engine.js                 <- page generation + tool_panel
app/api/seed-lanes/route.js        <- serves seed CSV to client
app/sitemap.xml/route.js           <- dynamic sitemap
app/robots.txt/route.js            <- crawler directives
```

## Recommended Launch Order

1. **Tier 1 Core** (batch size: 250) — ship first, 1,560 pairs
2. **Tier 1 to Tier 2 Expansion** (batch size: 200) — ship second, 440 pairs

Start with smb + midmarket segments, add enterprise after validating conversion on first 500 pages.

## Testing

29 Playwright e2e tests cover:
- Lane import (CSV paste, summary, mode/segment toggles)
- Multi-mode generation (correct page count)
- Batch creation and quality scoring
- Tool panel rendering
- Sitemap.xml and robots.txt routes
- All existing features preserved
