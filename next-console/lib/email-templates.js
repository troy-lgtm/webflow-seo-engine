/**
 * Email templates for the approval workflow.
 * Each template returns { subject, html } for use with email-sender.
 */

const escHtml = (s) =>
  String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function wrapper(body) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1a1a1a;background:#f8f8f8;line-height:1.6;margin:0;padding:0}
.wrap{max-width:640px;margin:0 auto;padding:24px}
.card{background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:20px;margin-bottom:16px}
h1{font-size:1.3rem;margin-bottom:8px}
h2{font-size:1.1rem;margin-bottom:8px;color:#333}
.label{font-size:.75rem;color:#888;text-transform:uppercase;letter-spacing:.05em}
.value{font-size:1rem;font-weight:600;margin-top:2px}
.approval-id{font-family:monospace;background:#f0f0f0;padding:8px 12px;border-radius:6px;font-size:.9rem;display:inline-block;margin:8px 0}
.instructions{background:#fffbe6;border:1px solid #ffe066;border-radius:8px;padding:16px;margin:16px 0}
.instructions p{margin:4px 0;font-size:.9rem}
.muted{font-size:.82rem;color:#888}
hr{border:none;border-top:1px solid #e0e0e0;margin:16px 0}
</style>
</head>
<body><div class="wrap">${body}</div></body></html>`;
}

/**
 * Draft ready email — sent when a Webflow CMS draft is created.
 */
export function draftReadyEmail({ approvalId, canonicalPath, seoTitle, webflowItemId, previewHtml }) {
  const subject = `Warp Draft Ready ${canonicalPath.replace(/^\//, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Ltl/g, "LTL").replace(/Ftl/g, "FTL")}`;
  const html = wrapper(`
    <h1>Draft Ready for Review</h1>
    <div class="card">
      <p class="label">Page</p>
      <p class="value">${escHtml(seoTitle)}</p>
      <hr>
      <p class="label">Canonical</p>
      <p class="value">${escHtml(canonicalPath)}</p>
      <hr>
      <p class="label">Webflow Item ID</p>
      <p class="value" style="font-family:monospace;font-size:.85rem">${escHtml(webflowItemId)}</p>
      <p class="muted" style="margin-top:4px">To view in Webflow: open the CMS Editor → Lane Pages → find the draft item by title.</p>
    </div>

    <div class="card">
      <p class="label">Approval ID</p>
      <p class="approval-id">${escHtml(approvalId)}</p>
    </div>

    <div class="instructions">
      <h2>How to respond</h2>
      <p><strong>To approve and publish:</strong> Reply to this email with just <code>yes</code></p>
      <p><strong>To request edits:</strong> Reply with <code>no edit: your instructions here</code></p>
      <p>Example: <code>no edit: shorten the intro, make the problem section more specific to LTL pain points</code></p>
    </div>

    <hr>
    <h2>Page Preview</h2>
    ${previewHtml}
  `);
  return { subject, html };
}

/**
 * Edit applied email — sent after edits are applied to the draft.
 */
export function editAppliedEmail({ approvalId, canonicalPath, seoTitle, webflowItemId, editInstructions, previewHtml }) {
  const subject = `Warp Draft Updated ${canonicalPath.replace(/^\//, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Ltl/g, "LTL").replace(/Ftl/g, "FTL")}`;
  const html = wrapper(`
    <h1>Draft Updated — Review Again</h1>
    <div class="card">
      <p class="label">Page</p>
      <p class="value">${escHtml(seoTitle)}</p>
      <hr>
      <p class="label">Canonical</p>
      <p class="value">${escHtml(canonicalPath)}</p>
      <hr>
      <p class="label">Edits Applied</p>
      <p style="font-size:.9rem;color:#444;margin-top:4px">${escHtml(editInstructions)}</p>
    </div>

    <div class="card">
      <p class="label">Approval ID</p>
      <p class="approval-id">${escHtml(approvalId)}</p>
    </div>

    <div class="instructions">
      <h2>How to respond</h2>
      <p><strong>To approve and publish:</strong> Reply with <code>yes</code></p>
      <p><strong>To request more edits:</strong> Reply with <code>no edit: your instructions here</code></p>
    </div>

    <hr>
    <h2>Updated Preview</h2>
    ${previewHtml}
  `);
  return { subject, html };
}

/**
 * Published confirmation email — sent after the item is published.
 */
export function publishedConfirmationEmail({ approvalId, canonicalPath, seoTitle, webflowItemId }) {
  const liveUrl = `https://www.wearewarp.com${canonicalPath}`;
  const subject = `Published: ${seoTitle}`;
  const html = wrapper(`
    <h1>Page Published</h1>
    <div class="card">
      <p class="label">Page</p>
      <p class="value">${escHtml(seoTitle)}</p>
      <hr>
      <p class="label">Live URL (after Webflow CDN propagation)</p>
      <p class="value" style="font-family:monospace;font-size:.85rem;word-break:break-all;">${escHtml(liveUrl)}</p>
      <p class="muted" style="margin-top:4px">This URL will become active after CDN propagation. Verify it returns HTTP 200 before treating it as live.</p>
      <hr>
      <p class="label">Webflow Item ID</p>
      <p class="value" style="font-family:monospace;font-size:.85rem">${escHtml(webflowItemId)}</p>
    </div>

    <div class="card">
      <p class="label">Approval ID</p>
      <p class="approval-id">${escHtml(approvalId)}</p>
      <p class="muted">Status: approved and published</p>
    </div>

    <div class="instructions">
      <h2>Next Steps</h2>
      <p>1. Verify the page loads at the live URL (may take a few minutes for CDN propagation)</p>
      <p>2. Submit the URL to Google Search Console for indexing</p>
      <p>3. Check indexing within 24 hours</p>
      <p>4. The page has been added to published_pages.json to prevent duplicates</p>
    </div>
  `);
  return { subject, html };
}
