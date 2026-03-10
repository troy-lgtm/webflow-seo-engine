/**
 * Operational Content Tests
 *
 * Validates the lane page operational content pipeline:
 * - publish_next.js uses extracted modules for lane intelligence
 * - The dedicated renderer (render-lane-page.js) generates proper sections
 * - The renderer produces all 19+ CMS fields
 * - faq-schema includes marketing-hide CSS beyond video
 * - breadcrumb-schema includes BreadcrumbList JSON-LD
 * - body-content is free of generic marketing content
 * - Each lane generates unique intro text
 *
 * Architecture verification: scripts import from extracted modules
 *   lib/lane-knowledge.js → lane intelligence
 *   lib/lane-page-schema.js → canonical schema builder
 *   lib/render-lane-page.js → dedicated renderer
 *
 * Uses fs.readFileSync for source analysis (same pattern as gsc.spec.js)
 * to avoid Playwright CJS transform conflicts with ES module scripts.
 */

import { test, expect } from "@playwright/test";
import { execSync } from "child_process";

/** Run an inline ES module script, return parsed JSON output. */
function runNode(script, extraEnv = {}) {
  const result = execSync(`node --input-type=module -e '${script}'`, {
    cwd: process.cwd(),
    timeout: 30000,
    env: { ...process.env, ...extraEnv },
  });
  return JSON.parse(result.toString().trim());
}

// ── Enriched Lane Intelligence (via extracted modules) ────────────────

