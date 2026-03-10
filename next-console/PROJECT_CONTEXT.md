# WARP SEO Console — Project Context

## What This Is
A Next.js 15.5 operator console for WARP (a freight logistics company). It generates SEO-optimized lane pages at scale — every combination of origin × destination × mode × segment gets a unique, publish-ready page with structured data, FAQ schema, LLM-optimized snippets, and conversion CTAs.

## Stack
- Next.js 15.5.12, React 19, vanilla CSS (no Tailwind)
- Playwright e2e tests (5 passing)
- No database — client-side state + localStorage + JSON/CSV export
- Design system: dark theme, Space Grotesk + JetBrains Mono, accent green #00FF33

## Key URLs (local dev)
- Dashboard: http://localhost:3000
- Builder: http://localhost:3000/builder

## Architecture

### Pages
- `app/page.js` — Dashboard: pipeline metrics, optimization backlog, recent pages, progress bar
- `app/builder/page.js` — Builder: lane generation, live preview, queue management, export, self-learning suggestions

### Core Logic
- `lib/lane-engine.js` — Lane combo generation, weighted ranking, unique content per page (mode-specific + segment-specific), FAQ/schema/snippet generation, CSV export, publish-readiness checks, self-learning suggestion engine
- `lib/dashboard-data.js` — Dashboard seed data + initial builder config

### Design
- `app/globals.css` — Full design system aligned with DESIGN_SYSTEM_HANDOFF 2.md (Warp Upload Portal tokens)
- `app/layout.js` — Font loading, root theme

## Builder Workflow
1. Configure origins, destinations, mode (LTL/FTL/Shared), segment (SMB/Enterprise/Midmarket)
2. Generate ranked lane combos (weighted by volume, value, win rate, strategic priority)
3. Preview live pages with unique H1, intro, FAQ, flow diagram, value cards
4. Edit any field inline
5. Export queue as JSON or CSV manifest
6. Run flow check (7 automated validations)
7. Check publish readiness (12 checks per page)

## SEO Output Per Page
- Unique seo_title, meta_description, h1, intro, proof_section
- Mode-specific visual cards and problem/solution copy
- 5 lane-specific FAQ entries with full Schema.org FAQPage JSON-LD
- 3 LLM direct-answer snippets per lane
- Mermaid workflow diagram
- Comparison table markdown

## Conversion Instrumentation
- `data-warp-event` attributes on all CTAs (GTM/Clarity-ready)
- `data-warp-funnel` step tracking on builder workflow
- `data-warp-section` on all major UI sections
- Self-learning suggestions panel: input conversion metrics → get prioritized copy/layout recommendations

## File Map
```
app/
  layout.js          — Root layout, fonts, theme
  page.js            — Dashboard
  globals.css        — Design system
  builder/page.js    — Builder (client component)
lib/
  lane-engine.js     — Core business logic
  dashboard-data.js  — Seed data
tests/
  dashboard-builder.spec.js — 5 e2e tests
```

## Running
```bash
npm run dev          # Start dev server on :3000
npm run build        # Production build
npm run test:e2e     # Run Playwright tests
```
