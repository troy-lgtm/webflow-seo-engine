# Claude Code SEO Engine (Webflow)

Purpose: auto-generate SMB + enterprise SEO pages optimized for both classic search and LLM answer extraction, then publish into Webflow.

This setup is tuned for conversion: `Book 15-min Fit Call` + `Get Instant Quote`.

## What you get

- Batch page generation via Anthropic API (`generate_seo_batch.sh`)
- LLM-search optimized content schema (answer snippets + entity-rich copy)
- Mermaid workflow diagrams with game-inspired operational flows
- McKinsey-style scorecard card data + HTML embed exporter
- Self-learning optimization loop using Microsoft Clarity + GTM exports
- Local QA gate and Webflow draft/publish scripts

## Structure

- `prompts/01_brief_planner.md`
- `prompts/02_page_writer.md`
- `prompts/03_qa_reviewer.md`
- `scripts/generate_seo_batch.sh`
- `scripts/build_learning_backlog.sh`
- `scripts/apply_learning_edits.sh`
- `scripts/build_dashboard_data.sh`
- `scripts/run_engine.sh`
- `scripts/qa_gate.sh`
- `scripts/export_visual_embed.sh`
- `scripts/create_webflow_draft.sh`
- `scripts/publish_webflow_items.sh`
- `data/keywords/targets.jsonl`
- `data/analytics/gtm_metrics.sample.json`
- `data/analytics/clarity_metrics.sample.csv`
- `data/approved/example-flexport-alternative.json`
- `docs/seo_engine_goals.md`
- `docs/tracking_spec.md`
- `dashboard/index.html`

## Setup

```bash
cd /Users/troyfavre/Documents/Playground/webflow-seo-engine
cp .env.example .env
```

Fill `.env` with:
- Anthropic API key/model
- Webflow token + collection id
- CTA URLs

## End-to-end run

1. Generate briefs + drafts + approved pages in batch:

```bash
./scripts/generate_seo_batch.sh data/keywords/targets.jsonl
```

2. (Optional) export visual embed block for each approved page:

```bash
./scripts/export_visual_embed.sh data/approved/flexport-alternative.json
```

3. Push approved page to Webflow draft:

```bash
./scripts/create_webflow_draft.sh data/approved/flexport-alternative.json
```

4. Publish by returned item ID(s):

```bash
./scripts/publish_webflow_items.sh <item_id_1> <item_id_2>
```

Or run the orchestrator:

```bash
bash ./scripts/run_engine.sh full
```

Modes:
- `generate`
- `optimize`
- `full`
- `publish`

## Dashboard

Dashboard file:
- `dashboard/index.html`
- `dashboard/builder.html` (manual lane-combo page builder)

Data source generated automatically:
- `dashboard/data.js`

Manual refresh command:
```bash
bash ./scripts/build_dashboard_data.sh
```

## Manual Lane Builder Flow (No Webflow Required)

1. Open:
- `dashboard/builder.html`

2. In builder:
- use `Easy Mode` (default): 3 buttons only
  - `Generate Top Lanes`
  - `Save Current Page`
  - `Export Queue`
- generate lane combos
- set default lane economics + scoring weights
- optionally paste lane metrics CSV for route-specific ranking
- generate top-ranked lanes first (`Top N`)
- customize copy + design tokens
- export queue JSON
- monitor `Progress + Impact` panel for:
  - queue size
  - QA-ready count
  - estimated monthly impact
  - local published status

3. If you need full controls:
- click `Show Advanced` in the builder

4. Validate runtime flows in-browser:
- click `Run Flow Check` (Advanced mode)
- confirm all critical paths pass before exporting

Sample lane-metrics CSV:
- `data/manual/lane-metrics.sample.csv`

3. Import and publish locally:

```bash
bash ./scripts/import_manual_pages.sh /absolute/path/to/exported-queue.json
```

This writes QA-passing pages into:
- `data/approved/`

And marks local publish into:
- `data/published/`

Import report:
- `data/manual/import-report.json`

## Self-learning loop (Clarity + GTM)

1. Export GTM metrics to:
`data/analytics/gtm_metrics.json`

2. Export Clarity metrics to:
`data/analytics/clarity_metrics.csv`

3. Build prioritized conversion backlog:

```bash
./scripts/build_learning_backlog.sh data/analytics/gtm_metrics.json data/analytics/clarity_metrics.csv
```

4. Apply safe content edits (no design changes):

```bash
./scripts/apply_learning_edits.sh data/analytics/learning_backlog.json data/approved data/optimized
```

5. Push optimized pages as drafts:

```bash
./scripts/create_webflow_draft.sh data/optimized/<slug>.json
```

## Webflow field mapping required

Your collection should include these fields (names can vary; update script keys if needed):
- `slug`
- `name`
- `seo-title`
- `seo-description`
- `h1`
- `target_segment`
- `executive_summary`
- `intro`
- `problem_section`
- `solution_section`
- `proof_section`
- `comparison_table_markdown`
- `diagram_mermaid`
- `visual_cards`
- `llm_answer_snippets`
- `faq`
- `cta_primary`
- `cta_secondary`
- `schema_jsonld`

## Quality controls

`qa_gate.sh` blocks publish if any of these fail:
- missing required fields
- fewer than 3 FAQs
- fewer than 3 LLM answer snippets
- fewer than 3 visual cards
- invalid Mermaid header
- risky/unverifiable claims language

`build_learning_backlog.sh` and `apply_learning_edits.sh` enforce:
- content-only optimization policy
- no layout/CSS/component changes
- conversion edits anchored to Clarity + GTM evidence
