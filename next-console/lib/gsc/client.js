/**
 * Google Search Console API Client
 *
 * OAuth 2.0 authenticated client with:
 * - Token refresh
 * - Retry with exponential backoff
 * - Response validation
 * - Dimension support (date, page, query, country, device)
 * - Row limit handling (GSC caps at 25,000 rows per request)
 */

const GSC_API_BASE = "https://www.googleapis.com/webmasters/v3";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_ROWS_PER_REQUEST = 25000;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// ── Token management ─────────────────────────────────────────────────

let _cachedToken = null;
let _tokenExpiresAt = 0;

/**
 * Get a valid access token, refreshing if needed.
 */
async function getAccessToken() {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiresAt - 60000) {
    return _cachedToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "[gsc-client] Missing OAuth credentials.\n" +
      "  Required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN\n" +
      "  See docs/gsc-setup.md for setup instructions."
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[gsc-client] Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  _cachedToken = data.access_token;
  _tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}

// ── Retry wrapper ────────────────────────────────────────────────────

async function fetchWithRetry(url, options, attempt = 1) {
  try {
    const res = await fetch(url, options);

    // Rate limit or server error — retry
    if ((res.status === 429 || res.status >= 500) && attempt <= MAX_RETRIES) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.log(`[gsc-client] HTTP ${res.status}, retrying in ${backoff}ms (attempt ${attempt}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchWithRetry(url, options, attempt + 1);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[gsc-client] API error (${res.status}): ${text}`);
    }

    return res.json();
  } catch (err) {
    if (attempt <= MAX_RETRIES && err.code === "ECONNRESET") {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.log(`[gsc-client] Connection reset, retrying in ${backoff}ms (attempt ${attempt}/${MAX_RETRIES})`);
      await sleep(backoff);
      return fetchWithRetry(url, options, attempt + 1);
    }
    throw err;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Core API methods ─────────────────────────────────────────────────

/**
 * Get the configured site URL from env.
 */
export function getSiteUrl() {
  const url = process.env.GSC_SITE_URL;
  if (!url) {
    throw new Error(
      "[gsc-client] GSC_SITE_URL not set.\n" +
      "  Format: 'sc-domain:example.com' (domain property) or 'https://example.com/' (URL prefix)\n" +
      "  See docs/gsc-setup.md for details."
    );
  }
  return url;
}

/**
 * List available Search Console properties.
 */
export async function listSites() {
  const token = await getAccessToken();
  return fetchWithRetry(`${GSC_API_BASE}/sites`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Query Search Analytics data.
 *
 * @param {object} params
 * @param {string} params.siteUrl - GSC property URL
 * @param {string} params.startDate - YYYY-MM-DD
 * @param {string} params.endDate - YYYY-MM-DD
 * @param {string[]} params.dimensions - ['date', 'page', 'query', 'country', 'device']
 * @param {string} [params.searchType='web'] - web | image | video | news
 * @param {object[]} [params.dimensionFilterGroups] - GSC filter groups
 * @param {number} [params.rowLimit=25000] - Max rows (capped at 25000)
 * @param {number} [params.startRow=0] - Pagination offset
 * @returns {Promise<{ rows: object[], responseAggregationType: string }>}
 */
export async function querySearchAnalytics({
  siteUrl,
  startDate,
  endDate,
  dimensions = ["date"],
  searchType = "web",
  dimensionFilterGroups,
  rowLimit = MAX_ROWS_PER_REQUEST,
  startRow = 0,
}) {
  const token = await getAccessToken();
  const encodedUrl = encodeURIComponent(siteUrl);

  const body = {
    startDate,
    endDate,
    dimensions,
    searchType,
    rowLimit: Math.min(rowLimit, MAX_ROWS_PER_REQUEST),
    startRow,
    dataState: "final",
  };

  if (dimensionFilterGroups) {
    body.dimensionFilterGroups = dimensionFilterGroups;
  }

  const data = await fetchWithRetry(
    `${GSC_API_BASE}/sites/${encodedUrl}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  return validateSearchAnalyticsResponse(data, dimensions);
}

/**
 * Query all rows for a date range (handles pagination).
 * GSC returns max 25,000 rows per request. This fetches all pages.
 */
export async function queryAllRows(params) {
  const allRows = [];
  let startRow = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await querySearchAnalytics({
      ...params,
      startRow,
      rowLimit: MAX_ROWS_PER_REQUEST,
    });

    if (!result.rows || result.rows.length === 0) {
      hasMore = false;
    } else {
      allRows.push(...result.rows);
      startRow += result.rows.length;
      // If we got fewer than max, we're done
      hasMore = result.rows.length >= MAX_ROWS_PER_REQUEST;
      if (hasMore) {
        console.log(`[gsc-client] Fetched ${allRows.length} rows so far, fetching more...`);
        await sleep(200); // Be polite to the API
      }
    }
  }

  return { rows: allRows, responseAggregationType: "byPage" };
}

// ── Response validation ──────────────────────────────────────────────

function validateSearchAnalyticsResponse(data, dimensions) {
  if (!data || typeof data !== "object") {
    throw new Error("[gsc-client] Invalid response: expected object");
  }

  const rows = data.rows || [];
  const validated = [];

  for (const row of rows) {
    // Validate keys array matches dimensions
    if (!Array.isArray(row.keys) || row.keys.length !== dimensions.length) {
      console.warn("[gsc-client] Skipping row with mismatched keys", row);
      continue;
    }

    // Validate metrics are numbers
    const clicks = Number(row.clicks) || 0;
    const impressions = Number(row.impressions) || 0;
    const ctr = Number(row.ctr) || 0;
    const position = Number(row.position) || 0;

    const parsed = {
      clicks,
      impressions,
      ctr: Math.round(ctr * 10000) / 10000, // 4 decimal places
      position: Math.round(position * 100) / 100, // 2 decimal places
    };

    // Map keys to dimension names
    for (let i = 0; i < dimensions.length; i++) {
      parsed[dimensions[i]] = row.keys[i];
    }

    validated.push(parsed);
  }

  return {
    rows: validated,
    responseAggregationType: data.responseAggregationType || "auto",
  };
}

// ── Test/mock support ────────────────────────────────────────────────

/**
 * Reset token cache (for testing).
 */
export function _resetTokenCache() {
  _cachedToken = null;
  _tokenExpiresAt = 0;
}

export { MAX_ROWS_PER_REQUEST };
