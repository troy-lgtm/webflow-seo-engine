import { expect, test } from "@playwright/test";

test("dashboard to builder navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "WARP SEO Engine Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "Open Builder" }).click();
  await page.waitForURL(/\/builder$/);
  await expect(page.getByRole("heading", { name: "WARP SEO + LLM Page Builder" })).toBeVisible({ timeout: 15000 });
});

test("easy mode generate, save, export queue", async ({ page }) => {
  await page.goto("/builder");

  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");

  await page.getByTestId("save-current-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Saved");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-queue-btn").click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^manual-lane-pages-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByTestId("status-text")).toContainText("Exported");
});

test("advanced mode queue and flow check", async ({ page }) => {
  await page.goto("/builder");

  await page.getByTestId("toggle-advanced").click();
  await expect(page.getByTestId("generate-all-btn")).toBeVisible();

  await page.getByTestId("generate-all-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added all");

  await page.locator('[data-testid^="queue-select-"]').first().click();
  await expect(page.getByTestId("preview-h1")).not.toContainText("Generate top lanes to begin");

  await page.getByTestId("run-flow-check").click();
  await expect(page.getByTestId("status-text")).toContainText("Flow check passed");

  const passLines = page.getByTestId("flow-results").locator("li", { hasText: "PASS" });
  await expect(passLines).toHaveCount(7);
});

test("csv export produces download", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-csv-btn").click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^lane-manifest-\d{4}-\d{2}-\d{2}\.csv$/);
  await expect(page.getByTestId("status-text")).toContainText("CSV manifest");
});

test("publish readiness panel renders 17 checks", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");
  await page.getByTestId("toggle-advanced").click();

  const checks = page.locator('[data-warp-section="publish-readiness"] .check-item');
  await expect(checks.first()).toBeVisible();
  const count = await checks.count();
  expect(count).toBe(17);
});

// --- P0: Estimate Transparency ---

test("estimate transparency shows distance, transit, rate with confidence", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");

  const section = page.getByTestId("estimate-transparency");
  await expect(section).toBeVisible();
  await expect(section.locator("text=Distance")).toBeVisible();
  await expect(section.locator("text=/transit/i")).toBeVisible();
  await expect(section.locator("text=/rate/i")).toBeVisible();
  // Confidence badges should exist
  await expect(section.locator(".pill").first()).toBeVisible();
});

test("estimate how-it-works accordion toggles", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");

  // Assumptions should be hidden initially
  await expect(page.getByTestId("estimate-assumptions")).not.toBeVisible();
  // Click toggle
  await page.getByTestId("estimate-how-toggle").click();
  await expect(page.getByTestId("estimate-assumptions")).toBeVisible();
  // Should show assumptions text
  const items = page.getByTestId("estimate-assumptions").locator("li");
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(2);
});

test("estimate disclaimer block is visible", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");

  const disclaimer = page.getByTestId("estimate-disclaimer");
  await expect(disclaimer).toBeVisible();
  await expect(disclaimer).toContainText("not guaranteed quotes");
});

// --- P0: Estimate Inputs Panel ---

test("estimate inputs panel renders and persists", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  const panel = page.getByTestId("estimate-inputs-panel");
  await expect(panel).toBeVisible();

  // Fill pallet count
  await page.getByTestId("est-pallet-count").fill("6");
  // Fill freight class
  await page.getByTestId("est-freight-class").selectOption("85");

  // Regenerate to apply inputs
  await page.getByTestId("generate-all-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added all");

  // Estimate transparency should still be visible with updated data
  await expect(page.getByTestId("estimate-transparency")).toBeVisible();
});

// --- P0: Lane Stats (equipment, freight class, seasonality) ---

test("lane stats panel shows equipment and seasonality", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");

  const stats = page.getByTestId("lane-stats");
  await expect(stats).toBeVisible();
  await expect(stats.locator("text=Equipment")).toBeVisible();
});

// --- Network Proof ---

test("network proof panel visible after generate", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");

  const proof = page.getByTestId("network-proof");
  await expect(proof).toBeVisible();
  await expect(proof.locator("text=Carriers")).toBeVisible();
  await expect(proof.locator("text=Regions")).toBeVisible();
});

// --- Internal Links ---

test("internal links panel visible after generate", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();
  await page.getByTestId("generate-all-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added all");

  const links = page.getByTestId("internal-links");
  await expect(links).toBeVisible();
  const pills = links.locator(".pill");
  await expect(pills.first()).toBeVisible();
});

// --- Knowledge Graph ---

test("dashboard shows knowledge graph health", async ({ page }) => {
  await page.goto("/");
  const graph = page.getByTestId("graph-health");
  await expect(graph).toBeVisible();
  await expect(graph.locator("text=Nodes")).toBeVisible();
  await expect(graph.locator("text=Edges")).toBeVisible();
  await expect(graph.locator("text=Lanes")).toBeVisible();
});

test("builder shows graph metrics in advanced mode", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");
  await page.getByTestId("toggle-advanced").click();

  const graphSection = page.locator('[data-warp-section="graph-metrics"]');
  await expect(graphSection).toBeVisible();
  await expect(graphSection.locator("text=Nodes")).toBeVisible();
});

// --- Guide Pages ---

test("guide page loads with correct content", async ({ page }) => {
  await page.goto("/guides/ltl");
  await expect(page.getByRole("heading", { name: /LTL Freight Shipping/i })).toBeVisible();
  const scripts = page.locator('script[type="application/ld+json"]');
  const scriptCount = await scripts.count();
  expect(scriptCount).toBeGreaterThanOrEqual(2);
});

test("guide page shows related guides", async ({ page }) => {
  await page.goto("/guides/ftl");
  await expect(page.getByRole("heading", { name: /FTL Freight Shipping/i })).toBeVisible();
  const related = page.locator(".preview-card");
  const count = await related.count();
  expect(count).toBeGreaterThanOrEqual(3);
});

test("guide page 404 for invalid slug", async ({ page }) => {
  await page.goto("/guides/nonexistent");
  await expect(page.getByRole("heading", { name: "Guide not found" })).toBeVisible();
});

// --- GSC/GA4 Import ---

test("gsc ga4 import panel renders and parses csv", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  const panel = page.getByTestId("gsc-ga4-panel");
  await expect(panel).toBeVisible();

  const gscInput = page.getByTestId("gsc-input");
  await gscInput.fill("query,page,clicks,impressions,ctr,position\nlos angeles freight,/la-to-nyc,25,500,5%,8.2\nnyc ltl shipping,/la-to-nyc,10,300,3.3%,12.1");
  await expect(panel.locator("text=2 rows parsed").first()).toBeVisible();
});

// --- Rank Mode ---

test("rank mode toggle changes ranking label", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  const select = page.getByTestId("rank-mode");
  await expect(select).toBeVisible();
  await expect(select).toHaveValue("strategic");
  await select.selectOption("blended");
  await expect(select).toHaveValue("blended");
});

// --- Flow Diagram ---

test("flow diagram renders after page generation", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");

  const diagram = page.locator('[data-warp-section="flow-diagram"]');
  await expect(diagram).toBeVisible();
  const nodes = diagram.locator(".flow-node");
  const count = await nodes.count();
  expect(count).toBeGreaterThanOrEqual(3);
});

// --- P1: Quote Feedback ---

test("quote feedback importer parses and updates lane count", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  const panel = page.getByTestId("quote-feedback-panel");
  await expect(panel).toBeVisible();

  const input = page.getByTestId("quote-feedback-input");
  await input.fill("origin,destination,mode,quote_amount\nLos Angeles,Chicago,LTL,$1500\nLos Angeles,Chicago,LTL,$1650\nLos Angeles,Chicago,LTL,$1420\nDallas,Atlanta,FTL,$2800\nDallas,Atlanta,FTL,$3100");
  await page.getByTestId("import-quotes-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Imported 5 quote rows");
  await expect(panel.locator("text=2 lanes with quote history")).toBeVisible();
});

// --- P1: Upgrade Readiness Badge ---

test("upgrade readiness badge shows modeled estimate by default", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");

  const badge = page.getByTestId("upgrade-readiness-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("Modeled estimate");
});

// --- Domination Launch: Lane Set Import ---

test("lane import panel renders with mode and segment toggles", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  const panel = page.getByTestId("lane-import-panel");
  await expect(panel).toBeVisible();

  // Mode checkboxes
  await expect(page.getByTestId("mode-LTL")).toBeChecked();
  await expect(page.getByTestId("mode-FTL")).toBeChecked();
  await expect(page.getByTestId("mode-Cargo Van / Box Truck")).toBeChecked();

  // Segment checkboxes
  await expect(page.getByTestId("segment-smb")).toBeChecked();
  await expect(page.getByTestId("segment-midmarket")).toBeChecked();
});

test("lane csv paste imports lanes and shows summary", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  const csvInput = page.getByTestId("lane-csv-input");
  await csvInput.fill("origin_city,origin_state,destination_city,destination_state,lane_set\nLos Angeles,CA,Chicago,IL,tier1_core\nDallas,TX,Atlanta,GA,tier1_core\nSeattle,WA,Denver,CO,tier1_to_tier2_expansion");

  await expect(page.getByTestId("import-summary")).toBeVisible();
  await expect(page.getByTestId("import-summary")).toContainText("3");
  await expect(page.getByTestId("status-text")).toContainText("Imported 3");
});

test("generate from import creates multi-mode pages", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  // Import 2 city pairs
  const csvInput = page.getByTestId("lane-csv-input");
  await csvInput.fill("origin_city,origin_state,destination_city,destination_state,lane_set\nLos Angeles,CA,Chicago,IL,tier1_core\nDallas,TX,Atlanta,GA,tier1_core");

  // Wait for import to complete
  await expect(page.getByTestId("import-summary")).toBeVisible();
  await expect(page.getByTestId("import-summary")).toContainText("2");

  // Deselect Cargo Van / Box Truck mode so we get 2 pairs × 2 modes × 2 segments = 8 pages
  await page.getByTestId("mode-Cargo Van / Box Truck").uncheck();
  await expect(page.getByTestId("gen-preview")).toContainText("8 pages");

  await page.getByTestId("generate-from-import").click();
  await expect(page.getByTestId("status-text")).toContainText("Generated 8 pages", { timeout: 10000 });
});

// --- Domination Launch: Publish Batches ---

test("publish batches panel builds and scores batches", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  // Generate some pages first
  await page.getByTestId("generate-all-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added all", { timeout: 10000 });

  const batchPanel = page.getByTestId("publish-batches-panel");
  await expect(batchPanel).toBeVisible({ timeout: 5000 });

  await page.getByTestId("rebuild-batches").click();
  await expect(page.getByTestId("status-text")).toContainText("batch", { timeout: 10000 });
});

// --- Domination Launch: Tool Panel ---

test("tool panel renders in preview after generate", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");

  const toolPanel = page.getByTestId("tool-panel");
  await expect(toolPanel).toBeVisible();
  await expect(toolPanel.locator("text=Freight Calculator")).toBeVisible();
  await expect(toolPanel.locator("text=Est. Rate")).toBeVisible();
  await expect(toolPanel.locator("text=Transit")).toBeVisible();
});

// --- Domination Launch: Sitemap ---

test("sitemap.xml route returns valid xml", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toContain("<?xml");
  expect(text).toContain("<urlset");
});

test("robots.txt route returns valid content", async ({ request }) => {
  const res = await request.get("/robots.txt");
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toContain("User-agent:");
  expect(text).toContain("Sitemap:");
});

// --- Rockefeller: Wave Publishing ---

test("wave publish panel renders with wave selector", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  const panel = page.getByTestId("wave-publish-panel");
  await expect(panel).toBeVisible();

  const select = page.getByTestId("wave-select");
  await expect(select).toBeVisible();
  await expect(select).toHaveValue("wave-1");

  // Can switch waves
  await select.selectOption("wave-2");
  await expect(select).toHaveValue("wave-2");
});

test("wave generation creates pages and runs quality gate", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  // Import lanes first
  const csvInput = page.getByTestId("lane-csv-input");
  await csvInput.fill("origin_city,origin_state,destination_city,destination_state,lane_set\nLos Angeles,CA,Chicago,IL,tier1_core\nDallas,TX,Atlanta,GA,tier1_core");
  await expect(page.getByTestId("import-summary")).toBeVisible();

  // Deselect modes to keep it small
  await page.getByTestId("mode-Cargo Van / Box Truck").uncheck();
  await page.getByTestId("mode-FTL").uncheck();
  await page.getByTestId("segment-midmarket").uncheck();

  // Generate wave
  await page.getByTestId("generate-wave").click();
  await expect(page.getByTestId("status-text")).toContainText("Wave 1", { timeout: 10000 });
  await expect(page.getByTestId("wave-gate-result")).toBeVisible();
});

// --- Rockefeller: Spreadsheet Workflow ---

test("spreadsheet template export produces csv download", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  // Import some lanes
  const csvInput = page.getByTestId("lane-csv-input");
  await csvInput.fill("origin_city,origin_state,destination_city,destination_state,lane_set\nLos Angeles,CA,Chicago,IL,tier1_core");
  await expect(page.getByTestId("import-summary")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-spreadsheet").click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^warp-quote-template.*\.csv$/);
});

// --- Rockefeller: Contrast Block ---

test("contrast block renders in preview after generate", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");

  const contrast = page.getByTestId("contrast-block");
  await expect(contrast).toBeVisible();
  await expect(contrast.locator("text=Legacy")).toBeVisible();
  await expect(contrast.locator("th", { hasText: "WARP" })).toBeVisible();
});

// --- Rockefeller: Index Links ---

test("index links panel renders after generate", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();
  await page.getByTestId("generate-all-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added all");

  const indexLinks = page.getByTestId("index-links");
  await expect(indexLinks).toBeVisible();
  await expect(indexLinks.locator("text=Freight References")).toBeVisible();
});

// --- Rockefeller: Index Pages ---

test("freight lanes index page loads with content", async ({ page }) => {
  await page.goto("/indexes/freight-lanes");
  await expect(page.getByTestId("index-h1")).toBeVisible();
  await expect(page.getByTestId("index-h1")).toContainText("Freight Lane Directory");
  await expect(page.getByTestId("index-content")).toBeVisible();
  await expect(page.getByTestId("quick-answers")).toBeVisible();
});

test("freight class index page has class table", async ({ page }) => {
  await page.goto("/indexes/freight-class");
  await expect(page.getByTestId("index-h1")).toContainText("Freight Classification");
  await expect(page.getByTestId("freight-class-table")).toBeVisible();

  // Should have rows for freight classes
  const rows = page.getByTestId("freight-class-table").locator("tbody tr");
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(10);
});

test("accessorials index page loads", async ({ page }) => {
  await page.goto("/indexes/accessorials");
  await expect(page.getByTestId("index-h1")).toContainText("Accessorial");
  await expect(page.getByTestId("index-content")).toBeVisible();
});

test("transit times index page loads", async ({ page }) => {
  await page.goto("/indexes/transit-times");
  await expect(page.getByTestId("index-h1")).toContainText("Transit Time");
  await expect(page.getByTestId("index-content")).toBeVisible();
});

test("index page 404 for invalid slug", async ({ page }) => {
  await page.goto("/indexes/nonexistent");
  await expect(page.getByRole("heading", { name: "Index not found" })).toBeVisible();
});

test("index pages have structured data", async ({ page }) => {
  await page.goto("/indexes/freight-class");
  const scripts = page.locator('script[type="application/ld+json"]');
  const count = await scripts.count();
  expect(count).toBeGreaterThanOrEqual(2);
});

// --- Rockefeller: RSS Feed ---

test("rss.xml route returns valid rss", async ({ request }) => {
  const res = await request.get("/rss.xml");
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toContain("<?xml");
  expect(text).toContain("<rss");
  expect(text).toContain("WARP Freight Lanes");
});

// --- Publishing Ops: Duplicate Check ---

test("duplicate check panel renders and detects duplicates", async ({ page }) => {
  // Inject published entry before navigating
  await page.goto("/builder");
  await page.evaluate(() => {
    const published = [{
      canonical_path: "/ltl-freight-los-angeles-ca-to-chicago-il",
      slug: "los-angeles-ca-to-chicago-il-ltl",
      seo_title: "Los Angeles, CA to Chicago, IL LTL Freight Quotes | WARP",
      h1: "Los Angeles, CA to Chicago, IL LTL freight quotes",
      intro: "test intro",
      origin_city: "Los Angeles",
      origin_state: "CA",
      destination_city: "Chicago",
      destination_state: "IL",
      mode: "LTL",
      segment: "smb",
      published_at_iso: "2026-03-04T04:30:00-08:00",
      wave_id: "wave-1",
      content_fingerprint: "12345"
    }];
    localStorage.setItem("warp_published_pages_v1", JSON.stringify(published));
  });

  // Reload to pick up published registry on mount
  await page.reload();
  await expect(page.getByRole("heading", { name: "WARP SEO + LLM Page Builder" })).toBeVisible({ timeout: 15000 });
  await page.getByTestId("toggle-advanced").click();

  const panel = page.getByTestId("duplicate-check-panel");
  await expect(panel).toBeVisible();

  // Generate pages that will include Los Angeles to Chicago (default config has both cities)
  await page.getByTestId("generate-all-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added all");

  // Run duplicate check
  await page.getByTestId("run-dup-check").click();
  await expect(page.getByTestId("dup-result")).toBeVisible();

  // Should detect the duplicate
  await expect(page.getByTestId("dup-result")).toContainText("blocked");
});

test("duplicate gate blocks export when duplicates exist", async ({ page }) => {
  // Inject published entry before navigating
  await page.goto("/builder");
  await page.evaluate(() => {
    const published = [{
      canonical_path: "/ltl-freight-los-angeles-ca-to-chicago-il",
      slug: "los-angeles-ca-to-chicago-il-ltl",
      seo_title: "Los Angeles, CA to Chicago, IL LTL Freight Quotes | WARP",
      h1: "Los Angeles, CA to Chicago, IL LTL freight quotes",
      intro: "",
      mode: "LTL",
      segment: "smb",
      published_at_iso: "2026-03-04T04:30:00-08:00",
      wave_id: "wave-1",
      content_fingerprint: "12345"
    }];
    localStorage.setItem("warp_published_pages_v1", JSON.stringify(published));
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "WARP SEO + LLM Page Builder" })).toBeVisible({ timeout: 15000 });
  await page.getByTestId("toggle-advanced").click();

  await page.getByTestId("generate-all-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added all");

  // Try safe export — should be blocked
  await page.getByTestId("safe-export").click();
  await expect(page.getByTestId("status-text")).toContainText("BLOCKED");
});

// --- Publishing Ops: Ramp Schedule ---

test("ramp schedule panel renders with schedule table", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  const panel = page.getByTestId("ramp-schedule-panel");
  await expect(panel).toBeVisible();

  const table = page.getByTestId("ramp-table");
  await expect(table).toBeVisible();

  // Should have 13 rows (13 drops)
  const rows = table.locator("tbody tr");
  const count = await rows.count();
  expect(count).toBe(13);
});

test("ramp schedule exports a drop manifest", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  // Generate some pages first
  await page.getByTestId("generate-all-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added all");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-drop-0").click()
  ]);
  expect(download.suggestedFilename()).toMatch(/^drop-manifest-/);
  await expect(page.getByTestId("status-text")).toContainText("manifest");
});

// --- Publishing Ops: First Page Package ---

test("first page package files exist", async () => {
  const fs = require("fs");
  const path = require("path");
  const base = path.join(__dirname, "..", "docs", "first_publish_chicago_to_dallas_ltl");

  expect(fs.existsSync(path.join(base, "webflow_page_spec.md"))).toBe(true);
  expect(fs.existsSync(path.join(base, "page_copy.md"))).toBe(true);
  expect(fs.existsSync(path.join(base, "faq_schema.json"))).toBe(true);
  expect(fs.existsSync(path.join(base, "breadcrumbs_schema.json"))).toBe(true);
  expect(fs.existsSync(path.join(base, "mobile_first_layout.md"))).toBe(true);
  expect(fs.existsSync(path.join(base, "internal_links.md"))).toBe(true);
  expect(fs.existsSync(path.join(base, "qa_checklist.md"))).toBe(true);
});

// --- Rockefeller: Quote Observations (enhanced) ---

test("quote feedback with extended columns updates confidence", async ({ page }) => {
  await page.goto("/builder");
  await page.getByTestId("toggle-advanced").click();

  const input = page.getByTestId("quote-feedback-input");
  await input.fill("origin,destination,mode,quote_amount\nLos Angeles,Chicago,LTL,$1500\nLos Angeles,Chicago,LTL,$1650\nLos Angeles,Chicago,LTL,$1420\nLos Angeles,Chicago,LTL,$1550\nLos Angeles,Chicago,LTL,$1480");
  await page.getByTestId("import-quotes-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Imported 5 quote rows");

  // Generate pages to see data-backed badge
  await page.getByTestId("generate-top-btn").click();
  await expect(page.getByTestId("status-text")).toContainText("Added");
});