test.describe("Enriched Lane Intelligence", () => {
  test("publish_next imports lane-knowledge module for lane intelligence", () => {
    const result = runNode(`
      import fs from "fs";
      const pnSrc = fs.readFileSync("./scripts/publish_next.js", "utf-8");
      const lfSrc = fs.readFileSync("./lib/lane-factory.js", "utf-8");
      const knowledgeSrc = fs.readFileSync("./lib/lane-knowledge.js", "utf-8");
      console.log(JSON.stringify({
        // publish_next imports from lane-factory (which contains enrichLaneInline)
        importsLaneFactory: pnSrc.includes("lane-factory.js"),
        hasEnrichLaneInline: lfSrc.includes("enrichLaneInline"),
        // lane-factory imports lane-knowledge and render-lane-page
        lfImportsLaneKnowledge: lfSrc.includes("lane-knowledge.js"),
        lfImportsRenderLanePage: lfSrc.includes("render-lane-page.js"),
        moduleHasHaversine: knowledgeSrc.includes("haversine"),
        moduleHasCities: knowledgeSrc.includes("cities.json"),
        moduleHasHubs: knowledgeSrc.includes("hubs.json"),
        moduleHasTransitBands: knowledgeSrc.includes("TRANSIT_BANDS"),
        moduleHasRatePerMile: knowledgeSrc.includes("RATE_PER_MILE"),
      }));
    `);

    expect(result.importsLaneFactory).toBe(true);
    expect(result.hasEnrichLaneInline).toBe(true);
    expect(result.lfImportsLaneKnowledge).toBe(true);
    expect(result.lfImportsRenderLanePage).toBe(true);
    expect(result.moduleHasHaversine).toBe(true);
    expect(result.moduleHasCities).toBe(true);
    expect(result.moduleHasHubs).toBe(true);
    expect(result.moduleHasTransitBands).toBe(true);
    expect(result.moduleHasRatePerMile).toBe(true);
  });

  test("ship_firstpage imports lane-knowledge module for lane intelligence", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("./scripts/ship_firstpage.js", "utf-8");
      console.log(JSON.stringify({
        hasEnrichLaneInline: src.includes("enrichLaneInline"),
        importsLaneKnowledge: src.includes("lane-knowledge.js"),
        importsRenderLanePage: src.includes("render-lane-page.js"),
      }));
    `);

    expect(result.hasEnrichLaneInline).toBe(true);
    expect(result.importsLaneKnowledge).toBe(true);
    expect(result.importsRenderLanePage).toBe(true);
  });
});

// ── Body Content ────────────────────────────────────────────────────

test.describe("Body Content Builder", () => {
  test("dedicated renderer includes lane overview, WARP fit, operating details, and pricing sections", () => {
    const result = runNode(`
      import fs from "fs";
      const rendererSrc = fs.readFileSync("./lib/render-lane-page.js", "utf-8");
      console.log(JSON.stringify({
        hasLaneOverview: rendererSrc.includes("Lane Overview"),
        hasWarpFit: rendererSrc.includes("WARP Operates") || rendererSrc.includes("renderWarpFit"),
        hasOperatingDetails: rendererSrc.includes("Operating Details"),
        hasPricing: rendererSrc.includes("Pricing"),
        hasValidate: rendererSrc.includes("Validate This Lane"),
      }));
    `);

    expect(result.hasLaneOverview).toBe(true);
    expect(result.hasWarpFit).toBe(true);
    expect(result.hasOperatingDetails).toBe(true);
    expect(result.hasPricing).toBe(true);
    expect(result.hasValidate).toBe(true);
  });

  test("body-content does NOT contain STEP 1 or generic marketing tutorial copy", () => {
    const result = runNode(`
      import fs from "fs";
      const rendererSrc = fs.readFileSync("./lib/render-lane-page.js", "utf-8");
      // Extract only the section renderer functions (exclude comments and CSS constants)
      const fnSection = rendererSrc.slice(rendererSrc.indexOf("function renderLaneOverview"));
      console.log(JSON.stringify({
        hasRenderLanePageBody: rendererSrc.includes("renderLanePageBody"),
        bodyHasStep1: fnSection.includes("STEP 1"),
        bodyHasStep2: fnSection.includes("STEP 2"),
        bodyHasBookFreight: fnSection.includes("Book Freight Instantly"),
      }));
    `);

    expect(result.hasRenderLanePageBody).toBe(true);
    expect(result.bodyHasStep1).toBe(false);
    expect(result.bodyHasStep2).toBe(false);
    expect(result.bodyHasBookFreight).toBe(false);
  });
});

// ── Webflow Fields ──────────────────────────────────────────────────

test.describe("Webflow CMS Fields", () => {
  test("renderer renderWebflowFields sends all 19+ required fields", () => {
    const result = runNode(`
      import fs from "fs";
      const rendererSrc = fs.readFileSync("./lib/render-lane-page.js", "utf-8");
      const fnStart = rendererSrc.indexOf("function renderWebflowFields(") || rendererSrc.indexOf("export function renderWebflowFields(");
      const fnBlock = rendererSrc.slice(fnStart, fnStart + 5000);

      const requiredFieldSlugs = [
        "hero-headline", "subheadline",
        "body-content", "seo-title", "seo-meta-description", "canonical-url",
        "address", "origin", "destination", "mode", "segment",
        "traditional-ltl", "warp-ltl",
        "proof-section", "cta-primary-text", "cta-primary-url",
        "cta-secondary-text", "cta-secondary-url",
        "faq-schema", "breadcrumb-schema", "index-page",
      ];

      const missing = requiredFieldSlugs.filter(f => !fnBlock.includes(f));
      console.log(JSON.stringify({ total: requiredFieldSlugs.length, missing, allPresent: missing.length === 0 }));
    `);

    expect(result.allPresent).toBe(true);
  });

  test("renderer sends origin, destination, mode, segment fields in renderWebflowFields", () => {
    const result = runNode(`
      import fs from "fs";
      const rendererSrc = fs.readFileSync("./lib/render-lane-page.js", "utf-8");
      const fnStart = rendererSrc.indexOf("renderWebflowFields(");
      const fnBlock = rendererSrc.slice(fnStart, fnStart + 5000);
      const dq = String.fromCharCode(34);

      console.log(JSON.stringify({
        hasOrigin: fnBlock.includes(dq + "origin" + dq) || fnBlock.includes("origin:"),
        hasDestination: fnBlock.includes(dq + "destination" + dq) || fnBlock.includes("destination:"),
        hasMode: fnBlock.includes(dq + "mode" + dq) || fnBlock.includes("mode:"),
        hasSegment: fnBlock.includes(dq + "segment" + dq) || fnBlock.includes("segment:"),
        hasProofSection: fnBlock.includes(dq + "proof-section" + dq) || fnBlock.includes("proof-section"),
        hasBreadcrumbSchema: fnBlock.includes(dq + "breadcrumb-schema" + dq) || fnBlock.includes("breadcrumb-schema"),
      }));
    `);

    expect(result.hasOrigin).toBe(true);
    expect(result.hasDestination).toBe(true);
    expect(result.hasMode).toBe(true);
    expect(result.hasSegment).toBe(true);
    expect(result.hasProofSection).toBe(true);
    expect(result.hasBreadcrumbSchema).toBe(true);
  });
});

// ── FAQ Schema & Marketing CSS ──────────────────────────────────────

test.describe("FAQ Schema & Marketing CSS", () => {
  test("dedicated renderer includes marketing-hide CSS beyond just video", () => {
    const result = runNode(`
      import fs from "fs";
      const rendererSrc = fs.readFileSync("./lib/render-lane-page.js", "utf-8");
      console.log(JSON.stringify({
        hasWistiaCSS: rendererSrc.includes("wistia-player"),
        hasHideCSS: rendererSrc.includes("display: none !important") || rendererSrc.includes("display:none!important"),
        hideBookFreight: rendererSrc.includes("book-freight") || rendererSrc.includes("book-a-meeting"),
        hasFAQPageSchema: rendererSrc.includes("FAQPage"),
        hasVisibleFaqDetails: rendererSrc.includes("<details"),
        hasVisibleFaqSummary: rendererSrc.includes("<summary"),
      }));
    `);

    expect(result.hasWistiaCSS).toBe(true);
    expect(result.hasHideCSS).toBe(true);
    expect(result.hideBookFreight).toBe(true);
    expect(result.hasFAQPageSchema).toBe(true);
    expect(result.hasVisibleFaqDetails).toBe(true);
    expect(result.hasVisibleFaqSummary).toBe(true);
  });

  test("ship_firstpage imports renderer that hides marketing sections", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("./scripts/ship_firstpage.js", "utf-8");
      const rendererSrc = fs.readFileSync("./lib/render-lane-page.js", "utf-8");
      console.log(JSON.stringify({
        scriptImportsRenderer: src.includes("render-lane-page.js"),
        rendererHidesCTALinks: rendererSrc.includes("book-freight") || rendererSrc.includes("book-a-meeting"),
        rendererHasDetails: rendererSrc.includes("<details"),
        rendererHasSummary: rendererSrc.includes("<summary"),
      }));
    `);

    expect(result.scriptImportsRenderer).toBe(true);
    expect(result.rendererHidesCTALinks).toBe(true);
    expect(result.rendererHasDetails).toBe(true);
    expect(result.rendererHasSummary).toBe(true);
  });
});

