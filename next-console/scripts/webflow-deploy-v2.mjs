#!/usr/bin/env node

/**
 * Webflow Deployment v2 — Uses chromium.launch() (non-persistent context)
 * Deploys lane-page-mode.html to Webflow Site Settings → Custom Code → Footer Code.
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SITE_SHORT_NAME = "untitled-ui-site-573f0e";
const SITE_ID = "688f073c4367c4fcf9651e08";
const API_TOKEN = process.env.WEBFLOW_API_TOKEN || "f03f437275327315aee1f3a8e530726987e9264f4074b3bd49eadb3e0f6dde84";
const CUSTOM_CODE_URL = `https://webflow.com/dashboard/sites/${SITE_SHORT_NAME}/code`;

const footerCodePath = path.join(ROOT, "artifacts/seo-fix/lane-page-mode.html");
const FOOTER_CODE = fs.readFileSync(footerCodePath, "utf-8").trim();

const screenshotDir = path.join(ROOT, "artifacts/webflow-deploy-screenshots");
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

console.log("");
console.log("╔══════════════════════════════════════════════════╗");
console.log("║  WEBFLOW DEPLOY v2 — Playwright                  ║");
console.log("╚══════════════════════════════════════════════════╝");
console.log("");

async function main() {
  console.log("── Launching Chromium ───────────────────────────────");
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--start-maximized",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  try {
    // Navigate to Webflow login
    console.log("  Navigating to Webflow...");
    await page.goto("https://webflow.com/dashboard", { waitUntil: "networkidle", timeout: 30000 });

    const url = page.url();
    console.log("  URL:", url);

    if (url.includes("/login") || url.includes("/auth")) {
      console.log("");
      console.log("  ┌──────────────────────────────────────────────┐");
      console.log("  │  LOGIN REQUIRED                               │");
      console.log("  │                                               │");
      console.log("  │  Log in to Webflow in the browser window.     │");
      console.log("  │  Then press ENTER here to continue.           │");
      console.log("  └──────────────────────────────────────────────┘");

      await waitForEnter("\n  Press ENTER after logging in: ");
      console.log("  ✓ Continuing...");
      await page.waitForTimeout(2000);
    }

    // Navigate to custom code page
    console.log("\n── Custom Code Settings ────────────────────────────");
    await page.goto(CUSTOM_CODE_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log("  URL:", page.url());

    await page.screenshot({ path: path.join(screenshotDir, "01-code-page.png"), fullPage: true });

    // Try to find and fill the footer code editor
    console.log("\n── Pasting Footer Code ─────────────────────────────");

    // Approach: find all textareas and code editors on the page
    const textareas = await page.locator("textarea").all();
    console.log(`  Textareas: ${textareas.length}`);

    const cmEditors = await page.locator(".CodeMirror, .cm-editor").all();
    console.log(`  CodeMirror editors: ${cmEditors.length}`);

    const aceEditors = await page.locator(".ace_editor").all();
    console.log(`  Ace editors: ${aceEditors.length}`);

    // Dump the page structure to help debug
    const bodyHTML = await page.evaluate(() => {
      const els = document.querySelectorAll("h1, h2, h3, h4, label, textarea, .CodeMirror, .cm-editor, .ace_editor, [contenteditable]");
      return Array.from(els).map(el => `${el.tagName}${el.className ? '.' + el.className.split(' ').join('.') : ''}: ${el.textContent?.substring(0, 80)}`);
    });
    console.log("  Page elements:");
    bodyHTML.forEach(el => console.log(`    ${el}`));

    let pasted = false;

    // Try textarea approach (most common)
    if (textareas.length >= 2) {
      const footer = textareas[1];
      await footer.scrollIntoViewIfNeeded();
      await footer.click();
      await footer.fill(FOOTER_CODE);
      pasted = true;
      console.log("  ✓ Pasted into textarea #2 (footer)");
    } else if (textareas.length === 1) {
      // Might be a single page with just footer
      await textareas[0].scrollIntoViewIfNeeded();
      await textareas[0].click();
      await textareas[0].fill(FOOTER_CODE);
      pasted = true;
      console.log("  ✓ Pasted into textarea #1");
    }

    // Try CodeMirror
    if (!pasted && cmEditors.length > 0) {
      const idx = cmEditors.length > 1 ? 1 : 0;
      await cmEditors[idx].scrollIntoViewIfNeeded();
      await cmEditors[idx].click();

      const result = await page.evaluate(({ code, i }) => {
        const cm6 = document.querySelectorAll(".cm-editor");
        if (cm6[i]?.cmView?.view) {
          const v = cm6[i].cmView.view;
          v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: code } });
          return "cm6";
        }
        const cm5 = document.querySelectorAll(".CodeMirror");
        if (cm5[i]?.CodeMirror) {
          cm5[i].CodeMirror.setValue(code);
          return "cm5";
        }
        return null;
      }, { code: FOOTER_CODE, i: idx });

      if (result) {
        pasted = true;
        console.log(`  ✓ Pasted via ${result} API`);
      }
    }

    if (!pasted) {
      // Copy to clipboard and ask user to paste manually
      await page.evaluate((code) => {
        const ta = document.createElement("textarea");
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }, FOOTER_CODE);

      console.log("  ⚠ Auto-paste failed. Code copied to clipboard.");
      console.log("  Scroll to Footer Code, Cmd+A, Cmd+V, then Save.");
      await waitForEnter("\n  Press ENTER after pasting and saving: ");
    }

    // Save
    if (pasted) {
      console.log("\n── Saving ──────────────────────────────────────────");
      const btns = await page.locator("button").all();
      for (const btn of btns) {
        const txt = (await btn.textContent().catch(() => "")).toLowerCase();
        if (txt.includes("save")) {
          const vis = await btn.isVisible().catch(() => false);
          if (vis) {
            await btn.click();
            console.log(`  ✓ Clicked "${txt.trim()}"`);
            await page.waitForTimeout(3000);
            break;
          }
        }
      }
    }

    await page.screenshot({ path: path.join(screenshotDir, "02-after-save.png"), fullPage: true });

    // Publish via API
    console.log("\n── Publishing via API ───────────────────────────────");
    const resp = await fetch(`https://api.webflow.com/v2/sites/${SITE_ID}/publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customDomains: ["689442045dc003d002d08285", "689442045dc003d002d08271"],
      }),
    });

    if (resp.ok) {
      console.log("  ✓ Published to production");
    } else {
      console.log(`  Publish API: ${resp.status} ${await resp.text()}`);
    }

    console.log("\n  Done! Browser closing in 5s...");
    await page.waitForTimeout(5000);

  } finally {
    await browser.close().catch(() => {});
  }
}

main()
  .then(() => { console.log("\n  DEPLOYMENT COMPLETE\n"); process.exit(0); })
  .catch((err) => { console.error(`\n  FAILED: ${err.message}\n`); process.exit(1); });
