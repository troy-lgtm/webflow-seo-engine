import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { resolveFromRoot } from "@/lib/fs/project-root.js";
import { safeRegistryUpdate } from "@/lib/publish-registry-disk.js";

const JOBS_PATH = resolveFromRoot("data", "approval_jobs.json");
const ARTIFACTS_DIR = resolveFromRoot("artifacts", "ship");

function loadJobs() {
  try {
    return JSON.parse(fs.readFileSync(JOBS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveJobs(jobs) {
  fs.writeFileSync(JOBS_PATH, JSON.stringify(jobs, null, 2));
}

/**
 * POST /api/approval
 *
 * Body: { secret, approval_id, action: "approve" | "edit", edit_instructions? }
 *
 * - Validates APPROVAL_WEBHOOK_SECRET
 * - Finds job by approval_id
 * - approve: publishes Webflow item, marks job approved, sends confirmation email
 * - edit: applies edits, updates draft, emails new preview, resets to awaiting_reply
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { secret, approval_id, action, edit_instructions } = body;

  // Validate secret
  const expectedSecret = process.env.APPROVAL_WEBHOOK_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate required fields
  if (!approval_id) {
    return NextResponse.json({ error: "Missing approval_id" }, { status: 400 });
  }
  if (!action || !["approve", "edit"].includes(action)) {
    return NextResponse.json(
      { error: 'Invalid action. Must be "approve" or "edit".' },
      { status: 400 }
    );
  }

  // Load jobs
  const jobs = loadJobs();
  const jobIndex = jobs.findIndex((j) => j.approval_id === approval_id);
  if (jobIndex === -1) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const job = jobs[jobIndex];

  // Determine dry run from job or environment
  const isDryRun = job.dry_run !== false;

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  if (action === "approve") {
    return handleApprove(jobs, jobIndex, isDryRun);
  } else {
    return handleEdit(jobs, jobIndex, edit_instructions || "", isDryRun);
  }
}

async function handleApprove(jobs, jobIndex, isDryRun) {
  const job = jobs[jobIndex];

  // Publish the Webflow item
  const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID || "(dry-run-collection)";
  const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/publish`;

  if (!isDryRun) {
    const { WEBFLOW_API_TOKEN } = process.env;
    if (!WEBFLOW_API_TOKEN) {
      return NextResponse.json({ error: "Missing WEBFLOW_API_TOKEN" }, { status: 500 });
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
        "Content-Type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({ itemIds: [job.webflow_item_id] })
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Webflow publish failed: ${res.status} ${text}` },
        { status: 502 }
      );
    }
  } else {
    // Dry run — write publish payload
    const payload = {
      endpoint,
      method: "POST",
      item_id: job.webflow_item_id,
      collection_id: collectionId,
      dry_run: true,
      generated_at: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, "webflow_publish_payload.json"),
      JSON.stringify(payload, null, 2)
    );
  }

  // Update shared registry (safe merge — never destructive)
  safeRegistryUpdate([{
    slug: job.slug,
    webflow_item_id: job.webflow_item_id,
    canonical_path: job.canonical_path,
    seo_title: job.seo_title,
    h1: job.package_data?.page?.h1 || "",
    origin_city: (job.origin || "").replace(/,.*/, "").trim(),
    destination_city: (job.destination || "").replace(/,.*/, "").trim(),
    mode: job.mode,
    segment: job.segment,
    published_at_iso: new Date().toISOString(),
    wave_id: "wave-1",
    dry_run: isDryRun,
    source_script: "approval/route.js",
  }], { source: "approval/route" });

  // Send confirmation email via canonical email-sender.js
  if (!isDryRun) {
    try {
      const { createTransportFromEnv, verifyTransport } = await import("@/lib/email-sender.js");
      const transporter = await createTransportFromEnv();
      const verification = await verifyTransport(transporter);
      if (verification.ok) {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: process.env.EMAIL_TO,
          subject: `Published: ${job.seo_title}`,
          html: `<h1>Page Published</h1><p>${job.seo_title}</p><p>Canonical: ${job.canonical_path}</p><p>Webflow Item: ${job.webflow_item_id}</p>`
        });
      }
    } catch {}
  }

  // Update job status
  jobs[jobIndex] = { ...job, status: "approved", approved_at: new Date().toISOString() };
  saveJobs(jobs);

  return NextResponse.json({
    success: true,
    action: "approved",
    approval_id: job.approval_id,
    webflow_item_id: job.webflow_item_id,
    canonical_path: job.canonical_path,
    dry_run: isDryRun
  });
}