// ── Breadcrumb Schema ───────────────────────────────────────────────

test.describe("Breadcrumb Schema", () => {
  test("dedicated renderer includes BreadcrumbList, Service, and Organization JSON-LD", () => {
    const result = runNode(`
      import fs from "fs";
      const rendererSrc = fs.readFileSync("./lib/render-lane-page.js", "utf-8");
      console.log(JSON.stringify({
        hasBreadcrumbList: rendererSrc.includes("BreadcrumbList"),
        hasRenderBreadcrumbSchemaEmbed: rendererSrc.includes("renderBreadcrumbSchemaEmbed"),
        hasService: rendererSrc.includes("Service"),
        hasOrganization: rendererSrc.includes("Organization"),
      }));
    `);

    expect(result.hasBreadcrumbList).toBe(true);
    expect(result.hasRenderBreadcrumbSchemaEmbed).toBe(true);
    expect(result.hasService).toBe(true);
    expect(result.hasOrganization).toBe(true);
  });
});

// ── Lane FAQs ───────────────────────────────────────────────────────

test.describe("Lane-Specific FAQs", () => {
  test("publish_next generates lane-specific FAQs (not generic)", () => {
    const result = runNode(`
      import fs from "fs";
      const pnSrc = fs.readFileSync("./scripts/publish_next.js", "utf-8");
      const lfSrc = fs.readFileSync("./lib/lane-factory.js", "utf-8");
      console.log(JSON.stringify({
        // publish_next imports buildLaneFaqs via lane-factory
        pnImportsLaneFactory: pnSrc.includes("lane-factory.js"),
        // lane-factory has the FAQ implementation
        hasBuildLaneFaqs: lfSrc.includes("buildLaneFaqs"),
        hasFaqTemplates: lfSrc.includes("FAQ_TEMPLATES"),
        hasFaqCall: lfSrc.includes("buildLaneFaqs(origin, destination"),
      }));
    `);

    expect(result.pnImportsLaneFactory).toBe(true);
    expect(result.hasBuildLaneFaqs).toBe(true);
    expect(result.hasFaqTemplates).toBe(true);
    expect(result.hasFaqCall).toBe(true);
  });
});