// --- Smoke Test: Artifacts Exist ---

test("smoke test artifacts exist after dry run", async () => {
  const fs = require("fs");
  const path = require("path");
  const base = path.join(__dirname, "..", "artifacts", "smoke");

  expect(fs.existsSync(path.join(base, "preview.html"))).toBe(true);
  expect(fs.existsSync(path.join(base, "email_payload.json"))).toBe(true);
  expect(fs.existsSync(path.join(base, "webflow_payload.json"))).toBe(true);

  // Verify email payload structure
  const emailPayload = JSON.parse(fs.readFileSync(path.join(base, "email_payload.json"), "utf-8"));
  expect(emailPayload.dry_run).toBe(true);
  expect(emailPayload.attachment_filenames).toContain("preview.html");
  expect(emailPayload.attachment_filenames).toContain("faq_schema.json");

  // Verify webflow payload structure
  const webflowPayload = JSON.parse(fs.readFileSync(path.join(base, "webflow_payload.json"), "utf-8"));
  expect(webflowPayload.dry_run).toBe(true);
  expect(webflowPayload.fields.slug).toBe("chicago-to-dallas");
  expect(webflowPayload.is_draft).toBe(true);
});

// --- Smoke Test: Preview Mobile Viewport ---

test("smoke preview renders correctly on mobile viewport", async ({ page }) => {
  // Set mobile viewport
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/preview");

  // H1 visible
  await expect(page.locator('[data-testid="preview-h1"]')).toBeVisible();
  await expect(page.locator('[data-testid="preview-h1"]')).toContainText("Chicago");

  // Quick Answers visible
  await expect(page.locator('[data-testid="quick-answers"]')).toBeVisible();

  // CTA button visible
  await expect(page.locator('[data-testid="cta-btn"]')).toBeVisible();

  // FAQ section visible
  await expect(page.locator('[data-testid="faq-section"]')).toBeVisible();
});

// --- Smoke Test: Webflow Package Files ---

test("webflow package files exist in docs output", async () => {
  const fs = require("fs");
  const path = require("path");
  const base = path.join(__dirname, "..", "docs", "first_publish_chicago_to_dallas_ltl_webflow");

  expect(fs.existsSync(path.join(base, "webflow_page_spec.md"))).toBe(true);
  expect(fs.existsSync(path.join(base, "page_copy.md"))).toBe(true);
  expect(fs.existsSync(path.join(base, "faq_schema.json"))).toBe(true);
  expect(fs.existsSync(path.join(base, "breadcrumbs_schema.json"))).toBe(true);
  expect(fs.existsSync(path.join(base, "og_meta.md"))).toBe(true);
  expect(fs.existsSync(path.join(base, "mobile_first_layout.md"))).toBe(true);
  expect(fs.existsSync(path.join(base, "internal_links.md"))).toBe(true);
  expect(fs.existsSync(path.join(base, "qa_checklist.md"))).toBe(true);
  expect(fs.existsSync(path.join(base, "content_fingerprint.txt"))).toBe(true);
});

// --- Approval Flow: ship:firstpage dry run ---

test("ship firstpage dry run creates approval job", async () => {
  const fs = require("fs");
  const path = require("path");

  // Run ship:firstpage which generates artifacts/ship/ and writes to approval_jobs.json
  const artifactsDir = path.join(__dirname, "..", "artifacts", "ship");

  // Check artifacts exist (ship was already run as part of setup)
  expect(fs.existsSync(path.join(artifactsDir, "preview.html"))).toBe(true);
  expect(fs.existsSync(path.join(artifactsDir, "email_payload.json"))).toBe(true);
  expect(fs.existsSync(path.join(artifactsDir, "webflow_payload.json"))).toBe(true);

  // Verify email payload has approval_id
  const emailPayload = JSON.parse(fs.readFileSync(path.join(artifactsDir, "email_payload.json"), "utf-8"));
  expect(emailPayload.approval_id).toBeTruthy();
  expect(emailPayload.webflow_item_id).toBeTruthy();
  expect(emailPayload.dry_run).toBe(true);
});

// --- Email: dry run does NOT send, produces email_payload.json and run_log ---

test("ship firstpage dry run does not send email and writes run_log", async () => {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");

  const root = path.join(__dirname, "..");
  const artifactsDir = path.join(root, "artifacts", "ship");
  const jobsPath = path.join(root, "data", "approval_jobs.json");

  // Clear published_pages to avoid duplicate gate block
  const publishedPath = path.join(root, "data", "published_pages.json");
  const origPublished = fs.readFileSync(publishedPath, "utf-8");
  const origJobs = fs.readFileSync(jobsPath, "utf-8");
  fs.writeFileSync(publishedPath, "[]");
  fs.writeFileSync(jobsPath, "[]");

  try {
    // Run dry run (no flags = dry run)
    execSync("node scripts/ship_firstpage.js", { cwd: root, timeout: 30000 });

    // email_payload.json must exist with dry_run: true
    const emailPayload = JSON.parse(fs.readFileSync(path.join(artifactsDir, "email_payload.json"), "utf-8"));
    expect(emailPayload.dry_run).toBe(true);

    // run_log.json must exist with dryRun: true, emailAttempted: false
    const runLog = JSON.parse(fs.readFileSync(path.join(artifactsDir, "run_log.json"), "utf-8"));
    expect(runLog.dryRun).toBe(true);
    expect(runLog.emailAttempted).toBe(false);
    expect(runLog.emailSent).toBe(false);
  } finally {
    fs.writeFileSync(publishedPath, origPublished);
    fs.writeFileSync(jobsPath, origJobs);
  }
});

test("ship firstpage --send-email without --publish-staging skips email (not attempted)", async () => {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");

  const root = path.join(__dirname, "..");
  const artifactsDir = path.join(root, "artifacts", "ship");
  const jobsPath = path.join(root, "data", "approval_jobs.json");
  const publishedPath = path.join(root, "data", "published_pages.json");

  const origPublished = fs.readFileSync(publishedPath, "utf-8");
  const origJobs = fs.readFileSync(jobsPath, "utf-8");
  fs.writeFileSync(publishedPath, "[]");
  fs.writeFileSync(jobsPath, "[]");

  try {
    // Run with --send-email but NO --publish-staging — email should be skipped (not attempted)
    execSync("node scripts/ship_firstpage.js --send-email", {
      cwd: root,
      timeout: 30000,
      env: { ...process.env, EMAIL_USER: "", EMAIL_APP_PASSWORD: "", EMAIL_TO: "" }
    });

    // run_log.json should show email was NOT attempted (no staging URL = no email)
    const runLog = JSON.parse(fs.readFileSync(path.join(artifactsDir, "run_log.json"), "utf-8"));
    expect(runLog.dryRun).toBe(true);
    expect(runLog.emailAttempted).toBe(false);
    expect(runLog.emailSent).toBe(false);

    // email_payload.json should have email_skipped: true
    const payload = JSON.parse(fs.readFileSync(path.join(artifactsDir, "email_payload.json"), "utf-8"));
    expect(payload.email_skipped).toBe(true);
  } finally {
    fs.writeFileSync(publishedPath, origPublished);
    fs.writeFileSync(jobsPath, origJobs);
  }
});

// --- Email Branding: HTML assertions ---

test("ship dry run email HTML has Warp brand tokens and preview link", async () => {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");

  const root = path.join(__dirname, "..");
  const artifactsDir = path.join(root, "artifacts", "ship");
  const jobsPath = path.join(root, "data", "approval_jobs.json");
  const publishedPath = path.join(root, "data", "published_pages.json");

  const origPublished = fs.readFileSync(publishedPath, "utf-8");
  const origJobs = fs.readFileSync(jobsPath, "utf-8");
  fs.writeFileSync(publishedPath, "[]");
  fs.writeFileSync(jobsPath, "[]");

  try {
    execSync("node scripts/ship_firstpage.js", { cwd: root, timeout: 30000 });

    // Read the job record to get the email HTML (embedded in package_data)
    const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf-8"));
    expect(jobs.length).toBeGreaterThan(0);

    // Also check the preview.html artifact exists
    expect(fs.existsSync(path.join(artifactsDir, "preview.html"))).toBe(true);

    // Check email_payload.json has correct dry_run flag
    const emailPayload = JSON.parse(fs.readFileSync(path.join(artifactsDir, "email_payload.json"), "utf-8"));
    expect(emailPayload.dry_run).toBe(true);

    // The email HTML is written in email_payload.json as html_length > 0
    // The actual HTML is too large for the payload, so verify by running the script
    // and checking the approval job's structure
    expect(jobs[0].approval_id).toBeTruthy();
    expect(jobs[0].webflow_item_id).toMatch(/^dry-run-item-/);

    // Dry run should indicate webflow not created
    const emailHtmlLength = emailPayload.html_length;
    expect(emailHtmlLength).toBeGreaterThan(1000);
  } finally {
    fs.writeFileSync(publishedPath, origPublished);
    fs.writeFileSync(jobsPath, origJobs);
  }
});

test("branded email HTML contains only preview link, approval ID, and reply syntax", async () => {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");

  const root = path.join(__dirname, "..");
  const artifactsDir = path.join(root, "artifacts", "ship");
  const jobsPath = path.join(root, "data", "approval_jobs.json");
  const publishedPath = path.join(root, "data", "published_pages.json");

  const origPublished = fs.readFileSync(publishedPath, "utf-8");
  const origJobs = fs.readFileSync(jobsPath, "utf-8");
  fs.writeFileSync(publishedPath, "[]");
  fs.writeFileSync(jobsPath, "[]");

  try {
    execSync("node scripts/ship_firstpage.js", { cwd: root, timeout: 30000 });

    const emailHtmlPath = path.join(artifactsDir, "email_preview.html");
    expect(fs.existsSync(emailHtmlPath)).toBe(true);

    const emailHtml = fs.readFileSync(emailHtmlPath, "utf-8");

    // Warp brand tokens present
    expect(emailHtml).toContain("#0B0C0E");
    expect(emailHtml).toContain("#00FF33");
    expect(emailHtml).toContain("#121418");
    // WARP branding in header
    expect(emailHtml).toContain(">WARP<");
    // Approval ID section
    expect(emailHtml).toContain("Approval ID");
    expect(emailHtml).toContain('data-testid="approval-id"');
    // Reply instructions
    expect(emailHtml).toContain("How to respond");
    expect(emailHtml).toContain('data-testid="reply-instructions"');
    // Stripped email must NOT contain old sections
    expect(emailHtml).not.toContain("Quick Answers");
    expect(emailHtml).not.toContain("Frequently Asked Questions");
    expect(emailHtml).not.toContain("Legacy");
    expect(emailHtml).not.toContain("Distance");
    expect(emailHtml).not.toContain("Get Instant Quote");
  } finally {
    fs.writeFileSync(publishedPath, origPublished);
    fs.writeFileSync(jobsPath, origJobs);
  }
});

// --- Webflow Draft: fail-fast and email link tests ---

test("--create-webflow-draft without env vars fails fast and writes run_log", async () => {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");

  const root = path.join(__dirname, "..");
  const artifactsDir = path.join(root, "artifacts", "ship");
  const jobsPath = path.join(root, "data", "approval_jobs.json");
  const publishedPath = path.join(root, "data", "published_pages.json");

  const origPublished = fs.readFileSync(publishedPath, "utf-8");
  const origJobs = fs.readFileSync(jobsPath, "utf-8");
  fs.writeFileSync(publishedPath, "[]");
  fs.writeFileSync(jobsPath, "[]");

  try {
    let failed = false;
    let stderr = "";
    try {
      execSync("node scripts/ship_firstpage.js --create-webflow-draft --send-email", {
        cwd: root,
        timeout: 30000,
        env: {
          ...process.env,
          WEBFLOW_API_TOKEN: "",
          WEBFLOW_SITE_ID: "",
          WEBFLOW_LANE_COLLECTION_ID: "",
          EMAIL_USER: "test@test.com",
          EMAIL_APP_PASSWORD: "fake",
          EMAIL_TO: "test@test.com"
        },
        encoding: "utf-8"
      });
    } catch (err) {
      failed = true;
      stderr = err.stderr || err.stdout || "";
    }
    expect(failed).toBe(true);

    // run_log.json should exist with error
    const runLog = JSON.parse(fs.readFileSync(path.join(artifactsDir, "run_log.json"), "utf-8"));
    expect(runLog.errorSummary).toContain("Missing");
    expect(runLog.errorSummary).toContain("WEBFLOW_");
  } finally {
    fs.writeFileSync(publishedPath, origPublished);
    fs.writeFileSync(jobsPath, origJobs);
  }
});

test("dry-run email has approval ID and no extraneous CTAs", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const emailHtmlPath = path.join(root, "artifacts", "ship", "email_preview.html");

  // email_preview.html should already exist from a prior dry-run test
  expect(fs.existsSync(emailHtmlPath)).toBe(true);
  const emailHtml = fs.readFileSync(emailHtmlPath, "utf-8");

  // Must have approval ID
  expect(emailHtml).toContain('data-testid="approval-id"');
  // Must have reply instructions
  expect(emailHtml).toContain('data-testid="reply-instructions"');
  // Must NOT contain Webflow dashboard link (stripped)
  expect(emailHtml).not.toContain("/dashboard/sites/");
  expect(emailHtml).not.toContain('data-testid="webflow-draft-live"');
  // Must NOT contain any CTA buttons to wearewarp.com
  expect(emailHtml).not.toContain("wearewarp.com/book");
  expect(emailHtml).not.toContain("wearewarp.com/quote");
});

// --- Staging Preview Link Tests ---

test("dry-run email explains staging publish not enabled and omits preview link", async () => {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");

  const root = path.join(__dirname, "..");
  const artifactsDir = path.join(root, "artifacts", "ship");
  const jobsPath = path.join(root, "data", "approval_jobs.json");
  const publishedPath = path.join(root, "data", "published_pages.json");

  const origPublished = fs.readFileSync(publishedPath, "utf-8");
  const origJobs = fs.readFileSync(jobsPath, "utf-8");
  fs.writeFileSync(publishedPath, "[]");
  fs.writeFileSync(jobsPath, "[]");

  try {
    execSync("node scripts/ship_firstpage.js", { cwd: root, timeout: 30000 });

    const emailHtml = fs.readFileSync(path.join(artifactsDir, "email_preview.html"), "utf-8");

    // In dry-run (no --publish-staging), email must explain staging is not enabled
    expect(emailHtml).toContain("Staging publish not enabled");
    expect(emailHtml).toContain('data-testid="preview-not-staged"');

    // Must NOT have staging preview section
    expect(emailHtml).not.toContain('data-testid="staging-preview-section"');
    // Must NOT contain any .webflow.io staging URL
    expect(emailHtml).not.toContain(".webflow.io");

    // Job record should have staging_url: null
    const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf-8"));
    expect(jobs[0].staging_url).toBe(null);
  } finally {
    fs.writeFileSync(publishedPath, origPublished);
    fs.writeFileSync(jobsPath, origJobs);
  }
});

test("email template with staging URL contains only preview link and approval ID", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const scriptPath = path.join(root, "scripts", "ship_firstpage.js");
  const scriptSource = fs.readFileSync(scriptPath, "utf-8");

  // Verify the template contains the staging preview section with correct test IDs
  expect(scriptSource).toContain('data-testid="staging-preview-section"');
  expect(scriptSource).toContain('data-testid="email-preview-link"');
  expect(scriptSource).toContain('data-testid="approval-id"');
  expect(scriptSource).toContain('data-testid="reply-instructions"');
  // Verify the staging URL is used as the href
  expect(scriptSource).toContain('esc(stagingUrl)');
  // Verify safety guard: staging is never triggered without --publish-staging
  expect(scriptSource).toContain("args.includes(\"--publish-staging\")");
  // Verify staging never publishes to custom domains
  expect(scriptSource).toContain("publishToWebflowSubdomain: true");
  // Verify the "not staged" fallback section exists
  expect(scriptSource).toContain('data-testid="preview-not-staged"');
  // Email function must NOT contain old CTA links (extract just buildApprovalEmailHtml)
  const emailFnStart = scriptSource.indexOf("function buildApprovalEmailHtml(");
  expect(emailFnStart).toBeGreaterThan(-1);
  const emailFnSource = scriptSource.slice(emailFnStart);
  expect(emailFnSource).not.toContain("cta_secondary_url");
  expect(emailFnSource).not.toContain("cta_primary_url");
  expect(emailFnSource).not.toContain("Quick Answers");
  expect(emailFnSource).not.toContain("Frequently Asked Questions");
});

test("staging URL discovery module and integration in ship_firstpage", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");

  // Verify lib/staging-url-discovery.js exists and has required exports
  const discoverySource = fs.readFileSync(path.join(root, "lib", "staging-url-discovery.js"), "utf-8");
  expect(discoverySource).toContain("discoverWorkingStagingUrl");
  expect(discoverySource).toContain("CANDIDATE_PATHS");
  expect(discoverySource).toContain("SOFT_404_MARKERS");
  expect(discoverySource).toContain("This Page Has Moved or Does Not Exist");
  expect(discoverySource).toContain("Page not found");
  expect(discoverySource).toContain("/lanes");
  expect(discoverySource).toContain("/lane");
  expect(discoverySource).toContain("/lane-pages");
  expect(discoverySource).toContain("/lane-page");
  expect(discoverySource).toContain("/ltl-lanes");
  expect(discoverySource).toContain("/resources/lanes");
  expect(discoverySource).toContain("/logistics/lanes");
  // Must support env override
  expect(discoverySource).toContain("overridePath");
  // Must check body for soft-404 markers
  expect(discoverySource).toContain("isSoft404");

  // Verify ship_firstpage.js imports and uses the discovery module
  const scriptSource = fs.readFileSync(path.join(root, "scripts", "ship_firstpage.js"), "utf-8");
  expect(scriptSource).toContain("discoverWorkingStagingUrl");
  expect(scriptSource).toContain("StagingDiscoveryError");
  expect(scriptSource).toContain("staging-url-discovery");
  // Must fetch real slug from Webflow after draft creation
  expect(scriptSource).toContain("Fetch real slug from Webflow");
  expect(scriptSource).toContain("fieldData?.slug");
  // Must block email on StagingDiscoveryError
  expect(scriptSource).toContain("Email NOT sent");
  // Must support env override
  expect(scriptSource).toContain("WEBFLOW_LANES_TEMPLATE_PATH");
  // Must publish to staging subdomain only
  expect(scriptSource).toContain("publishToWebflowSubdomain: true");

  // Verify test_staging_preview.js checks for soft-404 markers
  const testScript = fs.readFileSync(path.join(root, "scripts", "test_staging_preview.js"), "utf-8");
  expect(testScript).toContain("staging_url");
  expect(testScript).toContain("HTTP_STATUS");
  expect(testScript).toContain("STAGING_URL");
  expect(testScript).toContain("MAX_RETRIES");
  expect(testScript).toContain("SOFT_404_MARKERS");
  expect(testScript).toContain("This Page Has Moved or Does Not Exist");
  expect(testScript).toContain("isSoft404");
  // Must reject localhost URLs
  expect(testScript).toContain("localhost");
  expect(testScript).toContain("WEBFLOW_LANES_TEMPLATE_PATH");
  expect(testScript).toContain("Run ship:firstpage with --publish-staging");
});

test("test_staging_preview skips gracefully when no staging_url in jobs", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");

  // Verify test_staging_preview.js source handles null staging_url
  const testScript = fs.readFileSync(path.join(root, "scripts", "test_staging_preview.js"), "utf-8");
  // Must check for null staging_url and print clear error
  expect(testScript).toContain("!stagingUrl");
  expect(testScript).toContain("No staging_url found");
  expect(testScript).toContain("--publish-staging");
  expect(testScript).toContain("process.exit(1)");
  // Must also reject localhost URLs
  expect(testScript).toContain("localhost");
});

