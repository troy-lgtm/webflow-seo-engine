# Smoke Test — First Publish Flow

## Quick Start

```bash
# Dry run (no email, no Webflow API calls)
npm run smoke:firstpage
```

This generates artifacts in `artifacts/smoke/`:
- `preview.html` — Mobile-friendly page preview
- `email_payload.json` — What the email would contain
- `webflow_payload.json` — What the Webflow API call would look like

## Setting Up for Real Email

1. Create `.env.local` in the project root:
```
EMAIL_USER=your-email@gmail.com
EMAIL_APP_PASSWORD=your-gmail-app-password
EMAIL_TO=reviewer@example.com
```

2. Generate a Gmail App Password:
   - Go to Google Account → Security → 2-Step Verification → App passwords
   - Create a new app password for "Mail"

3. Run with real email:
```bash
npm run smoke:firstpage:send-email
```

## Setting Up for Webflow Draft

1. Add to `.env.local`:
```
WEBFLOW_API_TOKEN=your-webflow-api-token
WEBFLOW_SITE_ID=your-site-id
WEBFLOW_LANE_COLLECTION_ID=your-lane-collection-id
```

2. Run with real Webflow draft:
```bash
npm run smoke:firstpage:webflow-draft
```

This creates a draft item in Webflow CMS. It does **not** publish.

## Reviewing Preview on Mobile

1. Run `npm run smoke:firstpage` to generate the preview
2. Open `artifacts/smoke/preview.html` in a browser
3. Use Chrome DevTools → Toggle Device Toolbar → iPhone 12/13
4. Verify:
   - Quick Answer block visible above fold
   - CTA buttons full-width on mobile
   - FAQ section readable
   - All rates labeled as estimates
   - Disclaimer visible

Alternatively, start the dev server and visit `/preview`:
```bash
npm run dev
# Open http://localhost:3000/preview
```

## Confirming No Duplicates

```bash
npm run dupcheck:first-lane
```

This checks `data/published_pages.json` for existing entries matching:
- Canonical: `/ltl-freight-chicago-to-dallas`
- Slug: `ltl-freight-chicago-to-dallas`
- SEO title (exact match)
- H1 (exact match)
- Intro first 200 chars (exact match)

Exit code 0 = safe. Exit code 1 = duplicate found.

## Building the Full Lane Package

```bash
npm run build:first-lane
```

This writes 9 files to `docs/first_publish_chicago_to_dallas_ltl_webflow/`:
- `webflow_page_spec.md`
- `page_copy.md`
- `faq_schema.json`
- `breadcrumbs_schema.json`
- `og_meta.md`
- `mobile_first_layout.md`
- `internal_links.md`
- `qa_checklist.md`
- `content_fingerprint.txt`

## Full Integration Test Flow

```bash
# 1. Build the package
npm run build:first-lane

# 2. Check for duplicates
npm run dupcheck:first-lane

# 3. Run smoke test (dry run)
npm run smoke:firstpage

# 4. Review preview.html locally

# 5. When ready, send email for review
npm run smoke:firstpage:send-email

# 6. When approved, create Webflow draft
npm run smoke:firstpage:webflow-draft

# 7. Review draft in Webflow, then manually publish
```

## npm Scripts Reference

| Command | Description |
|---------|-------------|
| `npm run smoke:firstpage` | Dry run smoke test |
| `npm run smoke:firstpage:send-email` | Smoke test + send real email |
| `npm run smoke:firstpage:webflow-draft` | Smoke test + create Webflow draft |
| `npm run build:first-lane` | Build lane package docs |
| `npm run dupcheck:first-lane` | Check for duplicates |