// ── Patch Script ────────────────────────────────────────────────────

test.describe("Patch Published Pages Script", () => {
  test("patch_published_pages.js exists with required structure", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("./scripts/patch_published_pages.js", "utf-8");
      console.log(JSON.stringify({
        hasPublishedPages: src.includes("published_pages.json"),
        hasWebflowPatch: src.includes("PATCH"),
        hasLiveFlag: src.includes("--live"),
        hasEnrichLaneInline: src.includes("enrichLaneInline"),
        hasBuildBodyContent: src.includes("buildBodyContent"),
        hasBuildFaqSchemaEmbed: src.includes("buildFaqSchemaEmbed"),
        hasBreadcrumb: src.includes("buildBreadcrumbSchemaEmbed"),
        hasRateLimit: src.includes("1100") || src.includes("1.1"),
      }));
    `);

    expect(result.hasPublishedPages).toBe(true);
    expect(result.hasWebflowPatch).toBe(true);
    expect(result.hasLiveFlag).toBe(true);
    expect(result.hasEnrichLaneInline).toBe(true);
    expect(result.hasBuildBodyContent).toBe(true);
    expect(result.hasBuildFaqSchemaEmbed).toBe(true);
    expect(result.hasBreadcrumb).toBe(true);
    expect(result.hasRateLimit).toBe(true);
  });
});

// ── Unique Intro Text ───────────────────────────────────────────────

test.describe("Unique Intro Text", () => {
  test("lane knowledge module produces unique lane-specific data for intros", () => {
    const result = runNode(`
      import fs from "fs";
      const knowledgeSrc = fs.readFileSync("./lib/lane-knowledge.js", "utf-8");
      const schemaSrc = fs.readFileSync("./lib/lane-page-schema.js", "utf-8");
      console.log(JSON.stringify({
        introUsesDistance: knowledgeSrc.includes("estimated_distance_miles") || schemaSrc.includes("estimated_distance_miles"),
        introUsesTransit: knowledgeSrc.includes("estimated_transit_days_range") || schemaSrc.includes("estimated_transit_days_range"),
        introUsesCarriers: knowledgeSrc.includes("estimated_carrier_count") || schemaSrc.includes("estimated_carrier_count"),
        introUsesCrossDocks: knowledgeSrc.includes("nearest_cross_docks") || schemaSrc.includes("nearest_cross_docks"),
      }));
    `);

    expect(result.introUsesDistance).toBe(true);
    expect(result.introUsesTransit).toBe(true);
    expect(result.introUsesCarriers).toBe(true);
    expect(result.introUsesCrossDocks).toBe(true);
  });
});

// ── New Architecture ────────────────────────────────────────────────

test.describe("New Architecture Pipeline", () => {
  test("rebuild_sample_lane_pages.js uses the complete new architecture pipeline", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("./scripts/rebuild_sample_lane_pages.js", "utf-8");
      console.log(JSON.stringify({
        importsLaneKnowledge: src.includes("lane-knowledge.js"),
        importsLanePageSchema: src.includes("lane-page-schema.js"),
        importsRenderLanePage: src.includes("render-lane-page.js"),
        importsValidator: src.includes("lane-page-validator.js"),
        hasBuildLaneKnowledge: src.includes("buildLaneKnowledge"),
        hasBuildCanonicalLanePageData: src.includes("buildCanonicalLanePageData"),
        hasRenderWebflowFields: src.includes("renderWebflowFields"),
        has10Lanes: src.includes("Miami, FL") && src.includes("Dallas, TX") && src.includes("Chicago, IL") && src.includes("Atlanta, GA"),
      }));
    `);

    expect(result.importsLaneKnowledge).toBe(true);
    expect(result.importsLanePageSchema).toBe(true);
    expect(result.importsRenderLanePage).toBe(true);
    expect(result.importsValidator).toBe(true);
    expect(result.hasBuildLaneKnowledge).toBe(true);
    expect(result.hasBuildCanonicalLanePageData).toBe(true);
    expect(result.hasRenderWebflowFields).toBe(true);
    expect(result.has10Lanes).toBe(true);
  });
});