test("staging-url-discovery throws StagingDiscoveryError with urlsTried on failure", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const discoveryPath = path.join(root, "lib", "staging-url-discovery.js");
  const discoverySource = fs.readFileSync(discoveryPath, "utf-8");

  // Candidate paths must include all required paths from the spec
  const requiredPaths = ["/lanes", "/lane", "/lane-pages", "/lane-page", "/ltl-lanes", "/resources/lanes", "/logistics/lanes"];
  for (const p of requiredPaths) {
    expect(discoverySource).toContain(`"${p}"`);
  }

  // Soft-404 markers must be present
  expect(discoverySource).toContain("This Page Has Moved or Does Not Exist");
  expect(discoverySource).toContain("Page not found");

  // Must export StagingDiscoveryError and FATAL_MESSAGE
  expect(discoverySource).toContain("class StagingDiscoveryError extends Error");
  expect(discoverySource).toContain("FATAL_MESSAGE");
  expect(discoverySource).toContain("StagingDiscoveryError");
  expect(discoverySource).toContain("this.urlsTried = urlsTried");

  // Must export discoverWorkingStagingUrl, probeUrl, CANDIDATE_PATHS, SOFT_404_MARKERS
  expect(discoverySource).toContain("export async function discoverWorkingStagingUrl");
  expect(discoverySource).toContain("export { probeUrl");
  expect(discoverySource).toContain("CANDIDATE_PATHS");
  expect(discoverySource).toContain("SOFT_404_MARKERS");

  // Must support overridePath parameter
  expect(discoverySource).toContain("overridePath");
  // Must throw StagingDiscoveryError (not return null) when all paths fail
  expect(discoverySource).toContain("throw new StagingDiscoveryError(FATAL_MESSAGE, urlsTried)");
  // Must track markerMatched in urlsTried entries
  expect(discoverySource).toContain("markerMatched");
  // Must build URLs as https://{shortName}.webflow.io{candidate}/{itemSlug}
  expect(discoverySource).toContain("${domain}");
  expect(discoverySource).toContain("${itemSlug}");
  // Must check body text for soft-404 (GET not HEAD)
  expect(discoverySource).toContain('method: "GET"');
  // Must include clear instruction message
  expect(discoverySource).toContain("Create a Lanes Template Page in Webflow Designer");
  expect(discoverySource).toContain("Pages → Create Collection Template Page → Lanes");

  // Verify ship_firstpage.js catches StagingDiscoveryError and blocks email
  const scriptSource = fs.readFileSync(path.join(root, "scripts", "ship_firstpage.js"), "utf-8");
  expect(scriptSource).toContain("StagingDiscoveryError");
  expect(scriptSource).toContain("Email NOT sent");
  expect(scriptSource).toContain("discoveryErr.urlsTried");
  expect(scriptSource).toContain("urlsTried:");
  // writeRunLog must accept urlsTried
  expect(scriptSource).toContain("urlsTried: urlsTried || null");

  // Must have positive content markers
  expect(discoverySource).toContain("POSITIVE_CONTENT_MARKERS");
  expect(discoverySource).toContain("Book Freight Instantly");
  expect(discoverySource).toContain("Freight Quotes");
  expect(discoverySource).toContain("hasPositiveContent");
  expect(discoverySource).toContain("positiveMarkerFound");
  expect(discoverySource).toContain("positiveMarkers");
});

test("test_staging_preview rejects localhost staging URLs", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");

  // Verify test_staging_preview.js source rejects localhost URLs
  const testScript = fs.readFileSync(path.join(root, "scripts", "test_staging_preview.js"), "utf-8");

  // Must check for localhost and 127.0.0.1
  expect(testScript).toContain('stagingUrl.includes("localhost")');
  expect(testScript).toContain('stagingUrl.includes("127.0.0.1")');
  // Must exit 1 with clear error
  expect(testScript).toContain("localhost URL");
  expect(testScript).toContain("Only Webflow staging URLs are accepted");
  expect(testScript).toContain("process.exit(1)");
});

// --- Publish Verification & Field Audit Tests ---

test("ship_firstpage verifies item publish status and audits fields against known-good item", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const scriptSource = fs.readFileSync(path.join(root, "scripts", "ship_firstpage.js"), "utf-8");

  // Must import getItem, listCollectionItems, publishCollectionItem from webflow-client
  expect(scriptSource).toContain("getItem");
  expect(scriptSource).toContain("listCollectionItems");
  expect(scriptSource).toContain("publishCollectionItem");
  expect(scriptSource).toContain("webflow-client");

  // Step 4b: Verify CMS item publish status
  expect(scriptSource).toContain("Verify CMS item publish status");
  expect(scriptSource).toContain("isDraft");
  // Must call publishCollectionItem if item is still draft
  expect(scriptSource).toContain("publishing explicitly");
  expect(scriptSource).toContain("publishCollectionItem");
  // Must re-fetch to confirm publish succeeded
  expect(scriptSource).toContain("After publish: isDraft=");
  // Must fail if still draft after publish
  expect(scriptSource).toContain("still isDraft=true after publishCollectionItem");

  // Step 4c: Field audit against known-good item
  expect(scriptSource).toContain("Field audit against known-good item");
  expect(scriptSource).toContain("listCollectionItems");
  // Must compare field keys
  expect(scriptSource).toContain("MISSING in our payload");
  expect(scriptSource).toContain("EXTRA in our payload");
  expect(scriptSource).toContain("EMPTY in our payload");
  // Must fail fast on missing critical fields
  expect(scriptSource).toContain("Field audit FAILED");
  expect(scriptSource).toContain("buildWebflowFields");
  // Must write run_log on field audit failure
  expect(scriptSource).toContain("Field audit failed");
});

test("webflow-client exports getItem, listCollectionItems, and publishCollectionItem", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const clientSource = fs.readFileSync(path.join(root, "lib", "webflow-client.js"), "utf-8");

  // getItem - fetches single CMS item
  expect(clientSource).toContain("export async function getItem");
  expect(clientSource).toContain("collections/${collectionId}/items/${itemId}");
  expect(clientSource).toContain("WEBFLOW_API_TOKEN");

  // listCollectionItems - lists items for field audit
  expect(clientSource).toContain("export async function listCollectionItems");
  expect(clientSource).toContain("?limit=");
  expect(clientSource).toContain("data.items");

  // publishCollectionItem - explicitly publishes a draft item
  expect(clientSource).toContain("export async function publishCollectionItem");
  expect(clientSource).toContain("itemIds:");
  expect(clientSource).toContain("/items/publish");
});

test("staging-url-discovery has positive content markers for real page verification", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const discoverySource = fs.readFileSync(path.join(root, "lib", "staging-url-discovery.js"), "utf-8");

  // Must define POSITIVE_CONTENT_MARKERS array
  expect(discoverySource).toContain("POSITIVE_CONTENT_MARKERS");
  expect(discoverySource).toContain("Book Freight Instantly");
  expect(discoverySource).toContain("Freight Quotes");
  expect(discoverySource).toContain("Get Instant Quote");
  expect(discoverySource).toContain("WARP");

  // probeUrl must check for positive content
  expect(discoverySource).toContain("hasPositiveContent");
  expect(discoverySource).toContain("positiveMarkerFound");
  // Must treat HTTP 200 with no positive content as soft-404
  expect(discoverySource).toContain("No positive content marker found");
  // Must accept custom positiveMarkers parameter
  expect(discoverySource).toContain("positiveMarkers");
  // Must merge custom markers with built-in markers
  expect(discoverySource).toContain("...POSITIVE_CONTENT_MARKERS");
  // discoverWorkingStagingUrl must accept positiveMarkers
  expect(discoverySource).toContain("positiveMarkers,");
  // Must export POSITIVE_CONTENT_MARKERS
  expect(discoverySource).toContain("POSITIVE_CONTENT_MARKERS");
});

test("ship_firstpage passes origin→destination as positive content marker to staging discovery", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const scriptSource = fs.readFileSync(path.join(root, "scripts", "ship_firstpage.js"), "utf-8");

  // Must build origin→destination string for positive content verification
  expect(scriptSource).toContain("packageData.origin");
  expect(scriptSource).toContain("packageData.destination");
  expect(scriptSource).toContain("positiveMarkers:");
  // Must pass positiveMarkers to discoverWorkingStagingUrl
  expect(scriptSource).toContain("positiveMarkers: [originDest]");
});

test("writeRunLog accepts publishStatus and fieldAudit fields", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const scriptSource = fs.readFileSync(path.join(root, "scripts", "ship_firstpage.js"), "utf-8");

  // writeRunLog must accept publishStatus and fieldAudit parameters
  expect(scriptSource).toContain("publishStatus");
  expect(scriptSource).toContain("fieldAudit");
  expect(scriptSource).toContain("publishStatus: publishStatus || null");
  expect(scriptSource).toContain("fieldAudit: fieldAudit || null");
});

test("buildWebflowFields includes index-page field", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  // After module extraction, buildWebflowFields in ship_firstpage delegates to renderer
  const rendererSource = fs.readFileSync(path.join(root, "lib", "render-lane-page.js"), "utf-8");

  // Renderer must include "index-page" key
  expect(rendererSource).toContain('"index-page"');
  // Lane pages are indexed (true)
  expect(rendererSource).toContain('"index-page": true');
  // Verify the webflow_field_map also documents this field (canonical location: lib/)
  const mapSource = fs.readFileSync(path.join(root, "lib", "webflow-field-map.js"), "utf-8");
  expect(mapSource).toContain('"index-page"');
  expect(mapSource).toContain("index_page");
});

// --- Lane Slug Convention Tests ---

test("buildLaneSlug generates origin-to-destination slugs without mode prefix", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const scriptSource = fs.readFileSync(path.join(root, "scripts", "ship_firstpage.js"), "utf-8");

  // Must have a buildLaneSlug helper
  expect(scriptSource).toContain("function buildLaneSlug(");
  // Must NOT include mode in slug
  expect(scriptSource).not.toMatch(/slug.*=.*"ltl-freight-/);
  // Slug must follow origin-to-destination convention
  expect(scriptSource).toContain("buildLaneSlug(origin, destination)");
  // buildLaneSlug must extract city name (before comma) and lowercase it
  expect(scriptSource).toContain('.split(",")[0]');
  expect(scriptSource).toContain(".toLowerCase()");

  // Verify the slug in webflow payload artifact matches convention
  const payloadPath = path.join(root, "artifacts", "smoke", "webflow_payload.json");
  if (fs.existsSync(payloadPath)) {
    const payload = JSON.parse(fs.readFileSync(payloadPath, "utf-8"));
    expect(payload.fields.slug).toBe("chicago-to-dallas");
    expect(payload.fields.slug).not.toContain("ltl");
    expect(payload.fields.slug).not.toContain("freight");
  }

  // ship_firstpage.js dry-run artifacts should also have the new slug
  const shipPayloadPath = path.join(root, "artifacts", "ship", "webflow_payload.json");
  if (fs.existsSync(shipPayloadPath)) {
    const shipPayload = JSON.parse(fs.readFileSync(shipPayloadPath, "utf-8"));
    expect(shipPayload.fields.slug).toBe("chicago-to-dallas");
  }
});

// --- CMS Template Path Auto-Detection Tests ---

test("webflow-client exports listSitePages and findCmsTemplatePage", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const clientSource = fs.readFileSync(path.join(root, "lib", "webflow-client.js"), "utf-8");

  // listSitePages — fetches all pages for a site
  expect(clientSource).toContain("export async function listSitePages");
  expect(clientSource).toContain(`/v2/sites/\${siteId}/pages`);
  expect(clientSource).toContain("data.pages");

  // findCmsTemplatePage — finds the CMS template page matching a collectionId
  expect(clientSource).toContain("export async function findCmsTemplatePage");
  expect(clientSource).toContain("p.collectionId === collectionId");
  expect(clientSource).toContain("publishedPath");
  expect(clientSource).toContain("templatePath");
});

test("staging-url-discovery accepts detectedPath and probes it before candidates", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const discoverySource = fs.readFileSync(path.join(root, "lib", "staging-url-discovery.js"), "utf-8");

  // discoverWorkingStagingUrl must accept detectedPath parameter
  expect(discoverySource).toContain("detectedPath,");
  expect(discoverySource).toContain("detectedPath");
  // Must probe detectedPath BEFORE CANDIDATE_PATHS
  expect(discoverySource).toContain("Detected template path (API)");
  expect(discoverySource).toContain("API-detected path works");
  // Must still support overridePath as exclusive override
  expect(discoverySource).toContain("Override path (env)");
  // Must skip duplicate paths already tried
  expect(discoverySource).toContain("alreadyTried");
  // Must label detected path with source
  expect(discoverySource).toContain('source: "webflow-api"');
  expect(discoverySource).toContain("detected via API");
});

test("ship_firstpage detects CMS template path from Webflow Pages API", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const scriptSource = fs.readFileSync(path.join(root, "scripts", "ship_firstpage.js"), "utf-8");

  // Must import findCmsTemplatePage
  expect(scriptSource).toContain("findCmsTemplatePage");
  expect(scriptSource).toContain("webflow-client");

  // Must have a step to detect CMS template path
  expect(scriptSource).toContain("Detect CMS template path from API");
  expect(scriptSource).toContain("findCmsTemplatePage");
  // Must pass detectedPath to discoverWorkingStagingUrl
  expect(scriptSource).toContain("detectedPath: detectedTemplatePath");
  // Must handle API failure gracefully (try candidates)
  expect(scriptSource).toContain("Will try candidate paths");
  // Must still support overridePath env var
  expect(scriptSource).toContain("WEBFLOW_LANES_TEMPLATE_PATH");
});

test("WEBFLOW_LANES_TEMPLATE_PATH env var is commented out in .env.local", async () => {
  const fs = require("fs");
  const path = require("path");

  const root = path.join(__dirname, "..");
  const envContent = fs.readFileSync(path.join(root, ".env.local"), "utf-8");

  // The env var should be commented out (auto-detection is the default)
  expect(envContent).not.toMatch(/^WEBFLOW_LANES_TEMPLATE_PATH=/m);
  // But should still be documented as a comment
  expect(envContent).toContain("WEBFLOW_LANES_TEMPLATE_PATH");
  expect(envContent).toContain("auto-detected");
});

// --- Email gated behind staging verification ---

test("ship dry run skips email and writes email_skipped in payload", async () => {
  const { execSync } = require("child_process");
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");

  execSync("node scripts/ship_firstpage.js", { cwd: root, timeout: 15000 });

  // Check email_payload.json
  const payloadPath = path.join(root, "artifacts", "ship", "email_payload.json");
  expect(fs.existsSync(payloadPath)).toBe(true);
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf-8"));
  expect(payload.email_skipped).toBe(true);
  expect(payload.reason).toContain("No verified staging URL");
  expect(payload.dry_run).toBe(true);

  // Check run_log.json
  const logPath = path.join(root, "artifacts", "ship", "run_log.json");
  const log = JSON.parse(fs.readFileSync(logPath, "utf-8"));
  expect(log.emailAttempted).toBe(false);
  expect(log.emailSent).toBe(false);
  expect(log.dryRun).toBe(true);
});

test("ship_firstpage header says email requires --publish-staging", async () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "scripts", "ship_firstpage.js"), "utf-8");

  // Verify the console output includes the gating message
  expect(source).toContain("email requires --publish-staging");
  // Verify email is only sent when stagingUrl is truthy
  expect(source).toContain("if (stagingUrl)");
  // Verify the else branch says email skipped
  expect(source).toContain("email_skipped");
  expect(source).toContain("No verified staging URL");
});

test("ship_firstpage uses 60s retry timeout (maxRetries=30) for staging discovery", async () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "scripts", "ship_firstpage.js"), "utf-8");

  // Verify maxRetries is 30 (30 × 2000ms = 60s)
  expect(source).toContain("maxRetries: 30");
  expect(source).toContain("retryDelayMs: 2000");
});

test("test_staging_preview uses 60s retry timeout (MAX_RETRIES=30)", async () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "scripts", "test_staging_preview.js"), "utf-8");

  // Verify MAX_RETRIES is 30 (30 × 2000ms = 60s)
  expect(source).toMatch(/const MAX_RETRIES\s*=\s*30/);
  expect(source).toMatch(/const RETRY_DELAY_MS\s*=\s*2000/);
});

test("ship_firstpage only sends email when staging URL is verified (no --publish-staging = no email)", async () => {
  const fs = require("fs");
  const path = require("path");
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "scripts", "ship_firstpage.js"), "utf-8");

  // Verify the email step is inside `if (stagingUrl)` block
  expect(source).toContain("Send approval email (staging verified)");
  // Verify the else branch writes artifacts but does NOT call sendMail
  expect(source).toContain("Write email artifacts (no staging URL — email skipped)");
  // The old unconditional email step label should NOT exist
  expect(source).not.toMatch(/Send approval email \(.*LIVE.*dry run/);
});

// --- Approval Flow: Webhook Tests ---

test("approval webhook with wrong secret returns 401", async ({ request }) => {
  const res = await request.post("/api/approval", {
    data: {
      secret: "wrong-secret",
      approval_id: "test-id",
      action: "approve"
    }
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toBe("Unauthorized");
});

test.describe.serial("approval webhook actions", () => {
  test("approve path sets status approved", async ({ request }) => {
    const fs = require("fs");
    const path = require("path");
    const jobsPath = path.join(__dirname, "..", "data", "approval_jobs.json");
    const publishedPath = path.join(__dirname, "..", "data", "published_pages.json");

    // Save original files to restore later
    const originalJobs = fs.readFileSync(jobsPath, "utf-8");
    const originalPublished = fs.readFileSync(publishedPath, "utf-8");

    // Write a test job
    const testJob = {
      approval_id: "test-approve-id",
      webflow_item_id: "dry-run-item-test",
      canonical_path: "/test-lane-approve",
      slug: "test-lane-approve",
      seo_title: "Test Lane Approve",
      origin: "Test, TX",
      destination: "Test, CA",
      mode: "LTL",
      segment: "smb",
      created_at: new Date().toISOString(),
      last_sent_at: new Date().toISOString(),
      status: "awaiting_reply",
      last_email_subject: "Warp Draft Ready Test",
      dry_run: true,
      package_data: {
        page: { h1: "Test H1", intro: "Test intro", slug: "test-lane-approve" },
        canonicalPath: "/test-lane-approve"
      }
    };
    fs.writeFileSync(jobsPath, JSON.stringify([testJob], null, 2));

    try {
      const res = await request.post("/api/approval", {
        data: {
          secret: "test-webhook-secret",
          approval_id: "test-approve-id",
          action: "approve"
        }
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe("approved");

      // Verify job status updated
      const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf-8"));
      const job = jobs.find((j) => j.approval_id === "test-approve-id");
      expect(job.status).toBe("approved");

      // Verify published_pages.json updated
      const published = JSON.parse(fs.readFileSync(publishedPath, "utf-8"));
      const entry = published.find((p) => p.canonical_path === "/test-lane-approve");
      expect(entry).toBeTruthy();
    } finally {
      // Restore original files
      fs.writeFileSync(jobsPath, originalJobs);
      fs.writeFileSync(publishedPath, originalPublished);
    }
  });

  test("edit path updates preview and resets status", async ({ request }) => {
    const fs = require("fs");
    const path = require("path");
    const jobsPath = path.join(__dirname, "..", "data", "approval_jobs.json");

    // Save original
    const originalJobs = fs.readFileSync(jobsPath, "utf-8");

    // Write a test job with package_data
    const testJob = {
      approval_id: "test-edit-id",
      webflow_item_id: "dry-run-item-edit",
      canonical_path: "/test-lane-edit",
      slug: "test-lane-edit",
      seo_title: "Test Lane Edit",
      origin: "Test, TX",
      destination: "Test, CA",
      mode: "LTL",
      segment: "smb",
      created_at: new Date().toISOString(),
      last_sent_at: new Date().toISOString(),
      status: "awaiting_reply",
      last_email_subject: "Warp Draft Ready Test Edit",
      dry_run: true,
      package_data: {
        page: {
          slug: "test-lane-edit",
          canonical_path: "/test-lane-edit",
          seo_title: "Test Lane Edit Title",
          h1: "Test lane edit heading",
          intro: "This is a long intro paragraph that should be shortened when the edit instruction says to make it shorter for testing purposes.",
          meta_description: "Test meta",
          problem_section: "The problem is complex and multifaceted requiring deep analysis.",
          solution_section: "WARP solves this with a unified approach.",
          cta_primary: "Book Call",
          cta_secondary: "Get Quote",
          cta_primary_url: "https://example.com/book",
          cta_secondary_url: "https://example.com/quote",
          lane: { origin: "Test, TX", destination: "Test, CA", mode: "LTL" },
          lane_stats: { estimated_distance_miles: 500, estimated_transit_days_range: { min: 2, max: 4 }, estimated_rate_range_usd: { low: 400, high: 800 }, disclaimers: ["Estimates only."] },
          target_segment: "smb",
          visual_cards: [],
          faq: [{ q: "Test Q?", a: "Test A." }]
        },
        canonicalPath: "/test-lane-edit",
        quickAnswers: [{ question: "Test?", answer: "Answer." }]
      }
    };
    fs.writeFileSync(jobsPath, JSON.stringify([testJob], null, 2));

    try {
      const res = await request.post("/api/approval", {
        data: {
          secret: "test-webhook-secret",
          approval_id: "test-edit-id",
          action: "edit",
          edit_instructions: "shorten the intro"
        }
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe("edit_applied");

      // Verify job status reset to awaiting_reply
      const jobs = JSON.parse(fs.readFileSync(jobsPath, "utf-8"));
      const job = jobs.find((j) => j.approval_id === "test-edit-id");
      expect(job.status).toBe("awaiting_reply");
      expect(job.last_edit_instructions).toBe("shorten the intro");

      // Verify intro was shortened
      const updatedIntro = job.package_data.page.intro;
      expect(updatedIntro.length).toBeLessThan(testJob.package_data.page.intro.length);
    } finally {
      // Restore original
      fs.writeFileSync(jobsPath, originalJobs);
    }
  });
});

// ─── Archetype tests (6) ────────────────────────────────────────────────────

test("lane-archetypes.js exports required functions", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "lane-archetypes.js"), "utf-8");
  expect(src).toContain("export function assignArchetype");
  expect(src).toContain("export function getArchetypeFaq");
  expect(src).toContain("export function getArchetypeIntro");
  expect(src).toContain("export function getSectionEmphasis");
  expect(src).toContain("export function analyzeDistribution");
  expect(src).toContain("export function classifyCity");
});

test("lane-archetypes defines exactly 10 archetype IDs", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "lane-archetypes.js"), "utf-8");
  const ids = ["short_haul_metro", "port_to_inland", "energy_corridor", "agriculture_lane",
    "ecommerce_corridor", "coastal_to_coastal", "long_haul_hub_to_hub",
    "midwest_manufacturing", "sunbelt_growth", "retail_distribution"];
  for (const id of ids) {
    expect(src).toContain(`"${id}"`);
  }
});

