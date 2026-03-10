# CLAUDE.md — Project Memory for webflow-seo-engine

## What This Is

WARP's SEO automation engine. Generates, validates, approves, and publishes 10,000+ freight lane pages to Webflow CMS. The primary working directory is `next-console/`.

## Repository Structure

```
webflow-seo-engine/
├── next-console/          # PRIMARY APP — Next.js 15 operator console
│   ├── lib/               # Core business logic (70+ modules)
│   ├── scripts/           # Automation scripts (80+ scripts)
│   ├── tests/             # Playwright + regression tests
│   ├── app/               # Next.js app directory (UI)
│   ├── data/              # Lane data, registries, approval ledger
│   ├── config/            # Thresholds, rules, banned content
│   ├── schemas/           # JSON Schema definitions
│   ├── manifests/         # Immutable per-run publish records
│   ├── artifacts/         # Generated reports and previews
│   └── .env.local         # Credentials (EMAIL, WEBFLOW, etc.)
├── gsc-fix-engine/        # GSC incident detection & auto-remediation (separate Next.js app)
├── dashboard/             # Static HTML dashboard (legacy)
├── data/                  # Root-level shared data files
├── scripts/               # Root-level bash orchestration
├── docs/                  # Design docs, rendering specs
└── prompts/               # Anthropic prompt templates
```

## The Lane Page Pipeline

```
buildLaneKnowledge()           → Raw lane intelligence (distance, transit, carriers, equipment)
  ↓
buildCanonicalLanePageData()   → 11-section canonical data model
  ↓
renderWebflowFields()          → Webflow CMS field payload (HTML, schema markup, meta)
  ↓
assessPublishQuality()         → 17 hard gates + 5-dimension weighted scoring
  ↓
Webflow CMS PATCH + Publish    → Live at wearewarp.com/lanes/{slug}
```

## Critical Files (next-console/)

### Core Pipeline

| File | Purpose |
|------|---------|
| `lib/lane-knowledge.js` | Lane intelligence: cities, hubs, transit bands, rates, equipment |
| `lib/lane-page-schema.js` | Canonical data model builder. 11 sections: hero → lane_overview → warp_fit → operating_details → pricing → best_fit_shipments → faqs → related_links → why_warp → final_cta → lane_relevant_cta |
| `lib/render-lane-page.js` | Dual renderer: `renderWebflowFields()` (CMS) + `renderLanePageHtml()` (static). Owns all HTML/CSS/schema generation. ~1722 lines |
| `lib/lane-page-validator.js` | All validation + `assessPublishQuality()` — 17 hard gates, returns {publishable, grade, score, gates, dimensions, errors, warnings}. ~1414 lines |
| `lib/page-quality-scorer.js` | 5-dimension weighted scoring: SEO (25%), AI Search (20%), Readability (20%), Design (15%), Conversion (20%). 621 lines |
| `lib/lane-factory.js` | Manufacturing functions, `sanitizeWebflowFields()` |
| `lib/lane-engine.js` | Lane generation & ranking, mode-specific content |

### Publishing & Approval

| File | Purpose |
|------|---------|
| `lib/approval-gate.js` | State machine: draft → ready_for_review → approved → manufactured → published_pending_verification → verified_live |
| `lib/publish-registry-disk.js` | Published pages registry (published_pages.json) |
| `lib/publish-manifest.js` | Immutable per-run manifest builder (source of truth) |
| `lib/publish-governor.js` | Rate limiting & ramp scheduling |
| `lib/uniqueness-engine.js` | Duplicate detection: Jaccard, n-gram, SimHash |
| `lib/webflow-client.js` | Webflow API wrapper |

### Key Scripts

| Script | Purpose |
|--------|---------|
| `scripts/update_lane_content.js` | **THE deployment script.** Regenerates + pushes to Webflow CMS with quality gate enforcement |
| `scripts/publish_next.js` | Publish N approved lanes (build → draft → staging → email) |
| `scripts/approve_lane.js` | Approve single/batch lanes |
| `scripts/lanes_auto_publish.js` | Autonomous publish loop |
| `scripts/verify_live_pages.js` | Live page health verification |
| `scripts/gsc_sync.js` | Sync Google Search Console data |

### Tests

| Test File | Assertions | What It Tests |
|-----------|-----------|---------------|
| `tests/lane-architecture.test.js` | 108 | Ownership boundaries, no section leakage |
| `tests/section-ownership.test.js` | 213 | Section rendering exclusively by correct functions |
| `tests/pipeline-parity.test.js` | 216 | Dual pipeline consistency (Webflow vs static) |
| `tests/quality-regression.test.js` | 199 | Quality gates, hostile bypass prevention, anti-garbage |

**Run all tests:** `cd next-console && npx playwright test tests/lane-architecture.test.js tests/section-ownership.test.js tests/pipeline-parity.test.js tests/quality-regression.test.js`

**Total: 736 assertions, 0 failures** (as of Directive 3 completion)

## Quality Gate System (assessPublishQuality)

### 17 Hard Gates (any failure blocks publish)

