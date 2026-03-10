# Google Search Console Setup

## 1. Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or select an existing one
3. Enable the **Search Console API** (APIs & Services → Library → search "Search Console API")
4. Go to **APIs & Services → Credentials**
5. Click **Create Credentials → OAuth client ID**
6. Application type: **Web application**
7. Add authorized redirect URI: `http://localhost:3000/oauth/callback` (or your callback URL)
8. Copy the **Client ID** and **Client Secret**

## 2. Get a Refresh Token

Use the OAuth 2.0 Playground or a one-time script:

### Option A: OAuth Playground (quickest)

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
2. Click the gear icon → check "Use your own OAuth credentials"
3. Enter your Client ID and Client Secret
4. In Step 1, select scope: `https://www.googleapis.com/auth/webmasters.readonly`
5. Click "Authorize APIs" and sign in with your Google account
6. In Step 2, click "Exchange authorization code for tokens"
7. Copy the **Refresh Token**

### Option B: CLI script

```bash
# Install googleapis temporarily
npx -y google-auth-library

# Follow the browser flow to get a refresh token
# Copy the refresh_token from the output
```

## 3. Find Your Search Console Property URL

Go to [Search Console](https://search.google.com/search-console) and note your property format:

- **Domain property**: `sc-domain:wearewarp.com` (recommended)
- **URL prefix**: `https://www.wearewarp.com/`

## 4. Set Environment Variables

Add to `.env.local`:

```env
# Google OAuth (required)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REFRESH_TOKEN=your-refresh-token

# Search Console (required)
GSC_SITE_URL=sc-domain:wearewarp.com

# BigQuery (optional — for bulk export later)
# BIGQUERY_PROJECT_ID=your-gcp-project
# BIGQUERY_DATASET=searchconsole
```

## 5. Verify Setup

```bash
# List available properties (verifies OAuth works)
npm run gsc:list-sites

# Dry run sync (shows what would happen)
npm run gsc:sync -- --dry-run
```

## 6. First Sync

```bash
# Sync yesterday's data
npm run gsc:sync:yesterday

# Backfill last 30 days
npm run gsc:backfill:30d

# Custom date range
npm run gsc:backfill -- --start=2026-01-01 --end=2026-03-01
```

## 7. Verify Data Landed

```bash
# Check row counts
curl http://localhost:3000/api/seo/gsc?view=stats

# View the dashboard
open http://localhost:3000/internal/seo-progress
```

## 8. Daily Sync (Cron)

Add to your crontab or CI:

```bash
# Daily at 8am UTC — sync yesterday + refresh last 3 days
0 8 * * * cd /path/to/next-console && npm run gsc:sync:refresh
```

Or use the built-in commands:

```bash
npm run gsc:sync:yesterday    # Yesterday only
npm run gsc:sync:refresh      # Rolling 3-day refresh (catches GSC lag)
npm run gsc:backfill:7d       # Last 7 days
npm run gsc:backfill:30d      # Last 30 days
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `npm run gsc:sync:yesterday` | Sync yesterday's data |
| `npm run gsc:sync:refresh` | Rolling 3-day refresh |
| `npm run gsc:backfill:7d` | Backfill last 7 days |
| `npm run gsc:backfill:30d` | Backfill last 30 days |
| `npm run gsc:backfill -- --start=YYYY-MM-DD --end=YYYY-MM-DD` | Custom range |
| `npm run gsc:sync -- --skip-page-query` | Skip page-query level (faster) |
| `npm run gsc:sync -- --dry-run` | Preview without fetching |
| `npm run gsc:list-sites` | List GSC properties |

## API Endpoints

All endpoints: `GET /api/seo/gsc?view=...`

| View | Description |
|------|-------------|
| `summary` | Site summary (7d, 28d, 90d) |
| `pages` | Page leaderboard (gaining/losing) |
| `queries` | Query leaderboard |
| `page-detail&page=URL` | Daily trend for a page |
| `query-detail&query=TEXT` | Daily trend for a query |
| `priority` | Priority page performance |
| `branded` | Branded vs non-branded |
| `new-queries` | Newly appearing queries |
| `position-movers` | Position changers |
| `rising-flat` | Rising impressions, flat clicks |
| `rolling` | Rolling 7d/28d metrics |
| `stats` | Table row counts |

Optional params: `&days=7|28|90`, `&limit=20`

## Common Failure Cases

| Error | Solution |
|-------|----------|
| Token refresh failed (401) | Refresh token expired — re-run OAuth flow |
| Missing OAuth credentials | Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN |
| GSC_SITE_URL not set | Add GSC_SITE_URL to .env.local |
| No data returned | GSC data has 2-3 day lag — try older dates |
| 429 rate limit | Built-in retry handles this, but reduce concurrency if persistent |
| Permission denied | Ensure OAuth account has access to the GSC property |

## BigQuery Bulk Export (Future)

When ready to use BigQuery as the data source:

1. Set up [Search Console bulk data export](https://support.google.com/webmasters/answer/7576553) in GSC settings
2. Set `BIGQUERY_PROJECT_ID` and `BIGQUERY_DATASET` env vars
3. The system will automatically prefer BigQuery over API ingestion
4. Implement the `SearchConsoleBigQueryDataSource` class in `lib/gsc/data-source.js`

## Data Storage

Data is stored as JSON files in `data/gsc/`:

- `gsc_daily_site_metrics.json`
- `gsc_daily_page_metrics.json`
- `gsc_daily_query_metrics.json`
- `gsc_daily_page_query_metrics.json`

All writes are idempotent upserts. Re-running sync for the same dates is safe.
