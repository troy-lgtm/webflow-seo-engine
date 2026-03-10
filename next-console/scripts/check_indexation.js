#!/usr/bin/env node
/**
 * Check Indexation
 * Loads published pages and outputs URL list for indexation monitoring.
 * Placeholder for Google Search Console API integration.
 *
 * Usage: node scripts/check_indexation.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

const BASE_URL = "https://www.wearewarp.com";

/** Safely load JSON from a file path. Returns fallback on any error. */
function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  console.log("Check Indexation");
  console.log("================\n");

  // 1. Load published pages
  const publishedPath = path.join(ROOT, "data", "published_pages.json");
  const publishedPages = loadJson(publishedPath, []);

  // Also check metro cluster manifest for generated pages
  const manifestPath = path.join(ROOT, "artifacts", "metro_cluster", "manifest.json");
  const manifest = loadJson(manifestPath, null);
  let clusterSlugs = [];
  if (manifest && manifest.pages) {
    clusterSlugs = manifest.pages.map((p) => p.slug);
  }

  // Build URL list from published pages
  const publishedUrls = publishedPages
    .map((p) => {
      const canonicalPath = p.canonical_path || `/${p.slug}`;
      return `${BASE_URL}${canonicalPath}`;
    })
    .filter(Boolean);

  // Build URL list from cluster pages (not yet published, but trackable)
  const clusterUrls = clusterSlugs.map((slug) => `${BASE_URL}/${slug}`);

  // 2. Print URLs
  console.log(`Published Pages (${publishedUrls.length}):`);
  if (publishedUrls.length === 0) {
    console.log("  (none — published_pages.json is empty)");
  } else {
    for (const url of publishedUrls) {
      console.log(`  ${url}`);
    }
  }

  console.log(`\nCluster Pages — Not Yet Published (${clusterUrls.length}):`);
  if (clusterUrls.length === 0) {
    console.log("  (none — run generate-metro-cluster.js first)");
  } else {
    // Show first 20 and summarize the rest
    const displayLimit = 20;
    for (const url of clusterUrls.slice(0, displayLimit)) {
      console.log(`  ${url}`);
    }
    if (clusterUrls.length > displayLimit) {
      console.log(`  ... and ${clusterUrls.length - displayLimit} more`);
    }
  }

  // 3. Summary
  const totalPages = publishedUrls.length + clusterUrls.length;
  // Placeholder indexed count — in production this would come from GSC API
  const estimatedIndexed = publishedUrls.length;
  const pendingIndexation = clusterUrls.length;

  console.log("\n--- Summary ---");
  console.log(`Total published URLs: ${publishedUrls.length}`);
  console.log(`Total cluster URLs (pending publish): ${clusterUrls.length}`);
  console.log(`Estimated indexed (placeholder): ${estimatedIndexed}`);
  console.log(`Pending indexation: ${pendingIndexation}`);

  if (publishedUrls.length > 0) {
    const indexRate = ((estimatedIndexed / publishedUrls.length) * 100).toFixed(1);
    console.log(`Index rate: ${indexRate}%`);
  }

  // 4. Write indexation status JSON
  const artifactsDir = path.join(ROOT, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });

  const status = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    published: {
      total: publishedUrls.length,
      urls: publishedUrls,
      estimated_indexed: estimatedIndexed,
      index_rate: publishedUrls.length > 0
        ? Math.round((estimatedIndexed / publishedUrls.length) * 1000) / 1000
        : 0,
    },
    cluster_pending: {
      total: clusterUrls.length,
      urls: clusterUrls,
    },
    total_urls: totalPages,
    notes: [
      "estimated_indexed is a placeholder. Integrate Google Search Console API for actual data.",
      "cluster_pending URLs are generated but not yet published to Webflow.",
      "Run 'node scripts/generate-metro-cluster.js' to populate cluster pages.",
    ],
    // Placeholder for future GSC integration
    gsc_integration: {
      status: "not_configured",
      api_scope: "https://www.googleapis.com/auth/webmasters.readonly",
      todo: [
        "Set up Google Cloud project with Search Console API enabled",
        "Create service account and grant it access to the GSC property",
        "Store credentials securely (not in repo)",
        "Implement URL inspection API calls for each published URL",
        "Track index status, coverage issues, and crawl errors",
      ],
    },
  };

  const outputPath = path.join(artifactsDir, "indexation_status.json");
  fs.writeFileSync(outputPath, JSON.stringify(status, null, 2));

  console.log(`\nOutput: ${outputPath}`);
  console.log("\nNote: Indexed count is a placeholder. Integrate GSC API for real data.");
}

main();
