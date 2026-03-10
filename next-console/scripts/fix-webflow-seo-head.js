#!/usr/bin/env node

/**
 * Fix Webflow Site-Level Custom Head Code
 *
 * Root cause: The current site-level head code contains HARDCODED homepage
 * canonical/og:url/og:description/twitter tags that get injected into EVERY page.
 * This causes Google to see the homepage canonical on all deep pages (lanes, blogs, etc.).
 *
 * This script:
 *   1. Generates corrected head code with dynamic canonical/og:url
 *   2. Generates corrected footer code (removes redundant canonical fix)
 *   3. Writes artifacts for manual paste into Webflow Designer
 *   4. Optionally pushes via Webflow Custom Code API (registered scripts)
 *
 * Usage:
 *   node scripts/fix-webflow-seo-head.js              # Generate artifacts only
 *   node scripts/fix-webflow-seo-head.js --push        # Push to Webflow (requires API token)
 *
 * After running:
 *   1. Open Webflow Designer → Site Settings → Custom Code
 *   2. Replace Head Code with contents of artifacts/seo-fix/head-code.html
 *   3. Replace Footer Code with contents of artifacts/seo-fix/footer-code.html
 *   4. Publish site
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "artifacts", "seo-fix");

// ── Corrected Head Code ─────────────────────────────────────────────────────
// Changes from current:
//   REMOVED: hardcoded <link rel="canonical" href="https://www.wearewarp.com/" />
//   REMOVED: hardcoded <meta property="og:url" content="https://www.wearewarp.com/" />
//   REMOVED: hardcoded <meta property="og:description" content="...homepage desc..." />
//   REMOVED: hardcoded <meta name="twitter:title" content="...homepage title..." />
//   REMOVED: hardcoded <meta name="twitter:description" content="...homepage desc..." />
//   REMOVED: FAQPage JSON-LD (not appropriate site-wide; belongs on homepage only)
//   ADDED:   document.write() script for dynamic canonical + og:url per page
//   KEPT:    og:type, og:site_name, twitter:card (appropriate site-wide)
//   KEPT:    Organization + WebSite JSON-LD (appropriate site-wide)

const HEAD_CODE = `<!-- Warp SEO & Schema Markup (v2 — dynamic per-page canonical) -->
<script>
(function(){
  var p = (location.pathname || '/').replace(/\\/+$/, '') || '/';
  var u = location.origin + (p === '/' ? '' : p);
  document.write('<link rel="canonical" href="' + u + '" />');
  document.write('<meta property="og:url" content="' + u + '" />');
})();
</script>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Warp" />
<meta name="twitter:card" content="summary_large_image" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Warp",
  "url": "https://www.wearewarp.com",
  "logo": "https://www.wearewarp.com/images/warp-logo.png",
  "description": "Warp is an AI-powered middle-mile freight network that helps brands and retailers optimize FTL, LTL, pool distribution, and parcel shipping. Trusted by Walmart, HelloFresh, DoorDash, and thousands of shippers.",
  "foundingDate": "2021",
  "founders": [
    {"@type": "Person", "name": "Daniel Sokolovsky"},
    {"@type": "Person", "name": "Troy Lester"}
  ],
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "1800 Vine Street",
    "addressLocality": "Los Angeles",
    "addressRegion": "CA",
    "postalCode": "90028",
    "addressCountry": "US"
  },
  "contactPoint": {
    "@type": "ContactPoint",
    "telephone": "+1-213-267-1373",
    "contactType": "sales",
    "email": "support@wearewarp.com"
  },
  "sameAs": [
    "https://www.linkedin.com/company/warp-tech",
    "https://www.crunchbase.com/organization/wearewarp"
  ],
  "award": ["2025 Top Tech Startup Award", "2025 Freight Tech Award", "2025 Most Innovative Companies"],
  "numberOfEmployees": {"@type": "QuantitativeValue", "minValue": 50, "maxValue": 200},
  "knowsAbout": ["freight optimization", "middle mile logistics", "LTL shipping", "FTL shipping", "pool distribution", "zone skipping", "freight consolidation", "AI logistics", "cross-dock operations", "store replenishment"]
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Warp",
  "url": "https://www.wearewarp.com",
  "description": "AI-powered freight network optimization platform for FTL, LTL, pool distribution, and parcel shipping.",
  "publisher": {"@type": "Organization", "name": "Warp", "url": "https://www.wearewarp.com"}
}
</script>`;

// ── Corrected Footer Code ───────────────────────────────────────────────────
// The warp-seo-p0-head-v1 script is simplified:
//   REMOVED: canonical/og:url fix (now handled by head code document.write)
//   KEPT:    title fix for "Warp Landing Page" → proper title from H1
//   KEPT:    auto-generate meta description for pages missing one
//
// The warp-seo-p0-footer-v1 and WARP GEO scripts are kept as-is.

const FOOTER_SEO_HEAD_SCRIPT = `<script id="warp-seo-p0-head-v2">
(function(){
  function run(){
    try {
      var d = document;
      function cleanText(s){ return String(s || "").replace(/\\s+/g, " ").trim(); }
      function firstText(sel){ var el = d.querySelector(sel); return el ? cleanText(el.textContent) : ""; }
      function stripWarpSuffix(t){ return cleanText(String(t || "").replace(/\\s*\\|\\s*Warp.*$/i, "")); }

      var h1 = firstText("h1");
      var rawTitle = cleanText(d.title);
      var currentTitle = stripWarpSuffix(rawTitle);
      if (/^warp landing page/i.test(rawTitle) && h1) {
        d.title = h1 + " | Warp";
        currentTitle = h1;
      }

      var desc = d.querySelector("meta[name=\\"description\\"]");
      if (!desc) {
        desc = d.createElement("meta");
        desc.setAttribute("name", "description");
        d.head.appendChild(desc);
      }
      var currentDesc = cleanText(desc.getAttribute("content"));
      if (!currentDesc) {
        var path = location.pathname || "/";
        var p = firstText("article p, main p, .w-richtext p, p");
        var source = p || h1 || currentTitle;
        if (source) {
          var text = cleanText(source);
          if (path.indexOf("/warp-blogs/") === 0) {
            text = "Freight strategy insights: " + text;
          }
          if (text.length > 155) text = text.slice(0, 152).trim() + "...";
          desc.setAttribute("content", text);
        }
      }

      /* Deduplicate canonical tags — keep only the first one */
      var canonicals = Array.from(d.querySelectorAll('link[rel="canonical"]'));
      for (var i = 1; i < canonicals.length; i++) {
        canonicals[i].parentNode.removeChild(canonicals[i]);
      }

      /* Deduplicate og:url tags — keep only the first one */
      var ogUrls = Array.from(d.querySelectorAll('meta[property="og:url"]'));
      for (var j = 1; j < ogUrls.length; j++) {
        ogUrls[j].parentNode.removeChild(ogUrls[j]);
      }
    } catch (err) {
      console.warn("warp seo head v2 patch error", err);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();
</script>`;

// ── Diff summary ────────────────────────────────────────────────────────────

const DIFF_SUMMARY = `# SEO Head Code Fix — What Changed

## Problem
The site-level custom head code contained HARDCODED homepage meta tags:
  <link rel="canonical" href="https://www.wearewarp.com/" />
  <meta property="og:url" content="https://www.wearewarp.com/" />
  <meta property="og:description" content="...homepage description..." />
  <meta name="twitter:title" content="...homepage title..." />
  <meta name="twitter:description" content="...homepage description..." />

These were injected into EVERY page (lanes, blogs, etc.), causing Google
to index all pages with the homepage canonical URL.

## Fix Applied (head-code.html)
1. REMOVED hardcoded canonical → replaced with document.write() that
   outputs the correct self-referencing URL per page
2. REMOVED hardcoded og:url → same dynamic fix
3. REMOVED hardcoded og:description (was overriding page-specific tags)
4. REMOVED hardcoded twitter:title (was overriding page-specific tags)
5. REMOVED hardcoded twitter:description (was overriding page-specific tags)
6. REMOVED FAQPage JSON-LD from site-level (belongs on homepage only)
7. KEPT og:type, og:site_name, twitter:card (appropriate site-wide)
8. KEPT Organization + WebSite JSON-LD schemas

## Fix Applied (footer-seo-head-v2.html)
The footer script warp-seo-p0-head-v1 is replaced with v2:
1. REMOVED canonical/og:url DOM manipulation (now handled by head code)
2. KEPT title fix for "Warp Landing Page" → proper H1-based title
3. KEPT auto-generate meta description for pages without one
4. ADDED deduplication of canonical and og:url tags (defensive cleanup)

## How to Deploy
1. Open Webflow Designer → Site Settings → Custom Code
2. In the "Head Code" section:
   - Select ALL existing code and DELETE it
   - Paste contents of artifacts/seo-fix/head-code.html
3. In the "Footer Code" section:
   - Find and REPLACE the <script id="warp-seo-p0-head-v1"> block
     with contents of artifacts/seo-fix/footer-seo-head-v2.html
   - Keep all other footer scripts (warp-seo-p0-footer-v1, WARP GEO, etc.)
4. Publish the site to production

## Verification
After deploying, run:
  curl -sL "https://www.wearewarp.com/lanes/atlanta-to-austin" | grep -E 'canonical|og:url'
Expected:
  <link rel="canonical" href="https://www.wearewarp.com/lanes/atlanta-to-austin" />
  <meta property="og:url" content="https://www.wearewarp.com/lanes/atlanta-to-austin" />

## Sitemap/Robots Fix (manual in Webflow Designer)
1. Go to Webflow Designer → Pages
2. Find "warp-meeting-confirmation" page → Page Settings → uncheck "Include in sitemap"
3. Find "book-a-freight-instantly-pseudo" page → Page Settings → uncheck "Include in sitemap"
4. Publish site

## Blog SEO Fix (manual in Webflow CMS)
Blog CMS items are missing meta descriptions. For each blog post:
1. Go to Webflow CMS → Blog collection
2. Edit each item → SEO tab
3. Add a unique meta description
4. The v2 footer script will auto-generate descriptions as a fallback,
   but manually-set descriptions are strongly preferred.
`;

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Write head code artifact
  fs.writeFileSync(path.join(OUT_DIR, "head-code.html"), HEAD_CODE);
  console.log(`  Written: ${path.join(OUT_DIR, "head-code.html")}`);

  // Write footer script artifact
  fs.writeFileSync(path.join(OUT_DIR, "footer-seo-head-v2.html"), FOOTER_SEO_HEAD_SCRIPT);
  console.log(`  Written: ${path.join(OUT_DIR, "footer-seo-head-v2.html")}`);

  // Write diff summary
  fs.writeFileSync(path.join(OUT_DIR, "CHANGES.md"), DIFF_SUMMARY);
  console.log(`  Written: ${path.join(OUT_DIR, "CHANGES.md")}`);

  console.log("");
  console.log("=== Next Steps ===");
  console.log("1. Open Webflow Designer → Site Settings → Custom Code");
  console.log("2. Replace Head Code with: artifacts/seo-fix/head-code.html");
  console.log("3. In Footer Code, replace warp-seo-p0-head-v1 with: artifacts/seo-fix/footer-seo-head-v2.html");
  console.log("4. Publish site");
  console.log("");
  console.log("See artifacts/seo-fix/CHANGES.md for full details.");
}

main();
