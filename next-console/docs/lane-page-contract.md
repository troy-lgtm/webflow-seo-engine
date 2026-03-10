# Lane Page Contract

> Canonical source of truth for WARP LTL lane page structure, content requirements, quality gating, and publish rules.
> This document governs what the AI generator produces, what the validator enforces, and what engineers build against.

---

## 1. What a Lane Page Is

A lane page is a lane-specific operational freight page targeting a shipper who is evaluating LTL freight on a specific origin-destination route (e.g., Miami to Atlanta, Dallas to Chicago).

Every lane page must answer these questions for the reader:

- What is this lane (origin, destination, freight context)?
- Why is WARP relevant on this lane?
- How does WARP handle LTL on this route?
- What freight characteristics and operating conditions matter?
- What does pricing look like at a high level?
- How does WARP's service and operational model fit this lane?
- What related lanes and tools are available?

### A lane page is NOT any of the following:

- A homepage clone with a city name swapped in
- A generic marketing page
- A product tutorial or feature walkthrough
- A strategy call landing page
- A video embed page
- A generic cross-dock or network explainer
- A blog post or thought leadership piece
- A corridor hub page (those are separate entities)

If the page could describe any lane by swapping city names, it fails the contract.

---

## 2. Required Page Structure

Every lane page must contain the following sections in this exact order. No section may be omitted. No section may be reordered.

### 2.1 HERO

- **H1**: Must contain origin city, destination city, and LTL intent. Example format: `LTL Freight from {Origin} to {Destination}`.
- **Subhead**: One sentence describing the operational value WARP provides on this lane. Not a tagline. Not a brand statement.
- **Primary CTA**: Single clear call-to-action. Lane-relevant. Example: "Get a quote for this lane" or "See per-pallet pricing."

### 2.2 LANE OVERVIEW

Covers:

- Origin city and state
- Destination city and state
- Operational relevance of this lane (why shippers move freight on this route)
- Typical use cases (retail replenishment, distribution, e-commerce fulfillment, etc.)
- Where WARP fits in the lane (cross-dock network, direct service, regional coverage)

This section sets geographic and freight context. It is not a sales pitch.

### 2.3 WARP FIT FOR THIS LANE

Explains how WARP's model specifically applies to this lane. Must address at least five of the following:

- Pickup consistency and scheduling
- Delivery appointment adherence
- Appointment-driven freight handling
- Palletized freight fit
- Cross-dock and network fit for this route
- Shipment visibility and tracking
- Per-pallet economics vs. traditional LTL

This section must be lane-specific. Generic WARP product descriptions do not satisfy this requirement.

### 2.4 OPERATING DETAILS

Must include at least 3 of the following detail types:

- Appointment windows (pickup and delivery)
- Dock scheduling considerations
- Shipment profile fit (pallet count ranges, weight ranges, freight class)
- Pallet handling requirements
- Mode fit (LTL, partials, cross-dock transfer)
- Service notes (transit time expectations, weekend availability, seasonal considerations)
- Cross-dock notes (which facilities serve this lane, transfer points)
- Direct vs. transfer routing

Content must reflect actual operational characteristics of the lane, not generic freight advice.

### 2.5 PRICING / COMMERCIAL FRAMING

Must include:

- Per-pallet pricing framing (how WARP prices LTL on this lane)
- Lane consistency messaging (stable rates, predictable quoting)
- Recurring volume economics (how repeat shippers benefit)
- Transparent quoting positioning (no hidden fees, no accessorial surprises)

**Hard rules:**

- No fabricated percentages ("Save 30% on freight!")
- No unsubstantiated cost claims
- No competitor price comparisons with invented numbers
- No dollar amounts unless dynamically sourced from a pricing feed

### 2.6 FAQS

- Minimum 4 FAQs per lane page. No maximum, but 4-8 is the target range.
- Every FAQ must be specific to this lane and WARP's LTL service on it.
- Generic freight FAQs that apply to any lane are not acceptable.
- Each FAQ must have a clear question and a direct answer.
- FAQs must be marked up with FAQPage JSON-LD structured data.