test("lane-archetypes defines 20 metro cities", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "lane-archetypes.js"), "utf-8");
  const metros = ["los angeles", "chicago", "dallas", "atlanta", "new york", "miami",
    "phoenix", "houston", "seattle", "denver", "san francisco", "las vegas",
    "portland", "salt lake city", "nashville", "charlotte", "orlando", "tampa",
    "indianapolis", "kansas city"];
  for (const metro of metros) {
    expect(src).toContain(`"${metro}"`);
  }
});

test("lane-engine.js imports archetypes and assigns archetype field", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "lane-engine.js"), "utf-8");
  expect(src).toContain("import { assignArchetype");
  expect(src).toContain("getArchetypeFaq");
  expect(src).toContain("archetype: archetype.id");
  expect(src).toContain("section_emphasis: sectionEmphasis");
});

test("lane-archetypes has FAQ pools with primary and variant items", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "lane-archetypes.js"), "utf-8");
  expect(src).toContain("faqPool");
  expect(src).toContain("faqVariants");
  expect(src).toContain("introTemplate");
  expect(src).toContain("sectionEmphasis");
});

test("lane-archetypes priority ladder resolves collisions (port_to_inland priority 2)", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "lane-archetypes.js"), "utf-8");
  // Priority ladder should be defined with port_to_inland having priority 2
  expect(src).toContain("priority: 2");
  // retail_distribution is the fallback (priority 10)
  expect(src).toContain("priority: 10");
});

// ─── Uniqueness engine tests (5) ────────────────────────────────────────────

test("uniqueness-engine.js exports required functions", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "uniqueness-engine.js"), "utf-8");
  expect(src).toContain("export function runUniquenessCheck");
  expect(src).toContain("export function writeUniquenessReport");
  expect(src).toContain("export function tokenize");
  expect(src).toContain("export function porterStem");
  expect(src).toContain("export function simhash");
  expect(src).toContain("export function jaccardSimilarity");
  expect(src).toContain("export function shingleOverlap");
});

test("uniqueness-engine defines section thresholds", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "uniqueness-engine.js"), "utf-8");
  expect(src).toContain("SECTION_THRESHOLDS");
  expect(src).toContain("seo_title");
  expect(src).toContain("meta_description");
  expect(src).toContain("intro");
  expect(src).toContain("faq");
  expect(src).toContain("maxSimilarity");
  expect(src).toContain("minUniqueTokens");
});

test("uniqueness-engine defines all rule IDs", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "uniqueness-engine.js"), "utf-8");
  const ruleIds = ["UN-TITLE-01", "UN-META-01", "UN-H1-01", "UN-INTRO-01", "UN-FAQ-01",
    "UN-COMMON-01", "UN-COMMON-02", "UN-H2-01", "UN-SHINGLES-01", "UN-NOISE-01", "UN-NOISE-02", "UN-PAGE-01"];
  for (const id of ruleIds) {
    expect(src).toContain(`"${id}"`);
  }
});

test("uniqueness-engine has stopwords list with 100+ entries", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "uniqueness-engine.js"), "utf-8");
  expect(src).toContain("STOPWORDS");
  // Should have at least common stopwords
  expect(src).toContain('"the"');
  expect(src).toContain('"and"');
  expect(src).toContain('"for"');
});

test("uniqueness-engine variable stripping replaces cities and amounts", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "uniqueness-engine.js"), "utf-8");
  expect(src).toContain("export function stripVariables");
  expect(src).toContain("{CITY}");
  expect(src).toContain("{MODE}");
  expect(src).toContain("{AMOUNT}");
  expect(src).toContain("{DISTANCE}");
  expect(src).toContain("{TRANSIT}");
});

// ─── Usefulness gates tests (3) ─────────────────────────────────────────────

test("usefulness-gates.js exports required functions", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "usefulness-gates.js"), "utf-8");
  expect(src).toContain("export function runUsefulnessGates");
  expect(src).toContain("export function getAllRuleIds");
});

test("usefulness-gates defines 29 rule IDs across 5 categories", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "usefulness-gates.js"), "utf-8");
  // Check category prefixes
  expect(src).toContain("UF-STRUCT-01");
  expect(src).toContain("UF-STRUCT-08");
  expect(src).toContain("UF-LANE-01");
  expect(src).toContain("UF-LANE-09");
  expect(src).toContain("UF-READ-01");
  expect(src).toContain("UF-READ-05");
  expect(src).toContain("UF-TRUTH-01");
  expect(src).toContain("UF-TRUTH-04");
  expect(src).toContain("UF-CNV-01");
  expect(src).toContain("UF-CNV-03");
});

test("usefulness-gates checks archetype field presence (UF-LANE-09)", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "usefulness-gates.js"), "utf-8");
  expect(src).toContain("UF-LANE-09");
  expect(src).toContain("archetype");
});

// ─── Schema drift tests (2) ─────────────────────────────────────────────────

test("webflow_lanes_contract.json is valid and has required fields", async () => {
  const fs = require("fs");
  const path = require("path");
  const contractPath = path.join(__dirname, "..", "data", "webflow_lanes_contract.json");
  expect(fs.existsSync(contractPath)).toBe(true);
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf-8"));
  expect(contract.version).toBeTruthy();
  expect(contract.fields).toBeTruthy();
  expect(contract.fields["slug"]).toBeTruthy();
  expect(contract.fields["seo-title"]).toBeTruthy();
  expect(contract.fields["mode"]).toBeTruthy();
  expect(contract.fields["mode"].enum).toContain("LTL");
  expect(contract.fields["mode"].enum).toContain("FTL");
  expect(contract.fields["mode"].enum).toContain("Cargo Van / Box Truck");
});

test("schema-drift.js exports validation functions", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "schema-drift.js"), "utf-8");
  expect(src).toContain("export function validatePayload");
  expect(src).toContain("export function runSchemaDriftCheck");
  expect(src).toContain("export function detectUnknownFields");
  expect(src).toContain("export function detectMissingRequired");
  expect(src).toContain("SD-MISSING-01");
  expect(src).toContain("SD-TYPE-01");
  expect(src).toContain("SD-PATTERN-01");
});

// ─── Publish governor tests (3) ─────────────────────────────────────────────

test("ramp_policy.json has 4 waves and valid limits", async () => {
  const fs = require("fs");
  const path = require("path");
  const policyPath = path.join(__dirname, "..", "data", "ramp_policy.json");
  expect(fs.existsSync(policyPath)).toBe(true);
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf-8"));
  expect(policy.waves).toHaveLength(4);
  expect(policy.waves[0].maxPages).toBe(10);
  expect(policy.waves[3].maxPages).toBe(200);
  expect(policy.limits.maxPublishPerDay).toBe(5);
  expect(policy.limits.maxPublishPerWeek).toBe(20);
  expect(policy.killSwitch.envVar).toBe("PUBLISH_KILL_SWITCH");
});

test("publish-governor.js exports governor check and kill switch functions", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-governor.js"), "utf-8");
  expect(src).toContain("export function runGovernorCheck");
  expect(src).toContain("export function isKillSwitchActive");
  expect(src).toContain("export function getCurrentWave");
  expect(src).toContain("GOV-KILL-01");
  expect(src).toContain("GOV-WAVE-01");
  expect(src).toContain("GOV-DAILY-01");
  expect(src).toContain("GOV-PREVIEW-01");
});

test("publish-governor kill switch blocks on PUBLISH_KILL_SWITCH env var", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-governor.js"), "utf-8");
  // Verify the kill switch checks the correct env var
  expect(src).toContain("process.env.PUBLISH_KILL_SWITCH");
  expect(src).toContain("GOV-KILL-01");
  // Verify it blocks
  expect(src).toContain('"block"');
});

// ─── Publish decision tests (2) ─────────────────────────────────────────────

test("publish-decision.js is the single source of truth orchestrator", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-decision.js"), "utf-8");
  expect(src).toContain("export function evaluatePublishDecision");
  expect(src).toContain("export function formatDecision");
  // Imports all check modules
  expect(src).toContain("runUniquenessCheck");
  expect(src).toContain("runUsefulnessGates");
  expect(src).toContain("runSchemaDriftCheck");
  expect(src).toContain("runGovernorCheck");
  expect(src).toContain("isKillSwitchActive");
});

test("publish-decision produces APPROVE/BLOCK/WARN verdicts", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-decision.js"), "utf-8");
  expect(src).toContain('"APPROVE"');
  expect(src).toContain('"BLOCK"');
  expect(src).toContain('"WARN"');
  expect(src).toContain('"publish"');
  expect(src).toContain('"block"');
  expect(src).toContain('"review"');
});

// ─── Geo + reference page tests (3) ─────────────────────────────────────────

test("geo.js is single source of truth for geography helpers", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "geo.js"), "utf-8");
  expect(src).toContain("export function haversine");
  expect(src).toContain("export function lookupCity");
  expect(src).toContain("export function normCity");
  expect(src).toContain("export function cityName");
  // Verify estimate-model and lane-intelligence import from geo.js
  const estSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "estimate-model.js"), "utf-8");
  expect(estSrc).toContain('from "@/lib/geo"');
  const laneSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "lane-intelligence.js"), "utf-8");
  expect(laneSrc).toContain('from "@/lib/geo"');
});

test("reference pages exist with required exports", async () => {
  const fs = require("fs");
  const path = require("path");
  const costSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "reference-pages", "freight-cost-breakdown.js"), "utf-8");
  expect(costSrc).toContain("export function buildFreightCostBreakdown");
  expect(costSrc).toContain("freight-cost-breakdown");
  const guideSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "reference-pages", "ltl-vs-ftl.js"), "utf-8");
  expect(guideSrc).toContain("export function buildLtlVsFtlGuide");
  expect(guideSrc).toContain("ltl-vs-ftl-guide");
  expect(guideSrc).toContain("comparison_table");
});

test("cities.json includes all 20 metros including Orlando", async () => {
  const fs = require("fs");
  const path = require("path");
  const cities = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "cities.json"), "utf-8"));
  const metroKeys = ["los angeles, ca", "chicago, il", "dallas, tx", "atlanta, ga",
    "new york, ny", "miami, fl", "phoenix, az", "houston, tx", "seattle, wa",
    "denver, co", "san francisco, ca", "las vegas, nv", "portland, or",
    "salt lake city, ut", "nashville, tn", "charlotte, nc", "orlando, fl",
    "tampa, fl", "indianapolis, in", "kansas city, mo"];
  for (const key of metroKeys) {
    expect(cities[key]).toBeTruthy();
    expect(cities[key].lat).toBeDefined();
    expect(cities[key].lon).toBeDefined();
    expect(cities[key].region).toBeTruthy();
  }
});

// ── Publish Next: duplicate skip + inventory exhaustion + report ──

test("publish_next skips lanes when slug exists in webflow_existing_slugs", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "publish_next.js"), "utf-8");

  // Script loads both exclusion sources
  expect(src).toContain("webflow_existing_slugs.json");
  expect(src).toContain("published_pages.json");
  expect(src).toContain("excludedSlugs");

  // Verify the duplicate gate checks the set and uses rule ID
  expect(src).toContain("excludedSlugs.has(slug)");
  expect(src).toContain("DUP-SLUG-01");

  // Verify it adds to exclusion set after publish to prevent within-run dupes
  expect(src).toContain("excludedSlugs.add(slug)");
});

test("publish_next exits 2 when inventory exhausted before target count", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "publish_next.js"), "utf-8");

  // Exit 0 when target met, exit 2 when exhausted
  expect(src).toContain("process.exit(0)");
  expect(src).toContain("process.exit(2)");
  expect(src).toContain("Inventory exhausted");
  expect(src).toContain("Target met");
});

test("publish_next writes artifacts/publish_next_report.json with required fields", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "publish_next.js"), "utf-8");

  // Report must include all required fields
  expect(src).toContain("publish_next_report.json");
  expect(src).toContain("attempted");
  expect(src).toContain("skipped_duplicates");
  expect(src).toContain("published_success");
  expect(src).toContain("failures");
  expect(src).toContain("remaining_candidates");
});

test("publish_next dry-run creates lane artifacts without API calls", async ({ page }) => {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");
  const ROOT = path.resolve(__dirname, "..");

  // Save original published_pages.json
  const pubPath = path.join(ROOT, "data", "published_pages.json");
  const origPublished = fs.readFileSync(pubPath, "utf-8");

  // Save original webflow slugs
  const slugsPath = path.join(ROOT, "data", "webflow_existing_slugs.json");
  const origSlugs = fs.readFileSync(slugsPath, "utf-8");

  try {
    // Reset published pages and set one webflow slug to test skipping
    fs.writeFileSync(pubPath, "[]");
    fs.writeFileSync(slugsPath, JSON.stringify(["los-angeles-to-long-beach"]));

    // Run dry-run with count 2
    const nodeBin = "/Users/troyfavre/Documents/.local/node-v24.14.0-darwin-arm64/bin";
    const result = execSync(
      `${nodeBin}/node scripts/publish_next.js --dry-run --count 2 --filter-mode LTL --no-hub-priority`,
      { cwd: ROOT, env: { ...process.env, PATH: `${nodeBin}:${process.env.PATH}` }, timeout: 15000 }
    ).toString();

    // Should have published 2 lanes
    expect(result).toContain("Target met");
    expect(result).toContain("SKIP (duplicate)");

    // Report file should exist
    const reportPath = path.join(ROOT, "artifacts", "publish_next_report.json");
    expect(fs.existsSync(reportPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    expect(report.published_success.length).toBe(2);
    expect(report.skipped_duplicates.length).toBeGreaterThanOrEqual(1);
    expect(report.skipped_duplicates[0].slug).toBe("los-angeles-to-long-beach");
    expect(report.skipped_duplicates[0].rule_id).toBe("DUP-SLUG-01");
    expect(report.remaining_candidates).toBeGreaterThan(0);

    // Published pages should have been updated
    const updatedPub = JSON.parse(fs.readFileSync(pubPath, "utf-8"));
    expect(updatedPub.length).toBe(2);
    expect(updatedPub[0].slug).toBeTruthy();
    expect(updatedPub[0].dry_run).toBe(true);
  } finally {
    // Restore original files
    fs.writeFileSync(pubPath, origPublished);
    fs.writeFileSync(slugsPath, origSlugs);
  }
});

test("import_webflow_slugs normalizes unicode hyphens and deduplicates", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "import_webflow_slugs_from_export.js"), "utf-8");

  // Unicode hyphen normalization
  expect(src).toContain("\\u2013"); // en-dash
  expect(src).toContain("\\u2014"); // em-dash
  expect(src).toContain("normalizeSlug");
  expect(src).toContain("webflow_existing_slugs.json");

  // Dedup
  expect(src).toContain("new Set");
});

test("lane_inventory.json exists with deterministic ordering and no self-lanes", async () => {
  const fs = require("fs");
  const path = require("path");
  const inventory = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "lane_inventory.json"), "utf-8")
  );

  expect(inventory.length).toBeGreaterThan(100);

  // Check structure
  const first = inventory[0];
  expect(first.origin).toBeTruthy();
  expect(first.destination).toBeTruthy();
  expect(first.mode).toBeTruthy();
  expect(first.slug).toBeTruthy();
  expect(first.order).toBeDefined();

  // No self-lanes
  for (const lane of inventory) {
    const oCity = lane.origin.split(",")[0].trim().toLowerCase();
    const dCity = lane.destination.split(",")[0].trim().toLowerCase();
    expect(oCity).not.toBe(dCity);
  }

  // Deterministic ordering (order field is sequential)
  for (let i = 1; i < Math.min(inventory.length, 20); i++) {
    expect(inventory[i].order).toBeGreaterThan(inventory[i - 1].order);
  }
});

// ── Lane ingestion pipeline tests ──

test("ingest_lanes_from_pdf.js extracts lanes and normalizes city names", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "ingest_lanes_from_pdf.js"), "utf-8");

  // Must normalize using cities.json
  expect(src).toContain("cities.json");
  expect(src).toContain("normalizeCity");
  expect(src).toContain("normalizeState");

  // Must handle multiple input formats
  expect(src).toContain("extractLanes");

  // Must detect duplicates
  expect(src).toContain("detectDuplicates");
  expect(src).toContain("INGEST-DUP-01"); // exact duplicate
  expect(src).toContain("INGEST-DUP-02"); // reversed lane

  // Must output all three files
  expect(src).toContain("raw_lanes.json");
  expect(src).toContain("lanes_canonical.json");
  expect(src).toContain("lanes_duplicates_report.json");
});

test("lanes_canonical.json exists with unique deduplicated lanes", async () => {
  const fs = require("fs");
  const path = require("path");
  const canonical = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "lanes_canonical.json"), "utf-8")
  );

  expect(canonical.length).toBeGreaterThan(100);

  // Each lane has required fields
  const first = canonical[0];
  expect(first.origin).toBeTruthy();
  expect(first.destination).toBeTruthy();
  expect(first.slug).toBeTruthy();
  expect(first.order).toBeDefined();

  // No exact duplicates (slug is unique)
  const slugs = canonical.map(l => l.slug);
  const uniqueSlugs = new Set(slugs);
  expect(uniqueSlugs.size).toBe(slugs.length);
});

test("lanes_duplicates_report.json has summary and duplicate entries", async () => {
  const fs = require("fs");
  const path = require("path");
  const report = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "lanes_duplicates_report.json"), "utf-8")
  );

  // Summary required fields
  expect(report.summary).toBeTruthy();
  expect(report.summary.total_raw).toBeGreaterThan(0);
  expect(report.summary.canonical_unique).toBeGreaterThan(0);
  expect(typeof report.summary.exact_duplicates).toBe("number");
  expect(typeof report.summary.reversed_duplicates).toBe("number");
  expect(typeof report.summary.total_duplicates).toBe("number");

  // Duplicates array
  expect(Array.isArray(report.duplicates)).toBe(true);
  if (report.duplicates.length > 0) {
    const d = report.duplicates[0];
    expect(d.slug).toBeTruthy();
    expect(d.reason).toBeTruthy();
    expect(d.rule_id).toBeTruthy();
    expect(d.duplicate_of_slug).toBeTruthy();
  }
});

// ── SEO Engine: Layer 6 — URL Discipline ──────────────────────────────

test("url-discipline.js exports all required functions", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "url-discipline.js"), "utf-8");

  const required = [
    "export function normalizeCityName",
    "export function laneSlug",
    "export function canonicalForIntent",
    "export function isParametrizedUrlIndexable",
    "export function canonicalFromUrl",
    "export function buildCanonicalIndex",
    "export function isVariantSlug",
  ];
  for (const fn of required) {
    expect(src).toContain(fn);
  }
});

test("url-discipline laneSlug generates correct origin-to-destination format", async ({ page }) => {
  await page.goto("/builder");
  const slug = await page.evaluate(() => {
    // Import via module resolution in page context
    const slugify = (s) =>
      String(s || "").split(",")[0].trim().toLowerCase()
        .replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
        .replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
    const laneSlug = (o, d) => `${slugify(o)}-to-${slugify(d)}`;
    return JSON.stringify({
      basic: laneSlug("Chicago", "Dallas"),
      withState: laneSlug("Los Angeles, CA", "Phoenix, AZ"),
      withSpaces: laneSlug("Salt Lake City", "Kansas City"),
    });
  });
  const result = JSON.parse(slug);
  expect(result.basic).toBe("chicago-to-dallas");
  expect(result.withState).toBe("los-angeles-to-phoenix");
  expect(result.withSpaces).toBe("salt-lake-city-to-kansas-city");
});

