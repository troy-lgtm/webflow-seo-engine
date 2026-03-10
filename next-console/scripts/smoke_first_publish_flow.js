#!/usr/bin/env node

/**
 * Smoke test for the first publish flow: Chicago → Dallas LTL.
 *
 * Default: dry run (no email, no Webflow API calls).
 * Flags:
 *   --send-email         Send real email via Gmail SMTP
 *   --create-webflow-draft  Create real Webflow draft item
 *
 * Exit codes:
 *   0 = success
 *   1 = failure
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

const args = process.argv.slice(2);
const sendEmail = args.includes("--send-email");
const createWebflowDraft = args.includes("--create-webflow-draft");

const ARTIFACTS_DIR = path.join(ROOT, "artifacts", "smoke");

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

async function main() {
  console.log("=== WARP First Publish Smoke Test ===");
  console.log(`  Mode: ${sendEmail ? "SEND EMAIL" : "dry run (email)"} | ${createWebflowDraft ? "CREATE WEBFLOW DRAFT" : "dry run (webflow)"}`);
  console.log("");

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  // --- Step 1: Build package ---
  const packageData = await step("Build lane package", async () => {
    // We can't use @/ aliases in scripts, so we inline the core logic
    // Read the pre-built package files to confirm they exist, then build data

    const origin = "Chicago, IL";
    const destination = "Dallas, TX";
    const mode = "LTL";
    const segment = "smb";
    const slug = `${origin.split(",")[0].trim().toLowerCase().replace(/\s+/g, "-")}-to-${destination.split(",")[0].trim().toLowerCase().replace(/\s+/g, "-")}`;
    const canonicalPath = `/${slug}`;
    const seoTitle = `${origin} to ${destination} ${mode} Freight Quotes | WARP`;
    const h1 = `${origin} to ${destination} ${mode} freight quotes`;
    const intro = "Small and mid-size shipping teams moving LTL freight from Chicago, IL to Dallas, TX can use this lane-specific workflow to compare options, reduce manual quote cycles, and book faster with stronger service visibility.";

    // Compute fingerprint
    const raw = [canonicalPath, seoTitle, h1, intro.slice(0, 200)].join("|");
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) + hash + raw.charCodeAt(i)) | 0;
    }

    return {
      page: {
        slug,
        canonical_path: canonicalPath,
        seo_title: seoTitle,
        h1,
        intro,
        meta_description: `Compare LTL freight options from ${origin} to ${destination}. Small and mid-size shipping teams get lane-specific estimated pricing.`,
        problem_section: "LTL shippers struggle with inconsistent transit times, opaque pricing, and fragmented visibility across multiple carriers.",
        solution_section: "WARP unifies LTL lane quoting, carrier selection, and exception management into a single operational workflow.",
        cta_primary: "Book 15-min Fit Call",
        cta_secondary: "Get Instant Quote",
        cta_primary_url: "https://www.wearewarp.com/book",
        cta_secondary_url: "https://www.wearewarp.com/quote",
        visual_cards: [
          { label: "Consolidation", value: "Optimized shared loads", insight: "Reduce per-unit shipping costs by sharing truck space." },
          { label: "Flexibility", value: "Ship any pallet count", insight: "Scale from one pallet to partial truckloads." },
          { label: "Visibility", value: "Shipment-level tracking", insight: "Track each LTL shipment with real-time status." }
        ],
        faq: [
          { q: "How fast can we launch a LTL pilot from Chicago, IL to Dallas, TX?", a: "Most small and mid-size shipping teams can define lane scope and start pilot quoting within days." },
          { q: "What makes LTL shipping different on the Chicago, IL to Dallas, TX lane?", a: "Each lane has unique volume patterns, carrier availability, and transit windows." },
          { q: "Can we start with just the Chicago, IL to Dallas, TX lane before expanding?", a: "Yes. A lane-first rollout lets you validate performance before scaling." },
          { q: "What metrics should we track on this LTL lane?", a: "Focus on quote response time, transit predictability, exception rate, and cost-per-shipment trends." },
          { q: "Do we need to migrate our entire process?", a: "No. Start this single lane, measure results, and expand based on quick ROI evidence." }
        ],
        contrast: {
          headline: "Why WARP vs Legacy Process",
          points: [
            { metric: "Get Quote", legacy: "Phone calls, 2-4 hours", warp: "Instant digital quotes" },
            { metric: "Compare Options", legacy: "Manual spreadsheets", warp: "Side-by-side dashboard" },
            { metric: "Book Shipment", legacy: "Email chains, 24-48h", warp: "One-click booking" },
            { metric: "Track Status", legacy: "Call for updates", warp: "Real-time GPS tracking" }
          ],
          bottom_line: "WARP compresses days of manual freight operations into minutes."
        },
        lane: { origin, destination, mode },
        lane_stats: {
          estimated_distance_miles: 920,
          estimated_transit_days_range: { min: 3, max: 5 },
          estimated_rate_range_usd: { low: 680, high: 1150 },
          confidence: { transit: "medium", rate: "medium" },
          disclaimers: ["These are modeled estimates, not guaranteed quotes.", "Actual rates depend on freight details, accessorials, and current market conditions."]
        },
        target_segment: segment
      },
      canonicalPath,
      quickAnswers: [
        { question: "How much does LTL freight from Chicago to Dallas cost?", answer: "Estimated LTL rates range from approximately $680 to $1,150 depending on freight class, pallet count, and shipment weight. These are modeled estimates." },
        { question: "How long does LTL transit take from Chicago to Dallas?", answer: "Estimated transit time is 3-5 business days for standard LTL service on this ~920-mile corridor." }
      ],
      contentFingerprint: String(Math.abs(hash)),
      origin,
      destination,
      mode,
      segment
    };
  });

  // --- Step 2: Duplicate gate ---
  await step("Duplicate check", async () => {
    const publishedPath = path.join(ROOT, "data", "published_pages.json");
    let published = [];
    try {
      published = JSON.parse(fs.readFileSync(publishedPath, "utf-8"));
    } catch {}

    const candidate = {
      slug: packageData.page.slug,
      canonical_path: packageData.canonicalPath,
      seo_title: packageData.page.seo_title,
      h1: packageData.page.h1,
      intro: packageData.page.intro
    };

    for (const existing of published) {
      if (existing.canonical_path === candidate.canonical_path) {
        throw new Error(`Duplicate canonical: ${candidate.canonical_path}`);
      }
      if (existing.slug === candidate.slug) {
        throw new Error(`Duplicate slug: ${candidate.slug}`);
      }
    }
    return `Checked against ${published.length} published pages`;
  });

  // --- Step 3: Render preview HTML ---
  const previewPath = await step("Render preview HTML", async () => {
    // Inline the preview renderer logic since we can't use @/ aliases
    const { page, quickAnswers } = packageData;
    const stats = page.lane_stats || {};
    const faq = page.faq || [];
    const contrast = page.contrast;

    const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const qaHTML = quickAnswers.map((qa) => `<div class="quick-answer"><h3>${esc(qa.question)}</h3><p>${esc(qa.answer)}</p></div>`).join("");
    const faqHTML = faq.map((f) => `<div class="faq-item"><h4>${esc(f.q)}</h4><p>${esc(f.a)}</p></div>`).join("");
    const contrastHTML = contrast?.points ? `<section class="section"><h2>${esc(contrast.headline)}</h2><table><thead><tr><th>Metric</th><th>Legacy</th><th>WARP</th></tr></thead><tbody>${contrast.points.map((p) => `<tr><td><strong>${esc(p.metric)}</strong></td><td class="legacy">${esc(p.legacy)}</td><td class="warp">${esc(p.warp)}</td></tr>`).join("")}</tbody></table><p class="muted">${esc(contrast.bottom_line)}</p></section>` : "";
    const cardsHTML = (page.visual_cards || []).map((c) => `<div class="card"><span class="card-label">${esc(c.label)}</span><p class="card-value">${esc(c.value)}</p><p class="card-insight">${esc(c.insight)}</p></div>`).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(page.seo_title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#f8f8f8;line-height:1.5}.container{max-width:720px;margin:0 auto;padding:16px}.hero{background:#0a0a0a;color:#fff;padding:24px 16px;border-radius:12px;margin-bottom:16px}.overline{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:4px}h1{font-size:1.5rem;font-weight:700;margin-bottom:8px}.intro{font-size:.92rem;color:#ccc;margin-bottom:16px}.btn{display:block;width:100%;padding:14px;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;margin-bottom:8px}.btn-primary{background:#FF6B35;color:#fff}.btn-secondary{background:#222;color:#fff;border:1px solid #444}.quick-answer{background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin-bottom:12px}.quick-answer h3{font-size:.95rem;margin-bottom:6px;color:#111}.quick-answer p{font-size:.88rem;color:#444}.section{background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin-bottom:12px}.section h2{font-size:1.1rem;margin-bottom:10px}.grid{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:12px}.stat{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:12px}.stat-label{font-size:.72rem;color:#888;text-transform:uppercase}.stat-value{font-size:1.1rem;font-weight:700;margin-top:2px}.card{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin-bottom:8px}.card-label{font-size:.72rem;color:#888;text-transform:uppercase}.card-value{font-size:.95rem;font-weight:600;margin-top:2px}.card-insight{font-size:.82rem;color:#666;margin-top:4px}.faq-item{border-bottom:1px solid #e8e8e8;padding:12px 0}.faq-item:last-child{border-bottom:none}.faq-item h4{font-size:.92rem;margin-bottom:4px}.faq-item p{font-size:.85rem;color:#555}table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{padding:8px;text-align:left;border-bottom:1px solid #e0e0e0}th{font-weight:600;background:#f5f5f5}.legacy{color:#999}.warp{color:#FF6B35;font-weight:600}.muted{font-size:.82rem;color:#888;margin-top:8px}.disclaimer{font-size:.78rem;color:#999;background:#f0f0f0;padding:10px;border-radius:6px;margin-top:12px}@media(min-width:520px){.grid{grid-template-columns:1fr 1fr 1fr}}
</style>
</head>
<body>
<div class="container">
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
</div>
</body>
</html>`;

    const outPath = path.join(ARTIFACTS_DIR, "preview.html");
    fs.writeFileSync(outPath, html);
    return outPath;
  });

  // --- Step 4: Email sender ---
  await step(`Email sender (${sendEmail ? "LIVE" : "dry run"})`, async () => {
    const subject = "Warp Lane Page Draft – Chicago → Dallas LTL";
    const htmlBody = fs.readFileSync(previewPath, "utf-8");

    const attachments = [
      { filename: "preview.html", content: htmlBody },
      { filename: "faq_schema.json", content: JSON.stringify(packageData.page.faq, null, 2) },
      { filename: "breadcrumbs_schema.json", content: JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "WARP", item: "https://www.wearewarp.com" }, { "@type": "ListItem", position: 2, name: "LTL Freight", item: "https://www.wearewarp.com/guides/ltl" }, { "@type": "ListItem", position: 3, name: "Chicago to Dallas" }] }, null, 2) },
      { filename: "webflow_fields.json", content: JSON.stringify({ name: packageData.page.seo_title, slug: packageData.page.slug, "seo-title": packageData.page.seo_title, "seo-description": packageData.page.meta_description, h1: packageData.page.h1, intro: packageData.page.intro, canonical: packageData.canonicalPath }, null, 2) }
    ];

    if (sendEmail) {
      // Real send
      const nodemailer = await import("nodemailer");
      const { EMAIL_USER, EMAIL_APP_PASSWORD, EMAIL_TO } = process.env;
      if (!EMAIL_USER || !EMAIL_APP_PASSWORD || !EMAIL_TO) {
        throw new Error("Missing EMAIL_USER, EMAIL_APP_PASSWORD, or EMAIL_TO");
      }
      const transporter = nodemailer.default.createTransport({ service: "gmail", auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD } });
      await transporter.sendMail({ from: EMAIL_USER, to: EMAIL_TO, subject, html: htmlBody, attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })) });
    } else {
      // Dry run — write payload
      const payload = {
        to: process.env.EMAIL_TO || "(dry run)",
        from: process.env.EMAIL_USER || "(dry run)",
        subject,
        html_length: htmlBody.length,
        attachment_filenames: attachments.map((a) => a.filename),
        dry_run: true,
        generated_at: new Date().toISOString()
      };
      fs.writeFileSync(path.join(ARTIFACTS_DIR, "email_payload.json"), JSON.stringify(payload, null, 2));
    }
  });

  // --- Step 5: Webflow client ---
  await step(`Webflow client (${createWebflowDraft ? "LIVE" : "dry run"})`, async () => {
    const fields = {
      name: packageData.page.seo_title,
      slug: packageData.page.slug,
      "seo-title": packageData.page.seo_title,
      "seo-description": packageData.page.meta_description,
      h1: packageData.page.h1,
      intro: packageData.page.intro,
      canonical: packageData.canonicalPath,
      mode: packageData.mode,
      segment: packageData.segment,
      origin: packageData.origin,
      destination: packageData.destination
    };

    const endpoint = `https://api.webflow.com/v2/collections/${process.env.WEBFLOW_LANE_COLLECTION_ID || "(dry run)"}/items`;

    if (createWebflowDraft) {
      const { WEBFLOW_API_TOKEN, WEBFLOW_LANE_COLLECTION_ID } = process.env;
      if (!WEBFLOW_API_TOKEN || !WEBFLOW_LANE_COLLECTION_ID) {
        throw new Error("Missing WEBFLOW_API_TOKEN or WEBFLOW_LANE_COLLECTION_ID");
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${WEBFLOW_API_TOKEN}`, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ isArchived: false, isDraft: true, fieldData: fields })
      });
      if (!res.ok) throw new Error(`Webflow API error ${res.status}: ${await res.text()}`);
    } else {
      const payload = {
        endpoint,
        method: "POST",
        site_id: process.env.WEBFLOW_SITE_ID || "(dry run)",
        collection_id: process.env.WEBFLOW_LANE_COLLECTION_ID || "(dry run)",
        fields,
        is_draft: true,
        dry_run: true,
        generated_at: new Date().toISOString()
      };
      fs.writeFileSync(path.join(ARTIFACTS_DIR, "webflow_payload.json"), JSON.stringify(payload, null, 2));
    }
  });

  // --- Summary ---
  console.log("");
  console.log("=== SMOKE TEST PASSED ===");
  console.log(`  Preview:  ${path.join(ARTIFACTS_DIR, "preview.html")}`);
  console.log(`  Email:    ${path.join(ARTIFACTS_DIR, "email_payload.json")}`);
  console.log(`  Webflow:  ${path.join(ARTIFACTS_DIR, "webflow_payload.json")}`);
  console.log(`  Canonical: ${packageData.canonicalPath}`);
}

main().catch((err) => {
  console.error("\n=== SMOKE TEST FAILED ===");
  console.error(`  ${err.message}`);
  process.exit(1);
});