Example of an acceptable FAQ:
> Q: What is the typical transit time for LTL freight from Dallas to Chicago with WARP?
> A: WARP typically delivers palletized LTL shipments from Dallas to Chicago within 3-5 business days, depending on pickup scheduling and appointment availability at destination.

Example of an unacceptable FAQ:
> Q: What is LTL freight?
> A: LTL stands for less-than-truckload...

### 2.7 RELATED LINKS

Must include:

- Link to the corridor hub this lane belongs to
- 5-12 related lane pages (same corridor, reverse lane, adjacent routes)
- Link to the relevant tool page (e.g., quote tool, rate calculator)
- Link to the relevant data page, if one exists

All links must be internal. No external links in this section.

### 2.8 CTA / CONVERSION

- Clean, lane-relevant CTA block at the bottom of the page.
- CTA text must reference the lane or freight action. Example: "Get a quote for LTL from Miami to Atlanta."
- Must not duplicate homepage footer copy.
- Must not use generic conversion language ("Let's talk!", "Schedule a demo!", "Transform your supply chain!").

---

## 3. Banned Content

The following content is banned from all lane pages. The machine-readable version of this list is maintained at `config/lane-page-banned-content.json`. Both this document and that file must stay in sync.

### 3.1 Banned Phrases

- "Reinvent your supply chain"
- "Revolutionize your logistics"
- "Transform your freight future"
- "Game-changing"
- "World-class"
- "Best-in-class"
- "Cutting-edge"
- "Seamless experience"
- "One-stop shop"
- "End-to-end solution"
- "Unlock savings"
- "Disrupt the industry"
- "Next-generation"
- "Frictionless"
- "Supercharge your shipping"
- "The future of freight"
- "It's that simple"
- "We're not just another..."
- "Say goodbye to..."
- "What if we told you..."
- "Here's the thing..."
- "Let's be honest..."
- "In today's fast-paced world..."
- "At the end of the day..."
- Any phrase containing "broken" + "freight" or "supply chain"

### 3.2 Banned Section Headings

- "Why Choose WARP?" (homepage heading, not lane-specific)
- "About WARP" (belongs on the about page)
- "Our Mission" / "Our Vision"
- "How It Works" (generic product section)
- "Testimonials" (not validated for lane pages)
- "Case Studies" (not part of lane page structure)
- "Partners" / "Integrations"
- "Blog" / "Resources" / "Learn More"
- "Watch the Video"
- "Book a Demo"

### 3.3 Banned Embeds

- Video embeds (YouTube, Vimeo, Wistia, or any other)
- Calendly or scheduling widgets
- Chat widgets embedded in page body (header/footer chat is separate)
- Third-party review widgets (G2, Capterra, etc.)
- Social media feed embeds
- Interactive maps (static route references are acceptable)
- Iframe embeds of any kind

---

## 4. Required Content Fields

The lane page generator must produce every field listed below. The validator must confirm every field is present and non-empty before a page can enter the publish pipeline.

