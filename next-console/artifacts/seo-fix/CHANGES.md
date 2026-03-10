# SEO Head Code Fix — What Changed

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
