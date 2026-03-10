# Approval Safety

## Core Principle

**No page is published without an explicit "yes" reply.**

The system defaults to safe. Every Webflow CMS item starts as a draft. Publication requires a human approval signal that flows through a verified webhook with a shared secret.

## How the Approval Loop Works

```
ship:firstpage → Webflow DRAFT → Email with preview → Troy replies
                                                          ↓
                                              ┌──── "yes" ────→ Publish item
                                              │
                                              └── "no edit: ..." → Apply edits
                                                                    → Update draft
                                                                    → Email new preview
                                                                    → Wait for reply again
```

## Safety Guards

### 1. No Auto-Publish

- The `ship:firstpage` command creates a **draft only** — never publishes
- The approval webhook only publishes when `action: "approve"` is received with a valid secret
- There is no timer, no auto-approve, no batch publish without review

### 2. Duplicate Gate

Every page passes through the duplicate gate before drafting:

- Checks `data/published_pages.json` for conflicts on 5 fields:
  - `slug` — exact match
  - `canonical_path` — exact match
  - `seo_title` — case-insensitive match
  - `h1` — case-insensitive match
  - `intro` — first 200 characters, case-insensitive match
- If any match is found, the ship command **exits with code 1** and does not proceed
- After approval and publish, the page is added to `published_pages.json` to prevent future duplicates

### 3. Webhook Authentication

- Every POST to `/api/approval` must include a `secret` field
- The secret is validated against `APPROVAL_WEBHOOK_SECRET` in `.env.local`
- Invalid or missing secrets return **401 Unauthorized**
- The secret is never logged, committed, or included in email content

### 4. Immutable Fields

The edit applier **never changes**:
- `slug`
- `canonical_path`
- Structured data schemas (FAQ, breadcrumbs)

These are set at generation time and remain fixed through the approval loop.

### 5. Estimate Labeling

All pricing and transit data is always presented as:
- "Estimated" or "approximate" ranges
- Never exact figures
- Always accompanied by disclaimers

## Rotating Secrets

### Webhook Secret (APPROVAL_WEBHOOK_SECRET)

1. Generate a new secret: `openssl rand -hex 32`
2. Update `.env.local`: `APPROVAL_WEBHOOK_SECRET=<new-value>`
3. Update the Google Apps Script property: `WEBHOOK_SECRET` → same new value
4. Restart the Next.js server

### Webflow API Token (WEBFLOW_API_TOKEN)

1. Go to Webflow Dashboard → Account → Integrations → API Access
2. Generate a new token with CMS write permissions
3. Update `.env.local`: `WEBFLOW_API_TOKEN=<new-token>`
4. Revoke the old token in Webflow

### Gmail App Password (EMAIL_APP_PASSWORD)

1. Go to Google Account → Security → 2-Step Verification → App passwords
2. Delete the old app password
3. Create a new one for "Mail"
4. Update `.env.local`: `EMAIL_APP_PASSWORD=<new-password>`

## Environment Variables Reference

| Variable | Purpose | Where to set |
|----------|---------|-------------|
| `EMAIL_USER` | Gmail address for sending | `.env.local` |
| `EMAIL_APP_PASSWORD` | Gmail app password | `.env.local` |
| `EMAIL_TO` | Recipient email (Troy) | `.env.local` |
| `WEBFLOW_API_TOKEN` | Webflow API v2 token | `.env.local` |
| `WEBFLOW_SITE_ID` | Webflow site identifier | `.env.local` |
| `WEBFLOW_LANE_COLLECTION_ID` | CMS collection for lane pages | `.env.local` |
| `APPROVAL_WEBHOOK_SECRET` | Shared secret for webhook auth | `.env.local` + Apps Script |
| `PUBLIC_WEBHOOK_BASE_URL` | Public URL for webhook callbacks | `.env.local` + Apps Script |

## Dry Run Mode

- `npm run ship:firstpage` runs in **dry run mode** by default
- Dry run creates artifacts in `artifacts/ship/` but makes no API calls
- Use `npm run ship:firstpage -- --live` for real API calls
- Dry run jobs are marked `dry_run: true` in `approval_jobs.json`
- The webhook respects the job's `dry_run` flag and skips real API calls accordingly

## Audit Trail

Every action is recorded in `data/approval_jobs.json`:

```json
{
  "approval_id": "uuid",
  "webflow_item_id": "...",
  "status": "awaiting_reply | approved | editing",
  "created_at": "ISO timestamp",
  "last_sent_at": "ISO timestamp",
  "last_edit_instructions": "...",
  "approved_at": "ISO timestamp (if approved)"
}
```
