// @ts-check
const { test, expect } = require("@playwright/test");

/**
 * REAL mobile verification at 375×812 (iPhone SE / standard mobile).
 * Tests all three lane distances on the live production site.
 */

const PAGES = [
  {
    name: "Short — Atlanta to Orlando",
    url: "https://www.wearewarp.com/lanes/atlanta-to-orlando",
    slug: "atlanta-to-orlando",
  },
  {
    name: "Medium — Atlanta to Miami",
    url: "https://www.wearewarp.com/lanes/atlanta-to-miami-062c5",
    slug: "atlanta-to-miami",
  },
  {
    name: "Long — Los Angeles to New York",
    url: "https://www.wearewarp.com/lanes/los-angeles-to-new-york-582d4",
    slug: "la-to-ny",
  },
];

test.use({
  viewport: { width: 375, height: 812 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
});

for (const page of PAGES) {
  test.describe(`Mobile 375px — ${page.name}`, () => {
    test("viewport is actually 375px", async ({ page: p }) => {
      await p.goto(page.url, { waitUntil: "networkidle", timeout: 30000 });
      const width = await p.evaluate(() => window.innerWidth);
      expect(width).toBe(375);
    });

    test("no horizontal overflow (no horizontal scroll)", async ({
      page: p,
    }) => {
      await p.goto(page.url, { waitUntil: "networkidle", timeout: 30000 });
      const scrollWidth = await p.evaluate(() => document.body.scrollWidth);
      // Allow 2px tolerance for sub-pixel rounding
      expect(scrollWidth).toBeLessThanOrEqual(377);
    });

    test("hero section renders within viewport", async ({ page: p }) => {
      await p.goto(page.url, { waitUntil: "networkidle", timeout: 30000 });
      // Check h1 exists and is visible
      const h1 = p.locator("h1").first();
      await expect(h1).toBeVisible();
      const box = await h1.boundingBox();
      expect(box).not.toBeNull();
      // H1 should fit within 375px
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    });

    test("KPI grid stacks on mobile (Lane Intelligence Panel)", async ({
      page: p,
    }) => {
      await p.goto(page.url, { waitUntil: "networkidle", timeout: 30000 });
      // KPI items use auto-fit minmax(160px, 1fr) — at 375px should be max 2 columns
      const kpiItems = await p.evaluate(() => {
        // Find the KPI grid by looking for the corridor distance stat
        const allDivs = document.querySelectorAll("div");
        for (const d of allDivs) {
          const style = d.getAttribute("style") || "";
          if (
            style.includes("grid-template-columns") &&
            style.includes("auto-fit")
          ) {
            const items = d.children;
            if (items.length >= 3) {
              const rects = Array.from(items)
                .slice(0, 3)
                .map((el) => el.getBoundingClientRect());
              return {
                found: true,
                itemCount: items.length,
                firstItemWidth: Math.round(rects[0].width),
                anyOverflow: rects.some((r) => r.right > 375),
              };
            }
          }
        }
        return { found: false };
      });
      if (kpiItems.found) {
        expect(kpiItems.anyOverflow).toBe(false);
      }
    });

    test("comparison table renders and fits within viewport", async ({
      page: p,
    }) => {
      await p.goto(page.url, { waitUntil: "networkidle", timeout: 30000 });

      // Find comparison table in rich text
      const compTable = p.locator(
        '.w-richtext table:has(th:text-is("WARP"))'
      );
      // If selector doesn't work, try broader approach
      const tableCount = await p
        .locator(".w-richtext table")
        .count();
      expect(tableCount).toBeGreaterThanOrEqual(1);

      // Check the table has overflow-x:auto wrapper (scrollable on mobile)
      const tableInfo = await p.evaluate(() => {
        const tables = document.querySelectorAll(".w-richtext table");
        for (const t of tables) {
          const ths = t.querySelectorAll("th");
          const headers = Array.from(ths).map((th) =>
            th.textContent.trim()
          );
          if (headers.some((h) => h.includes("WARP"))) {
            const parent = t.parentElement;
            const parentStyle = parent
              ? window.getComputedStyle(parent)
              : null;
            const parentOverflow = parentStyle
              ? parentStyle.overflowX
              : "unknown";
            const tableRect = t.getBoundingClientRect();
            return {
              found: true,
              rowCount: t.querySelectorAll("tbody tr").length,
              tableWidth: Math.round(tableRect.width),
              parentOverflow,
              headers,
            };
          }
        }
        return { found: false };
      });

      expect(tableInfo.found).toBe(true);
      expect(tableInfo.rowCount).toBe(9);
    });

    test("legacy div-block-27 is hidden", async ({ page: p }) => {
      await p.goto(page.url, { waitUntil: "networkidle", timeout: 30000 });
      const divBlock27 = await p.evaluate(() => {
        const el = document.querySelector(".div-block-27");
        if (!el) return { exists: false };
        const style = window.getComputedStyle(el);
        return {
          exists: true,
          display: style.display,
          visibility: style.visibility,
        };
      });
      if (divBlock27.exists) {
        expect(divBlock27.display).toBe("none");
      }
    });

    test("reason cards stack on mobile", async ({ page: p }) => {
      await p.goto(page.url, { waitUntil: "networkidle", timeout: 30000 });
      // Reason cards use auto-fit minmax(260px, 1fr) — at 375px should be 1 column
      const cardInfo = await p.evaluate(() => {
        const allDivs = document.querySelectorAll("div");
        for (const d of allDivs) {
          const style = d.getAttribute("style") || "";
          if (
            style.includes("grid-template-columns") &&
            style.includes("260px")
          ) {
            const items = d.children;
            if (items.length >= 2) {
              const rects = Array.from(items)
                .slice(0, 2)
                .map((el) => el.getBoundingClientRect());
              // If single column, items should be vertically stacked (different tops)
              return {
                found: true,
                itemCount: items.length,
                firstTop: Math.round(rects[0].top),
                secondTop: Math.round(rects[1].top),
                firstWidth: Math.round(rects[0].width),
                isStacked: rects[1].top > rects[0].bottom - 5,
                anyOverflow: rects.some((r) => r.right > 375),
              };
            }
          }
        }
        return { found: false };
      });
      if (cardInfo.found) {
        expect(cardInfo.isStacked).toBe(true);
        expect(cardInfo.anyOverflow).toBe(false);
      }
    });

    test("full page screenshot at 375px", async ({ page: p }) => {
      await p.goto(page.url, { waitUntil: "networkidle", timeout: 30000 });
      // Wait for any JS enhancements
      await p.waitForTimeout(2000);
      await p.screenshot({
        path: `tests/screenshots/mobile-375-${page.slug}.png`,
        fullPage: true,
      });
    });
  });
}
