#!/usr/bin/env node

/**
 * Ship First Page — Chicago → Dallas LTL
 *
 * Steps:
 * 1. Build lane package
 * 2. Duplicate gate check
 * 3. Render preview HTML
 * 4. Create Webflow DRAFT item (or dry run)
 * 5. Send approval email (or dry run)
 * 6. Write job record to data/approval_jobs.json
 *
 * Default: dry run (safe). No publish, no email.
 *
 * npm run ship:firstpage                  # dry run — artifacts only, no API calls, no email
 * npm run ship:firstpage:staging          # LIVE: create draft → publish item → publish staging → verify URL (60s) → email
 *
 * Email is ONLY sent when the staging preview URL is verified live (HTTP 200, real content).
 * If verification fails within 60s, the pipeline exits 1 and does NOT send email.
 *
 * Flags (used by npm scripts, not called directly):
 * --live                  = --create-webflow-draft + --send-email
 * --publish-staging       = publish to staging subdomain + verify URL
 * --send-email            = send approval email (only if staging URL is verified when --publish-staging is set)
 */

// --- Load .env.local FIRST, before anything else ---
import { config } from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";
import { runFullValidation } from "../lib/lane-page-validator.js";
import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import { renderLanePageBody, renderLanePageHtml, renderFaqSchemaEmbed, renderBreadcrumbSchemaEmbed, renderWebflowFields } from "../lib/render-lane-page.js";
import { safeRegistryUpdate, loadRegistry } from "../lib/publish-registry-disk.js";
import {
  createManifest, setIntended, addPublished, addFailed, addBlocked,
  setDeploy, setEmail, setSampleLiveUrls, addWarning,
  finalizeManifest, saveManifest, printManifestSummary,
} from "../lib/publish-manifest.js";
import {
  verifyLiveUrl, buildReceipt, saveReceipt, printReceipt,
  buildConfirmationEmailHtml,
} from "../lib/publish-receipt.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

// Load .env.local explicitly
config({ path: path.join(ROOT, ".env.local") });

const args = process.argv.slice(2);
const isLive = args.includes("--live");
const isSendEmail = args.includes("--send-email") || isLive;
const isCreateWebflowDraft = args.includes("--create-webflow-draft") || isLive;
const isPublishStaging = args.includes("--publish-staging");
const ARTIFACTS_DIR = path.join(ROOT, "artifacts", "ship");

async function step(label, fn) {
  process.stdout.write(`  ${label}... `);
  try {
    const result = await fn();
    console.log("OK");
    return result;
  } catch (err) {
    console.log("FAILED");
    console.error(`    Error: ${err.message}`);
    process.exit(1);
  }
}

// --- Inline helpers (can't use @/ aliases in scripts) ---

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Build a Webflow CMS slug for the Lanes collection.
 * Convention: {origin-city}-to-{destination-city}  (no mode prefix)
 * Example: "Chicago, IL" + "Dallas, TX" → "chicago-to-dallas"
 */
function buildLaneSlug(origin, destination) {
  const citySlug = (s) =>
    s.split(",")[0].trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `${citySlug(origin)}-to-${citySlug(destination)}`;
}

function enrichLaneInline(page) {
  if (!page?.lane) return;
  const knowledge = buildLaneKnowledge(page.lane);
  page.lane_stats = knowledge.lane_stats;
  page.network_proof = knowledge.network_proof;
}