// ── Mode-Specific Comparison ─────────────────────────────────────────

test.describe("Mode-Specific Comparison Content", () => {
  test("comparison content differs by mode (LTL ≠ FTL ≠ Cargo Van)", () => {
    const result = runNode(`
      import { buildLaneKnowledge } from "./lib/lane-knowledge.js";
      import { buildCanonicalLanePageData } from "./lib/lane-page-schema.js";
      import { renderWebflowFields } from "./lib/render-lane-page.js";

      function generateComparison(mode) {
        const knowledge = buildLaneKnowledge({ origin: "Chicago, IL", destination: "Dallas, TX", mode });
        const pageData = buildCanonicalLanePageData(knowledge, {
          corridor_hub: null, related_lanes: [],
          tool_link: "https://www.wearewarp.com/quote", data_link: null,
        });
        const fields = renderWebflowFields(pageData);
        return { traditional: fields["traditional-ltl"], warp: fields["warp-ltl"] };
      }

      const ltl = generateComparison("LTL");
      const ftl = generateComparison("FTL");
      const cv  = generateComparison("Cargo Van / Box Truck");

      console.log(JSON.stringify({
        ltlHasPallet: ltl.traditional.includes("Pallet Tracking") || ltl.traditional.includes("Pallet"),
        ftlHasCapacity: ftl.traditional.includes("Capacity Access") || ftl.traditional.includes("Capacity"),
        cvHasVehicle: cv.traditional.includes("Vehicle Matching") || cv.traditional.includes("Vehicle"),
        ltlNotEqualFtl: ltl.traditional !== ftl.traditional,
        ftlNotEqualCv: ftl.traditional !== cv.traditional,
        ltlNotEqualCv: ltl.traditional !== cv.traditional,
        ltlWarpNotFtlWarp: ltl.warp !== ftl.warp,
        ltlTradLen: ltl.traditional.length,
        ftlTradLen: ftl.traditional.length,
        cvTradLen: cv.traditional.length,
      }));
    `);

    expect(result.ltlHasPallet).toBe(true);
    expect(result.ftlHasCapacity).toBe(true);
    expect(result.cvHasVehicle).toBe(true);
    expect(result.ltlNotEqualFtl).toBe(true);
    expect(result.ftlNotEqualCv).toBe(true);
    expect(result.ltlNotEqualCv).toBe(true);
    expect(result.ltlWarpNotFtlWarp).toBe(true);
    expect(result.ltlTradLen).toBeGreaterThan(200);
    expect(result.ftlTradLen).toBeGreaterThan(200);
    expect(result.cvTradLen).toBeGreaterThan(200);
  });
});

// ── FAQ Schema Rich Text Compatibility ──────────────────────────────

