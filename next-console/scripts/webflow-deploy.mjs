#!/usr/bin/env node

/**
 * Webflow Deployment Script — Playwright Automation
 *
 * Deploys lane-page-mode.html to Webflow Site Settings → Custom Code → Footer Code.
 * Uses a headed browser with persistent storage so login session is preserved.
 *
 * Usage:
 *   node scripts/webflow-deploy.mjs                     → full deploy (footer code + publish)
 *   node scripts/webflow-deploy.mjs --footer-only       → paste footer code only
 *   node scripts/webflow-deploy.mjs --publish-only      → publish site only
 *
 * The script will:
 * 1. Launch a visible Chromium browser
 * 2. Navigate to Webflow (pause for login if needed)
 * 3. Go to Site Settings → Custom Code
 * 4. Paste lane-page-mode.html into the Footer Code editor
 * 5. Save changes
 * 6. Publish the site to production
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SITE_SHORT_NAME = "untitled-ui-site-573f0e";
const SITE_ID = "688f073c4367c4fcf9651e08";
const API_TOKEN = process.env.WEBFLOW_API_TOKEN || "f03f437275327315aee1f3a8e530726987e9264f4074b3bd49eadb3e0f6dde84";

// URLs
const CUSTOM_CODE_URL = `https://webflow.com/dashboard/sites/${SITE_SHORT_NAME}/code`;
const LOGIN_URL = "https://webflow.com/dashboard";

// Parse args
const args = process.argv.slice(2);
const FOOTER_ONLY = args.includes("--footer-only");
const PUBLISH_ONLY = args.includes("--publish-only");

// Load the footer code content
const footerCodePath = path.join(ROOT, "artifacts/seo-fix/lane-page-mode.html");
if (!fs.existsSync(footerCodePath)) {
  console.error(`ERROR: Footer code file not found: ${footerCodePath}`);
  process.exit(1);
}
const FOOTER_CODE = fs.readFileSync(footerCodePath, "utf-8").trim();

const screenshotDir = path.join(ROOT, "artifacts/webflow-deploy-screenshots");
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

console.log("");
console.log("╔══════════════════════════════════════════════════╗");
console.log("║  WEBFLOW DEPLOYMENT — Playwright Automation      ║");
console.log("╚══════════════════════════════════════════════════╝");
console.log(`  Site:     ${SITE_SHORT_NAME}`);
console.log(`  Footer:   ${FOOTER_CODE.length} chars`);
console.log(`  Mode:     ${FOOTER_ONLY ? "FOOTER ONLY" : PUBLISH_ONLY ? "PUBLISH ONLY" : "FULL DEPLOY"}`);
console.log("");

async function main() {
  const userDataDir = path.join(ROOT, ".playwright-webflow-session");

  console.log("── Launching browser ──────────────────────────────");

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    timeout: 60000,
  });

  const page = context.pages()[0] || await context.newPage();

  // Prevent accidental close
  page.on("close", () => {
    console.log("  ⚠ Page was closed");
  });

  context.on("close", () => {
    console.log("  ⚠ Browser context was closed");
  });

  try {
    // ── Step 1: Navigate to Webflow Dashboard ────────────────────────
    console.log("\n── Step 1: Navigate to Webflow ─────────────────────");
    await page.goto(LOGIN_URL, { waitUntil: "networkidle", timeout: 60000 });

    const currentUrl = page.url();
    console.log("  Current URL:", currentUrl);

    if (currentUrl.includes("/login") || currentUrl.includes("/auth") || currentUrl.includes("accounts.google")) {
      console.log("");
      console.log("  ╔════════════════════════════════════════════════╗");
      console.log("  ║  LOGIN REQUIRED                                ║");
      console.log("  ║                                                ║");
      console.log("  ║  Please log in to Webflow in the browser       ║");
      console.log("  ║  window. The script will pause here.           ║");
      console.log("  ║                                                ║");
      console.log("  ║  After login, click RESUME in the Playwright   ║");
      console.log("  ║  Inspector to continue.                        ║");
      console.log("  ╚════════════════════════════════════════════════╝");
      console.log("");

      // Use page.pause() to open Playwright Inspector
      await page.pause();

      console.log("  ✓ Resumed after login");
      await page.waitForTimeout(2000);
    } else if (currentUrl.includes("/dashboard") || currentUrl.includes("webflow.com")) {
      console.log("  ✓ Already logged in");
    }

    if (PUBLISH_ONLY) {
      await publishSiteViaAPI();
      return;
    }

    // ── Step 2: Navigate to Custom Code Settings ──────────────────────
    console.log("\n── Step 2: Navigate to Custom Code Settings ────────");
    await page.goto(CUSTOM_CODE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(3000);
    console.log("  Current URL:", page.url());

    await page.screenshot({ path: path.join(screenshotDir, "01-custom-code-page.png"), fullPage: true });
    console.log("  ✓ Screenshot: 01-custom-code-page.png");

    // ── Step 3: Find and populate the Footer Code editor ──────────────
    console.log("\n── Step 3: Paste Footer Code ────────────────────────");

    // Copy the footer code to clipboard via the page context
    await page.evaluate(async (code) => {
      try { await navigator.clipboard.writeText(code); } catch(e) {}
      // Also store in a global variable for fallback
      window.__WARP_FOOTER_CODE = code;
    }, FOOTER_CODE);

    // Try to find the footer code editor
    // Webflow's custom code page has code editors — try multiple strategies
    let success = false;

    // Strategy 1: Find textareas (most common for custom code in Webflow dashboard)
    const textareas = await page.locator("textarea").all();
    console.log(`  Found ${textareas.length} textarea(s)`);

    if (textareas.length >= 2) {
      // Footer code is typically the second textarea
      const footerTextarea = textareas[1];
      await footerTextarea.scrollIntoViewIfNeeded();
      await footerTextarea.click();
      await page.waitForTimeout(300);
      await footerTextarea.fill(FOOTER_CODE);
      success = true;
      console.log("  ✓ Footer code pasted into textarea #2");
    } else if (textareas.length === 1) {
      // If only one, check if it's the footer one
      const footerTextarea = textareas[0];
      await footerTextarea.scrollIntoViewIfNeeded();
      await footerTextarea.click();
      await page.waitForTimeout(300);
      await footerTextarea.fill(FOOTER_CODE);
      success = true;
      console.log("  ✓ Footer code pasted into textarea #1");
    }

    // Strategy 2: CodeMirror editors
    if (!success) {
      const cmEditors = await page.locator(".CodeMirror, .cm-editor").all();
      console.log(`  Found ${cmEditors.length} CodeMirror editor(s)`);

      if (cmEditors.length > 0) {
        const idx = cmEditors.length > 1 ? 1 : 0; // Footer = second editor
        const editor = cmEditors[idx];
        await editor.scrollIntoViewIfNeeded();
        await editor.click();
        await page.waitForTimeout(300);

        // Set value via CodeMirror API
        const setResult = await page.evaluate(({ code, editorIdx }) => {
          // CM6
          const cm6 = document.querySelectorAll(".cm-editor");
          if (cm6[editorIdx]) {
            const view = cm6[editorIdx].cmView?.view;
            if (view) {
              view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
              return "cm6";
            }
          }
          // CM5
          const cm5 = document.querySelectorAll(".CodeMirror");
          if (cm5[editorIdx]) {
            const cm = cm5[editorIdx].CodeMirror;
            if (cm) { cm.setValue(code); return "cm5"; }
          }
          return null;
        }, { code: FOOTER_CODE, editorIdx: idx });

        if (setResult) {
          success = true;
          console.log(`  ✓ Footer code set via ${setResult} API`);
        }
      }
    }

    // Strategy 3: Content editable divs
    if (!success) {
      const editables = await page.locator("[contenteditable='true']").all();
      console.log(`  Found ${editables.length} contenteditable element(s)`);
    }

    if (!success) {
      console.log("");
      console.log("  ╔════════════════════════════════════════════════╗");
      console.log("  ║  MANUAL PASTE REQUIRED                         ║");
      console.log("  ║                                                ║");
      console.log("  ║  Footer code is on your clipboard.             ║");
      console.log("  ║  Please:                                       ║");
      console.log("  ║  1. Scroll to 'Footer Code' section            ║");
      console.log("  ║  2. Click inside the editor                    ║");
      console.log("  ║  3. Cmd+A → Cmd+V to paste                    ║");
      console.log("  ║  4. Click 'Save Changes'                       ║");
      console.log("  ║                                                ║");
      console.log("  ║  Then click RESUME in Playwright Inspector.    ║");
      console.log("  ╚════════════════════════════════════════════════╝");
      console.log("");
      await page.pause();
      console.log("  ✓ Resumed after manual paste");
    }

    // ── Step 4: Save changes ──────────────────────────────────────────
    console.log("\n── Step 4: Save Changes ────────────────────────────");

    // Look for any save button
    const buttons = await page.locator("button").all();
    let saved = false;
    for (const btn of buttons) {
      const text = (await btn.textContent().catch(() => "")).trim().toLowerCase();
      if (text.includes("save")) {
        const isVisible = await btn.isVisible().catch(() => false);
        const isEnabled = await btn.isEnabled().catch(() => false);
        if (isVisible && isEnabled) {
          await btn.click();
          saved = true;
          console.log(`  ✓ Clicked: "${text}"`);
          await page.waitForTimeout(3000);
          break;
        }
      }
    }

    if (!saved) {
      console.log("  ⚠ No save button found — looking for alternative...");
      // Try keyboard shortcut
      await page.keyboard.press("Meta+s");
      await page.waitForTimeout(2000);
      console.log("  Tried Cmd+S");
    }

    await page.screenshot({ path: path.join(screenshotDir, "02-after-save.png"), fullPage: true });
    console.log("  ✓ Screenshot: 02-after-save.png");

    if (FOOTER_ONLY) {
      console.log("\n  Done (--footer-only mode).");
      return;
    }

    // ── Step 5: Publish the site ──────────────────────────────────────
    await publishSiteViaAPI();

  } catch (err) {
    console.error("\n  ERROR:", err.message);
    await page.screenshot({ path: path.join(screenshotDir, "error.png"), fullPage: true }).catch(() => {});
    throw err;
  } finally {
    console.log("\n── Cleanup ─────────────────────────────────────────");
    console.log("  Browser will close in 3 seconds...");
    await page.waitForTimeout(3000).catch(() => {});
    await context.close().catch(() => {});
    console.log("  ✓ Done");
  }
}

async function publishSiteViaAPI() {
  console.log("\n── Publish Site via API ─────────────────────────────");
  try {
    const response = await fetch(`https://api.webflow.com/v2/sites/${SITE_ID}/publish`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customDomains: ["689442045dc003d002d08285", "689442045dc003d002d08271"],
      }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log("  ✓ Site published to production");
      console.log("  ", JSON.stringify(result));
    } else {
      const err = await response.text();
      console.log(`  ✗ API publish ${response.status}: ${err}`);
    }
  } catch (err) {
    console.log(`  ✗ API error: ${err.message}`);
  }
}

main()
  .then(() => {
    console.log("\n═══════════════════════════════════════════════════");
    console.log("  DEPLOYMENT COMPLETE");
    console.log("═══════════════════════════════════════════════════\n");
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n  FAILED: ${err.message}`);
    process.exit(1);
  });
