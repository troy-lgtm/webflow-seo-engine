# Staging Preview Test

Verify that Webflow staging preview URLs are live (HTTP 200, not a soft-404) after publishing.

## Key Rule: Email Only After Verified Preview

**The approval email is NEVER sent unless the staging preview URL is verified live.**

- `npm run ship:firstpage` → dry run, artifacts only, **no email**
- `npm run ship:firstpage:staging` → create draft → publish item → publish staging → verify URL (60s) → **email only if verified**
- If staging verification fails within 60s → exit 1, diagnostic `run_log.json`, **no email**

## Prerequisites Checklist

1. **Create a Lanes Collection Template Page in Webflow Designer**
   - Webflow Designer → Pages → "Create Collection Template Page" → select "Lanes"
   - This is **required** — without it, all staging URLs will return a soft-404
   - The template path is auto-detected from the Webflow Pages API

2. **Set required env vars** in `.env.local`:
   ```
   WEBFLOW_API_TOKEN=...
   WEBFLOW_SITE_ID=...
   WEBFLOW_LANE_COLLECTION_ID=...
   EMAIL_USER=...
   EMAIL_APP_PASSWORD=...
   EMAIL_TO=...
   ```

3. **Optional override** — if auto-detection doesn't find the right path:
   ```
   WEBFLOW_LANES_TEMPLATE_PATH=/lanes
   ```

## How It Works

The staging URL is built as:

```
https://<shortName>.webflow.io/<template-path>/<item-slug>
```

**Detection order:**

1. **Env override** — if `WEBFLOW_LANES_TEMPLATE_PATH` is set, use it exclusively
2. **API auto-detection** — `GET /v2/sites/{siteId}/pages` → match `collectionId` → extract `publishedPath`
3. **Hardcoded fallbacks** — probes 7 candidate paths:
   - `/lanes`, `/lane`, `/lane-pages`, `/lane-page`, `/ltl-lanes`, `/resources/lanes`, `/logistics/lanes`
4. **Validation** — each candidate is checked for:
   - HTTP 200 status
   - Body does NOT contain soft-404 markers (`"This Page Has Moved or Does Not Exist"`, `"Page not found"`)
   - Body DOES contain at least one positive content marker (`"Book Freight Instantly"`, `"Freight Quotes"`, `"Get Instant Quote"`, `"WARP"`, or the origin→destination string)

**Verification timeout:** 60 seconds (30 retries × 2s intervals)

If no working URL is found:
- The pipeline **refuses to send the approval email**
- Prints a diagnostic table of all URLs tried with their HTTP status and soft-404 marker
- Writes `run_log.json` with `urlsTried` array and error message
- Exits with code 1

## Commands

### Full end-to-end: ship + staging publish + verify + email

```bash
npm run ship:firstpage:staging
```

This runs:
1. `ship:firstpage --live --publish-staging` — creates Webflow draft, publishes item, publishes site to staging subdomain, auto-detects template path, verifies URL is real (60s timeout), sends email **only if verified**
2. `test:staging-preview` — reads the newest job, GETs the staging URL with retries (up to 60s), passes on HTTP 200 with real content

### Dry run (safe, no email)

```bash
npm run ship:firstpage
```

Generates all artifacts (preview HTML, Webflow payload, email HTML) but makes **no API calls** and sends **no email**. The `email_payload.json` will contain `"email_skipped": true`.

### Standalone staging URL check

```bash
npm run test:staging-preview
```

Reads `data/approval_jobs.json`, extracts `staging_url` from the newest job, and performs an HTTP GET with up to 30 retries (2s apart, 60s max). Checks body for soft-404 markers.

## What PASS looks like

```
=== WARP Ship First Page ===
  Webflow: LIVE DRAFT
  Staging: WILL PUBLISH to staging subdomain
  Email:   WILL SEND (after staging URL verified)

  ...
  Detect CMS template path from API...
    Found CMS template page: "Lanes" → /lanes (page abc123)
  OK
  Publish to Webflow staging...
    Staging domain: untitled-ui-site-573f0e.webflow.io
    Detected template path (API): /lanes
    Probing: https://untitled-ui-site-573f0e.webflow.io/lanes/chicago-to-dallas
    HTTP 200 ✓ (attempt 3)
  OK
  Send approval email (staging verified)...
  EMAIL SENT: <abc123@smtp.gmail.com> to troy@wearewarp.com
  OK
  ...

=== WARP Staging Preview Test ===

  STAGING_URL=https://untitled-ui-site-573f0e.webflow.io/lanes/chicago-to-dallas
  HTTP_STATUS=200

  PASS: Staging preview is live and returns HTTP 200.
```

## What FAIL looks like

### No Collection Template page (all soft-404)

```
  ╔══════════════════════════════════════════════════════════════════════╗
  ║  FATAL: No CMS Collection Template page found for Lanes            ║
  ╚══════════════════════════════════════════════════════════════════════╝

  URLs tried:
    /lanes → HTTP 200 (soft-404: "This Page Has Moved or Does Not Exist")
      https://untitled-ui-site-573f0e.webflow.io/lanes/chicago-to-dallas
    /lane → HTTP 200 (soft-404: "This Page Has Moved or Does Not Exist")
    ...

  ➜ Create a Lanes Template Page in Webflow Designer:
    Pages → Create Collection Template Page → Lanes
  ➜ Then re-run: npm run ship:firstpage:staging

  Email NOT sent — no verified staging preview URL.
```

**Fix**: Open Webflow Designer → Pages → "Create Collection Template Page" → select "Lanes". Then re-run.

### Missing staging_url (dry run)

```
  No staging URL — email was NOT sent.
  Dry run — no external API calls were made.
  To publish and email: npm run ship:firstpage:staging
```

**Fix**: Run with staging:
```bash
npm run ship:firstpage:staging
```

### HTTP 401/403

```
  FAIL: HTTP 401/403. Staging might be disabled or unpublished.
```

**Fix**: Enable the staging subdomain in Webflow Dashboard → Site Settings → Publishing.

## Safety

- `--publish-staging` publishes to the Webflow staging subdomain (`.webflow.io`) only
- Production domains (`wearewarp.com`) are never touched
- `--publish-staging` is never triggered by `--live` alone; it must be explicitly passed
- **Email is NEVER sent unless the staging URL returns HTTP 200 with real content**
- Default `npm run ship:firstpage` (no flags) is a complete dry run — no API calls, no email
- `test:staging-preview` is read-only (HTTP GET only, no mutations)
- Verification timeout: 60s (30 retries × 2s)
