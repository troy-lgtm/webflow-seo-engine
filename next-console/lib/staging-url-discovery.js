/**
 * Staging URL Discovery
 *
 * Probes candidate Webflow CMS collection template paths to find the one
 * that actually renders the CMS item (HTTP 200 + no soft-404 markers).
 *
 * Usage:
 *   import { discoverWorkingStagingUrl } from "../lib/staging-url-discovery.js";
 *   const result = await discoverWorkingStagingUrl({ shortName, itemSlug });
 */

const FATAL_MESSAGE =
  "No Webflow CMS Collection Template page is rendering Lanes items. " +
  "Create a Lanes Template Page in Webflow Designer " +
  "(Pages → Create Collection Template Page → Lanes) and re-run.";

/** Markers that indicate a Webflow soft-404 page */
const SOFT_404_MARKERS = [
  "This Page Has Moved or Does Not Exist",
  "Page not found",
];

/**
 * Positive content markers — at least one must appear in the body
 * for us to consider the page as "real" (not a blank shell or error page).
 * This catches cases where the page returns HTTP 200 and has no soft-404
 * marker, but still renders a blank or generic template.
 */
const POSITIVE_CONTENT_MARKERS = [
  "Book Freight Instantly",
  "Freight Quotes",
  "Get Instant Quote",
  "WARP",
];

/** Candidate template paths to probe (order = priority) */
const CANDIDATE_PATHS = [
  "/lanes",
  "/lane",
  "/lane-pages",
  "/lane-page",
  "/ltl-lanes",
  "/resources/lanes",
  "/logistics/lanes",
];

/**
 * Custom error thrown when no working staging URL can be found.
 * Carries urlsTried diagnostic array for run_log.json.
 */
class StagingDiscoveryError extends Error {
  /**
   * @param {string} message
   * @param {{ path: string, url: string, status: number, isSoft404: boolean }[]} urlsTried
   */
  constructor(message, urlsTried) {
    super(message);
    this.name = "StagingDiscoveryError";
    this.urlsTried = urlsTried;
  }
}

/**
 * Probe a single URL.
 * Returns { status, isSoft404, hasPositiveContent, url, markerMatched, positiveMarkerFound }
 *
 * @param {string} url
 * @param {string[]} [positiveMarkers] - optional extra positive markers (e.g. origin/destination string)
 */
async function probeUrl(url, positiveMarkers) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "WARP-SEO-Engine/1.0",
        Accept: "text/html",
      },
      redirect: "follow",
    });
    const status = res.status;
    let isSoft404 = false;
    let markerMatched = null;
    let hasPositiveContent = false;
    let positiveMarkerFound = null;

    if (status === 200) {
      const body = await res.text();
      // Check for soft-404 markers
      for (const marker of SOFT_404_MARKERS) {
        if (body.includes(marker)) {
          isSoft404 = true;
          markerMatched = marker;
          break;
        }
      }
      // Check for positive content markers (only if not already soft-404)
      if (!isSoft404) {
        const allPositive = [...POSITIVE_CONTENT_MARKERS, ...(positiveMarkers || [])];
        for (const marker of allPositive) {
          if (body.includes(marker)) {
            hasPositiveContent = true;
            positiveMarkerFound = marker;
            break;
          }
        }
        // If HTTP 200, no soft-404, but no positive content → treat as soft-404
        if (!hasPositiveContent) {
          isSoft404 = true;
          markerMatched = "No positive content marker found (blank or generic page)";
        }
      }
    }

    return { status, isSoft404, hasPositiveContent, url, markerMatched, positiveMarkerFound };
  } catch {
    return { status: 0, isSoft404: false, hasPositiveContent: false, url, markerMatched: null, positiveMarkerFound: null };
  }
}

/**
 * Probe with retries (handles Webflow publish propagation delay).
 * @param {string} url
 * @param {number} maxRetries
 * @param {number} delayMs
 * @param {string[]} [positiveMarkers] - extra positive markers
 * @returns {Promise<{ status: number, isSoft404: boolean, hasPositiveContent: boolean, url: string, markerMatched: string|null, positiveMarkerFound: string|null, attempt: number }>}
 */
async function probeWithRetry(url, maxRetries = 15, delayMs = 2000, positiveMarkers) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await probeUrl(url, positiveMarkers);
    if (result.status === 200 && !result.isSoft404) {
      return { ...result, attempt };
    }
    if (attempt < maxRetries) {
      console.log(
        `    Attempt ${attempt}/${maxRetries}: HTTP ${result.status}${result.isSoft404 ? ` (soft-404: ${result.markerMatched})` : ""}, retrying in ${delayMs / 1000}s...`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    } else {
      return { ...result, attempt };
    }
  }
}

/**
 * Discover the working staging URL for a CMS item.
 *
 * Priority order:
 *   1. overridePath (env var WEBFLOW_LANES_TEMPLATE_PATH) — if set, use ONLY this, fail if it doesn't work
 *   2. detectedPath (from Webflow Pages API, collectionId match) — probe first
 *   3. CANDIDATE_PATHS hardcoded fallbacks — probe each in order
 *
 * @param {object} opts
 * @param {string} opts.shortName   - Webflow site shortName (e.g. "untitled-ui-site-573f0e")
 * @param {string} opts.itemSlug    - CMS item slug (e.g. "chicago-to-dallas")
 * @param {string} [opts.overridePath] - Manual template path override (env var) — exclusive, no fallback
 * @param {string} [opts.detectedPath] - Template path auto-detected from Webflow Pages API
 * @param {number} [opts.maxRetries]   - Max retries per URL (default 15 = 30s)
 * @param {number} [opts.retryDelayMs] - Delay between retries (default 2000ms)
 * @param {string[]} [opts.positiveMarkers] - Extra positive content markers (e.g. origin/destination string)
 * @returns {Promise<{ url: string, templatePath: string, source: string }>}
 * @throws {StagingDiscoveryError} when no working URL is found
 */