async function handleEdit(jobs, jobIndex, editInstructions, isDryRun) {
  const job = jobs[jobIndex];
  const packageData = job.package_data;

  if (!packageData) {
    return NextResponse.json({ error: "Job missing package_data" }, { status: 400 });
  }

  // Apply edits
  const updatedPackage = applyEditsInline(packageData, editInstructions);
  const page = updatedPackage.page;

  // Re-render preview
  const previewHtml = renderPreviewInline(updatedPackage);
  const previewPath = path.join(ARTIFACTS_DIR, "preview.html");
  fs.writeFileSync(previewPath, previewHtml);

  // Update Webflow draft
  const fields = {
    name: page.seo_title,
    slug: page.slug,
    "seo-title": page.seo_title,
    "seo-description": page.meta_description,
    h1: page.h1,
    intro: page.intro,
    "problem-section": page.problem_section,
    "solution-section": page.solution_section,
    origin: page.lane?.origin || "",
    destination: page.lane?.destination || "",
    mode: page.lane?.mode || "",
    segment: page.target_segment || "smb",
    "canonical-url": updatedPackage.canonicalPath,
    "cta-primary-text": page.cta_primary,
    "cta-primary-url": page.cta_primary_url,
    "cta-secondary-text": page.cta_secondary,
    "cta-secondary-url": page.cta_secondary_url
  };

  const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID || "(dry-run-collection)";

  if (!isDryRun) {
    const { WEBFLOW_API_TOKEN } = process.env;
    if (!WEBFLOW_API_TOKEN) {
      return NextResponse.json({ error: "Missing WEBFLOW_API_TOKEN" }, { status: 500 });
    }
    const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/${job.webflow_item_id}`;
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
        "Content-Type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({ isArchived: false, isDraft: true, fieldData: fields })
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Webflow update failed: ${res.status} ${text}` },
        { status: 502 }
      );
    }
  } else {
    const payload = {
      endpoint: `https://api.webflow.com/v2/collections/${collectionId}/items/${job.webflow_item_id}`,
      method: "PATCH",
      item_id: job.webflow_item_id,
      fields,
      dry_run: true,
      generated_at: new Date().toISOString()
    };
    fs.writeFileSync(
      path.join(ARTIFACTS_DIR, "webflow_update_payload.json"),
      JSON.stringify(payload, null, 2)
    );
  }

  // Send edit-applied email via canonical email-sender.js
  if (!isDryRun) {
    try {
      const { createTransportFromEnv, verifyTransport } = await import("@/lib/email-sender.js");
      const transporter = await createTransportFromEnv();
      const verification = await verifyTransport(transporter);
      if (verification.ok) {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: process.env.EMAIL_TO,
          subject: `Warp Draft Updated ${job.canonical_path}`,
          html: `<h1>Draft Updated</h1><p>Edits applied: ${editInstructions}</p><hr>${previewHtml}`
        });
      }
    } catch {}
  }

  // Update job
  jobs[jobIndex] = {
    ...job,
    status: "awaiting_reply",
    last_sent_at: new Date().toISOString(),
    last_edit_instructions: editInstructions,
    last_preview_path: previewPath,
    package_data: updatedPackage
  };
  saveJobs(jobs);

  return NextResponse.json({
    success: true,
    action: "edit_applied",
    approval_id: job.approval_id,
    webflow_item_id: job.webflow_item_id,
    edit_instructions: editInstructions,
    dry_run: isDryRun
  });
}

// --- Inline helpers (same logic as lib/edit-applier.js and lib/preview-renderer.js) ---

function applyEditsInline(packageData, editInstructions) {
  const updated = JSON.parse(JSON.stringify(packageData));
  const page = updated.page;
  const instructions = editInstructions.toLowerCase();

  const sectionMap = {
    intro: "intro",
    introduction: "intro",
    problem: "problem_section",
    solution: "solution_section",
    h1: "h1",
    heading: "h1",
    "seo title": "seo_title",
    title: "seo_title",
    "meta description": "meta_description",
    description: "meta_description"
  };

  const wantsShorter = /\bshort(er|en)\b/i.test(instructions);
  const wantsLonger = /\b(longer|expand|elaborate)\b/i.test(instructions);

  const referencedFields = [];
  for (const [keyword, field] of Object.entries(sectionMap)) {
    if (instructions.includes(keyword)) {
      referencedFields.push(field);
    }
  }

  const targetFields =
    referencedFields.length > 0
      ? [...new Set(referencedFields)]
      : wantsShorter || wantsLonger
        ? ["intro", "problem_section", "solution_section"]
        : [];

  for (const field of targetFields) {
    if (!page[field] || typeof page[field] !== "string") continue;
    if (wantsShorter) {
      const words = page[field].split(/\s+/);
      const len = Math.max(5, Math.ceil(words.length * 0.7));
      page[field] = words.slice(0, len).join(" ") + (len < words.length ? "." : "");
    } else if (wantsLonger) {
      const additions = {
        intro: " This lane-specific approach helps teams move faster with less manual work.",
        problem_section: " These challenges compound over time, leading to higher costs and lower service reliability.",
        solution_section: " The result is a measurable improvement in both speed and cost efficiency for every shipment."
      };
      page[field] = page[field] + (additions[field] || "");
    }
  }

  updated.page = page;
  return updated;
}