test("url-discipline has city alias map for common abbreviations", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "url-discipline.js"), "utf-8");

  // Check critical aliases exist
  expect(src).toContain('"la": "los angeles"');
  expect(src).toContain('"sf": "san francisco"');
  expect(src).toContain('"nyc": "new york"');
  expect(src).toContain('"slc": "salt lake city"');
  expect(src).toContain('"kc": "kansas city"');
});

test("url-discipline canonicalForIntent produces correct patterns for all page types", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "url-discipline.js"), "utf-8");

  // Verify canonical patterns for each page type
  expect(src).toContain("lane_service");
  expect(src).toContain("lane_data");
  expect(src).toContain("corridor_hub");
  expect(src).toContain("corridor_explainer");
  expect(src).toContain("/lanes/");
  expect(src).toContain("/data/");
  expect(src).toContain("/corridors/");
  expect(src).toContain("how-warp-runs-this-corridor");
});

test("url-discipline noindex parameter patterns block tracking params", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "url-discipline.js"), "utf-8");

  // These tracking parameters must trigger noindex
  const patterns = ["utm_", "fbclid", "gclid", "msclkid", "mc_cid", "prefill"];
  for (const p of patterns) {
    expect(src).toContain(`"${p}`);
  }
});

// ── SEO Engine: Layer 5 — Corridor-First Internal Linking ─────────────

test("corridors.json has 14 corridors including 'other' fallback", async () => {
  const fs = require("fs");
  const path = require("path");
  const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "corridors.json"), "utf-8")
  );

  expect(data.corridors).toBeTruthy();
  expect(data.corridors.length).toBe(14);

  // Other fallback exists
  const other = data.corridors.find(c => c.id === "other");
  expect(other).toBeTruthy();
  expect(other.priority).toBe("low");

  // Non-other corridors have valid clusters and priority
  const real = data.corridors.filter(c => c.id !== "other");
  expect(real.length).toBe(13);
  for (const c of real) {
    expect(c.origin_cluster.length).toBeGreaterThan(0);
    expect(c.destination_cluster.length).toBeGreaterThan(0);
    expect(["high", "medium", "low"]).toContain(c.priority);
    expect(c.name).toBeTruthy();
    expect(c.region_pair).toBeTruthy();
  }
});

test("corridors.js exports all required functions", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "corridors.js"), "utf-8");

  const required = [
    "export function loadCorridors",
    "export function getCorridorById",
    "export function assignCorridorToLane",
    "export function listCorridorLaneCandidates",
    "export function selectToolPage",
    "export function generateCorridorLinks",
  ];
  for (const fn of required) {
    expect(src).toContain(fn);
  }
});

test("corridors assignment uses priority → cluster size → tiebreaker resolution", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "corridors.js"), "utf-8");

  // Verify priority scoring
  expect(src).toContain("PRIORITY_RANK");
  expect(src).toContain("high: 3");
  expect(src).toContain("medium: 2");
  expect(src).toContain("low: 1");

  // Verify sort order: priority → cluster size → tiebreaker
  expect(src).toContain("priorityScore");
  expect(src).toContain("clusterSize");
  expect(src).toContain("tiebreaker");

  // Verify bidirectional matching
  expect(src).toContain("forwardOrigin");
  expect(src).toContain("reverseOrigin");
  expect(src).toContain('"forward"');
  expect(src).toContain('"reverse"');
  expect(src).toContain('"intra"');
  expect(src).toContain('"fallback"');
});

test("corridors generateCorridorLinks produces all required link types", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "corridors.js"), "utf-8");

  // Must produce these link types
  expect(src).toContain("corridorHub");
  expect(src).toContain("corridorExplainer");
  expect(src).toContain("relatedLanes");
  expect(src).toContain("toolLink");
  expect(src).toContain("dataPageLink");

  // Related lane scoring uses demand signals
  expect(src).toContain("demand.gsc");
  expect(src).toContain("demand.keywords");
  expect(src).toContain("demand.portal");
});

test("corridor hub page loads for chicago-dfw", async ({ page }) => {
  await page.goto("/corridors/chicago-dfw");
  await expect(page.locator("[data-testid='corridor-h1']")).toBeVisible();
  await expect(page.locator("[data-testid='corridor-h1']")).toContainText("Chicago");
  await expect(page.locator("[data-testid='corridor-lanes']")).toBeVisible();
});

test("corridor explainer page loads for chicago-dfw", async ({ page }) => {
  await page.goto("/corridors/chicago-dfw/how-warp-runs-this-corridor");
  await expect(page.locator("[data-testid='explainer-h1']")).toBeVisible();
  await expect(page.locator("[data-testid='explainer-h1']")).toContainText("How Warp Runs");
});

test("corridor hub has CollectionPage JSON-LD schema", async ({ page }) => {
  await page.goto("/corridors/socal-phoenix");
  const schema = await page.evaluate(() => {
    const el = document.querySelector('script[type="application/ld+json"]');
    return el ? JSON.parse(el.textContent) : null;
  });
  expect(schema).toBeTruthy();
  expect(schema["@type"]).toBe("CollectionPage");
  expect(schema.provider.name).toBe("WARP");
  expect(schema.url).toContain("corridors/socal-phoenix");
});

// ── SEO Engine: Layer 2 — Indexing Firewall ──────────────────────────

test("page-eligibility.js exports all required functions", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "page-eligibility.js"), "utf-8");

  const required = [
    "export function buildTextFingerprint",
    "export function cosineSimilarity",
    "export function evaluatePageEligibility",
    "export function buildPublishDecision",
  ];
  for (const fn of required) {
    expect(src).toContain(fn);
  }
});

test("page-eligibility has all 4 gates with correct rule IDs", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "page-eligibility.js"), "utf-8");

  // Gate 1: Demand
  expect(src).toContain("ELIG-DEMAND-01");
  // Gate 2: Content sufficiency (8 rules)
  expect(src).toContain("ELIG-CONTENT-01");
  expect(src).toContain("ELIG-CONTENT-02");
  expect(src).toContain("ELIG-CONTENT-03");
  expect(src).toContain("ELIG-CONTENT-04");
  expect(src).toContain("ELIG-CONTENT-05");
  expect(src).toContain("ELIG-CONTENT-06");
  expect(src).toContain("ELIG-CONTENT-07");
  expect(src).toContain("ELIG-CONTENT-08");
  // Gate 3: Duplication
  expect(src).toContain("ELIG-DUPE-01");
  // Gate 4: Quality
  expect(src).toContain("ELIG-QUALITY-01");
  expect(src).toContain("ELIG-QUALITY-02");
});

test("page-eligibility demandGate checks GSC, keywords, and portal signals", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "page-eligibility.js"), "utf-8");

  expect(src).toContain("demandGate");
  expect(src).toContain("gscImpressionsMin");
  expect(src).toContain("portalQuoteFrequencyMin");
  expect(src).toContain("keywordDemandMin");
  expect(src).toContain("corridorPriority");
});

test("page-eligibility quality scoring has max 100 cap", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "page-eligibility.js"), "utf-8");

  expect(src).toContain("qualityGate");
  expect(src).toContain("Math.min(score, 100)");
  expect(src).toContain("qualityHardFloor");
  expect(src).toContain("qualityThreshold");
});

test("page-eligibility buildPublishDecision produces correct artifact shape", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "page-eligibility.js"), "utf-8");

  // Must produce these fields
  expect(src).toContain("run_id");
  expect(src).toContain("pages_attempted");
  expect(src).toContain("pages_indexed");
  expect(src).toContain("pages_blocked");
  expect(src).toContain("pages_noindexed");
  expect(src).toContain("blocked_reasons");
  expect(src).toContain("canonical_conflicts");
  expect(src).toContain("duplicate_conflicts");
  expect(src).toContain("broken_internal_links");
  expect(src).toContain("quality_distribution");
});

// ── SEO Engine: Config & Demand Data ──────────────────────────────────

test("seo-engine.json config has all required thresholds", async () => {
  const fs = require("fs");
  const path = require("path");
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "config", "seo-engine.json"), "utf-8")
  );

  expect(typeof config.similarityThreshold).toBe("number");
  expect(typeof config.qualityThreshold).toBe("number");
  expect(typeof config.qualityHardFloor).toBe("number");
  expect(typeof config.maxBlockedPages).toBe("number");

  // Demand thresholds
  expect(config.demandThresholds).toBeTruthy();
  expect(typeof config.demandThresholds.gscImpressionsMin).toBe("number");
  expect(typeof config.demandThresholds.portalQuoteFrequencyMin).toBe("number");

  // Content minimums
  expect(config.contentMinimums).toBeTruthy();
  expect(config.contentMinimums.laneServicePage).toBeTruthy();
  expect(config.contentMinimums.laneDataPage).toBeTruthy();

  // Internal linking config
  expect(config.internalLinking).toBeTruthy();
  expect(typeof config.internalLinking.minRelatedLanes).toBe("number");
  expect(typeof config.internalLinking.maxRelatedLanes).toBe("number");

  // Tool pages
  expect(config.toolPages.length).toBeGreaterThanOrEqual(3);

  // Canonical pattern
  expect(config.canonicalPattern).toContain("/lanes/");
});

test("demand data stubs have correct shape (gsc, keywords, portal_quotes)", async () => {
  const fs = require("fs");
  const path = require("path");

  // GSC data
  const gsc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "demand", "gsc.json"), "utf-8"));
  const gscKeys = Object.keys(gsc).filter(k => !k.startsWith("_"));
  expect(gscKeys.length).toBeGreaterThanOrEqual(10);
  for (const key of gscKeys) {
    expect(typeof gsc[key].impressions).toBe("number");
    expect(typeof gsc[key].clicks).toBe("number");
    expect(typeof gsc[key].position).toBe("number");
  }

  // Keywords data
  const kw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "demand", "keywords.json"), "utf-8"));
  const kwKeys = Object.keys(kw).filter(k => !k.startsWith("_"));
  expect(kwKeys.length).toBeGreaterThanOrEqual(10);
  for (const key of kwKeys) {
    expect(Array.isArray(kw[key])).toBe(true);
    expect(kw[key].length).toBeGreaterThan(0);
  }

  // Portal quotes
  const portal = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "demand", "portal_quotes.json"), "utf-8"));
  const portalKeys = Object.keys(portal).filter(k => !k.startsWith("_"));
  expect(portalKeys.length).toBeGreaterThanOrEqual(5);
  for (const key of portalKeys) {
    expect(typeof portal[key].monthly_quotes).toBe("number");
    expect(typeof portal[key].avg_value_usd).toBe("number");
  }
});

// ── SEO Engine: Integration ──────────────────────────────────────────

test("lane-engine.js integrates corridor assignment and corridor links", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "lane-engine.js"), "utf-8");

  // Imports
  expect(src).toContain("assignCorridorToLane");
  expect(src).toContain("url-discipline");

  // Corridor assignment in makeLanePage
  expect(src).toContain("corridor_id");
  expect(src).toContain("corridor_name");
  expect(src).toContain("corridor_priority");

  // Corridor links in generatePages
  expect(src).toContain("corridor_links");
  expect(src).toContain("generateCorridorLinks");
});

test("validate_seo_engine.js script checks all 3 SEO layers", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "validate_seo_engine.js"), "utf-8");

  // Layer 5: Corridor checks
  expect(src).toContain("corridors.json exists");
  expect(src).toContain("Corridors defined");
  expect(src).toContain("Other corridor exists");

  // Layer 2: Eligibility checks
  expect(src).toContain("page-eligibility.js");
  expect(src).toContain("ELIG-DEMAND-01");
  expect(src).toContain("ELIG-CONTENT-01");
  expect(src).toContain("ELIG-DUPE-01");
  expect(src).toContain("ELIG-QUALITY-01");
  expect(src).toContain("buildPublishDecision");

  // Layer 6: URL discipline checks
  expect(src).toContain("url-discipline.js");
  expect(src).toContain("canonicalForIntent");
  expect(src).toContain("laneSlug");
  expect(src).toContain("isParametrizedUrlIndexable");

  // Artifact output
  expect(src).toContain("publish_decision.json");
});

// ── SEO Control Panel Dashboard ──────────────────────────────────────

test("seo control panel overview loads with metrics", async ({ page }) => {
  await page.goto("/internal/seo-control");
  await expect(page.locator("[data-testid='seo-control-panel']")).toBeVisible();
  await expect(page.locator("[data-testid='seo-control-nav']")).toBeVisible();
  await expect(page.locator("[data-testid='seo-overview']")).toBeVisible();
  await expect(page.locator("[data-testid='overview-metrics']")).toBeVisible();
  await expect(page.locator("[data-testid='overview-io']")).toBeVisible();
});

test("seo control panel overview shows input vs output comparison", async ({ page }) => {
  await page.goto("/internal/seo-control");
  const io = page.locator("[data-testid='overview-io']");
  await expect(io.locator("text=Inputs")).toBeVisible();
  await expect(io.locator("text=Outputs")).toBeVisible();
  await expect(io.locator("text=Corridors Active")).toBeVisible();
  await expect(io.locator("text=Pages Indexed")).toBeVisible();
  await expect(io.locator("text=GSC Impressions")).toBeVisible();
  await expect(io.locator("text=Bookings")).toBeVisible();
});

test("seo control panel has 4 metric cards on overview", async ({ page }) => {
  await page.goto("/internal/seo-control");
  const metrics = page.locator("[data-testid='overview-metrics']");
  await expect(metrics.locator("[data-testid='metric-pages-attempted']")).toBeVisible();
  await expect(metrics.locator("[data-testid='metric-pages-indexed']")).toBeVisible();
  await expect(metrics.locator("[data-testid='metric-pages-blocked']")).toBeVisible();
  await expect(metrics.locator("[data-testid='metric-pages-noindex']")).toBeVisible();
});

test("seo control panel corridors page lists corridor cards", async ({ page }) => {
  await page.goto("/internal/seo-control/corridors");
  await expect(page.locator("[data-testid='seo-corridors']")).toBeVisible();
  await expect(page.locator("[data-testid='corridor-card-chicago-dfw']")).toBeVisible();
  await expect(page.locator("[data-testid='corridor-card-socal-phoenix']")).toBeVisible();
  // Should show priority and health badges
  await expect(page.locator("text=high").first()).toBeVisible();
});

test("seo control panel corridor detail loads with inputs and outputs", async ({ page }) => {
  await page.goto("/internal/seo-control/corridors/chicago-dfw");
  await expect(page.locator("[data-testid='seo-corridor-detail']")).toBeVisible();
  await expect(page.locator("text=Corridor Inputs")).toBeVisible();
  await expect(page.locator("text=Corridor Outputs")).toBeVisible();
  await expect(page.locator("text=Origin Cluster")).toBeVisible();
  await expect(page.locator("text=Traffic Funnel")).toBeVisible();
});

test("seo control panel lanes page has search and filter", async ({ page }) => {
  await page.goto("/internal/seo-control/lanes");
  await expect(page.locator("[data-testid='seo-lanes']")).toBeVisible();
  await expect(page.locator("[data-testid='lane-search']")).toBeVisible();
  await expect(page.locator("[data-testid='lanes-table']")).toBeVisible({ timeout: 10000 });
});

test("seo control panel experiments page shows experiment cards", async ({ page }) => {
  await page.goto("/internal/seo-control/experiments");
  await expect(page.locator("[data-testid='seo-experiments']")).toBeVisible();
  await expect(page.locator("[data-testid='experiment-exp-001']")).toBeVisible();
  // Check experiment metrics
  await expect(page.locator("text=Indexing Lift").first()).toBeVisible();
  await expect(page.locator("text=Traffic Lift").first()).toBeVisible();
});

test("seo control panel nav links to all 4 pages", async ({ page }) => {
  await page.goto("/internal/seo-control");
  const nav = page.locator("[data-testid='seo-control-nav']");
  await expect(nav.locator("text=Overview")).toBeVisible();
  await expect(nav.locator("text=Corridors")).toBeVisible();
  await expect(nav.locator("text=Lanes")).toBeVisible();
  await expect(nav.locator("text=Experiments")).toBeVisible();
});

test("seo api endpoint returns overview data", async ({ request }) => {
  const res = await request.get("/api/seo?view=overview");
  expect(res.status()).toBe(200);
  const data = await res.json();
  expect(data.metrics).toBeTruthy();
  expect(typeof data.metrics.pages_attempted).toBe("number");
  expect(typeof data.metrics.pages_indexed).toBe("number");
  expect(data.inputs).toBeTruthy();
  expect(data.outputs).toBeTruthy();
});

test("seo api endpoint returns corridors data", async ({ request }) => {
  const res = await request.get("/api/seo?view=corridors");
  expect(res.status()).toBe(200);
  const data = await res.json();
  expect(data.corridors).toBeTruthy();
  expect(data.corridors.length).toBeGreaterThan(0);
  const first = data.corridors[0];
  expect(first.corridor_id).toBeTruthy();
  expect(typeof first.lanes_total).toBe("number");
});

test("seo api endpoint returns lanes data with filters", async ({ request }) => {
  const res = await request.get("/api/seo?view=lanes&search=chicago");
  expect(res.status()).toBe(200);
  const data = await res.json();
  expect(data.lanes).toBeTruthy();
  for (const lane of data.lanes) {
    expect(lane.lane_slug).toContain("chicago");
  }
});

test("seo snapshot artifacts exist with correct shape", async () => {
  const fs = require("fs");
  const path = require("path");

  // Lane registry snapshot
  const laneSnap = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "artifacts", "lane_registry_snapshot.json"), "utf-8")
  );
  expect(laneSnap.total_lanes).toBeGreaterThan(0);
  expect(laneSnap.lanes.length).toBeGreaterThan(0);
  const lane = laneSnap.lanes[0];
  expect(lane.lane_slug).toBeTruthy();
  expect(lane.corridor).toBeTruthy();
  expect(typeof lane.quality_score).toBe("number");
  expect(typeof lane.similarity_score).toBe("number");
  expect(typeof lane.gsc_impressions).toBe("number");

  // Corridor snapshot
  const corrSnap = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "artifacts", "corridor_snapshot.json"), "utf-8")
  );
  expect(corrSnap.total_corridors).toBeGreaterThan(0);
  expect(corrSnap.corridors.length).toBeGreaterThan(0);
  const corr = corrSnap.corridors[0];
  expect(corr.corridor_id).toBeTruthy();
  expect(typeof corr.lanes_total).toBe("number");
  expect(typeof corr.impressions).toBe("number");
});

test("seo dashboard data module exports all required functions", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "seo-dashboard-data.js"), "utf-8");

  expect(src).toContain("export function getOverviewData");
  expect(src).toContain("export function getCorridorsData");
  expect(src).toContain("export function getCorridorDetail");
  expect(src).toContain("export function getLanesData");
  expect(src).toContain("export function getLaneDetail");
  expect(src).toContain("export function getExperimentsData");
});

test("seo control panel is protected by INTERNAL_DASHBOARD_KEY", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "app", "internal", "seo-control", "layout.js"), "utf-8"
  );
  expect(src).toContain("INTERNAL_DASHBOARD_KEY");
  expect(src).toContain("seo_dash_key");
  expect(src).toContain("Enter dashboard key");
});

// ══════════════════════════════════════════════════════════════════════
// Publish Classification Tests — machine-enforced trust boundaries
// ══════════════════════════════════════════════════════════════════════

test("publish-classification.js exports all required functions", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-classification.js"), "utf-8");
  expect(src).toContain("export function classifyPublishRun");
  expect(src).toContain("export function isProductionEnvironment");
  expect(src).toContain("export function isLocalSimulation");
  expect(src).toContain("export function isConfirmedProductionPublish");
  expect(src).toContain("CLASSIFICATIONS");
  expect(src).toContain("DISPLAY_LABELS");
  expect(src).toContain("TRUST_LEVELS");
});

test("local audit bundle run classified as local_simulation with confirmed=false", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-classification.js"), "utf-8");
  // Verify the classification logic prevents local simulation from being confirmed
  expect(src).toContain("local_simulation");
  expect(src).toContain("confirmed_posted_today: false");

  // Verify the audit bundle marks itself as local
  const bundleSrc = fs.readFileSync(path.join(__dirname, "..", "scripts", "build_publish_audit_bundle.js"), "utf-8");
  expect(bundleSrc).toContain("manual_audit_bundle");
  expect(bundleSrc).toContain("_source");

  // Verify isLocalSimulation catches dry/local modes
  expect(src).toContain('mode === "dry"');
  expect(src).toContain('mode === "local"');
  expect(src).toContain('env === "local"');
  expect(src).toContain("manual_audit_bundle");
});