export async function discoverWorkingStagingUrl({
  shortName,
  itemSlug,
  overridePath,
  detectedPath,
  maxRetries = 15,
  retryDelayMs = 2000,
  positiveMarkers,
}) {
  const domain = `${shortName}.webflow.io`;
  const urlsTried = [];

  // 1. If manual override is set, use ONLY that (no fallback)
  if (overridePath) {
    let p = overridePath.replace(/\/+$/, "");
    if (!p.startsWith("/")) p = "/" + p;
    const url = `https://${domain}${p}/${itemSlug}`;
    console.log(`    Override path (env): ${p}`);
    console.log(`    Probing: ${url}`);
    const result = await probeWithRetry(url, maxRetries, retryDelayMs, positiveMarkers);
    urlsTried.push({ path: p, url, status: result.status, isSoft404: result.isSoft404, markerMatched: result.markerMatched });

    if (result.status === 200 && !result.isSoft404) {
      console.log(`    HTTP 200 ✓ (attempt ${result.attempt})`);
      return { url, templatePath: p, source: "env override" };
    }
    console.log(`    HTTP ${result.status}${result.isSoft404 ? " (soft-404)" : ""} ✗ after ${result.attempt} attempts`);
    printDiagnostic(urlsTried);
    throw new StagingDiscoveryError(FATAL_MESSAGE, urlsTried);
  }

  // 2. If API-detected path is available, probe it FIRST (highest confidence)
  if (detectedPath) {
    let p = detectedPath.replace(/\/+$/, "");
    if (!p.startsWith("/")) p = "/" + p;
    const url = `https://${domain}${p}/${itemSlug}`;
    console.log(`    Detected template path (API): ${p}`);
    console.log(`    Probing: ${url}`);
    const result = await probeWithRetry(url, maxRetries, retryDelayMs, positiveMarkers);
    urlsTried.push({ path: p, url, status: result.status, isSoft404: result.isSoft404, markerMatched: result.markerMatched, source: "webflow-api" });

    if (result.status === 200 && !result.isSoft404) {
      console.log(`    ✓ API-detected path works: ${p} (attempt ${result.attempt})`);
      return { url, templatePath: p, source: `detected via API "${p}"` };
    }
    console.log(`    ✗ API-detected path ${p} → HTTP ${result.status}${result.isSoft404 ? " (soft-404)" : ""} — trying fallback candidates...`);
  }

  // 3. Probe each hardcoded candidate path (skip if already tried via detectedPath)
  console.log("    Discovering template path (fallback candidates)...");
  const alreadyTried = urlsTried.map((u) => u.path);

  for (const candidatePath of CANDIDATE_PATHS) {
    if (alreadyTried.includes(candidatePath)) continue; // skip duplicates
    const url = `https://${domain}${candidatePath}/${itemSlug}`;
    console.log(`    Probing: ${url}`);
    const result = await probeWithRetry(url, maxRetries, retryDelayMs, positiveMarkers);
    urlsTried.push({ path: candidatePath, url, status: result.status, isSoft404: result.isSoft404, markerMatched: result.markerMatched });

    if (result.status === 200 && !result.isSoft404) {
      console.log(`    ✓ Working path found: ${candidatePath} (attempt ${result.attempt})`);
      console.log(`    Tip: Set WEBFLOW_LANES_TEMPLATE_PATH=${candidatePath} in .env.local to skip discovery next time.`);
      return { url, templatePath: candidatePath, source: `discovered "${candidatePath}"` };
    }
    console.log(`    ✗ ${candidatePath} → HTTP ${result.status}${result.isSoft404 ? " (soft-404)" : ""}`);
  }

  // 4. All failed — print diagnostic and throw fatal error
  printDiagnostic(urlsTried);
  throw new StagingDiscoveryError(FATAL_MESSAGE, urlsTried);
}

/** Print a formatted diagnostic table of all URLs tried */
function printDiagnostic(urlsTried) {
  console.log("");
  console.log("  ╔══════════════════════════════════════════════════════════════════════╗");
  console.log("  ║  FATAL: No CMS Collection Template page found for Lanes            ║");
  console.log("  ╚══════════════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("  URLs tried:");
  for (const t of urlsTried) {
    const soft = t.isSoft404 ? ` (soft-404: "${t.markerMatched}")` : "";
    console.log(`    ${t.path} → HTTP ${t.status}${soft}`);
    console.log(`      ${t.url}`);
  }
  console.log("");
  console.log("  ➜ Create a Lanes Template Page in Webflow Designer:");
  console.log("    Pages → Create Collection Template Page → Lanes");
  console.log("  ➜ Then re-run: npm run ship:firstpage:staging");
  console.log("");
}

// Export internals for testing
export { probeUrl, probeWithRetry, CANDIDATE_PATHS, SOFT_404_MARKERS, POSITIVE_CONTENT_MARKERS, StagingDiscoveryError, FATAL_MESSAGE };