function buildPackageData() {
  const origin = "Chicago, IL";
  const destination = "Dallas, TX";
  const mode = "LTL";
  const segment = "smb";
  const slug = buildLaneSlug(origin, destination);
  const canonicalPath = `/${slug}`;
  const oCity = "Chicago";
  const dCity = "Dallas";
  const seoTitle = `${origin} to ${destination} ${mode} Freight Quotes | WARP`;
  const h1 = `${origin} to ${destination} ${mode} freight quotes`;
  const metaDescription = `Compare ${mode} freight rates from ${oCity} to ${dCity}. Get instant quotes, estimated transit times, and book freight in minutes with WARP.`;

  const page = {
    slug,
    canonical_path: canonicalPath,
    seo_title: seoTitle,
    h1,
    meta_description: metaDescription,
    target_segment: segment,
    lane: { origin, destination, mode },
    lane_stats: {},
    network_proof: {},
    problem_section: `LTL shippers on the ${oCity} to ${dCity} corridor struggle with inconsistent transit times, opaque pricing from legacy brokers, and fragmented visibility across multiple carriers. Most teams spend hours chasing quotes and tracking updates manually.`,
    solution_section: `WARP provides instant ${mode} quotes on the ${oCity} to ${dCity} lane with real-time carrier comparison, one-click booking, and proactive exception management — replacing days of manual work with minutes of operational efficiency.`,
    cta_primary: "Book 15-min Fit Call",
    cta_secondary: "Get Instant Quote",
    cta_primary_url: "https://www.wearewarp.com/book",
    cta_secondary_url: "https://www.wearewarp.com/quote",
    contrast: {
      headline: `Why ${mode} shippers switch from brokers to WARP`,
      points: [
        { metric: "Quote speed", legacy: "2–24 hours via phone/email", warp: "Under 2 minutes, self-serve" },
        { metric: "Carrier comparison", legacy: "Manual spreadsheets", warp: "Side-by-side dashboard with performance data" },
        { metric: "Booking", legacy: "Email chains, 30–60 min", warp: "One-click from quote to BOL" },
        { metric: "Tracking", legacy: "Call carrier for updates", warp: "Real-time dashboard with exception alerts" },
        { metric: "Exception handling", legacy: "Reactive, hours to discover", warp: "Proactive alerts within 30 minutes" },
      ],
      bottom_line: `Shipping ${mode} from ${oCity} to ${dCity} with WARP eliminates the manual back-and-forth that costs logistics teams hours per shipment.`,
    },
  };

  // Enrich with real lane intelligence
  enrichLaneInline(page);

  const stats = page.lane_stats;

  // Lane-specific intro
  page.intro = `${mode} freight from ${origin} to ${destination} covers approximately ${stats.estimated_distance_miles.toLocaleString()} miles with estimated transit of ${stats.estimated_transit_days_range.min}–${stats.estimated_transit_days_range.max} business days. WARP's carrier network on this corridor includes ${page.network_proof.estimated_carrier_count}+ providers with cross-dock facilities at ${page.network_proof.nearest_cross_docks.slice(0, 3).join(", ")}. Get instant lane-specific quotes, compare carriers, and book in minutes.`;

  page.proof_section = `Validate this lane with a controlled pilot: ${origin} to ${destination}. Track quote response time, transit predictability, and exception rate across ${page.network_proof.estimated_carrier_count} active carriers on this ${stats.estimated_distance_miles}-mile corridor. Equipment includes ${stats.common_equipment.join(" and ")}. Start with this single lane, measure results, and expand based on data.`;

  // Lane-specific FAQs
  page.faq = [
    { q: `How long does LTL freight take from Chicago to Dallas?`, a: `Estimated transit for LTL freight on this ${stats.estimated_distance_miles}-mile lane is ${stats.estimated_transit_days_range.min}–${stats.estimated_transit_days_range.max} business days. Actual transit depends on pickup schedule, carrier routing, and weather conditions.` },
    { q: `How much does LTL shipping from Chicago to Dallas cost?`, a: `Estimated LTL rates on this lane range from $${stats.estimated_rate_range_usd.low.toLocaleString()} to $${stats.estimated_rate_range_usd.high.toLocaleString()} depending on weight, freight class, pallet count, and seasonal demand.` },
    { q: `How fast can we launch a LTL pilot from Chicago to Dallas?`, a: `Most shipping teams can scope a single-lane pilot and begin quoting within days. Start with this corridor, measure quote speed and transit reliability, then expand based on results.` },
    { q: `How does WARP handle tracking on the Chicago to Dallas lane?`, a: `WARP provides real-time visibility with scan events at pickup, in-transit checkpoints, and delivery confirmation. Exception alerts fire within 30 minutes of any status change.` },
    { q: `What equipment is available for LTL freight from Chicago to Dallas?`, a: `Common equipment on this lane includes ${stats.common_equipment.join(", ")}. Equipment availability varies by season and demand.` },
  ];

  // Schemas
  page.schema_breadcrumb = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "WARP", item: "https://www.wearewarp.com" },
      { "@type": "ListItem", position: 2, name: `${mode} Freight`, item: `https://www.wearewarp.com/guides/${mode.toLowerCase()}` },
      { "@type": "ListItem", position: 3, name: `${oCity} to ${dCity}` },
    ],
  };
  page.schema_service = {
    "@context": "https://schema.org", "@type": "Service",
    name: `${mode} Freight Service — ${oCity} to ${dCity}`,
    provider: { "@type": "Organization", name: "WARP", url: "https://www.wearewarp.com" },
    areaServed: [origin, destination],
    description: `${mode} freight shipping from ${origin} to ${destination} with instant quoting, carrier comparison, and real-time tracking.`,
  };
  page.schema_organization = {
    "@context": "https://schema.org", "@type": "Organization",
    name: "WARP", url: "https://www.wearewarp.com", description: "Technology-driven freight logistics platform",
  };

  const fp = String(stableHash([canonicalPath, seoTitle, h1, page.intro.slice(0, 200)].join("|")));

  return {
    page,
    canonicalPath,
    quickAnswers: [
      { question: `How much does LTL freight from Chicago to Dallas cost?`, answer: `Estimated LTL rates on this lane range from $${stats.estimated_rate_range_usd.low.toLocaleString()} to $${stats.estimated_rate_range_usd.high.toLocaleString()} depending on weight, freight class, pallet count, and seasonal demand.` },
      { question: `How long does LTL transit take from Chicago to Dallas?`, answer: `Estimated transit time for LTL freight on this ${stats.estimated_distance_miles}-mile lane is ${stats.estimated_transit_days_range.min}–${stats.estimated_transit_days_range.max} business days under standard conditions.` },
    ],
    contentFingerprint: fp,
    origin,
    destination,
    mode,
    segment,
  };
}

function renderPreview(packageData) {
  const { page, quickAnswers } = packageData;
  const stats = page.lane_stats || {};
  const faq = page.faq || [];
  const contrast = page.contrast;
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const qaHTML = quickAnswers.map((qa) => `<div class="quick-answer"><h3>${esc(qa.question)}</h3><p>${esc(qa.answer)}</p></div>`).join("");
  const faqHTML = faq.map((f) => `<div class="faq-item"><h4>${esc(f.q)}</h4><p>${esc(f.a)}</p></div>`).join("");
  const contrastHTML = contrast?.points
    ? `<section class="section"><h2>${esc(contrast.headline)}</h2><table><thead><tr><th>Metric</th><th>Legacy</th><th>WARP</th></tr></thead><tbody>${contrast.points.map((p) => `<tr><td><strong>${esc(p.metric)}</strong></td><td class="legacy">${esc(p.legacy)}</td><td class="warp">${esc(p.warp)}</td></tr>`).join("")}</tbody></table><p class="muted">${esc(contrast.bottom_line)}</p></section>`
    : "";
  const cardsHTML = (page.visual_cards || []).map((c) => `<div class="card"><span class="card-label">${esc(c.label)}</span><p class="card-value">${esc(c.value)}</p><p class="card-insight">${esc(c.insight)}</p></div>`).join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(page.seo_title)}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#f8f8f8;line-height:1.5}.container{max-width:720px;margin:0 auto;padding:16px}.hero{background:#0a0a0a;color:#fff;padding:24px 16px;border-radius:12px;margin-bottom:16px}.overline{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:4px}h1{font-size:1.5rem;font-weight:700;margin-bottom:8px}.intro{font-size:.92rem;color:#ccc;margin-bottom:16px}.btn{display:block;width:100%;padding:14px;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;margin-bottom:8px}.btn-primary{background:#FF6B35;color:#fff}.btn-secondary{background:#222;color:#fff;border:1px solid #444}.quick-answer{background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin-bottom:12px}.quick-answer h3{font-size:.95rem;margin-bottom:6px;color:#111}.quick-answer p{font-size:.88rem;color:#444}.section{background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin-bottom:12px}.section h2{font-size:1.1rem;margin-bottom:10px}.grid{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:12px}.stat{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:12px}.stat-label{font-size:.72rem;color:#888;text-transform:uppercase}.stat-value{font-size:1.1rem;font-weight:700;margin-top:2px}.card{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin-bottom:8px}.card-label{font-size:.72rem;color:#888;text-transform:uppercase}.card-value{font-size:.95rem;font-weight:600;margin-top:2px}.card-insight{font-size:.82rem;color:#666;margin-top:4px}.faq-item{border-bottom:1px solid #e8e8e8;padding:12px 0}.faq-item:last-child{border-bottom:none}.faq-item h4{font-size:.92rem;margin-bottom:4px}.faq-item p{font-size:.85rem;color:#555}table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{padding:8px;text-align:left;border-bottom:1px solid #e0e0e0}th{font-weight:600;background:#f5f5f5}.legacy{color:#999}.warp{color:#FF6B35;font-weight:600}.muted{font-size:.82rem;color:#888;margin-top:8px}.disclaimer{font-size:.78rem;color:#999;background:#f0f0f0;padding:10px;border-radius:6px;margin-top:12px}@media(min-width:520px){.grid{grid-template-columns:1fr 1fr 1fr}}</style>