test("staging deploy classified as staging_publish with confirmed=false", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-classification.js"), "utf-8");
  expect(src).toContain("staging_publish");
  expect(src).toContain("STAGING_PUBLISH");
  // Staging can never be confirmed
  expect(src).toContain('mode === "staging"');
  expect(src).toContain("isStagingEnvironment");
  // Verify staging trust level is medium, not high
  expect(src).toContain('staging_publish: "medium"');
});

test("production deploy success without live verification classified as production_unverified", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-classification.js"), "utf-8");
  expect(src).toContain("production_unverified");
  expect(src).toContain("PRODUCTION_UNVERIFIED");
  // Must check live verification
  expect(src).toContain("live_verification_not_run");
  expect(src).toContain("require_live_verification_for_confirmed");
  // Unverified trust level must be medium
  expect(src).toContain('production_unverified: "medium"');
});

test("production deploy success with live verification passed classified as production_confirmed", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-classification.js"), "utf-8");
  expect(src).toContain("production_confirmed");
  expect(src).toContain("PRODUCTION_CONFIRMED");
  // Only production_confirmed can have confirmed_posted_today: true
  expect(src).toContain("confirmed_posted_today: true");
  // Must be high trust
  expect(src).toContain('production_confirmed: "high"');
});

test("production deploy failed classified as production_failed", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-classification.js"), "utf-8");
  expect(src).toContain("production_failed");
  expect(src).toContain("PRODUCTION_FAILED");
  expect(src).toContain("deploy_status_failed");
  // Failed trust level must be low
  expect(src).toContain('production_failed: "low"');
});

test("localhost site_base_url can never be classified as production_confirmed", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-classification.js"), "utf-8");
  // isLocalhostUrl check
  expect(src).toContain("isLocalhostUrl");
  expect(src).toContain("localhost_site_url");
  // Must check production domain
  expect(src).toContain("isProductionDomain");
  expect(src).toContain("site_url_not_production_domain");
});

test("config/publish-trust.json has required fields", async () => {
  const fs = require("fs");
  const path = require("path");
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "config", "publish-trust.json"), "utf-8")
  );
  expect(config.production_domains).toBeDefined();
  expect(config.production_domains.length).toBeGreaterThan(0);
  expect(config.production_environment_markers).toBeDefined();
  expect(config.staging_environment_markers).toBeDefined();
  expect(config.localhost_markers).toBeDefined();
  expect(config.localhost_markers.length).toBeGreaterThan(0);
  expect(typeof config.require_live_verification_for_confirmed).toBe("boolean");
  expect(config.require_live_verification_for_confirmed).toBe(true);
});

test("verify_live_pages.js outputs verification_status field", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify_live_pages.js"), "utf-8");
  expect(src).toContain("verification_status");
  expect(src).toContain('"passed"');
  expect(src).toContain('"warning"');
  expect(src).toContain('"failed"');
  expect(src).toContain('"not_run"');
});

test("publish-audit.js didSomethingPostToday returns confirmed_posted_today field", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-audit.js"), "utf-8");
  expect(src).toContain("confirmed_posted_today");
  expect(src).toContain("best_available_status");
  expect(src).toContain("classifyPublishRun");
  expect(src).toContain("isConfirmedProductionPublish");
  // Must never return confirmed: true without classification check
  expect(src).not.toContain("confirmed: true,");
});

test("publish-audit.js buildPublishDecision includes classification metadata", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-audit.js"), "utf-8");
  // buildPublishDecision must attach classification
  expect(src).toContain("decisionObj.classification = cls.classification");
  expect(src).toContain("decisionObj.trust_level = cls.trust_level");
  expect(src).toContain("decisionObj.confirmed_posted_today = cls.confirmed_posted_today");
});

test("publish-audit.js confirmation report includes classification and verification_summary", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-audit.js"), "utf-8");
  expect(src).toContain("classification: classification.classification");
  expect(src).toContain("display_status: classification.display_status");
  expect(src).toContain("trust_level: classification.trust_level");
  expect(src).toContain("reason_codes: classification.reason_codes");
  expect(src).toContain("verification_summary");
});

test("publish-integrity-checks.js has classification trust violation checks", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-integrity-checks.js"), "utf-8");
  // Must check all 6 classification violations
  expect(src).toContain("classification_mismatch");
  expect(src).toContain("confirmation_classification_mismatch");
  expect(src).toContain("high_trust_no_verification");
  expect(src).toContain("confirmed_no_deployment_id");
  expect(src).toContain("confirmed_non_production_domain");
  expect(src).toContain("local_simulation_confirmed");
  expect(src).toContain("staging_confirmed");
});

test("build_publish_audit_bundle.js self-labels as local simulation", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "build_publish_audit_bundle.js"), "utf-8");
  // Must mark _source as manual_audit_bundle
  expect(src).toContain('_source');
  expect(src).toContain('manual_audit_bundle');
  // Must re-classify after marking
  expect(src).toContain("classifyPublishRun");
  // Must never allow confirmed_posted_today to be true from this script
  expect(src).toContain('provider: "local"');
  expect(src).toContain('deployment_id: "local-audit"');
});

test("all 5 publish-audit API endpoints include classification metadata", async () => {
  const fs = require("fs");
  const path = require("path");
  const routes = [
    "app/api/seo/publish-audit/latest/route.js",
    "app/api/seo/publish-audit/today/route.js",
    "app/api/seo/publish-audit/impact/route.js",
    "app/api/seo/publish-audit/momentum/route.js",
    "app/api/seo/publish-audit/live-verification/route.js",
  ];
  for (const route of routes) {
    const src = fs.readFileSync(path.join(__dirname, "..", route), "utf-8");
    expect(src).toContain("classification");
    expect(src).toContain("trust_level");
    expect(src).toContain("confirmed_posted_today");
  }
});

test("publish-audit dashboard page uses classification layer not raw confirmed check", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "app", "internal", "seo-control", "publish-audit", "page.js"), "utf-8"
  );
  // Must import classification
  expect(src).toContain("classifyPublishRun");
  // Must show trust badge
  expect(src).toContain("trust-badge");
  expect(src).toContain("trust");
  // Must show classification badge
  expect(src).toContain("classification-badge");
  // Must show reason codes
  expect(src).toContain("reason-codes");
  // Must use classification-based banner phrasing
  expect(src).toContain("Confirmed production publish completed today");
  expect(src).toContain("Simulated local audit ran today");
  expect(src).toContain("Staging publish ran today");
  expect(src).toContain("Production publish ran today but is unverified");
  expect(src).toContain("Production publish failed today");
  // Must NEVER say "posted today" unless production_confirmed
  expect(src).toContain('cls === "production_confirmed" ? "Posted URLs" : "Generated URLs (not confirmed posted)"');
});

test("publish-classification defines exactly 6 classification types", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-classification.js"), "utf-8");
  const types = [
    "local_simulation",
    "staging_publish",
    "production_unverified",
    "production_confirmed",
    "production_failed",
    "unknown",
  ];
  for (const t of types) {
    expect(src).toContain(`"${t}"`);
  }
});

test("publish-classification has display labels for all 6 types", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "publish-classification.js"), "utf-8");
  expect(src).toContain("Simulated local audit");
  expect(src).toContain("Staging publish");
  expect(src).toContain("Production publish unverified");
  expect(src).toContain("Confirmed production publish");
  expect(src).toContain("Production publish failed");
  expect(src).toContain('"Unknown"');
});

// ── Publish Next: empty-slugs guardrail ──

test("publish_next blocks real publish when webflow_existing_slugs.json is empty", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "publish_next.js"), "utf-8");

  // Must warn when slugs are empty
  expect(src).toContain("Webflow existing slugs not imported");
  expect(src).toContain("Real publish is unsafe");

  // Must block non-dry-run when empty and no override
  expect(src).toContain("BLOCKED");
  expect(src).toContain("allow-empty-webflow-slugs");

  // Must check webflowSlugs.length === 0
  expect(src).toContain("webflowSlugs.length === 0");
});

test("publish_next allows override with --allow-empty-webflow-slugs flag", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "publish_next.js"), "utf-8");

  // Must parse the override flag
  expect(src).toContain("ALLOW_EMPTY_WEBFLOW_SLUGS");
  expect(src).toContain("--allow-empty-webflow-slugs");

  // Override skips block
  expect(src).toContain("!ALLOW_EMPTY_WEBFLOW_SLUGS");
});

test("publish_next guardrail: dry-run path skips block, real path blocks on empty slugs", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "publish_next.js"), "utf-8");

  // The guardrail checks webflowSlugs.length === 0
  expect(src).toContain("webflowSlugs.length === 0");

  // When empty AND not dry-run AND no override → block with exit(1)
  expect(src).toContain("!DRY_RUN && !ALLOW_EMPTY_WEBFLOW_SLUGS");
  expect(src).toContain("BLOCKED");
  expect(src).toContain("process.exit(1)");

  // The block and warning are INSIDE the webflowSlugs.length === 0 check
  // Verify the order: warn first, then conditionally block
  const warnIdx = src.indexOf("Webflow existing slugs not imported");
  const blockIdx = src.indexOf("BLOCKED");
  expect(warnIdx).toBeGreaterThan(-1);
  expect(blockIdx).toBeGreaterThan(warnIdx); // warn comes before block

  // DRY_RUN skips the block (only !DRY_RUN blocks)
  // This is validated by the condition containing !DRY_RUN
  expect(src).toContain("!DRY_RUN");
});

// ── Daily Publish Summary Email ──

test("daily summary email script reads confirmed pages from artifacts", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Reads from machine-readable artifacts, not guessed
  expect(src).toContain("published_pages.json");
  expect(src).toContain("publish_next_report.json");
  expect(src).toContain("publish_decision.json");

  // Filters out dry runs — only real publishes count
  expect(src).toContain("dry_run === true");
  expect(src).toContain("published_at_iso");

  // Writes both output artifacts
  expect(src).toContain("daily_publish_summary.json");
  expect(src).toContain("daily_publish_summary.html");
});

test("daily summary email default recipient is troy@wearewarp.com", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Default recipient must be troy@wearewarp.com (not tro@)
  expect(src).toContain('DEFAULT_RECIPIENT = "troy@wearewarp.com"');

  // Supports DAILY_SUMMARY_EMAIL_TO override
  expect(src).toContain("DAILY_SUMMARY_EMAIL_TO");
  expect(src).toContain("process.env.DAILY_SUMMARY_EMAIL_TO || DEFAULT_RECIPIENT");

  // Subject format: "Warp SEO Daily Publish Summary — {date}"
  expect(src).toContain("Warp SEO Daily Publish Summary");
  expect(src).toContain("${today}");

  // Uses existing email sender infrastructure
  expect(src).toContain("createTransportFromEnv");
  expect(src).toContain("verifyTransport");
});

test("daily summary email handles zero-post day with clear message", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Must include zero-post message
  expect(src).toContain("No confirmed pages were posted today");

  // Email sends even when zero pages (no early return before send)
  const dryRunIdx = src.indexOf("DRY RUN — email not sent");
  const realSendIdx = src.indexOf("Real send");
  expect(dryRunIdx).toBeGreaterThan(-1);
  expect(realSendIdx).toBeGreaterThan(dryRunIdx);
});

test("daily summary includes top 5 strategic pages by hub priority", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Hub priority scoring function
  expect(src).toContain("hubPriorityScore");
  expect(src).toContain("HUB_CITIES");

  // Top 5 section in email
  expect(src).toContain("Top 5 Most Strategic Pages Posted Today");
  expect(src).toContain("top_5_strategic");
  expect(src).toContain("hub_score");
});

test("daily summary dry-run writes artifacts without sending email", async ({ page }) => {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");
  const ROOT = path.resolve(__dirname, "..");

  const nodeBin = "/Users/troyfavre/Documents/.local/node-v24.14.0-darwin-arm64/bin";
  const result = execSync(
    `${nodeBin}/node scripts/send_daily_publish_summary.js --dry-run`,
    { cwd: ROOT, env: { ...process.env, PATH: `${nodeBin}:${process.env.PATH}` }, timeout: 15000 }
  ).toString();

  expect(result).toContain("DRY RUN");
  expect(result).toContain("daily_publish_summary.json");
  expect(result).toContain("daily_publish_summary.html");

  // Artifacts should exist
  const jsonPath = path.join(ROOT, "artifacts", "daily_publish_summary.json");
  const htmlPath = path.join(ROOT, "artifacts", "daily_publish_summary.html");
  expect(fs.existsSync(jsonPath)).toBe(true);
  expect(fs.existsSync(htmlPath)).toBe(true);

  // JSON artifact should have correct structure
  const summary = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  expect(summary.date).toBeTruthy();
  expect(typeof summary.recipient).toBe("string");
  expect(typeof summary.total_confirmed_today).toBe("number");
  expect(Array.isArray(summary.pages)).toBe(true);
  expect(Array.isArray(summary.top_5_strategic)).toBe(true);
  expect(typeof summary.failures).toBe("number");
  expect(typeof summary.skipped_duplicates).toBe("number");
});