| Field | Type | Description |
|---|---|---|
| `lane_slug` | string | URL-safe slug. Format: `{origin_city}-{origin_state}-to-{destination_city}-{destination_state}-ltl` |
| `canonical_path` | string | Full canonical path. Format: `/lanes/{lane_slug}` |
| `origin_city` | string | Origin city name |
| `origin_state` | string | Origin state abbreviation (2-letter) |
| `destination_city` | string | Destination city name |
| `destination_state` | string | Destination state abbreviation (2-letter) |
| `page_title` | string | HTML `<title>` tag content. Must contain origin, destination, and "LTL" |
| `meta_description` | string | Meta description. Must mention both cities and mode. Max 160 characters |
| `hero_headline` | string | H1 text. Must contain origin, destination, and LTL intent |
| `hero_subhead` | string | Subhead text. One sentence, operational value |
| `lane_overview` | string/html | Lane overview section content |
| `warp_fit_section` | string/html | WARP fit for this lane section content |
| `operating_details` | string/html | Operating details section content |
| `pricing_section` | string/html | Pricing / commercial framing section content |
| `faqs` | array | Array of FAQ objects `[{question, answer}]`. Minimum 4 items |
| `related_lanes` | array | Array of related lane slugs. 5-12 items |
| `corridor_id` | string | ID of the parent corridor this lane belongs to |
| `tool_link` | string | Internal path to the relevant tool page |
| `data_link_if_any` | string/null | Internal path to the relevant data page, or null |
| `primary_cta` | string | Primary CTA text |
| `secondary_cta_optional` | string/null | Secondary CTA text, or null |
| `quality_score` | integer | Computed quality score (0-100). Must be >= 70 to publish |
| `banned_content_scan_result` | object | Result of banned content scan `{passed: bool, violations: []}` |
| `rendered_html_validation_result` | object | Result of HTML validation `{passed: bool, errors: []}` |

---

## 5. Tone and Copy Rules

### Voice

- Operator-grade: sounds like it was written by someone who understands freight operations
- Specific: references the actual lane, not generic freight concepts
- Freight-aware: uses correct industry terminology without over-explaining
- Clean: no filler words, no padding sentences, no fluff paragraphs
- Useful: every sentence either informs the reader or moves them toward a decision
- Confident: states what WARP does without hedging or overselling

### Anti-patterns

- Theatrical or dramatic language
- Startup marketing fluff
- Homepage brand poetry
- Buzzword stacking
- Rhetorical questions as section openers
- Sentences that say nothing ("At WARP, we believe in the power of logistics.")
- Vague superlatives without specifics

### Examples

**Good:**
> WARP supports palletized LTL freight on this lane with live tracking and scheduled pickup coordination.

**Good:**
> Shippers moving 2-6 pallets from Miami to Atlanta can use WARP's cross-dock network for consistent per-pallet pricing and appointment-based delivery.

**Bad:**
> Reinvent your broken freight future with our game-changing platform.

**Bad:**
> Say goodbye to the old way of shipping. WARP is here to transform how you think about LTL.

**Bad:**
> In today's fast-paced logistics landscape, shippers need a partner they can trust.

### Litmus test

Read the copy out loud. If it sounds like a freight broker explaining the lane to a shipper on a call, it passes. If it sounds like a SaaS landing page, it fails.

---

## 6. SEO Principles

### On-page requirements

- **H1**: Must contain origin city, destination city, and "LTL". One H1 per page.
- **Meta description**: Must mention both cities and the freight mode. Max 160 characters.
- **Canonical URL**: Must follow the `/lanes/{lane_slug}` pattern. No trailing slashes. No query parameters.
- **Page title**: Format: `LTL Freight from {Origin} to {Destination} | WARP`

### Structured data (JSON-LD)

Every lane page must include the following structured data types:

1. **BreadcrumbList** -- Reflects the path: Home > Lanes > Corridor > This Lane
2. **Service** -- Describes the LTL service WARP provides on this lane
3. **Organization** -- WARP organization entity (can be shared across pages)
4. **FAQPage** -- All FAQs on the page marked up as Question/Answer pairs

### Internal linking

- Every lane page links to its parent corridor hub page.
- Every lane page links to 5-12 related lane pages.
- Every lane page links to the relevant tool page.
- Anchor text must be descriptive (not "click here").
- No orphan lane pages. Every lane page must be linked to from at least one corridor hub.

### Crawlability

- Pages must be indexable (no `noindex` tag).
- Pages must not be blocked by `robots.txt`.
- Pages must load without JavaScript for core content (SSR or static generation).
- Page must return a 200 status code.

---

## 7. Publish Gating

No lane page may be published unless it passes all of the following gate checks. A failure on any single gate blocks publication.