</head><body><div class="container">
<section class="hero"><p class="overline">WARP Freight</p><h1 data-testid="preview-h1">${esc(page.h1)}</h1><p class="intro">${esc(page.intro)}</p><a class="btn btn-primary" href="${esc(page.cta_secondary_url)}" data-testid="cta-btn">${esc(page.cta_secondary)}</a><a class="btn btn-secondary" href="${esc(page.cta_primary_url)}">${esc(page.cta_primary)}</a></section>
<section data-testid="quick-answers"><h2 style="font-size:1rem;margin-bottom:8px">Quick Answers</h2>${qaHTML}</section>
<div class="grid"><div class="stat"><span class="stat-label">Distance</span><p class="stat-value">~${(stats.estimated_distance_miles || 0).toLocaleString()} mi</p></div><div class="stat"><span class="stat-label">Transit (est.)</span><p class="stat-value">${stats.estimated_transit_days_range?.min}-${stats.estimated_transit_days_range?.max} days</p></div><div class="stat"><span class="stat-label">Rate (est.)</span><p class="stat-value">$${stats.estimated_rate_range_usd?.low?.toLocaleString()}-$${stats.estimated_rate_range_usd?.high?.toLocaleString()}</p></div></div>
<section class="section"><h2>Why ${esc(page.lane?.mode)} on This Lane</h2>${cardsHTML}</section>
<section class="section"><h2>Problem</h2><p style="font-size:.88rem;color:#444">${esc(page.problem_section)}</p></section>
<section class="section"><h2>Solution</h2><p style="font-size:.88rem;color:#444">${esc(page.solution_section)}</p></section>
${contrastHTML}
<section class="section" data-testid="faq-section"><h2>Frequently Asked Questions</h2>${faqHTML}</section>
<div class="disclaimer">${(stats.disclaimers || []).map((d) => `<p>${esc(d)}</p>`).join("")}</div>
<div style="margin-top:16px"><a class="btn btn-primary" href="${esc(page.cta_secondary_url)}">${esc(page.cta_secondary)}</a></div>
<p class="muted" style="margin-top:12px;text-align:center">Canonical: ${esc(packageData.canonicalPath)}</p>
</div></body></html>`;
}

// --- Operational content builders (delegated to extracted modules) ---

function buildBodyContent(page) {
  const knowledge = buildLaneKnowledge(page.lane);
  knowledge.origin = page.lane.origin;
  knowledge.destination = page.lane.destination;
  knowledge.segment = page.target_segment || "smb";
  const canonicalData = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null, related_lanes: [], tool_link: "https://www.wearewarp.com/quote", data_link: null,
  });
  // renderLanePageHtml returns full HTML (for validation).
  // renderLanePageBody returns plain text (for Webflow CMS body-content field).
  return renderLanePageHtml(canonicalData);
}

function buildFaqSchemaEmbed(page) {
  const knowledge = buildLaneKnowledge(page.lane);
  knowledge.origin = page.lane.origin;
  knowledge.destination = page.lane.destination;
  knowledge.segment = page.target_segment || "smb";
  const canonicalData = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null, related_lanes: [], tool_link: "https://www.wearewarp.com/quote", data_link: null,
  });
  return renderFaqSchemaEmbed(canonicalData);
}

function buildBreadcrumbSchemaEmbed(page) {
  const knowledge = buildLaneKnowledge(page.lane);
  knowledge.origin = page.lane.origin;
  knowledge.destination = page.lane.destination;
  knowledge.segment = page.target_segment || "smb";
  const canonicalData = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null, related_lanes: [], tool_link: "https://www.wearewarp.com/quote", data_link: null,
  });
  return renderBreadcrumbSchemaEmbed(canonicalData);
}

function buildWebflowFields(page) {
  const knowledge = buildLaneKnowledge(page.lane);
  knowledge.origin = page.lane.origin;
  knowledge.destination = page.lane.destination;
  knowledge.segment = page.target_segment || "smb";
  const canonicalData = buildCanonicalLanePageData(knowledge, {
    corridor_hub: null, related_lanes: [], tool_link: "https://www.wearewarp.com/quote", data_link: null,
  });
  return renderWebflowFields(canonicalData);
}

function writeRunLog({ dryRun, emailAttempted, emailSent, messageId, errorSummary, from, to, subject, urlsTried, publishStatus, fieldAudit }) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const log = {
    timestamp: new Date().toISOString(),
    dryRun: !!dryRun,
    emailAttempted: !!emailAttempted,
    emailSent: !!emailSent,
    messageId: messageId || null,
    errorSummary: errorSummary || null,
    urlsTried: urlsTried || null,
    publishStatus: publishStatus || null,
    fieldAudit: fieldAudit || null,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    from: from || process.env.EMAIL_USER || "(not set)",
    to: to || process.env.EMAIL_TO || "(not set)",
    subject: subject || "(not set)"
  };
  fs.writeFileSync(path.join(ARTIFACTS_DIR, "run_log.json"), JSON.stringify(log, null, 2));
  return log;
}

// --- Webflow client helpers ---
import { getItem, listCollectionItems, publishCollectionItem, findCmsTemplatePage } from "../lib/webflow-client.js";

// --- Staging URL discovery (imported from lib) ---
import { discoverWorkingStagingUrl, CANDIDATE_PATHS, StagingDiscoveryError } from "../lib/staging-url-discovery.js";

// --- Main ---

async function main() {
  const emailDryRun = !isSendEmail;
  const isDryRun = !isCreateWebflowDraft;

  // Create publish manifest for this run
  const runManifest = createManifest({
    scriptName: "ship_firstpage.js",
    triggerSource: "manual",
    dryRun: isDryRun,
  });
  setIntended(runManifest, 1);

  console.log("=== WARP Ship First Page ===");
  if (isDryRun) {
    console.log("  ╔═══════════════════════════════╗");
    console.log("  ║         DRY RUN MODE          ║");
    console.log("  ║  No pages will be published   ║");
    console.log("  ║  No emails will be sent       ║");
    console.log("  ╚═══════════════════════════════╝");
  }
  console.log(`  Webflow: ${isCreateWebflowDraft ? "LIVE DRAFT" : "DRY RUN"}`);
  console.log(`  Staging: ${isPublishStaging ? "WILL PUBLISH to staging subdomain" : "OFF (no --publish-staging)"}`);
  console.log(`  Email:   ${isPublishStaging && isSendEmail ? "WILL SEND (after staging URL verified)" : "OFF (email requires --publish-staging)"}`);
  console.log(`  Run ID:  ${runManifest.run_id}`);
  console.log("");

  // Fail fast: if email will be sent (requires --publish-staging + --send-email), check env vars
  if (isSendEmail && isPublishStaging) {
    const missing = [];
    if (!process.env.EMAIL_USER) missing.push("EMAIL_USER");
    if (!process.env.EMAIL_APP_PASSWORD) missing.push("EMAIL_APP_PASSWORD");
    if (!process.env.EMAIL_TO) missing.push("EMAIL_TO");
    if (missing.length > 0) {
      console.error(`  FATAL: Missing env vars for email: ${missing.join(", ")}`);
      console.error("  Set these in .env.local and retry.");
      writeRunLog({ dryRun: false, emailAttempted: true, emailSent: false, errorSummary: `Missing env vars: ${missing.join(", ")}`, subject: "Warp Draft Ready Chicago To Dallas LTL" });
      process.exit(1);
    }
  }

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  // Step 1: Build package
  const packageData = await step("Build lane package", () => buildPackageData());

  // Step 1b: Lane page validation gate
  await step("Lane page validation", () => {
    const bodyHtml = buildBodyContent(packageData.page);
    const faqEmbed = buildFaqSchemaEmbed(packageData.page);
    const breadcrumbEmbed = buildBreadcrumbSchemaEmbed(packageData.page);
    const validation = runFullValidation(packageData.page, bodyHtml, faqEmbed, breadcrumbEmbed);

    // Store validation result on the package
    packageData.page.quality_score = validation.quality_score;
    packageData.page.banned_content_scan_result = validation.banned_content_found.length === 0 ? "clean" : validation.banned_content_found;
    packageData.page.rendered_html_validation_result = validation.valid ? "passed" : validation.errors.map(e => e.message);

    if (!validation.valid) {
      const failedGates = Object.entries(validation.gates).filter(([, v]) => !v).map(([k]) => k);
      const blockMsg = `Validation BLOCKED: ${failedGates.join(", ")} | score: ${validation.quality_score}`;

      // Write blocked artifact for inspection
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(ARTIFACTS_DIR, "validation_blocked.json"),
        JSON.stringify({ validation, slug: packageData.page.slug, generated_at: new Date().toISOString() }, null, 2)
      );

      addBlocked(runManifest, { slug: packageData.page.slug, reason: blockMsg, rule_id: "VALIDATION-BLOCK" });
      throw new Error(blockMsg);
    }

    console.log(`score: ${validation.quality_score}`);
    return validation;
  });

  // Step 2: Duplicate gate (uses shared registry)
  await step("Duplicate check", () => {
    const { entries: published } = loadRegistry();
    for (const existing of published) {
      if (existing.canonical_path === packageData.canonicalPath) {
        addBlocked(runManifest, { slug: packageData.page.slug, reason: `Duplicate canonical: ${packageData.canonicalPath}`, rule_id: "DUP-CANONICAL-01" });
        throw new Error(`Duplicate canonical: ${packageData.canonicalPath}`);
      }
      if (existing.slug === packageData.page.slug) {
        addBlocked(runManifest, { slug: packageData.page.slug, reason: `Duplicate slug: ${packageData.page.slug}`, rule_id: "DUP-SLUG-01" });
        throw new Error(`Duplicate slug: ${packageData.page.slug}`);
      }
    }
    return `Checked against ${published.length} published pages`;
  });

  // Step 3: Render preview
  const previewHtml = await step("Render preview HTML", () => {
    const html = renderPreview(packageData);
    const previewPath = path.join(ARTIFACTS_DIR, "preview.html");
    fs.writeFileSync(previewPath, html);
    return html;
  });

  // Step 4: Create Webflow draft
  const webflowResult = await step(
    `Create Webflow draft (${isCreateWebflowDraft ? "LIVE" : "dry run"})`,
    async () => {
      const fields = buildWebflowFields(packageData.page, packageData.canonicalPath);
      const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID || "(dry-run-collection)";
      const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items`;

      if (!isCreateWebflowDraft) {
        const payload = {
          endpoint,
          method: "POST",
          collection_id: collectionId,
          fields,
          is_draft: true,
          dry_run: true,
          generated_at: new Date().toISOString()
        };
        fs.writeFileSync(
          path.join(ARTIFACTS_DIR, "webflow_payload.json"),
          JSON.stringify(payload, null, 2)
        );
        return { itemId: "dry-run-item-" + crypto.randomUUID().slice(0, 8), dryRun: true };
      }

      const { WEBFLOW_API_TOKEN, WEBFLOW_SITE_ID } = process.env;
      const missingWf = [];
      if (!WEBFLOW_API_TOKEN) missingWf.push("WEBFLOW_API_TOKEN");
      if (!WEBFLOW_SITE_ID) missingWf.push("WEBFLOW_SITE_ID");
      if (!process.env.WEBFLOW_LANE_COLLECTION_ID) missingWf.push("WEBFLOW_LANE_COLLECTION_ID");
      if (missingWf.length > 0) {
        writeRunLog({ dryRun: false, emailAttempted: false, emailSent: false, errorSummary: `Missing Webflow env vars: ${missingWf.join(", ")}`, subject: "Warp Draft Ready Chicago To Dallas LTL" });
        throw new Error(`Missing ${missingWf.join(", ")}.\n    Add these to .env.local to create a real Webflow draft.\n    Or use --send-email without --create-webflow-draft to only send email.`);
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
          "Content-Type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({ isArchived: false, isDraft: true, fieldData: fields })
      });
      if (!res.ok) throw new Error(`Webflow API error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return { itemId: data.id, dryRun: false, siteId: WEBFLOW_SITE_ID, collectionId };
    }
  );

  // Track publish in manifest
  if (!webflowResult.dryRun) {
    addPublished(runManifest, {
      slug: packageData.page.slug,
      webflow_item_id: webflowResult.itemId,
      url: `https://www.wearewarp.com/lanes/${packageData.page.slug}`,
    });
    setDeploy(runManifest, {
      status: "draft_created",
      id: webflowResult.itemId,
      provider: "webflow",
    });
  }

  // Step 4b: Verify item is published (not stuck as draft)
  if (!webflowResult.dryRun) {
    await step("Verify CMS item publish status", async () => {
      const collectionId = webflowResult.collectionId;
      const itemId = webflowResult.itemId;

      // 1. GET item to check isDraft flag
      const item = await getItem({ collectionId, itemId });
      const isDraft = item.isDraft ?? true;
      console.log(`\n    isDraft=${isDraft}, id=${itemId}`);

      if (isDraft) {
        // 2. Publish the item explicitly
        console.log("    Item is still draft — publishing explicitly...");
        await publishCollectionItem({ collectionId, itemId });

        // 3. Re-fetch to confirm
        const after = await getItem({ collectionId, itemId });
        const stillDraft = after.isDraft ?? true;
        console.log(`    After publish: isDraft=${stillDraft}`);
        if (stillDraft) {
          throw new Error(
            `Item ${itemId} is still isDraft=true after publishCollectionItem. ` +
            `The Webflow CMS item may need manual attention.`
          );
        }
      }

      return { isDraft, itemId };
    });
  }

  // Step 4c: Field audit — compare our fields against a known-good item
  if (!webflowResult.dryRun) {
    await step("Field audit against known-good item", async () => {
      const collectionId = webflowResult.collectionId;
      const ourFields = buildWebflowFields(packageData.page, packageData.canonicalPath);

      // List existing items to find a known-good published one
      const items = await listCollectionItems({ collectionId, limit: 20 });
      const goodItem = items.find((i) => !i.isDraft && i.id !== webflowResult.itemId);

      if (!goodItem) {
        console.log("\n    ⚠ No known-good published item found for comparison. Skipping field audit.");
        return { skipped: true };
      }

      const goodFields = goodItem.fieldData || {};
      const ourKeys = Object.keys(ourFields);
      const goodKeys = Object.keys(goodFields);

      // Compare
      const missing = goodKeys.filter((k) => !ourKeys.includes(k) && k !== "slug" && k !== "name");
      const extra = ourKeys.filter((k) => !goodKeys.includes(k) && k !== "slug" && k !== "name");
      const empty = ourKeys.filter((k) => {
        const v = ourFields[k];
        return v === "" || v === null || v === undefined;
      });

      console.log(`\n    Known-good item: "${goodItem.fieldData?.name || goodItem.id}" (${goodItem.id})`);
      console.log(`    Good item fields: ${goodKeys.length} | Our fields: ${ourKeys.length}`);
      if (missing.length) console.log(`    ⚠ MISSING in our payload (present in good item): ${missing.join(", ")}`);
      if (extra.length) console.log(`    ℹ EXTRA in our payload (not in good item): ${extra.join(", ")}`);
      if (empty.length) console.log(`    ⚠ EMPTY in our payload: ${empty.join(", ")}`);

      // Fail fast if critical template fields are missing
      // These are the fields the Webflow template likely depends on to render
      const criticalFields = goodKeys.filter((k) => {
        const v = goodFields[k];
        // A field is "critical" if it's non-empty in the good item
        return v !== "" && v !== null && v !== undefined && k !== "slug" && k !== "name";
      });
      const missingCritical = criticalFields.filter((k) => !ourKeys.includes(k));

      if (missingCritical.length > 0) {
        const report = missingCritical.map((k) => `  - ${k}: "${String(goodFields[k]).slice(0, 60)}..."`).join("\n");
        writeRunLog({
          dryRun: false,
          emailAttempted: false,
          emailSent: false,
          errorSummary: `Field audit failed: ${missingCritical.length} critical fields missing from payload: ${missingCritical.join(", ")}`,
          subject: "Warp Draft Ready Chicago To Dallas LTL",
        });
        throw new Error(
          `Field audit FAILED — ${missingCritical.length} fields present in known-good item but missing from our payload:\n${report}\n` +
          `    Update buildWebflowFields() to include these fields.`
        );
      }

      return { missing, extra, empty, goodItemId: goodItem.id };
    });
  }

  // Step 5: Publish to Webflow staging (if --publish-staging)
  let stagingUrl = null;
  if (isPublishStaging && !webflowResult.dryRun) {
    // 5a. Fetch real slug from Webflow to confirm it matches
    const realSlug = await step("Fetch real slug from Webflow", async () => {
      const { WEBFLOW_API_TOKEN } = process.env;
      const collectionId = webflowResult.collectionId;
      const itemId = webflowResult.itemId;
      const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`;
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${WEBFLOW_API_TOKEN}`, accept: "application/json" }
      });
      if (!res.ok) throw new Error(`Fetch item error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const slug = data.fieldData?.slug || data.slug || packageData.page.slug;
      if (slug !== packageData.page.slug) {
        console.log(`\n    ⚠ Webflow slug "${slug}" differs from local slug "${packageData.page.slug}". Using Webflow slug.`);
      }
      return slug;
    });

    // 5b. Detect CMS template path from Webflow Pages API
    const detectedTemplatePath = await step("Detect CMS template path from API", async () => {
      const siteId = webflowResult.siteId;
      const collectionId = webflowResult.collectionId;
      try {
        const result = await findCmsTemplatePage({ siteId, collectionId });
        if (result) {
          console.log(`\n    Found CMS template page: "${result.title}" → ${result.templatePath} (page ${result.pageId})`);
          return result.templatePath;
        }
        console.log("\n    ⚠ No CMS template page found for Lanes collection via API. Will try candidate paths.");
        return null;
      } catch (err) {
        console.log(`\n    ⚠ Could not fetch site pages: ${err.message}. Will try candidate paths.`);
        return null;
      }
    });

    stagingUrl = await step("Publish to Webflow staging", async () => {
      const { WEBFLOW_API_TOKEN } = process.env;
      const collectionId = webflowResult.collectionId;
      const siteId = webflowResult.siteId;

      // 1. Publish the CMS item (makes it visible in staging, not production)
      const itemPubEndpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/publish`;
      const itemRes = await fetch(itemPubEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
          "Content-Type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({ itemIds: [webflowResult.itemId] })
      });
      if (!itemRes.ok) throw new Error(`Item publish error ${itemRes.status}: ${await itemRes.text()}`);

      // 2. Publish site to staging subdomain ONLY (never to custom domains / wearewarp.com)
      const sitePubEndpoint = `https://api.webflow.com/v2/sites/${siteId}/publish`;
      const siteRes = await fetch(sitePubEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
          "Content-Type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({ publishToWebflowSubdomain: true })
      });
      if (!siteRes.ok) throw new Error(`Staging publish error ${siteRes.status}: ${await siteRes.text()}`);

      // 3. Get site shortName for staging domain
      const siteInfoRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}`, {
        headers: { Authorization: `Bearer ${WEBFLOW_API_TOKEN}`, accept: "application/json" }
      });
      const siteData = await siteInfoRes.json();
      const shortName = siteData.shortName || siteId;
      console.log(`\n    Staging domain: ${shortName}.webflow.io`);

      // 4. Discover working staging URL
      //    Priority: overridePath (env) → detectedTemplatePath (API) → CANDIDATE_PATHS (hardcoded)
      //    Throws StagingDiscoveryError if all fail — writes run_log, does NOT send email.
      const overridePath = process.env.WEBFLOW_LANES_TEMPLATE_PATH || null;
      const originDest = `${packageData.origin} to ${packageData.destination}`;
      try {
        const discovery = await discoverWorkingStagingUrl({
          shortName,
          itemSlug: realSlug,
          overridePath,
          detectedPath: detectedTemplatePath,
          maxRetries: 30,
          retryDelayMs: 2000,
          positiveMarkers: [originDest],
        });
        return discovery.url;
      } catch (discoveryErr) {
        if (discoveryErr.name === "StagingDiscoveryError") {
          writeRunLog({
            dryRun: false,
            emailAttempted: false,
            emailSent: false,
            errorSummary: discoveryErr.message,
            urlsTried: discoveryErr.urlsTried,
            subject: "Warp Draft Ready Chicago To Dallas LTL",
          });
          console.log("");
          console.log("  Email NOT sent — no verified staging preview URL.");
          console.log(`  Run log: ${path.join(ARTIFACTS_DIR, "run_log.json")}`);
          process.exit(1);
        }
        throw discoveryErr;
      }
    });
  } else if (isPublishStaging && webflowResult.dryRun) {
    console.log("  Publish to Webflow staging... SKIPPED (Webflow draft is dry run — use with --create-webflow-draft)");
  }

  // Step 6: Send approval email
  // Email is ONLY sent when staging URL is verified live.
  // No --publish-staging or dry run → skip email entirely.
  const approvalId = crypto.randomUUID();
  const subject = "Warp Draft Ready Chicago To Dallas LTL";

  if (stagingUrl) {
    // Staging URL verified — send email with the live preview link
    await step("Send approval email (staging verified)", async () => {
      const emailHtml = buildApprovalEmailHtml({
        approvalId,
        seoTitle: packageData.page.seo_title,
        canonicalPath: packageData.canonicalPath,
        webflowItemId: webflowResult.itemId,
        webflowDryRun: webflowResult.dryRun,
        webflowSiteId: webflowResult.siteId || null,
        webflowCollectionId: webflowResult.collectionId || null,
        stagingUrl,
        packageData
      });

      // Always save email HTML artifact for inspection
      fs.writeFileSync(path.join(ARTIFACTS_DIR, "email_preview.html"), emailHtml);

      // Live email — use nodemailer with SMTP verification
      const nodemailer = await import("nodemailer");
      const { EMAIL_USER, EMAIL_APP_PASSWORD, EMAIL_TO } = process.env;

      const transport = nodemailer.default.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD }
      });

      // Verify SMTP first
      try {
        await transport.verify();
      } catch (verifyErr) {
        writeRunLog({ dryRun: false, emailAttempted: true, emailSent: false, errorSummary: `SMTP verify failed: ${verifyErr.message}`, from: EMAIL_USER, to: EMAIL_TO, subject });
        throw new Error(`SMTP verification failed: ${verifyErr.message}\n    Probable cause: incorrect EMAIL_APP_PASSWORD or EMAIL_USER, or Gmail app password not set up.\n    See: https://myaccount.google.com/apppasswords`);
      }

      try {
        const info = await transport.sendMail({ from: EMAIL_USER, to: EMAIL_TO, subject, html: emailHtml });
        console.log("");
        console.log(`  EMAIL SENT: ${info.messageId} to ${EMAIL_TO}`);
        writeRunLog({ dryRun: false, emailAttempted: true, emailSent: true, messageId: info.messageId, from: EMAIL_USER, to: EMAIL_TO, subject });
      } catch (sendErr) {
        writeRunLog({ dryRun: false, emailAttempted: true, emailSent: false, errorSummary: `sendMail failed: ${sendErr.message}`, from: EMAIL_USER, to: EMAIL_TO, subject });
        throw new Error(`Email send failed: ${sendErr.message}`);
      }
    });
  } else {
    // No staging URL — write dry-run artifacts, skip email
    await step("Write email artifacts (no staging URL — email skipped)", async () => {
      const emailHtml = buildApprovalEmailHtml({
        approvalId,
        seoTitle: packageData.page.seo_title,
        canonicalPath: packageData.canonicalPath,
        webflowItemId: webflowResult.itemId,
        webflowDryRun: webflowResult.dryRun,
        webflowSiteId: webflowResult.siteId || null,
        webflowCollectionId: webflowResult.collectionId || null,
        stagingUrl: null,
        packageData
      });
      fs.writeFileSync(path.join(ARTIFACTS_DIR, "email_preview.html"), emailHtml);
      const payload = {
        to: process.env.EMAIL_TO || "(dry run)",
        from: process.env.EMAIL_USER || "(dry run)",
        subject,
        approval_id: approvalId,
        webflow_item_id: webflowResult.itemId,
        html_length: emailHtml.length,
        email_skipped: true,
        reason: "No verified staging URL — email only sent after staging preview passes",
        dry_run: true,
        generated_at: new Date().toISOString()
      };
      fs.writeFileSync(
        path.join(ARTIFACTS_DIR, "email_payload.json"),
        JSON.stringify(payload, null, 2)
      );
      writeRunLog({ dryRun: true, emailAttempted: false, emailSent: false, subject });
    });
  }

  // Step 7: Write approval job record (legacy — kept for backward compat)
  await step("Write approval job", () => {
    const jobsPath = path.join(ROOT, "data", "approval_jobs.json");
    let jobs = [];
    try {
      jobs = JSON.parse(fs.readFileSync(jobsPath, "utf-8"));
    } catch {}

    const job = {
      approval_id: approvalId,
      webflow_item_id: webflowResult.itemId,
      canonical_path: packageData.canonicalPath,
      slug: packageData.page.slug,
      seo_title: packageData.page.seo_title,
      origin: packageData.origin,
      destination: packageData.destination,
      mode: packageData.mode,
      segment: packageData.segment,
      created_at: new Date().toISOString(),
      last_sent_at: new Date().toISOString(),
      status: "awaiting_reply",
      last_email_subject: subject,
      last_preview_path: path.join(ARTIFACTS_DIR, "preview.html"),
      staging_url: stagingUrl || null,
      dry_run: isDryRun,
      package_data: packageData,
      run_id: runManifest.run_id,
    };

    jobs.push(job);
    fs.writeFileSync(jobsPath, JSON.stringify(jobs, null, 2));
    return job;
  });

  // Step 8: Update shared registry (safe merge — never destructive)
  if (!webflowResult.dryRun) {
    await step("Update shared registry", () => {
      const newEntry = {
        slug: packageData.page.slug,
        webflow_item_id: webflowResult.itemId,
        published_at_iso: new Date().toISOString(),
        dry_run: false,
        canonical_path: packageData.canonicalPath,
        seo_title: packageData.page.seo_title,
        h1: packageData.page.h1,
        origin_city: packageData.origin,
        destination_city: packageData.destination,
        mode: packageData.mode,
        segment: packageData.segment,
        source_script: "ship_firstpage.js",
        run_id: runManifest.run_id,
      };
      const regResult = safeRegistryUpdate([newEntry], { source: "ship_firstpage" });
      console.log(`registry: ${regResult.added} added, ${regResult.updated} updated, ${regResult.total} total`);
      for (const w of regResult.warnings) {
        addWarning(runManifest, w);
      }
      return regResult;
    });
  }

  // Step 9: Write publish audit trail (legacy — kept for backward compat)
  await step("Write publish audit trail", async () => {
    try {
      const {
        buildPublishDecision: buildPD,
        writePublishDecision: writePD,
        appendPublishRunHistory: appendHistory,
        buildRunSummary,
        writePublishedPagesLatest,
        buildPublishConfirmationReport: buildReport,
      } = await import("../lib/publish-audit.js");

      const isProduction = isCreateWebflowDraft && isPublishStaging && stagingUrl;
      const deployStatus = webflowResult.dryRun ? "unknown" : (stagingUrl ? "success" : "unknown");

      const decision = buildPD({
        mode: isProduction ? "production" : (isCreateWebflowDraft ? "staging" : "dry"),
        environment: isProduction ? "vercel-production" : "local",
        siteBaseUrl: "https://www.wearewarp.com",
        deploy: {
          provider: "webflow",
          deployment_id: webflowResult.itemId || "unknown",
          deployment_url: stagingUrl || "unknown",
          commit_sha: "unknown",
          branch: "unknown",
          status: deployStatus,
        },
        lanes: [{
          lane_slug: packageData.page.slug,
          status: "indexed",
          indexable: true,
          corridor: "unknown",
        }],
        blockedReasons: [],
        allowed: true,
        errors: [],
      });

      writePD(decision);
      appendHistory(buildRunSummary(decision));

      writePublishedPagesLatest({
        runId: decision.run_id,
        timestamp: decision.timestamp,
        liveIndexablePages: [{
          page_path: `/lanes/${packageData.page.slug}`,
          page_type: "lane",
          lane_slug: packageData.page.slug,
          corridor_id: "unknown",
        }],
        liveNoindexPages: [],
        blockedPages: [],
      });

      buildReport({ publishDecision: decision });
      return decision.run_id;
    } catch (auditErr) {
      console.log(`audit trail warning: ${auditErr.message}`);
      return null;
    }
  });

  // Step 10: Set email tracking in manifest
  if (stagingUrl && isSendEmail) {
    // Email was already sent in step 6 — track in manifest
    // (actual email result was already written to run_log.json)
    const runLog = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, "run_log.json"), "utf-8"));
    setEmail(runManifest, {
      attempted: true,
      sent: !!runLog.emailSent,
      recipient: runLog.to || process.env.EMAIL_TO || "unknown",
      error: runLog.errorSummary || null,
      providerResponse: runLog.messageId || null,
    });
  } else {
    setEmail(runManifest, {
      attempted: false,
      sent: false,
      skipReason: stagingUrl ? "email flag not set" : "no staging URL verified",
    });
  }

  // Step 11: Set sample live URLs
  if (!webflowResult.dryRun) {
    setSampleLiveUrls(runManifest, [`https://www.wearewarp.com/lanes/${packageData.page.slug}`]);
  }

  // Step 12: Finalize and save manifest
  finalizeManifest(runManifest);
  const { path: manifestPath } = saveManifest(runManifest);

  // Step 13: Print manifest summary (canonical output format)
  printManifestSummary(runManifest);

  // Step 14: Generate and save receipt (canonical post-publish receipt)
  {
    let verificationResults = [];
    if (!webflowResult.dryRun && stagingUrl) {
      // Verify the live URL
      try {
        const v = await verifyLiveUrl(
          `https://www.wearewarp.com/lanes/${packageData.page.slug}`,
          packageData.page.slug
        );
        verificationResults = [v];
      } catch (verifyErr) {
        verificationResults = [{
          slug: packageData.page.slug,
          url: `https://www.wearewarp.com/lanes/${packageData.page.slug}`,
          status: "published_unverified",
          httpStatus: null,
          identityMatch: false,
          error: verifyErr.message,
        }];
      }
    } else if (isDryRun) {
      verificationResults = [{
        slug: packageData.page.slug,
        url: `https://www.wearewarp.com/lanes/${packageData.page.slug}`,
        status: "dry_run",
        httpStatus: null,
        identityMatch: false,
        error: "dry_run",
      }];
    }

    const receipt = buildReceipt(runManifest, verificationResults);
    receipt.recipient = process.env.EMAIL_TO || "troy@wearewarp.com";
    const { path: receiptPath } = saveReceipt(receipt);
    printReceipt(receipt);
    console.log(`  Receipt: ${receiptPath}`);
  }

  // Legacy summary
  console.log("");
  console.log("=== SHIP FIRST PAGE COMPLETE ===");
  console.log(`  Approval ID:  ${approvalId}`);
  console.log(`  Webflow Item: ${webflowResult.itemId}`);
  console.log(`  Status:       awaiting_reply`);
  console.log(`  Preview:      ${path.join(ARTIFACTS_DIR, "preview.html")}`);
  if (stagingUrl) console.log(`  Staging URL:  ${stagingUrl}`);
  console.log(`  Run log:      ${path.join(ARTIFACTS_DIR, "run_log.json")}`);
  console.log(`  Jobs file:    ${path.join(ROOT, "data", "approval_jobs.json")}`);
  console.log(`  Manifest:     ${manifestPath}`);
  if (!stagingUrl) {
    console.log("");
    console.log("  No staging URL — email was NOT sent.");
    if (isDryRun) {
      console.log("  Dry run — no external API calls were made.");
    }
    console.log("  To publish and email: npm run ship:firstpage:staging");
  }
}

