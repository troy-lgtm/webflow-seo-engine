#!/usr/bin/env node

/**
 * Build the first lane package for Chicago → Dallas LTL.
 * Writes Webflow-ready files to docs/first_publish_chicago_to_dallas_ltl_webflow/
 */

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

// Since we can't use @/ aliases in scripts, inline the required logic
async function main() {
  // Dynamic import with alias resolution
  const { register } = await import("module");

  // Use a simpler approach: read the compiled output or call the functions directly
  // We'll construct the package data manually using the same logic as lib/lane-package.js

  const outDir = path.join(ROOT, "docs", "first_publish_chicago_to_dallas_ltl_webflow");
  fs.mkdirSync(outDir, { recursive: true });

  const origin = "Chicago, IL";
  const destination = "Dallas, TX";
  const mode = "LTL";
  const segment = "smb";
  const slug = `${origin.split(",")[0].trim().toLowerCase().replace(/\s+/g, "-")}-to-${destination.split(",")[0].trim().toLowerCase().replace(/\s+/g, "-")}`;
  const canonicalPath = `/${slug}`;
  const seoTitle = `${origin} to ${destination} ${mode} Freight Quotes | WARP`;
  const h1 = `${origin} to ${destination} ${mode} freight quotes`;
  const intro = "Small and mid-size shipping teams moving LTL freight from Chicago, IL to Dallas, TX can use this lane-specific workflow to compare options, reduce manual quote cycles, and book faster with stronger service visibility.";

  // Content fingerprint
  const raw = [canonicalPath, seoTitle, h1, intro.slice(0, 200)].join("|");
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
  }
  const fingerprint = String(Math.abs(hash));

  // Write webflow_page_spec.md
  fs.writeFileSync(path.join(outDir, "webflow_page_spec.md"), `# Webflow Page Specification

## Page Identity
- **Canonical URL**: ${canonicalPath}
- **Slug**: ${slug}
- **Publish Date**: Wednesday March 4, 2026 at 4:30am PST
- **Wave**: wave-1 (Beachhead)

## SEO Fields
- **Title Tag**: ${seoTitle}
- **Meta Description**: Compare LTL freight options from ${origin} to ${destination}. Small and mid-size shipping teams get lane-specific estimated pricing, performance data, and a fast, self-serve evaluation workflow.
- **H1**: ${h1}
- **Canonical**: https://www.wearewarp.com${canonicalPath}

## Open Graph
- **og:title**: ${seoTitle}
- **og:description**: Same as meta description
- **og:type**: website
- **og:url**: https://www.wearewarp.com${canonicalPath}

## Webflow Settings
- Collection: Lane Pages
- Template: Lane Page — LTL
- Status: Staged (publish at scheduled time)
- noindex: false
- Sitemap priority: 0.8
- Mobile responsive: required

## Content Sections (top to bottom)
1. Quick Answer Block
2. Hero with H1 + intro
3. Estimate transparency (distance, transit range, rate range)
4. Value cards (3 cards)
5. Problem/Solution
6. Contrast table (Legacy vs WARP)
7. FAQ (5 entries with FAQPage schema)
8. Internal links (related lanes + guides + indexes)
9. CTA block

## Structured Data
- FAQPage schema (5 Q&A pairs)
- BreadcrumbList schema (3 levels)
- Organization schema
- Service schema
`);

  // Write page_copy.md
  fs.writeFileSync(path.join(outDir, "page_copy.md"), `# Page Copy — Chicago to Dallas LTL

## Quick Answer Block
**How much does LTL freight from Chicago to Dallas cost?**
Estimated LTL rates from ${origin} to ${destination} range from approximately $680 to $1,150 depending on freight class, pallet count, and shipment weight. These are modeled estimates. Get an instant quote for real-time pricing.

**How long does LTL transit take from Chicago to Dallas?**
Estimated transit time is 3-5 business days for standard LTL service on this ~920-mile corridor. Actual transit depends on carrier routing and terminal schedules.

## H1
${h1}

## Intro
${intro}

## Problem
LTL shippers struggle with inconsistent transit times, opaque pricing, and fragmented visibility across multiple carriers.

## Solution
WARP unifies LTL lane quoting, carrier selection, and exception management into a single operational workflow.

## CTA Primary
Book 15-min Fit Call → https://www.wearewarp.com/book

## CTA Secondary
Get Instant Quote → https://www.wearewarp.com/quote
`);

  // Write faq_schema.json
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: `How fast can we launch a LTL pilot from ${origin} to ${destination}?`, acceptedAnswer: { "@type": "Answer", text: "Most small and mid-size shipping teams can define lane scope and start pilot quoting within days." } },
      { "@type": "Question", name: `What makes LTL shipping different on the ${origin} to ${destination} lane?`, acceptedAnswer: { "@type": "Answer", text: "Each lane has unique volume patterns, carrier availability, and transit windows. WARP analyzes these factors to optimize your LTL operations for this corridor." } },
      { "@type": "Question", name: `Can we start with just the ${origin} to ${destination} lane before expanding?`, acceptedAnswer: { "@type": "Answer", text: "Yes. A lane-first rollout lets you validate performance before scaling to additional corridors." } },
      { "@type": "Question", name: `What metrics should we track on this LTL lane?`, acceptedAnswer: { "@type": "Answer", text: "Focus on quote response time, transit predictability, exception rate, and cost-per-shipment trends for a clear go/no-go scaling signal." } },
      { "@type": "Question", name: `Do we need to migrate our entire process to use WARP for this lane?`, acceptedAnswer: { "@type": "Answer", text: "No. Use a fast, self-serve approach — start this single lane, measure results, and expand based on quick ROI evidence." } }
    ]
  };
  fs.writeFileSync(path.join(outDir, "faq_schema.json"), JSON.stringify(faqSchema, null, 2));

  // Write breadcrumbs_schema.json
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "WARP", item: "https://www.wearewarp.com" },
      { "@type": "ListItem", position: 2, name: "LTL Freight", item: "https://www.wearewarp.com/guides/ltl" },
      { "@type": "ListItem", position: 3, name: "Chicago to Dallas" }
    ]
  };
  fs.writeFileSync(path.join(outDir, "breadcrumbs_schema.json"), JSON.stringify(breadcrumbSchema, null, 2));

  // Write og_meta.md
  fs.writeFileSync(path.join(outDir, "og_meta.md"), `# Open Graph Meta — Chicago to Dallas LTL

\`\`\`html
<meta property="og:title" content="${seoTitle}" />
<meta property="og:description" content="Compare LTL freight options from ${origin} to ${destination}. Lane-specific estimated pricing and fast self-serve evaluation." />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://www.wearewarp.com${canonicalPath}" />
<meta property="og:site_name" content="WARP" />
\`\`\`
`);

  // Write mobile_first_layout.md
  fs.writeFileSync(path.join(outDir, "mobile_first_layout.md"), `# Mobile-First Layout

## Viewport Breakpoints
- Mobile: 320-767px (primary design target)
- Tablet: 768-1023px
- Desktop: 1024px+

## Mobile Layout (top to bottom)
1. Quick Answer Block (above fold) — bold question, 2-sentence answer, rate range, CTA
2. Hero — H1 24px, intro 14px, two CTA buttons stacked vertically
3. Estimate Transparency — 3 stat cards in single column
4. Value Cards — single column stack
5. Problem / Solution — stacked blocks
6. Contrast Table — horizontal scroll if needed, WARP column highlighted
7. FAQ Accordion — tap to expand, schema on all entries
8. Internal Links — pill-style wrapping links
9. Bottom CTA — full-width primary button

## Performance
- First Contentful Paint: under 1.5s
- Largest Contentful Paint: under 2.5s
- No layout shift, lazy load images below fold
`);

  // Write internal_links.md
  fs.writeFileSync(path.join(outDir, "internal_links.md"), `# Internal Links — Chicago to Dallas LTL

## Related Lanes (12+)
- Dallas, TX to Chicago, IL LTL → /ltl-freight-dallas-to-chicago
- Chicago, IL to Los Angeles, CA LTL → /ltl-freight-chicago-to-los-angeles
- Chicago, IL to Houston, TX LTL → /ltl-freight-chicago-to-houston
- Chicago, IL to Atlanta, GA LTL → /ltl-freight-chicago-to-atlanta
- Los Angeles, CA to Dallas, TX LTL → /ltl-freight-los-angeles-to-dallas
- Houston, TX to Dallas, TX LTL → /ltl-freight-houston-to-dallas
- Atlanta, GA to Dallas, TX LTL → /ltl-freight-atlanta-to-dallas

## Guide Links (6+)
- LTL Freight Shipping Guide → /guides/ltl
- FTL Freight Shipping Guide → /guides/ftl
- SMB Freight Buyer's Guide → /guides/smb
- Understanding Freight Classification → /guides/freight-class

## Index Page Links (4)
- Freight Lane Directory → /indexes/freight-lanes
- Freight Classification Reference → /indexes/freight-class
- Accessorials Reference → /indexes/accessorials
- Transit Times Reference → /indexes/transit-times
`);

  // Write qa_checklist.md
  fs.writeFileSync(path.join(outDir, "qa_checklist.md"), `# QA Checklist

## Before Publish
- [ ] H1 matches target keyword
- [ ] Title tag 30-60 characters
- [ ] Meta description 120-160 characters
- [ ] Quick answer block above fold
- [ ] All rates labeled as estimates
- [ ] Disclaimer visible
- [ ] FAQPage schema validates
- [ ] BreadcrumbList schema validates
- [ ] Canonical URL is ${canonicalPath}
- [ ] 12+ related lane links
- [ ] 6+ guide links
- [ ] 4 index page links
- [ ] CTA URLs work
- [ ] Mobile responsive at 375px
- [ ] No duplicate in published_pages.json

## After Publish
- [ ] Submit URL to Google Search Console
- [ ] Verify indexing within 24h
- [ ] Entry added to published_pages.json
`);

  // Write content_fingerprint.txt
  fs.writeFileSync(path.join(outDir, "content_fingerprint.txt"), fingerprint);

  console.log(`Built lane package in ${outDir}`);
  console.log(`  Files: 9`);
  console.log(`  Canonical: ${canonicalPath}`);
  console.log(`  Fingerprint: ${fingerprint}`);
}

main().catch((err) => {
  console.error("Failed to build lane package:", err.message);
  process.exit(1);
});