| Gate Rule ID | Check | Failure Condition |
|---|---|---|
| `LANE-TEMPLATE-01` | All required fields present | Any field from Section 4 is missing or empty |
| `LANE-TEMPLATE-02` | Banned content scan passes | Any banned phrase, heading, or embed detected |
| `LANE-TEMPLATE-03` | HTML validation passes | Rendered HTML contains errors or malformed markup |
| `LANE-TEMPLATE-04` | Quality score threshold | Quality score < 70 |
| `LANE-TEMPLATE-05` | FAQ minimum count | Fewer than 4 FAQs |
| `LANE-TEMPLATE-06` | Canonical path valid | Canonical path does not match `/lanes/{lane_slug}` pattern |
| `LANE-TEMPLATE-07` | Internal links valid | Any internal link returns non-200 or points to a missing page |
| `LANE-TEMPLATE-08` | Structured data present | Missing any of: BreadcrumbList, Service, Organization, FAQPage JSON-LD |
| `LANE-TEMPLATE-09` | Meta description length | Meta description exceeds 160 characters or is empty |
| `LANE-TEMPLATE-10` | H1 contains required terms | H1 missing origin city, destination city, or LTL reference |
| `LANE-FALLBACK-01` | Fallback rejection | Page was generated from a fallback template without lane-specific content |

### Gate enforcement

- Gates are run in the CI/CD pipeline before any page is deployed.
- Gates are also run by the validator service on-demand during content generation.
- A page that fails any gate is returned to the generator with the failure reason.
- Gate results are logged and stored for audit.

---

## 8. Quality Score

Every lane page receives a quality score on a 100-point scale. The score is computed from the following components. A page must score >= 70 to pass the publish gate.

| Component | Points | Criteria |
|---|---|---|
| Required sections present | 30 | All 8 sections (Hero, Lane Overview, WARP Fit, Operating Details, Pricing, FAQs, Related Links, CTA) are present and non-empty. Partial credit: 3.75 pts per section. |
| FAQ count | 10 | 4 or more FAQs present. 0 pts if fewer than 4. No partial credit. |
| Banned content absent | 20 | No banned phrases, headings, or embeds detected. 0 pts if any violation found. No partial credit. |
| Body content length | 10 | Total body content >= 800 words. Partial credit: proportional below 800. |
| Lane-specific terms present | 10 | Content includes origin city name, destination city name, and at least 2 freight-specific terms (e.g., pallet, LTL, cross-dock, appointment, transit). Partial credit: 2 pts per term found, up to 10. |
| Internal links present | 10 | At least 1 corridor hub link + 5 related lane links + 1 tool link present. Partial credit: proportional based on links found vs. required. |
| Structured data present | 10 | All 4 required JSON-LD types present (BreadcrumbList, Service, Organization, FAQPage). Partial credit: 2.5 pts per type. |

### Score interpretation

| Range | Status | Action |
|---|---|---|
| 90-100 | Excellent | Publish-ready. No review needed. |
| 70-89 | Acceptable | Publish-ready. Flag for optional review. |
| 50-69 | Below threshold | Blocked from publish. Returned to generator with improvement notes. |
| 0-49 | Failing | Blocked from publish. Likely a template or generation failure. Requires investigation. |

---

## Appendix: File References

| File | Purpose |
|---|---|
| `config/lane-page-banned-content.json` | Machine-readable banned content list. Must stay in sync with Section 3. |
| `config/lane-page-fields.json` | Machine-readable required fields schema. Must stay in sync with Section 4. |
| `config/lane-page-gates.json` | Machine-readable publish gate definitions. Must stay in sync with Section 7. |
| `config/lane-page-quality-score.json` | Machine-readable quality score weights. Must stay in sync with Section 8. |

---

*This document is the canonical contract for WARP LTL lane pages. All generators, validators, templates, and review processes must conform to it. If this document and any config file disagree, this document wins.*