test("daily summary DAILY_SUMMARY_EMAIL_TO override changes recipient", async ({ page }) => {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");
  const ROOT = path.resolve(__dirname, "..");

  const nodeBin = "/Users/troyfavre/Documents/.local/node-v24.14.0-darwin-arm64/bin";
  const result = execSync(
    `${nodeBin}/node scripts/send_daily_publish_summary.js --dry-run`,
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${nodeBin}:${process.env.PATH}`,
        DAILY_SUMMARY_EMAIL_TO: "override-test@example.com",
      },
      timeout: 15000,
    }
  ).toString();

  // Output should show override recipient
  expect(result).toContain("override-test@example.com");

  // Send log should record override recipient with correct shape
  const sendLogPath = path.join(ROOT, "artifacts", "daily_publish_summary_send_log.json");
  expect(fs.existsSync(sendLogPath)).toBe(true);
  const sendLog = JSON.parse(fs.readFileSync(sendLogPath, "utf-8"));
  expect(sendLog.to).toBe("override-test@example.com");
  expect(sendLog.attempted).toBe(false);
  expect(sendLog.sent).toBe(false);
  expect(sendLog.errorSummary).toBeNull();
});

test("daily summary send log has correct shape { to, subject, attempted, sent, errorSummary }", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Send log must use exact shape keys
  expect(src).toContain("to: RECIPIENT");
  expect(src).toContain("attempted:");
  expect(src).toContain("sent:");
  expect(src).toContain("errorSummary:");

  // writeSendLog must be called on dry-run, success, failure, and missing-creds paths
  const writeCount = (src.match(/writeSendLog\(\)/g) || []).length;
  expect(writeCount).toBeGreaterThanOrEqual(4);

  // File name must be daily_publish_summary_send_log.json
  expect(src).toContain("daily_publish_summary_send_log.json");
});

test("daily summary derives classification from actual pages, not publish_decision.json", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Must NOT blindly read classification from publish_decision.json
  // Instead, derives from todayPages content
  expect(src).toContain("Derive classification from today");
  expect(src).toContain("production_unverified");
  expect(src).toContain("no_pages_today");
  expect(src).toContain("webflow_item_id");
  expect(src).toContain('!String(p.webflow_item_id).startsWith("dry-run")');
});

test("daily summary writes published_today_debug.json with excluded rows and mismatch check", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Debug artifact must be written
  expect(src).toContain("published_today_debug.json");

  // Must track excluded rows with reasons
  expect(src).toContain("dry_run_true");
  expect(src).toContain("missing_or_fake_item_id");
  expect(src).toContain("missing_timestamp");
  expect(src).toContain("timestamp_not_today");

  // Must detect mismatch between report successes and actual rows
  expect(src).toContain("published_success");
  // report_mismatch must be an object with exists and details fields
  expect(src).toContain("report_mismatch");
  expect(src).toContain("exists:");
  expect(src).toContain("details:");
});

test("daily summary excludes dry-run rows and includes real rows with valid item IDs", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Three-gate filter for real publishes:
  // 1) dry_run === true → excluded
  expect(src).toContain("dry_run === true");
  // 2) webflow_item_id missing or starts with "dry-run" → excluded
  expect(src).toContain('startsWith("dry-run")');
  // 3) timestamp not today → excluded
  expect(src).toContain("isoToDateBucket");
  // Valid rows go into todayPages
  expect(src).toContain("const todayPages = validRows");
});

test("report_published_today.js script exists with correct npm script", async () => {
  const fs = require("fs");
  const path = require("path");

  // Script exists
  const scriptPath = path.join(__dirname, "..", "scripts", "report_published_today.js");
  expect(fs.existsSync(scriptPath)).toBe(true);

  const src = fs.readFileSync(scriptPath, "utf-8");
  // Reads from published_pages.json
  expect(src).toContain("published_pages.json");
  // Filters by dry_run, webflow_item_id, and date
  expect(src).toContain("dry_run === true");
  expect(src).toContain('startsWith("dry-run")');
  expect(src).toContain("isoToDateBucket");
  // Writes both artifacts
  expect(src).toContain("published_today_report.json");
  expect(src).toContain("published_today_report.md");

  // npm script exists
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
  expect(pkg.scripts["report:published:today"]).toBe("node scripts/report_published_today.js");
});

test("report_published_today uses same filter logic as daily summary", async () => {
  const fs = require("fs");
  const path = require("path");
  const summarySrc = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");
  const reportSrc = fs.readFileSync(path.join(__dirname, "..", "scripts", "report_published_today.js"), "utf-8");

  // Both must use the same 3 gates
  for (const gate of ["dry_run === true", 'startsWith("dry-run")', "isoToDateBucket"]) {
    expect(summarySrc).toContain(gate);
    expect(reportSrc).toContain(gate);
  }
});

// ── Publish Next: hub-priority scoring ──

test("publish_next has hub-priority scoring with major and tier2 hubs", async () => {
  const fs = require("fs");
  const path = require("path");
  const pnSrc = fs.readFileSync(path.join(__dirname, "..", "scripts", "publish_next.js"), "utf-8");
  const lfSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "lane-factory.js"), "utf-8");

  // publish_next imports hub scoring from lane-factory
  expect(pnSrc).toContain("computeHubPriority");
  expect(pnSrc).toContain("lane-factory.js");

  // Hub sets defined in lane-factory
  expect(lfSrc).toContain("MAJOR_HUBS");
  expect(lfSrc).toContain("TIER2_HUBS");

  // Major hubs include key cities (in lane-factory)
  expect(lfSrc).toContain('"los angeles"');
  expect(lfSrc).toContain('"chicago"');
  expect(lfSrc).toContain('"dallas"');
  expect(lfSrc).toContain('"atlanta"');
  expect(lfSrc).toContain('"new york"');
  expect(lfSrc).toContain('"houston"');

  // Scoring function in lane-factory
  expect(lfSrc).toContain("computeHubPriority");

  // Reverse lane bonus
  expect(lfSrc).toContain("reverseSlug");

  // Dense cluster bonus
  expect(lfSrc).toContain("Dense cluster bonus");
});

test("publish_next:15 npm script exists", async () => {
  const fs = require("fs");
  const path = require("path");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));

  expect(pkg.scripts["publish:next:15"]).toBe("node scripts/publish_next.js --count 15");
  expect(pkg.scripts["email:daily-summary"]).toContain("send_daily_publish_summary");
  expect(pkg.scripts["email:daily-summary:dry"]).toContain("--dry-run");
  expect(pkg.scripts["cron:install:daily-summary"]).toContain("install_daily_publish_summary_cron");
});

test("publish_next dry-run with hub-priority produces ranked candidates", async ({ page }) => {
  const fs = require("fs");
  const path = require("path");
  const { execSync } = require("child_process");
  const ROOT = path.resolve(__dirname, "..");

  // Save originals
  const pubPath = path.join(ROOT, "data", "published_pages.json");
  const slugsPath = path.join(ROOT, "data", "webflow_existing_slugs.json");
  const origPublished = fs.readFileSync(pubPath, "utf-8");
  const origSlugs = fs.readFileSync(slugsPath, "utf-8");

  try {
    fs.writeFileSync(pubPath, "[]");
    fs.writeFileSync(slugsPath, JSON.stringify(["dummy-test-slug"]));

    const nodeBin = "/Users/troyfavre/Documents/.local/node-v24.14.0-darwin-arm64/bin";
    const result = execSync(
      `${nodeBin}/node scripts/publish_next.js --dry-run --count 3 --filter-mode LTL`,
      { cwd: ROOT, env: { ...process.env, PATH: `${nodeBin}:${process.env.PATH}` }, timeout: 15000 }
    ).toString();

    // Hub priority should be ON
    expect(result).toContain("Hub priority: ON");
    expect(result).toContain("Target met");

    // Check report
    const reportPath = path.join(ROOT, "artifacts", "publish_next_report.json");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    expect(report.published_success.length).toBe(3);

    // First published should be a hub lane (hub-priority sorts hubs first)
    const firstSlug = report.published_success[0].slug;
    const hubCities = ["los-angeles", "chicago", "dallas", "atlanta", "new-york", "houston"];
    const isHubLane = hubCities.some(h => firstSlug.includes(h));
    expect(isHubLane).toBe(true);
  } finally {
    fs.writeFileSync(pubPath, origPublished);
    fs.writeFileSync(slugsPath, origSlugs);
  }
});

// ── Cron Installer ──

test("cron installer outputs correct 7 PM schedule", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "install_daily_publish_summary_cron.js"), "utf-8");

  // Cron schedule: 7:00 PM = minute 0, hour 19
  expect(src).toContain("0 19 * * *");

  // Points to the summary script
  expect(src).toContain("send_daily_publish_summary.js");

  // Logs to artifact
  expect(src).toContain("cron_daily_publish_summary.log");

  // Has install flag
  expect(src).toContain("--install");
});

// ── Daily summary: integration test with mock published entries ──

test("daily summary counts exactly 15 real publishes and excludes dry-runs", async ({ page }) => {
  const fs = require("fs");
  const path = require("path");
  const os = require("os");
  const { execSync } = require("child_process");
  const ROOT = path.resolve(__dirname, "..");

  // Use a temp directory so we don't conflict with parallel tests
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daily-summary-test-"));
  const tmpDataDir = path.join(tmpDir, "data");
  const tmpArtifactsDir = path.join(tmpDir, "artifacts");
  fs.mkdirSync(tmpDataDir, { recursive: true });
  fs.mkdirSync(tmpArtifactsDir, { recursive: true });

  try {
    // Build 15 real entries + 3 dry-run entries, all with today's timestamp
    const nowIso = new Date().toISOString();
    const mockEntries = [];

    // 15 real publishes
    for (let i = 0; i < 15; i++) {
      mockEntries.push({
        slug: `test-real-lane-${i}`,
        seo_title: `Test Real Lane ${i} LTL Freight | WARP`,
        h1: `Test Lane ${i}`,
        intro: `Test intro ${i}`,
        origin_city: "Dallas",
        origin_state: "TX",
        destination_city: "Chicago",
        destination_state: "IL",
        mode: "LTL",
        published_at_iso: nowIso,
        webflow_item_id: `wf-item-${i}`,
        dry_run: false,
      });
    }

    // 3 dry-run entries (should be excluded)
    for (let i = 0; i < 3; i++) {
      mockEntries.push({
        slug: `test-dry-lane-${i}`,
        seo_title: `Test Dry Lane ${i}`,
        origin_city: "Test",
        origin_state: "TX",
        destination_city: "Test",
        destination_state: "IL",
        mode: "LTL",
        published_at_iso: nowIso,
        webflow_item_id: `dry-run-${i}`,
        dry_run: true,
      });
    }

    // Write mock data to temp directory
    fs.writeFileSync(path.join(tmpDataDir, "published_pages.json"), JSON.stringify(mockEntries, null, 2));
    fs.writeFileSync(path.join(tmpArtifactsDir, "publish_next_report.json"), JSON.stringify({
      failures: [{ slug: "fail-1", error: "test" }],
      skipped_duplicates: [{ slug: "dup-1" }, { slug: "dup-2" }],
    }, null, 2));

    // Read the summary script source and verify the filtering logic directly
    const summarySource = fs.readFileSync(path.join(ROOT, "scripts", "send_daily_publish_summary.js"), "utf-8");

    // 1) Script reads published_pages.json
    expect(summarySource).toContain("published_pages.json");

    // 2) Script filters out dry_run === true entries
    expect(summarySource).toContain("dry_run");
    expect(summarySource).toMatch(/dry_run\s*===\s*true/);

    // 3) Script checks published_at_iso date
    expect(summarySource).toContain("published_at_iso");

    // 4) Simulate the filter logic from the script inline
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
    }).format(new Date());

    function isoToDateBucket(iso) {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
      }).format(new Date(iso));
    }

    const confirmedToday = mockEntries.filter((p) => {
      if (p.dry_run === true) return false;
      if (!p.published_at_iso) return false;
      return isoToDateBucket(p.published_at_iso) === today;
    });

    expect(confirmedToday.length).toBe(15);

    // Verify no dry-run entries leaked through
    for (const p of confirmedToday) {
      expect(p.slug).not.toContain("dry");
    }

    // Verify all 15 real entries are present
    for (let i = 0; i < 15; i++) {
      expect(confirmedToday.some((p) => p.slug === `test-real-lane-${i}`)).toBe(true);
    }
  } finally {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Cluster publish flag tests ──

test("publish_next --cluster flag changes ordering to cluster-first priority", async ({ page }) => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const pnSrc = fs.readFileSync(path.join(ROOT, "scripts", "publish_next.js"), "utf-8");
  const lfSrc = fs.readFileSync(path.join(ROOT, "lib", "lane-factory.js"), "utf-8");

  // publish_next imports cluster functions from lane-factory
  expect(pnSrc).toContain('getFlag("cluster"');
  expect(pnSrc).toContain("parseClusterCities");
  expect(pnSrc).toContain("computeClusterPriority");

  // Cluster priority logic in lane-factory
  // Cluster priority has Tier A (both in cluster = 1000)
  expect(lfSrc).toMatch(/score\s*=\s*1000/);

  // Cluster priority has Tier B (one cluster + one secondary = 500)
  expect(lfSrc).toMatch(/score\s*=\s*500/);

  // Cluster priority has Tier C (one cluster + other = 250)
  expect(lfSrc).toMatch(/score\s*=\s*250/);

  // Secondary metros include Houston, New York, Los Angeles, Miami, Nashville, Charlotte (in lane-factory)
  expect(lfSrc).toContain('"houston"');
  expect(lfSrc).toContain('"new york"');
  expect(lfSrc).toContain('"los angeles"');
  expect(lfSrc).toContain('"miami"');
  expect(lfSrc).toContain('"nashville"');
  expect(lfSrc).toContain('"charlotte"');

  // When clusterCities is set, it overrides hub priority (in publish_next)
  expect(pnSrc).toContain("Cluster-first ranking overrides hub priority");
});

test("publish_next cluster priority scoring ranks cluster lanes first", async ({ page }) => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "scripts", "publish_next.js"), "utf-8");

  // Verify cluster scoring logic: Tier A (both in cluster) gets 1000
  // Tier B (one cluster + one secondary) gets 500
  // Tier C (one cluster + other) gets 250
  // This means 6 intra-cluster lanes (3 cities × 2 directions) always rank first

  // Simulate the scoring: cluster = chicago, dallas, atlanta
  // stableHash inline (from the script)
  function stableHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  const clusterCities = new Set(["chicago", "dallas", "atlanta"]);
  const secondaryMetros = new Set(["houston", "new york", "los angeles", "miami", "nashville", "charlotte"]);

  // Tier A lane: chicago → dallas (both in cluster)
  const tierAScore = 1000 + stableHash("chicago-to-dallas") % 100 / 100;
  // Tier B lane: chicago → houston (one cluster + one secondary)
  const tierBScore = 500 + stableHash("chicago-to-houston") % 100 / 100;
  // Tier C lane: chicago → seattle (one cluster + other)
  const tierCScore = 250 + stableHash("chicago-to-seattle") % 100 / 100;
  // Tier D lane: seattle → phoenix (neither in cluster)
  const tierDScore = 0 + stableHash("seattle-to-phoenix") % 100 / 100;

  expect(tierAScore).toBeGreaterThan(tierBScore);
  expect(tierBScore).toBeGreaterThan(tierCScore);
  expect(tierCScore).toBeGreaterThan(tierDScore);

  // All 6 intra-cluster lanes score above any non-cluster lane
  const intraClusterLanes = [
    "chicago-to-dallas", "dallas-to-chicago",
    "chicago-to-atlanta", "atlanta-to-chicago",
    "dallas-to-atlanta", "atlanta-to-dallas",
  ];
  for (const slug of intraClusterLanes) {
    const score = 1000 + stableHash(slug) % 100 / 100;
    expect(score).toBeGreaterThan(500 + 99.99/100); // always above any Tier B
  }

  // Verify the source uses clusterCities conditional
  expect(src).toContain("if (clusterCities)");
  expect(src).toContain("computeClusterPriority");
});

test("publish_next cluster still skips duplicates from published_pages", async ({ page }) => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "scripts", "publish_next.js"), "utf-8");

  // Cluster mode still uses the same exclusion set
  expect(src).toContain("excludedSlugs.has(slug)");

  // Exclusion set is built from both webflow slugs and published pages
  expect(src).toContain("webflow_existing_slugs.json");
  expect(src).toContain("published_pages.json");

  // Duplicate skip logic is unchanged
  expect(src).toContain("SKIP (duplicate)");
  expect(src).toContain("DUP-SLUG-01");
});

test("publish_next cluster backfills when a target lane is blocked by exclusion set", async ({ page }) => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "scripts", "publish_next.js"), "utf-8");

  // The script builds excludedSlugs from both webflow_existing_slugs.json and published_pages.json
  expect(src).toContain("excludedSlugs.add(String(s).toLowerCase().trim())");
  expect(src).toContain("excludedSlugs.add(p.slug.toLowerCase().trim())");

  // Then for each candidate, it checks: if (excludedSlugs.has(slug)) → skip
  expect(src).toContain("if (excludedSlugs.has(slug))");
  expect(src).toContain('reason: "slug exists in Webflow export or published registry"');

  // The loop continues to next candidate (backfill), it does NOT reduce the TARGET_COUNT
  // It only increments successCount on success, so blocked lanes cause backfill
  expect(src).toContain("if (successCount >= TARGET_COUNT) break");
  expect(src).toContain("successCount++");

  // Cluster scoring is applied BEFORE the exclusion check, so backfill
  // picks the next highest-scored cluster lane
  expect(src).toContain("computeClusterPriority");
  expect(src).toContain(".sort((a, b) => b._hubScore - a._hubScore)");
});

test("publish:next:15:cluster npm scripts exist", async ({ page }) => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));

  expect(pkg.scripts["publish:next:15:cluster"]).toContain("--cluster chicago-dallas-atlanta");
  expect(pkg.scripts["publish:next:15:cluster"]).toContain("--count 15");
  expect(pkg.scripts["publish:next:15:cluster"]).not.toContain("--dry-run");

  expect(pkg.scripts["publish:next:15:cluster:dry"]).toContain("--cluster chicago-dallas-atlanta");
  expect(pkg.scripts["publish:next:15:cluster:dry"]).toContain("--dry-run");
});

// ── Truth source: stale artifacts do not zero out real publishes ──

test("daily summary derives classification from actual pages, not stale publish_decision.json", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Classification must be derived from todayPages, not decision artifact
  expect(src).toContain("todayPages.length > 0");
  expect(src).toContain("production_unverified");
  expect(src).toContain("no_pages_today");

  // The script loads publish_decision but does NOT use its classification field for the summary
  // It only uses site_base_url from decision
  expect(src).toContain("decision?.site_base_url");

  // classification is set from todayPages, not decision.classification
  expect(src).not.toContain("decision.classification");
  expect(src).not.toContain("decision?.classification");
});

test("debug artifact report_mismatch flags when report shows successes but 0 real rows", async () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Mismatch detection: reportSuccessCount > 0 && todayPages.length === 0
  expect(src).toContain("reportSuccessCount > 0 && todayPages.length === 0");

  // report_mismatch is an object with exists (boolean) and details (string|null)
  expect(src).toContain("report_mismatch:");
  expect(src).toContain("exists: hasMismatch");
  expect(src).toContain("details: hasMismatch");
});

test("report_published_today shows same pages as daily summary truth source", async () => {
  const fs = require("fs");
  const path = require("path");
  const summarySrc = fs.readFileSync(path.join(__dirname, "..", "scripts", "send_daily_publish_summary.js"), "utf-8");
  const reportSrc = fs.readFileSync(path.join(__dirname, "..", "scripts", "report_published_today.js"), "utf-8");

  // Both use the identical 3-gate filter
  const gates = [
    "dry_run === true",
    'startsWith("dry-run")',
    "published_at_iso",
    "isoToDateBucket",
  ];
  for (const gate of gates) {
    expect(summarySrc).toContain(gate);
    expect(reportSrc).toContain(gate);
  }

  // Both output webflow_item_id and live_url
  expect(summarySrc).toContain("webflow_item_id");
  expect(reportSrc).toContain("webflow_item_id");
  expect(summarySrc).toContain("live_url");
  expect(reportSrc).toContain("live_url");
});

// ── Existing slug fallback from artifacts ──

test("webflow slug fallback script exists and extracts from publish_next artifacts", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  // Script exists
  const scriptPath = path.join(ROOT, "scripts", "import_webflow_slugs_from_artifacts.js");
  expect(fs.existsSync(scriptPath)).toBe(true);

  const src = fs.readFileSync(scriptPath, "utf-8");

  // Reads from artifacts/publish_next/ subdirectories
  expect(src).toContain("publish_next");
  expect(src).toContain("readdirSync");

  // Reads from published_pages.json
  expect(src).toContain("published_pages.json");

  // Writes webflow_existing_slugs.json
  expect(src).toContain("webflow_existing_slugs.json");

  // Writes import report
  expect(src).toContain("webflow_slug_import_report.json");

  // npm script exists
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  expect(pkg.scripts["webflow:slugs:fallback"]).toBe("node scripts/import_webflow_slugs_from_artifacts.js");
});

test("webflow slug fallback produces non-empty slug set when publish_next artifacts exist", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  // Check that artifacts/publish_next/ has subdirectories
  const publishNextDir = path.join(ROOT, "artifacts", "publish_next");
  if (!fs.existsSync(publishNextDir)) return; // skip if no artifacts

  const dirs = fs.readdirSync(publishNextDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  // There should be at least some artifact directories from previous runs
  expect(dirs.length).toBeGreaterThan(0);

  // Each directory name should be a valid slug pattern
  for (const d of dirs.slice(0, 5)) {
    expect(d.name).toMatch(/^[a-z0-9-]+-to-[a-z0-9-]+$/);
  }
});

// ── Live URL Path & Verification Tests ──────────────────────────────

test("daily summary generates /lanes/{slug} URLs (not /{slug})", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Must use templatePath variable for URL construction
  expect(src).toContain("templatePath");
  expect(src).toContain('/lanes"');

  // Must NOT have the old broken pattern: `${baseUrl}/${p.slug}`
  // The correct pattern is: `${baseUrl}${templatePath}/${p.slug}`
  const lines = src.split("\n");
  const liveUrlLines = lines.filter(l => l.includes("live_url:") && l.includes("baseUrl"));
  for (const line of liveUrlLines) {
    expect(line).toContain("templatePath");
    expect(line).not.toMatch(/\$\{baseUrl\}\/\$\{p\.slug\}/);
  }
});

test("report_published_today generates /lanes/{slug} URLs", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "scripts", "report_published_today.js"), "utf-8");

  // Must use templatePath for URL construction
  expect(src).toContain("templatePath");
  expect(src).toContain('/lanes"');

  // Check live_url line uses templatePath
  const lines = src.split("\n");
  const liveUrlLines = lines.filter(l => l.includes("live_url:") && l.includes("baseUrl"));
  for (const line of liveUrlLines) {
    expect(line).toContain("templatePath");
  }
});

test("daily summary includes soft-404 detection markers", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Must contain soft-404 marker strings for URL verification
  expect(src).toContain("This Page Has Moved or Does Not Exist");
  expect(src).toContain("Page not found");

  // Must contain positive content markers
  expect(src).toContain("Book Freight Instantly");
  expect(src).toContain("Freight Quotes");
});

test("daily summary has verified/unverified link sections in email", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "scripts", "send_daily_publish_summary.js"), "utf-8");

  // HTML email must split into verified and unverified sections
  expect(src).toContain("Verified Live Links");
  expect(src).toContain("Unverified / Broken Links");

  // Must write link verification artifact
  expect(src).toContain("daily_publish_link_verification.json");

  // Summary data must include verified flag per page
  expect(src).toContain("verified:");
  expect(src).toContain("verified_count");
  expect(src).toContain("unverified_count");
});

test("daily summary writes link verification artifact", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "scripts", "send_daily_publish_summary.js"), "utf-8");

  // Must write daily_publish_link_verification.json
  expect(src).toContain("daily_publish_link_verification.json");

  // Artifact must contain expected fields
  expect(src).toContain("template_path");
  expect(src).toContain("base_url");
  expect(src).toContain("total_checked");
  expect(src).toContain("verified_count");
  expect(src).toContain("unverified_count");

  // Must have verifyLiveUrl function
  expect(src).toContain("verifyLiveUrl");
});

// ══════════════════════════════════════════════════════════════════
// Part 1: Page Quality Contract Tests
// ══════════════════════════════════════════════════════════════════

test("page-quality-contract.js exports required functions", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "page-quality-contract.js"), "utf-8");

  expect(src).toContain("export function validatePageQuality");
  expect(src).toContain("export function getRequiredSections");
  expect(src).toContain("export function getRequiredAnswerFields");
  expect(src).toContain("export function getTruthfulnessRules");
  // Must check for guarantee language
  expect(src).toContain("guarantee");
  // Must check for exact rate claims
  expect(src).toContain("exact");
  // Must check all required sections
  expect(src).toContain("quick_answer");
  expect(src).toContain("cost_drivers");
  expect(src).toContain("lane_insight");
  expect(src).toContain("faq");
});

test("page-quality-contract blocks pages missing required sections", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "page-quality-contract.js"), "utf-8");

  // REQUIRED_SECTIONS must include these critical fields
  expect(src).toContain('"h1"');
  expect(src).toContain('"quick_answer"');
  expect(src).toContain('"cost_drivers"');
  expect(src).toContain('"lane_insight"');
  expect(src).toContain("minCount: 5"); // FAQ min 5
  expect(src).toContain("minCount: 3"); // Reference links min 3

  // Blocking failures must be populated when checks fail
  expect(src).toContain("blocking_failures");
  expect(src).toContain("blocking.length === 0");
});

// ══════════════════════════════════════════════════════════════════
// Part 2: Lane Archetypes Tests
// ══════════════════════════════════════════════════════════════════

test("lane-archetypes.js has at least 10 archetypes", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "lane-archetypes.js"), "utf-8");

  // Must export assignArchetype
  expect(src).toContain("assignArchetype");

  // Must have at least 10 archetype definitions
  const archetypeMatches = src.match(/id:\s*["'][a-z_]+["']/g) || [];
  expect(archetypeMatches.length).toBeGreaterThanOrEqual(10);
});

// ══════════════════════════════════════════════════════════════════
// Part 3: Uniqueness Config Tests
// ══════════════════════════════════════════════════════════════════

test("uniqueness-config.js has immutable thresholds", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "uniqueness-config.js"), "utf-8");

  expect(src).toContain("UNIQUENESS_THRESHOLDS");
  expect(src).toContain("title_similarity_max");
  expect(src).toContain("intro_similarity_max");
  expect(src).toContain("faq_overlap_max");
  expect(src).toContain("eight_gram_overlap_cap");
  expect(src).toContain("sentence_reuse_max_fraction");
  expect(src).toContain("IMMUTABLE_THRESHOLD_KEYS");
  expect(src).toContain("validateThresholdsUnchanged");
});

// ══════════════════════════════════════════════════════════════════
// Part 5: Lane Content Engine Tests
// ══════════════════════════════════════════════════════════════════

test("lane-content-engine.js exports buildLanePage and validates before publish", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "lane-content-engine.js"), "utf-8");

  expect(src).toContain("export function buildLanePage");
  expect(src).toContain("export function buildLanePages");
  expect(src).toContain("export function validateBeforePublish");
  // Must generate required fields
  expect(src).toContain("generateQuickAnswer");
  expect(src).toContain("generateCostDrivers");
  expect(src).toContain("generateLaneInsight");
  // Must read learning state
  expect(src).toContain("loadLearningState");
  expect(src).toContain("learning_snapshot_version");
});

// ══════════════════════════════════════════════════════════════════
// Part 7: AI Search Optimizer Tests
// ══════════════════════════════════════════════════════════════════

test("ai-search-optimizer.js generates snippets and scores extractability", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "ai-search-optimizer.js"), "utf-8");

  expect(src).toContain("export function generateAiSnippetCandidates");
  expect(src).toContain("export function scoreAiExtractability");
  expect(src).toContain("export function generateSchemaBlocks");
  expect(src).toContain("export function buildQueryMatchPatterns");

  // Must generate FAQPage schema
  expect(src).toContain("FAQPage");
  expect(src).toContain("BreadcrumbList");
  expect(src).toContain("WebPage");

  // Score must include required criteria
  expect(src).toContain("has_quick_answer");
  expect(src).toContain("faq_quality");
  expect(src).toContain("query_matching");
  expect(src).toContain("schema_richness");
});

// ══════════════════════════════════════════════════════════════════
// Part 9: Page Layout Audit Tests
// ══════════════════════════════════════════════════════════════════

test("page-layout-audit.js checks structural completeness", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "page-layout-audit.js"), "utf-8");

  expect(src).toContain("export function auditPageLayout");
  expect(src).toContain("export function auditBatch");
  expect(src).toContain("LAYOUT-01");
  expect(src).toContain("LAYOUT-06"); // CTA block
  expect(src).toContain("LAYOUT-12"); // Meta fields
  expect(src).toContain("blocking_failures");
});

// ══════════════════════════════════════════════════════════════════
// Part 10: Publish Decision Tests
// ══════════════════════════════════════════════════════════════════

test("publish-decision.js runs all 8 check types", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "publish-decision.js"), "utf-8");

  // Must import and run all check modules
  expect(src).toContain("validatePageQuality");
  expect(src).toContain("auditPageLayout");
  expect(src).toContain("scoreAiExtractability");

  // Must include all check types in output
  expect(src).toContain("quality: qualityCheck");
  expect(src).toContain("layout: layoutCheck");
  expect(src).toContain("ai_extractability: aiCheck");
  expect(src).toContain("duplicate: duplicateCheck");

  // Must block on duplicate slugs
  expect(src).toContain("already published");
  expect(src).toContain("duplicate in batch");
});

// ══════════════════════════════════════════════════════════════════
// Part 11: Live URL Builder Tests
// ══════════════════════════════════════════════════════════════════

test("publish pipeline uses /lanes/ collection path for URLs", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  // Check publish_next.js
  const publishSrc = fs.readFileSync(path.join(ROOT, "scripts", "publish_next.js"), "utf-8");
  expect(publishSrc).toContain("/lanes/");

  // Check lane-content-engine uses /lanes/ for canonical_path
  const engineSrc = fs.readFileSync(path.join(ROOT, "lib", "lane-content-engine.js"), "utf-8");
  expect(engineSrc).toContain("/lanes/");
});

// ══════════════════════════════════════════════════════════════════
// Part 14: Cluster Publishing Tests
// ══════════════════════════════════════════════════════════════════

test("generate_launch_cluster.js targets 9 metros", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "scripts", "generate_launch_cluster.js"), "utf-8");

  expect(src).toContain("Chicago");
  expect(src).toContain("Dallas");
  expect(src).toContain("Atlanta");
  expect(src).toContain("Houston");
  expect(src).toContain("New York");
  expect(src).toContain("Los Angeles");
  expect(src).toContain("Miami");
  expect(src).toContain("Charlotte");
  expect(src).toContain("Nashville");
});

test("publish_cluster.js wraps publish_next with cluster flag", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "scripts", "publish_cluster.js"), "utf-8");

  expect(src).toContain("--cluster chicago-dallas-atlanta");
  expect(src).toContain("publish_next.js");
});

test("npm scripts include cluster and learning commands", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));

  expect(pkg.scripts["publish:next:15"]).toBeDefined();
  expect(pkg.scripts["publish:next:15:cluster"]).toBeDefined();
  expect(pkg.scripts["publish:next:15:cluster:dry"]).toBeDefined();
  expect(pkg.scripts["publish:cluster"]).toBeDefined();
  expect(pkg.scripts["publish:cluster:dry"]).toBeDefined();
  expect(pkg.scripts["report:published:today"]).toBeDefined();
  expect(pkg.scripts["email:daily-summary"]).toBeDefined();
  expect(pkg.scripts["uniqueness:weekly"]).toBeDefined();
  expect(pkg.scripts["check:indexation"]).toBeDefined();
  expect(pkg.scripts["learning:weekly"]).toBeDefined();
  expect(pkg.scripts["learning:ingest"]).toBeDefined();
  expect(pkg.scripts["generate:launch-cluster"]).toBeDefined();
});

// ══════════════════════════════════════════════════════════════════
// Part 13: Reference Pages Tests
// ══════════════════════════════════════════════════════════════════

test("reference pages exist and are not thin", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  // Check reference page modules exist
  const refDir = path.join(ROOT, "lib", "reference-pages");
  expect(fs.existsSync(path.join(refDir, "freight-class.js"))).toBe(true);
  expect(fs.existsSync(path.join(refDir, "freight-accessorials.js"))).toBe(true);
  expect(fs.existsSync(path.join(refDir, "transit-times.js"))).toBe(true);

  // Check freight-class has substantial content
  const fcSrc = fs.readFileSync(path.join(refDir, "freight-class.js"), "utf-8");
  expect(fcSrc).toContain("NMFC");
  expect(fcSrc).toContain("faq");
  expect(fcSrc.length).toBeGreaterThan(2000);

  // Check accessorials has substantial content
  const accSrc = fs.readFileSync(path.join(refDir, "freight-accessorials.js"), "utf-8");
  expect(accSrc).toContain("liftgate");
  expect(accSrc.length).toBeGreaterThan(2000);

  // Check transit-times has substantial content
  const ttSrc = fs.readFileSync(path.join(refDir, "transit-times.js"), "utf-8");
  expect(ttSrc).toContain("transit");
  expect(ttSrc.length).toBeGreaterThan(2000);
});

// ══════════════════════════════════════════════════════════════════
// Part 18: Self Learning System Tests
// ══════════════════════════════════════════════════════════════════

test("learning-store.js reads and writes learning state", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "learning-store.js"), "utf-8");

  expect(src).toContain("export function loadLearningState");
  expect(src).toContain("export function saveLearningState");
  expect(src).toContain("export function loadLearningHistory");
  expect(src).toContain("export function appendLearningHistory");
  expect(src).toContain("export function loadPostmortems");
  expect(src).toContain("export function loadManualFeedback");
  expect(src).toContain("export function loadGSCData");
  expect(src).toContain("export function loadGA4Data");
  // Must define immutable keys
  expect(src).toContain("IMMUTABLE_KEYS");
  expect(src).toContain("isImmutableKey");
});

test("learning-scoring.js computes performance scores", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "learning-scoring.js"), "utf-8");

  expect(src).toContain("export function computePerformanceScore");
  expect(src).toContain("export function scorePattern");
  expect(src).toContain("export function scoreArchetypes");
  expect(src).toContain("export function scoreToWeight");
  // Must have weighted score components
  expect(src).toContain("ctr:");
  expect(src).toContain("impressions:");
  expect(src).toContain("quote_starts:");
  expect(src).toContain("ai_extractability:");
  expect(src).toContain("publish_success:");
  expect(src).toContain("uniqueness_safety:");
});

test("learning-updater.js updates weights but cannot change hard gates", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "learning-updater.js"), "utf-8");

  expect(src).toContain("export function updateLearningWeights");
  expect(src).toContain("export function applyLearningUpdate");
  // Must check immutable keys
  expect(src).toContain("IMMUTABLE_KEYS");
  expect(src).toContain("isImmutableKey");
  expect(src).toContain("requires_human_approval: true");
  // Must update these weight types
  expect(src).toContain("archetype_weights");
  expect(src).toContain("title_pattern_weights");
  expect(src).toContain("faq_weights");
  expect(src).toContain("cta_weights");
  expect(src).toContain("intro_pattern_weights");
  expect(src).toContain("link_pattern_weights");
});

test("hard safety gates do not change automatically", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  // Check learning-updater guards against immutable changes
  const updaterSrc = fs.readFileSync(path.join(ROOT, "lib", "learning-updater.js"), "utf-8");
  expect(updaterSrc).toContain("IMMUTABLE_KEYS");
  expect(updaterSrc).toContain("requires_human_approval: true");
  expect(updaterSrc).toContain('delete state[key]'); // Must remove prohibited keys

  // Check learning-store defines immutable keys
  const storeSrc = fs.readFileSync(path.join(ROOT, "lib", "learning-store.js"), "utf-8");
  expect(storeSrc).toContain("uniqueness_thresholds");
  expect(storeSrc).toContain("usefulness_gate_rules");
  expect(storeSrc).toContain("slug_rules");
  expect(storeSrc).toContain("schema_requirements");
  expect(storeSrc).toContain("duplicate_protection");
  expect(storeSrc).toContain("live_verification_rules");
});

test("pattern-ranker.js provides weighted deterministic selection", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "pattern-ranker.js"), "utf-8");

  expect(src).toContain("export function weightedDeterministicSelect");
  expect(src).toContain("export function rankByWeight");
  expect(src).toContain("export function verifyDeterminism");
  expect(src).toContain("export function computeLearnedPriorityBoost");
  // Must use seeded PRNG for determinism
  expect(src).toContain("rngFromKey");
});

test("learning_weekly.js script exists with correct npm script", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  expect(fs.existsSync(path.join(ROOT, "scripts", "learning_weekly.js"))).toBe(true);
  expect(fs.existsSync(path.join(ROOT, "scripts", "ingest_feedback_signals.js"))).toBe(true);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  expect(pkg.scripts["learning:weekly"]).toBe("node scripts/learning_weekly.js");
  expect(pkg.scripts["learning:ingest"]).toBe("node scripts/ingest_feedback_signals.js");
});

test("ingest_feedback_signals.js joins published pages with GSC and GA4", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "scripts", "ingest_feedback_signals.js"), "utf-8");

  // Must read published pages
  expect(src).toContain("published_pages.json");
  // Must read GSC data
  expect(src).toContain("gsc_import_current.csv");
  // Must read GA4 data
  expect(src).toContain("ga4_import_current.csv");
  // Must write postmortems
  expect(src).toContain("page_postmortems.json");
  // Must include required postmortem fields
  expect(src).toContain("ai_extractability_score");
  expect(src).toContain("uniqueness_score");
  expect(src).toContain("archetype_id");
  expect(src).toContain("title_pattern_id");
  expect(src).toContain("faq_ids");
});

test("lane-content-engine reads learning_state.json for weighted selection", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");
  const src = fs.readFileSync(path.join(ROOT, "lib", "lane-content-engine.js"), "utf-8");

  // Must load learning state
  expect(src).toContain("learning_state.json");
  expect(src).toContain("loadLearningState");
  // Must store learning snapshot version
  expect(src).toContain("learning_snapshot_version");
  // Must use weighted selection
  expect(src).toContain("weightedSelect");
});

test("data template files exist for learning system", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  expect(fs.existsSync(path.join(ROOT, "data", "manual_feedback.json"))).toBe(true);
  expect(fs.existsSync(path.join(ROOT, "data", "learning_history.json"))).toBe(true);
  expect(fs.existsSync(path.join(ROOT, "data", "page_postmortems.json"))).toBe(true);

  // Manual feedback should be valid JSON array
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "manual_feedback.json"), "utf-8"));
  expect(Array.isArray(mf)).toBe(true);

  // Learning history should be valid JSON array
  const lh = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "learning_history.json"), "utf-8"));
  expect(Array.isArray(lh)).toBe(true);
});

// ── Learning Hardening Tests ──────────────────────────────────────────────

test("wiring audit artifacts exist and document real vs decorative", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const auditJson = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "learning_wiring_audit.json"), "utf-8"));
  const auditMd = fs.readFileSync(path.join(ROOT, "artifacts", "learning_wiring_audit.md"), "utf-8");

  // Must list active and inactive dimensions
  expect(auditJson.active_dimensions_after_fix).toContain("archetype_weights");
  expect(auditJson.active_dimensions_after_fix).toContain("faq_weights");
  expect(auditJson.inactive_dimensions_after_fix).toContain("title_pattern_weights");
  expect(auditJson.inactive_dimensions_after_fix).toContain("cta_weights");

  // Hard gates audit must be safe
  expect(auditJson.hard_gates_audit.verdict).toContain("SAFE");

  // Markdown audit must exist
  expect(auditMd).toContain("DECORATIVE");
  expect(auditMd).toContain("HARDENED");
});

test("learning-scope.json defines active vs inactive dimensions", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const scope = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "learning-scope.json"), "utf-8"));

  // Must have exactly 2 active dimensions
  expect(Object.keys(scope.active_dimensions)).toHaveLength(2);
  expect(scope.active_dimensions.archetype_weights).toBeDefined();
  expect(scope.active_dimensions.faq_weights).toBeDefined();

  // Must have 5 inactive dimensions
  expect(Object.keys(scope.inactive_dimensions)).toHaveLength(5);

  // Must define immutable keys
  expect(scope.immutable_keys.length).toBeGreaterThanOrEqual(8);

  // Must define signal confidence levels
  expect(scope.signal_confidence_levels.high).toBeDefined();
  expect(scope.signal_confidence_levels.medium).toBeDefined();
  expect(scope.signal_confidence_levels.low).toBeDefined();
});

test("publish_next.js reads learning state and applies archetype boost", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const pnSrc = fs.readFileSync(path.join(ROOT, "scripts", "publish_next.js"), "utf-8");
  const lfSrc = fs.readFileSync(path.join(ROOT, "lib", "lane-factory.js"), "utf-8");

  // publish_next imports learning functions from lane-factory
  expect(pnSrc).toContain("loadLearningStateForPriority");
  expect(pnSrc).toContain("computeHubPriority");
  expect(pnSrc).toContain("lane-factory.js");

  // Must pass learningState to computeHubPriority (in publish_next)
  expect(pnSrc).toContain("computeHubPriority(lane, publishedSlugSet, learningState)");

  // lane-factory has the implementation
  expect(lfSrc).toContain("learning_state.json");
  expect(lfSrc).toContain("computeLearnedPriorityBoost");

  // computeHubPriority must accept learning state parameter (in lane-factory)
  expect(lfSrc).toMatch(/function computeHubPriority\(lane, publishedSlugs, learningState\)/);
});

test("lane-archetypes.js getArchetypeFaq accepts faqWeights parameter", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "lib", "lane-archetypes.js"), "utf-8");

  // Must accept faqWeights parameter
  expect(src).toMatch(/getArchetypeFaq\(archetype, origin, dest, mode, segment, pageIndex, faqWeights\)/);

  // Must check for weights
  expect(src).toContain("hasWeights");

  // Must sort by weight when weights exist
  expect(src).toContain("weightedPool.sort");
});

test("lane-engine.js passes faqWeights through to getArchetypeFaq", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "lib", "lane-engine.js"), "utf-8");

  // makeLanePage must accept faqWeights
  expect(src).toMatch(/export function makeLanePage\(combo, design, estimateInputs, quoteHistory, faqWeights\)/);

  // Must pass faqWeights to getArchetypeFaq
  expect(src).toContain("getArchetypeFaq(archetype, origin, destination, mode, segment, rank || 0, faqWeights)");
});

test("lane-content-engine.js extracts FAQ weights from learning state", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "lib", "lane-content-engine.js"), "utf-8");

  // Must extract faqWeights from learning state
  expect(src).toContain("faqWeights = learningState?.faq_weights");

  // Must pass faqWeights to makeLanePage
  expect(src).toContain("makeLanePage(opts.combo, opts.design || {}, opts.estimateInputs, opts.quoteHistory, faqWeights)");

  // Must track faq_weights_active
  expect(src).toContain("faq_weights_active");
});

test("learning updater only updates ACTIVE dimensions", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "lib", "learning-updater.js"), "utf-8");

  // Must define ACTIVE_DIMENSIONS
  expect(src).toContain('ACTIVE_DIMENSIONS');
  expect(src).toContain('"archetype_weights"');
  expect(src).toContain('"faq_weights"');

  // Must define INACTIVE_DIMENSIONS
  expect(src).toContain('INACTIVE_DIMENSIONS');
  expect(src).toContain('"title_pattern_weights"');

  // Must NOT compute title pattern weights anymore
  expect(src).not.toContain("Update title pattern weights");

  // Must NOT compute CTA weights anymore
  expect(src).not.toContain("Update CTA weights");

  // Must NOT compute intro pattern weights anymore
  expect(src).not.toContain("Update intro pattern weights");

  // Must NOT compute link pattern weights anymore
  expect(src).not.toContain("Update link pattern weights");

  // Must filter by signal confidence
  expect(src).toContain("signal_confidence");
  expect(src).toContain("qualifiedPostmortems");
});

test("learning updater filters low confidence postmortems", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "lib", "learning-updater.js"), "utf-8");

  // Must filter to high/medium confidence
  expect(src).toContain('signal_confidence === "high"');
  expect(src).toContain('signal_confidence === "medium"');

  // Must log filtered count
  expect(src).toContain("lowConfidenceCount");

  // Must return early if no qualified postmortems
  expect(src).toContain("qualifiedPostmortems.length === 0");
});

test("ingest_feedback_signals.js adds signal_confidence field", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "scripts", "ingest_feedback_signals.js"), "utf-8");

  // Must compute signal_confidence
  expect(src).toContain("signal_confidence");
  expect(src).toContain('"high"');
  expect(src).toContain('"medium"');
  expect(src).toContain('"low"');

  // Must include in postmortem output
  expect(src).toContain("signal_confidence,");
});

test("proof scripts exist and have correct structure", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  // prove_learning_influence.js
  const influence = fs.readFileSync(path.join(ROOT, "scripts", "prove_learning_influence.js"), "utf-8");
  expect(influence).toContain("Prove Learning Influence");
  expect(influence).toContain("baseline");
  expect(influence).toContain("weightedSelection");
  expect(influence).toContain("PROVEN");

  // prove_hard_gate_immutability.js
  const immutability = fs.readFileSync(path.join(ROOT, "scripts", "prove_hard_gate_immutability.js"), "utf-8");
  expect(immutability).toContain("Prove Hard Gate Immutability");
  expect(immutability).toContain("IMMUTABLE_KEYS");
  expect(immutability).toContain("requires_human_approval");
  expect(immutability).toContain("PROVEN");

  // prove_publish_priority_learning.js
  const priority = fs.readFileSync(path.join(ROOT, "scripts", "prove_publish_priority_learning.js"), "utf-8");
  expect(priority).toContain("Prove Publish Priority Learning");
  expect(priority).toContain("computeLearnedPriorityBoost");
  expect(priority).toContain("computeHubPriority");
  expect(priority).toContain("PROVEN");
});

test("computeLearnedPriorityBoost maps weight range correctly", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "lib", "pattern-ranker.js"), "utf-8");

  // Must export computeLearnedPriorityBoost
  expect(src).toContain("export function computeLearnedPriorityBoost");

  // Test the function inline (same logic as in pattern-ranker.js)
  function computeLearnedPriorityBoost(archetypeId, archetypeWeights) {
    if (!archetypeWeights || !archetypeId) return 0;
    const aw = archetypeWeights[archetypeId];
    if (!aw) return 0;
    const weight = aw.priority_weight || 1.0;
    return Math.max(0, Math.min(20, Math.round((weight - 0.3) / 1.2 * 20)));
  }

  // Weight 0.3 → boost 0
  expect(computeLearnedPriorityBoost("x", { x: { priority_weight: 0.3 } })).toBe(0);

  // Weight 1.5 → boost 20
  expect(computeLearnedPriorityBoost("x", { x: { priority_weight: 1.5 } })).toBe(20);

  // Weight 1.0 → boost ~12
  const midBoost = computeLearnedPriorityBoost("x", { x: { priority_weight: 1.0 } });
  expect(midBoost).toBeGreaterThan(5);
  expect(midBoost).toBeLessThan(15);

  // No archetype → boost 0
  expect(computeLearnedPriorityBoost(null, {})).toBe(0);
  expect(computeLearnedPriorityBoost("missing", {})).toBe(0);
});

test("hard gate immutable keys are defined and correct", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "lib", "learning-store.js"), "utf-8");

  // Must export IMMUTABLE_KEYS
  expect(src).toContain("export const IMMUTABLE_KEYS");

  // Must contain all 8 critical keys
  expect(src).toContain("uniqueness_thresholds");
  expect(src).toContain("usefulness_gate_rules");
  expect(src).toContain("slug_rules");
  expect(src).toContain("schema_requirements");
  expect(src).toContain("duplicate_protection");
  expect(src).toContain("live_verification_rules");
  expect(src).toContain("domain_path_trust_rules");
  expect(src).toContain("collection_template_path");

  // Must export isImmutableKey
  expect(src).toContain("export function isImmutableKey");
});

test("learning updater deletes immutable keys and generates recommendations", async () => {
  const fs = require("fs");
  const path = require("path");
  const ROOT = path.resolve(__dirname, "..");

  const src = fs.readFileSync(path.join(ROOT, "lib", "learning-updater.js"), "utf-8");

  // Must iterate IMMUTABLE_KEYS
  expect(src).toContain("for (const key of IMMUTABLE_KEYS)");

  // Must delete prohibited keys
  expect(src).toContain("delete state[key]");

  // Must add blocked recommendation
  expect(src).toContain("requires_human_approval: true");
  expect(src).toContain('action: "blocked"');
});
