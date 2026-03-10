/**
 * Webflow CMS field mapping for lane pages.
 *
 * Update these field slugs to match your Webflow CMS collection schema.
 * The keys are internal names; the values are Webflow CMS field slugs.
 *
 * To find your field slugs:
 * 1. Open Webflow Designer → CMS Collections → Lane Pages
 * 2. Click each field to see its slug in the settings panel
 * 3. Update the values below to match
 */

export const WEBFLOW_FIELD_MAP = {
  // ── Identity ─────────────────────────────────────────────────────
  name: "name",                        // Webflow item name (CMS display)
  slug: "slug",                        // URL slug — canonical format
  origin_city: "origin-city",          // Origin city name only (e.g., "Chicago")
  destination_city: "destination-city", // Destination city name only (e.g., "Dallas")

  // ── SEO ──────────────────────────────────────────────────────────
  seo_title: "seo-title",             // <title> tag
  seo_description: "seo-meta-description", // <meta name="description"> — Webflow field slug
  canonical: "canonical-url",          // Full canonical URL

  // ── Hero ─────────────────────────────────────────────────────────
  h1: "hero-headline",                // Main heading / hero headline
  intro: "subheadline",               // Hero subheadline
  hero_kpi_distance: "hero-kpi-distance",     // e.g. "1,108 mi"
  hero_kpi_transit: "hero-kpi-transit",       // e.g. "4–5 days"
  hero_kpi_carriers: "hero-kpi-carriers",     // e.g. "10 active"
  hero_visual_type: "hero-visual-type",       // "lane-map"
  hero_map_origin: "hero-map-origin",         // "Orlando, FL"
  hero_map_destination: "hero-map-destination", // "New York, NY"

  // ── Content ──────────────────────────────────────────────────────
  body_content: "body-content",        // Rich HTML body (all sections)
  proof: "proof-section",             // Validate This Lane section

  // ── Lane metadata ────────────────────────────────────────────────
  origin: "origin",                    // Origin city + state (e.g., "Chicago, IL")
  destination: "destination",          // Destination city + state (e.g., "Dallas, TX")
  mode: "mode",                        // Shipping mode (LTL, FTL, Cargo Van / Box Truck)
  segment: "segment",                 // Target segment (smb, midmarket, enterprise)

  // ── Structured data (code embed fields) ──────────────────────────
  //
  // faq-schema contains:
  //   1. CSS to hide Wistia video player (media-id 8pogd36stc) from the template
  //   2. CSS to hide generic marketing CTAs ("Book Freight Instantly", etc.)
  //   3. FAQPage JSON-LD structured data for SEO
  //   4. Visible FAQ HTML (<details> elements) for on-page rendering
  //
  // breadcrumb-schema contains:
  //   1. BreadcrumbList JSON-LD (Home → Mode → Lane)
  //   2. Service JSON-LD (freight service description)
  //   3. Organization JSON-LD (WARP company info)
  //
  // Both are data-driven — each CMS item controls its own rendering.
  faq_schema: "faq-schema",
  breadcrumb_schema: "breadcrumb-schema",

  // ── CTA fields ───────────────────────────────────────────────────
  cta_primary_text: "cta-primary-text",
  cta_primary_url: "cta-primary-url",
  cta_secondary_text: "cta-secondary-text",
  cta_secondary_url: "cta-secondary-url",

  // ── Comparison ───────────────────────────────────────────────────
  traditional_ltl: "traditional-ltl",
  warp_ltl: "warp-ltl",

  // ── Template flags (Webflow Switch / boolean) ────────────────────
  hero_video_enabled: "hero-video-enabled",  // false for lane pages (hides video)
  hero_map_enabled: "hero-map-enabled",      // true for lane pages (shows map hero)
  index_page: "index-page",
};

/**
 * Map internal page data to Webflow CMS fields.
 *
 * @param {object} page - Generated page object from lane-engine
 * @param {string} canonicalPath - Canonical URL path
 * @returns {object} Webflow-ready field data
 */
export function mapPageToWebflowFields(page, canonicalPath) {
  const oCity = (page.lane?.origin || "").split(",")[0].trim();
  const dCity = (page.lane?.destination || "").split(",")[0].trim();
  const stats = page.lane_stats || {};
  const np = page.network_proof || {};
  const transit = stats.estimated_transit_days_range || {};

  return {
    [WEBFLOW_FIELD_MAP.name]: `${oCity} to ${dCity} ${page.lane?.mode || "LTL"}`,
    [WEBFLOW_FIELD_MAP.slug]: page.slug,
    [WEBFLOW_FIELD_MAP.origin_city]: oCity,
    [WEBFLOW_FIELD_MAP.destination_city]: dCity,
    [WEBFLOW_FIELD_MAP.seo_title]: page.seo_title,
    [WEBFLOW_FIELD_MAP.seo_description]: page.meta_description,
    [WEBFLOW_FIELD_MAP.canonical]: canonicalPath,
    [WEBFLOW_FIELD_MAP.h1]: page.h1,
    [WEBFLOW_FIELD_MAP.intro]: page.intro,
    [WEBFLOW_FIELD_MAP.hero_kpi_distance]: stats.estimated_distance_miles
      ? `${stats.estimated_distance_miles.toLocaleString()} mi` : "",
    [WEBFLOW_FIELD_MAP.hero_kpi_transit]: (transit.min && transit.max)
      ? `${transit.min}–${transit.max} days` : "",
    [WEBFLOW_FIELD_MAP.hero_kpi_carriers]: np.estimated_carrier_count
      ? `${np.estimated_carrier_count} active` : "",
    [WEBFLOW_FIELD_MAP.hero_visual_type]: "lane-map",
    [WEBFLOW_FIELD_MAP.hero_map_origin]: page.lane?.origin || "",
    [WEBFLOW_FIELD_MAP.hero_map_destination]: page.lane?.destination || "",
    [WEBFLOW_FIELD_MAP.proof]: page.proof_section,
    [WEBFLOW_FIELD_MAP.origin]: page.lane?.origin || "",
    [WEBFLOW_FIELD_MAP.destination]: page.lane?.destination || "",
    [WEBFLOW_FIELD_MAP.mode]: page.lane?.mode || "",
    [WEBFLOW_FIELD_MAP.segment]: page.target_segment || "smb",
    [WEBFLOW_FIELD_MAP.cta_primary_text]: page.cta_primary,
    [WEBFLOW_FIELD_MAP.cta_primary_url]: page.cta_primary_url,
    [WEBFLOW_FIELD_MAP.cta_secondary_text]: page.cta_secondary,
    [WEBFLOW_FIELD_MAP.cta_secondary_url]: page.cta_secondary_url,
    [WEBFLOW_FIELD_MAP.hero_video_enabled]: false,
    [WEBFLOW_FIELD_MAP.hero_map_enabled]: true,
    [WEBFLOW_FIELD_MAP.index_page]: true,
  };
}