test.describe("FAQ Schema Rich Text Compatibility", () => {
  test("faq-schema contains NO <script> or <style> tags (Rich Text safe)", () => {
    const result = runNode(`
      import { buildLaneKnowledge } from "./lib/lane-knowledge.js";
      import { buildCanonicalLanePageData } from "./lib/lane-page-schema.js";
      import { renderWebflowFields } from "./lib/render-lane-page.js";

      const knowledge = buildLaneKnowledge({ origin: "Atlanta, GA", destination: "Miami, FL", mode: "LTL" });
      const pageData = buildCanonicalLanePageData(knowledge, {
        corridor_hub: null, related_lanes: [],
        tool_link: "https://www.wearewarp.com/quote", data_link: null,
      });
      const fields = renderWebflowFields(pageData);
      const faqSchema = fields["faq-schema"];

      console.log(JSON.stringify({
        hasContent: faqSchema.length > 500,
        contentLen: faqSchema.length,
        hasNoScriptTag: !faqSchema.includes("<script"),
        hasNoStyleTag: !faqSchema.includes("<style"),
        hasInlineStyles: faqSchema.includes("style="),
        hasDarkBackground: faqSchema.includes("background:#121418") || faqSchema.includes("background:#0B0C0E"),
        hasOuterWrapper: faqSchema.startsWith("<div"),
      }));
    `);

    expect(result.hasContent).toBe(true);
    expect(result.contentLen).toBeGreaterThan(500);
    expect(result.hasNoScriptTag).toBe(true);
    expect(result.hasNoStyleTag).toBe(true);
    expect(result.hasInlineStyles).toBe(true);
    expect(result.hasDarkBackground).toBe(true);
    expect(result.hasOuterWrapper).toBe(true);
  });

  test("breadcrumb-schema contains FAQPage JSON-LD (moved from faq-schema)", () => {
    const result = runNode(`
      import { buildLaneKnowledge } from "./lib/lane-knowledge.js";
      import { buildCanonicalLanePageData } from "./lib/lane-page-schema.js";
      import { renderWebflowFields } from "./lib/render-lane-page.js";

      const knowledge = buildLaneKnowledge({ origin: "Los Angeles, CA", destination: "Phoenix, AZ", mode: "LTL" });
      const pageData = buildCanonicalLanePageData(knowledge, {
        corridor_hub: null, related_lanes: [],
        tool_link: "https://www.wearewarp.com/quote", data_link: null,
      });
      const fields = renderWebflowFields(pageData);
      const breadcrumb = fields["breadcrumb-schema"];

      console.log(JSON.stringify({
        hasBreadcrumbList: breadcrumb.includes("BreadcrumbList"),
        hasFAQPage: breadcrumb.includes("FAQPage"),
        hasScriptTags: breadcrumb.includes("<script"),
        hasMultipleSchemas: (breadcrumb.match(/application\\/ld\\+json/g) || []).length >= 2,
        breadcrumbLen: breadcrumb.length,
      }));
    `);

    expect(result.hasBreadcrumbList).toBe(true);
    expect(result.hasFAQPage).toBe(true);
    expect(result.hasScriptTags).toBe(true);
    expect(result.hasMultipleSchemas).toBe(true);
    expect(result.breadcrumbLen).toBeGreaterThan(500);
  });
});

// ── Update Script Coverage ──────────────────────────────────────────

test.describe("Update Lane Content Script", () => {
  test("update_lane_content.js pushes comparison, proof, faq-schema, and breadcrumb fields", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("./scripts/update_lane_content.js", "utf-8");
      const dq = String.fromCharCode(34);
      console.log(JSON.stringify({
        pushesTraditionalLtl: src.includes(dq + "traditional-ltl" + dq),
        pushesWarpLtl: src.includes(dq + "warp-ltl" + dq),
        pushesProofSection: src.includes(dq + "proof-section" + dq),
        pushesFaqSchema: src.includes(dq + "faq-schema" + dq),
        pushesBreadcrumbSchema: src.includes(dq + "breadcrumb-schema" + dq),
        usesItemMode: src.includes("item.fieldData?.mode"),
        noHardcodedLtlMode: !src.includes("mode: " + dq + "LTL" + dq + ", // Default"),
      }));
    `);

    expect(result.pushesTraditionalLtl).toBe(true);
    expect(result.pushesWarpLtl).toBe(true);
    expect(result.pushesProofSection).toBe(true);
    expect(result.pushesFaqSchema).toBe(true);
    expect(result.pushesBreadcrumbSchema).toBe(true);
    expect(result.usesItemMode).toBe(true);
    expect(result.noHardcodedLtlMode).toBe(true);
  });
});