function renderPreviewInline(packageData) {
  const { page, quickAnswers } = packageData;
  const stats = page.lane_stats || {};
  const faq = page.faq || [];
  const contrast = page.contrast;
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const qaHTML = (quickAnswers || []).map((qa) => `<div class="quick-answer"><h3>${esc(qa.question)}</h3><p>${esc(qa.answer)}</p></div>`).join("");
  const faqHTML = faq.map((f) => `<div class="faq-item"><h4>${esc(f.q)}</h4><p>${esc(f.a)}</p></div>`).join("");
  const contrastHTML = contrast?.points
    ? `<section class="section"><h2>${esc(contrast.headline)}</h2><table><thead><tr><th>Metric</th><th>Legacy</th><th>WARP</th></tr></thead><tbody>${contrast.points.map((p) => `<tr><td><strong>${esc(p.metric)}</strong></td><td class="legacy">${esc(p.legacy)}</td><td class="warp">${esc(p.warp)}</td></tr>`).join("")}</tbody></table><p class="muted">${esc(contrast.bottom_line)}</p></section>`
    : "";
  const cardsHTML = (page.visual_cards || []).map((c) => `<div class="card"><span class="card-label">${esc(c.label)}</span><p class="card-value">${esc(c.value)}</p><p class="card-insight">${esc(c.insight)}</p></div>`).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(page.seo_title)}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#f8f8f8;line-height:1.5}.container{max-width:720px;margin:0 auto;padding:16px}.hero{background:#0a0a0a;color:#fff;padding:24px 16px;border-radius:12px;margin-bottom:16px}h1{font-size:1.5rem;font-weight:700;margin-bottom:8px}.intro{font-size:.92rem;color:#ccc;margin-bottom:16px}.btn{display:block;width:100%;padding:14px;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;margin-bottom:8px}.btn-primary{background:#FF6B35;color:#fff}.btn-secondary{background:#222;color:#fff}.quick-answer{background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin-bottom:12px}.quick-answer h3{font-size:.95rem;margin-bottom:6px}.quick-answer p{font-size:.88rem;color:#444}.section{background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:16px;margin-bottom:12px}.section h2{font-size:1.1rem;margin-bottom:10px}.grid{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:12px}.stat{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:12px}.stat-label{font-size:.72rem;color:#888;text-transform:uppercase}.stat-value{font-size:1.1rem;font-weight:700}.card{background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin-bottom:8px}.card-label{font-size:.72rem;color:#888;text-transform:uppercase}.card-value{font-size:.95rem;font-weight:600}.card-insight{font-size:.82rem;color:#666}.faq-item{border-bottom:1px solid #e8e8e8;padding:12px 0}.faq-item h4{font-size:.92rem;margin-bottom:4px}.faq-item p{font-size:.85rem;color:#555}table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{padding:8px;text-align:left;border-bottom:1px solid #e0e0e0}th{font-weight:600;background:#f5f5f5}.legacy{color:#999}.warp{color:#FF6B35;font-weight:600}.muted{font-size:.82rem;color:#888}.disclaimer{font-size:.78rem;color:#999;background:#f0f0f0;padding:10px;border-radius:6px;margin-top:12px}@media(min-width:520px){.grid{grid-template-columns:1fr 1fr 1fr}}</style>
</head><body><div class="container">
<section class="hero"><p style="font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:4px">WARP Freight</p><h1 data-testid="preview-h1">${esc(page.h1)}</h1><p class="intro">${esc(page.intro)}</p><a class="btn btn-primary" href="${esc(page.cta_secondary_url)}" data-testid="cta-btn">${esc(page.cta_secondary)}</a><a class="btn btn-secondary" href="${esc(page.cta_primary_url)}">${esc(page.cta_primary)}</a></section>
<section data-testid="quick-answers"><h2 style="font-size:1rem;margin-bottom:8px">Quick Answers</h2>${qaHTML}</section>
<div class="grid"><div class="stat"><span class="stat-label">Distance</span><p class="stat-value">~${(stats.estimated_distance_miles || 0).toLocaleString()} mi</p></div><div class="stat"><span class="stat-label">Transit (est.)</span><p class="stat-value">${stats.estimated_transit_days_range?.min || "?"}-${stats.estimated_transit_days_range?.max || "?"} days</p></div><div class="stat"><span class="stat-label">Rate (est.)</span><p class="stat-value">$${stats.estimated_rate_range_usd?.low?.toLocaleString() || "?"}-$${stats.estimated_rate_range_usd?.high?.toLocaleString() || "?"}</p></div></div>
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