function buildApprovalEmailHtml({ approvalId, seoTitle, canonicalPath, webflowItemId, webflowDryRun, webflowSiteId, webflowCollectionId, stagingUrl, packageData }) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const page = packageData.page;

  // --- Warp brand tokens ---
  const bg = "#0B0C0E";
  const surface = "#121418";
  const border = "rgba(255,255,255,0.08)";
  const text = "#E8E8E8";
  const muted = "#A7A7A7";
  const accent = "#00FF33";
  const fontStack = "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

  // --- Preview link section (plain text URL, no button) ---
  let previewLinkSection;
  if (stagingUrl) {
    previewLinkSection = `<tr><td style="padding:20px 24px;background:${surface};border:1px solid ${border};border-radius:8px;" data-testid="staging-preview-section">
      <p style="margin:0;font-size:12px;color:${accent};text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Preview Link (Staging)</p>
      <p style="margin:8px 0 0;">
        <a href="${esc(stagingUrl)}" style="color:${accent};text-decoration:none;font-size:13px;font-family:monospace;" data-testid="email-preview-link">${esc(stagingUrl)}</a>
      </p>
      <p style="margin:8px 0 0;font-size:11px;color:${muted};">Staging subdomain only. Not visible on wearewarp.com.</p>
    </td></tr>`;
  } else {
    previewLinkSection = `<tr><td style="padding:16px 24px;background:${surface};border:1px solid ${border};border-radius:8px;" data-testid="preview-not-staged">
      <p style="margin:0;font-size:12px;color:${muted};text-transform:uppercase;letter-spacing:0.05em;">Preview</p>
      <p style="margin:6px 0 0;font-size:13px;color:#FF6B35;">Staging publish not enabled — no live preview link.</p>
    </td></tr>`;
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:${bg};font-family:${fontStack};-webkit-font-smoothing:antialiased;" data-testid="warp-email">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${bg};">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

  <!-- HEADER -->
  <tr><td style="padding:0 0 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td><span style="font-size:20px;font-weight:700;color:${accent};letter-spacing:0.02em;">WARP</span></td>
      <td align="right"><span style="font-size:12px;color:${muted};">Draft Review</span></td>
    </tr></table>
  </td></tr>

  <!-- TITLE -->
  <tr><td style="padding:24px;background:${surface};border:1px solid ${border};border-radius:12px;">
    <p style="margin:0;font-size:12px;color:${accent};text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Lane Page Ready for Review</p>
    <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:${text};line-height:1.3;">${esc(page.h1)}</h1>
  </td></tr>
  <tr><td style="height:16px;"></td></tr>

  <!-- PREVIEW LINK -->
  ${previewLinkSection}
  <tr><td style="height:16px;"></td></tr>

  <!-- APPROVAL ID -->
  <tr><td style="padding:16px 24px;background:${surface};border:1px solid ${border};border-radius:8px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:4px 0;"><span style="font-size:12px;color:${muted};text-transform:uppercase;">Approval ID</span></td><td align="right" style="padding:4px 0;font-size:13px;font-family:monospace;color:${accent};" data-testid="approval-id">${esc(approvalId)}</td></tr>
    </table>
  </td></tr>
  <tr><td style="height:16px;"></td></tr>

  <!-- HOW TO RESPOND -->
  <tr><td style="padding:20px 24px;background:#1a1c10;border:1px solid #3d3d00;border-radius:8px;" data-testid="reply-instructions">
    <p style="margin:0;font-size:16px;font-weight:700;color:${text};">How to respond</p>
    <p style="margin:8px 0 4px;font-size:14px;color:${text};"><strong>Approve &amp; publish:</strong> Reply <span style="font-family:monospace;background:rgba(0,255,51,0.1);color:${accent};padding:2px 6px;border-radius:4px;">yes</span></p>
    <p style="margin:4px 0;font-size:14px;color:${text};"><strong>Request edits:</strong> Reply <span style="font-family:monospace;background:rgba(255,107,53,0.1);color:#FF6B35;padding:2px 6px;border-radius:4px;">no edit: your instructions</span></p>
    <p style="margin:8px 0 0;font-size:12px;color:${muted};">Example: no edit: shorten the intro, make the problem section more specific to LTL pain points</p>
  </td></tr>
  <tr><td style="height:20px;"></td></tr>

  <!-- FOOTER -->
  <tr><td style="padding:16px 0;border-top:1px solid ${border};">
    <p style="margin:0;font-size:11px;color:${muted};">This is an automated draft review email from WARP SEO Engine. Do not forward outside your team.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

main().catch((err) => {
  console.error("\n=== SHIP FAILED ===");
  console.error(`  ${err.message}`);
  process.exit(1);
});
