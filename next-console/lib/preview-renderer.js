/**
 * Render a mobile-friendly HTML preview of a lane package.
 * Output is a self-contained HTML string with inline CSS.
 */
export function renderPreviewHTML(packageData) {
  const { page, canonicalPath, quickAnswers } = packageData;
  const stats = page.lane_stats || {};
  const faq = page.faq || [];
  const contrast = page.contrast;

  const escHtml = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const quickAnswerHTML = quickAnswers.map((qa) => `
    <div class="quick-answer">
      <h3>${escHtml(qa.question)}</h3>
      <p>${escHtml(qa.answer)}</p>
    </div>
  `).join("");

  const faqHTML = faq.map((f) => `
    <div class="faq-item">
      <h4>${escHtml(f.q)}</h4>
      <p>${escHtml(f.a)}</p>
    </div>
  `).join("");

  const contrastHTML = contrast?.points ? `
    <section class="section">
      <h2>${escHtml(contrast.headline)}</h2>
      <table>
        <thead><tr><th>Metric</th><th>Legacy</th><th>WARP</th></tr></thead>
        <tbody>
          ${contrast.points.map((p) => `<tr><td><strong>${escHtml(p.metric)}</strong></td><td class="legacy">${escHtml(p.legacy)}</td><td class="warp">${escHtml(p.warp)}</td></tr>`).join("")}
        </tbody>
      </table>
      <p class="muted">${escHtml(contrast.bottom_line)}</p>
    </section>
  ` : "";

  const cardsHTML = (page.visual_cards || []).slice(0, 3).map((c) => `
    <div class="card">
      <span class="card-label">${escHtml(c.label)}</span>
      <p class="card-value">${escHtml(c.value)}</p>
      <p class="card-insight">${escHtml(c.insight)}</p>
    </div>
  `).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(page.seo_title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; background: #f8f8f8; line-height: 1.5; }
    .container { max-width: 720px; margin: 0 auto; padding: 16px; }
    .hero { background: #0a0a0a; color: #fff; padding: 24px 16px; border-radius: 12px; margin-bottom: 16px; }
    .overline { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; color: #999; margin-bottom: 4px; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 8px; }
    .intro { font-size: 0.92rem; color: #ccc; margin-bottom: 16px; }
    .btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; text-align: center; text-decoration: none; margin-bottom: 8px; }
    .btn-primary { background: #FF6B35; color: #fff; }
    .btn-secondary { background: #222; color: #fff; border: 1px solid #444; }
    .quick-answer { background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 16px; margin-bottom: 12px; }
    .quick-answer h3 { font-size: 0.95rem; margin-bottom: 6px; color: #111; }
    .quick-answer p { font-size: 0.88rem; color: #444; }
    .section { background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 16px; margin-bottom: 12px; }
    .section h2 { font-size: 1.1rem; margin-bottom: 10px; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 12px; }
    .stat { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; }
    .stat-label { font-size: 0.72rem; color: #888; text-transform: uppercase; }
    .stat-value { font-size: 1.1rem; font-weight: 700; margin-top: 2px; }
    .card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px; margin-bottom: 8px; }
    .card-label { font-size: 0.72rem; color: #888; text-transform: uppercase; }
    .card-value { font-size: 0.95rem; font-weight: 600; margin-top: 2px; }
    .card-insight { font-size: 0.82rem; color: #666; margin-top: 4px; }
    .faq-item { border-bottom: 1px solid #e8e8e8; padding: 12px 0; }
    .faq-item:last-child { border-bottom: none; }
    .faq-item h4 { font-size: 0.92rem; margin-bottom: 4px; }
    .faq-item p { font-size: 0.85rem; color: #555; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    th { font-weight: 600; background: #f5f5f5; }
    .legacy { color: #999; }
    .warp { color: #FF6B35; font-weight: 600; }
    .muted { font-size: 0.82rem; color: #888; margin-top: 8px; }
    .disclaimer { font-size: 0.78rem; color: #999; background: #f0f0f0; padding: 10px; border-radius: 6px; margin-top: 12px; }
    .pill { display: inline-block; background: #e8e8e8; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; margin: 2px; }
    @media (min-width: 520px) { .grid { grid-template-columns: 1fr 1fr 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <section class="hero">
      <p class="overline">WARP Freight</p>
      <h1 data-testid="preview-h1">${escHtml(page.h1)}</h1>
      <p class="intro">${escHtml(page.intro)}</p>
      <a class="btn btn-primary" href="${escHtml(page.cta_secondary_url)}" data-testid="cta-btn">${escHtml(page.cta_secondary || "Get Instant Quote")}</a>
      <a class="btn btn-secondary" href="${escHtml(page.cta_primary_url)}">${escHtml(page.cta_primary || "Book 15-min Fit Call")}</a>
    </section>

    <section data-testid="quick-answers">
      <h2 style="font-size: 1rem; margin-bottom: 8px;">Quick Answers</h2>
      ${quickAnswerHTML}
    </section>

    <div class="grid">
      <div class="stat">
        <span class="stat-label">Distance</span>
        <p class="stat-value">~${(stats.estimated_distance_miles || 0).toLocaleString()} mi</p>
      </div>
      <div class="stat">
        <span class="stat-label">Transit (est.)</span>
        <p class="stat-value">${stats.estimated_transit_days_range?.min || "?"}-${stats.estimated_transit_days_range?.max || "?"} days</p>
      </div>
      <div class="stat">
        <span class="stat-label">Rate (est.)</span>
        <p class="stat-value">$${stats.estimated_rate_range_usd?.low?.toLocaleString() || "?"}-$${stats.estimated_rate_range_usd?.high?.toLocaleString() || "?"}</p>
      </div>
    </div>

    <section class="section">
      <h2>Why ${escHtml(page.lane?.mode)} on This Lane</h2>
      ${cardsHTML}
    </section>

    <section class="section">
      <h2>Problem</h2>
      <p style="font-size: 0.88rem; color: #444;">${escHtml(page.problem_section)}</p>
    </section>

    <section class="section">
      <h2>Solution</h2>
      <p style="font-size: 0.88rem; color: #444;">${escHtml(page.solution_section)}</p>
    </section>

    ${contrastHTML}

    <section class="section" data-testid="faq-section">
      <h2>Frequently Asked Questions</h2>
      ${faqHTML}
    </section>

    <div class="disclaimer">
      ${(stats.disclaimers || ["These are modeled estimates, not guaranteed quotes."]).map((d) => `<p>${escHtml(d)}</p>`).join("")}
    </div>

    <div style="margin-top: 16px;">
      <a class="btn btn-primary" href="${escHtml(page.cta_secondary_url)}">${escHtml(page.cta_secondary || "Get Instant Quote")}</a>
    </div>

    <p class="muted" style="margin-top: 12px; text-align: center;">Canonical: ${escHtml(packageData.canonicalPath)}</p>
  </div>
</body>
</html>`;
}