| Gate | What It Checks |
|------|---------------|
| QG-STRUCT-01 | All 11 canonical sections present |
| QG-STRUCT-02 | Section ordering matches CANONICAL_SECTIONS |
| QG-STRUCT-03 | No empty sections |
| QG-CONTENT-01 | Hero headline contains origin + destination |
| QG-CONTENT-02 | Minimum word counts per section |
| QG-CONTENT-03 | No placeholder/lorem text |
| QG-CONTENT-04 | Banned content phrases absent |
| QG-OWNER-01 | KPI panel rendered by renderLaneIntelligencePanel() |
| QG-OWNER-02 | Execution flow rendered by renderExecutionFlow() |
| QG-OWNER-03 | No cross-section content leakage |
| QG-SCHEMA-01 | FAQ schema valid JSON-LD |
| QG-SCHEMA-02 | Breadcrumb schema valid |
| QG-DUPLICATE-01 | Uniqueness score above threshold |
| QG-RENDER-01 | All required Webflow CMS fields present |
| QG-RENDER-02 | **Anti-garbage gate:** minimum content lengths (body ≥400, faq-schema ≥5000, intelligence-panel ≥500, execution-flow ≥500, breadcrumb ≥200) |
| QG-VEHICLE-01 | Vehicle/equipment check (SOFT — warning only, never blocks) |
| QG-QUALITY-01 | Weighted quality score ≥ 70% |

### Grading Scale
- A: ≥ 90% | B: ≥ 80% | C: ≥ 70% | D: ≥ 60% | F: < 60%
- Must score ≥ 70% (C) to publish

## Architectural Principles

1. **Deterministic outputs** — same input always produces same HTML/schema
2. **Section ownership** — each renderer owns its sections exclusively, no leakage
3. **Dual pipeline parity** — `renderWebflowFields()` and `renderLanePageHtml()` produce equivalent content
4. **Hard gates before soft scoring** — structural failures block before quality scoring runs
5. **Immutable manifests** — each publish run creates a manifest file (source of truth, not the convenience registry)
6. **ES modules** — all files use import/export, resolved via import.meta.url
7. **No process.cwd()** — all paths absolute via import.meta.url + fileURLToPath
8. **Lane archetypes** — 10 types (metro, port, agriculture, etc.) control content variation
9. **Approval ledger separate from page data** — state machine in approval_state.json

## Environment & Credentials (next-console/.env.local)

| Variable | Purpose |
|----------|---------|
| WEBFLOW_API_TOKEN | Webflow CMS API access |
| WEBFLOW_SITE_ID | Target Webflow site |
| WEBFLOW_LANE_COLLECTION_ID | Lane pages CMS collection |
| EMAIL_USER | SMTP sender (mickey@wearewarp.com) |
| EMAIL_APP_PASSWORD | Gmail app password |
| EMAIL_TO | Default recipient (troy@wearewarp.com) |

**SMTP:** smtp.gmail.com:587

## Common Commands

```bash
# Navigate to primary app
cd next-console

# Deploy a specific lane page (with quality gate)
node scripts/update_lane_content.js --slugs atlanta-to-orlando --limit 1

# Dry run (no CMS push)
node scripts/update_lane_content.js --slugs atlanta-to-orlando --dry-run

# Run all regression tests
npx playwright test tests/lane-architecture.test.js tests/section-ownership.test.js tests/pipeline-parity.test.js tests/quality-regression.test.js

# Publish next N approved lanes
node scripts/publish_next.js --count 5 --mode live

# System health check
node scripts/doctor.js

# Start dev server
npm run dev
```

## Completed Directives (Session History)

### Directive 1: Section Ownership Hardening
- Enforced exclusive rendering ownership per section
- Created section-ownership.test.js (213 assertions)

### Directive 2: Parallel Render Pipeline Hardening
- Ensured Webflow and static pipelines produce equivalent content
- Created pipeline-parity.test.js (216 assertions)

### Directive 3: Lane Page Quality Scoring & Pre-Publish Guardrails
- Built `assessPublishQuality()` — 17 hard gates + 5-dimension scoring
- Wired into update_lane_content.js (blocks publish on gate failure)
- Created quality-regression.test.js (199 assertions)
- Hostile verification found 3 bugs, all fixed:
  - BUG 1: Added QG-RENDER-02 anti-garbage gate
  - BUG 2: Fixed QG-VEHICLE-01 as explicit soft gate
  - BUG 3: Addressed by QG-RENDER-02

### Directive 4: Autonomous Execution — Atlanta to Orlando
- Generated, deployed, and verified Atlanta-to-Orlando LTL page
- Quality: 86% (B), 17/17 gates passed
- Live at: https://www.wearewarp.com/lanes/atlanta-to-orlando
- Email confirmation sent to troy@wearewarp.com

## Live Site

- **Base URL:** https://www.wearewarp.com
- **Lane pages:** https://www.wearewarp.com/lanes/{origin}-to-{destination}
- **Quote CTA:** https://www.wearewarp.com/quote
- **Book CTA:** https://www.wearewarp.com/book

## GitHub

- **Remote:** https://github.com/troy-lgtm/webflow-seo-engine.git
- **Branch:** main
