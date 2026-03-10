/**
 * Create FTL and Cargo Van lane pages through the real pipeline.
 * Uses buildPackageForLane + shipOneLane from lane-factory.js.
 *
 * The full content (body-content, faq-schema, proof-section, comparison)
 * is generated internally by shipOneLane → buildWebflowFields → renderWebflowFields.
 */
import { buildPackageForLane, shipOneLane, buildWebflowFields, publishSiteToProduction } from "../lib/lane-factory.js";

// Env setup
const {
  WEBFLOW_API_TOKEN,
  WEBFLOW_SITE_ID,
  WEBFLOW_LANE_COLLECTION_ID,
} = process.env;

if (!WEBFLOW_API_TOKEN || !WEBFLOW_SITE_ID || !WEBFLOW_LANE_COLLECTION_ID) {
  console.error("Missing env vars. Set WEBFLOW_API_TOKEN, WEBFLOW_SITE_ID, WEBFLOW_LANE_COLLECTION_ID");
  process.exit(1);
}

const pages = [
  {
    origin: "Dallas, TX",
    destination: "Atlanta, GA",
    mode: "FTL",
    segment: "full-truckload",
  },
  {
    origin: "Miami, FL",
    destination: "Orlando, FL",
    mode: "Cargo Van / Box Truck",
    segment: "cargo-van",
  },
];

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Create Mode Pages — ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`${"=".repeat(60)}\n`);

  const results = [];

  for (const p of pages) {
    console.log(`\n--- Building ${p.mode}: ${p.origin} → ${p.destination} ---`);

    try {
      const pkg = buildPackageForLane(p.origin, p.destination, p.mode, p.segment);

      // Preview the RENDERED fields (not the raw package)
      const renderedFields = buildWebflowFields(pkg.page);
      console.log(`  Slug: ${renderedFields.slug}`);
      console.log(`  Name: ${renderedFields.name}`);
      console.log(`  Mode: ${renderedFields.mode}`);
      console.log(`  Body: ${(renderedFields["body-content"] || "").length} chars`);
      console.log(`  FAQ-schema: ${(renderedFields["faq-schema"] || "").length} chars`);
      console.log(`  Proof-section: ${(renderedFields["proof-section"] || "").length} chars`);
      console.log(`  Traditional: ${(renderedFields["traditional-ltl"] || "").length} chars`);
      console.log(`  Warp: ${(renderedFields["warp-ltl"] || "").length} chars`);
      console.log(`  Breadcrumb: ${(renderedFields["breadcrumb-schema"] || "").length} chars`);

      const result = await shipOneLane(pkg, { dryRun });
      console.log(`  ✅ ${dryRun ? "Would create" : "Created"}: ${result.slug} (item: ${result.itemId})`);
      results.push(result);

      // Rate limit between creates
      if (!dryRun) {
        console.log("  Waiting 1.5s for rate limit...");
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      results.push({ success: false, error: err.message, mode: p.mode });
    }
  }

  // Publish site to production
  if (!dryRun && results.some(r => r.success)) {
    console.log("\n--- Publishing site to production ---");
    try {
      await new Promise(r => setTimeout(r, 2000));
      await publishSiteToProduction(WEBFLOW_SITE_ID, WEBFLOW_API_TOKEN);
      console.log("  ✅ Site published to production");
    } catch (err) {
      console.error(`  ❌ Publish error: ${err.message}`);
      // Retry once after delay
      console.log("  Retrying in 15s...");
      await new Promise(r => setTimeout(r, 15000));
      try {
        await publishSiteToProduction(WEBFLOW_SITE_ID, WEBFLOW_API_TOKEN);
        console.log("  ✅ Site published (retry)");
      } catch (e2) {
        console.error(`  ❌ Retry failed: ${e2.message}`);
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Results: ${results.filter(r => r.success).length}/${results.length} successful`);
  results.forEach(r => {
    if (r.success) {
      console.log(`  ✅ ${r.slug} — ${r.dryRun ? "dry-run" : "live"} (${r.itemId})`);
    } else {
      console.log(`  ❌ ${r.mode} — ${r.error}`);
    }
  });
  console.log(`${"=".repeat(60)}\n`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
