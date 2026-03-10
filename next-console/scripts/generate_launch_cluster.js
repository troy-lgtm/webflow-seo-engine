#!/usr/bin/env node
/**
 * Generate Launch Cluster
 * Generates lane page content for the target metro cluster.
 * Outputs page data to artifacts/launch_cluster/.
 *
 * Target metros: Chicago, Dallas, Atlanta, Houston, New York,
 *                Los Angeles, Miami, Charlotte, Nashville
 *
 * Usage: node scripts/generate_launch_cluster.js [--dry-run]
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts", "launch_cluster");

const DRY_RUN = process.argv.includes("--dry-run");

const CLUSTER_METROS = [
  "Chicago",
  "Dallas",
  "Atlanta",
  "Houston",
  "New York",
  "Los Angeles",
  "Miami",
  "Charlotte",
  "Nashville",
];

function loadJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { /* ignore */ }
  return null;
}

function main() {
  console.log("=== Generate Launch Cluster ===");
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN" : "GENERATE"}`);
  console.log(`  Metros: ${CLUSTER_METROS.join(", ")}`);
  console.log("");

  // Load inventory
  const inventory = loadJSON(path.join(ROOT, "data", "lane_inventory.json")) || [];
  console.log(`  Inventory: ${inventory.length} total lanes`);

  // Load published
  const published = loadJSON(path.join(ROOT, "data", "published_pages.json")) || [];
  const publishedSlugs = new Set(published.map((p) => p.slug));

  // Filter to cluster lanes
  const clusterSet = new Set(CLUSTER_METROS.map((m) => m.toLowerCase()));
  const clusterLanes = inventory.filter((lane) => {
    const oCity = (lane.origin || "").split(",")[0].trim().toLowerCase();
    const dCity = (lane.destination || "").split(",")[0].trim().toLowerCase();
    return clusterSet.has(oCity) || clusterSet.has(dCity);
  });

  console.log(`  Cluster lanes: ${clusterLanes.length}`);

  // Categorize by tier
  const tierA = []; // Both cities in cluster
  const tierB = []; // One cluster city
  const already = [];

  for (const lane of clusterLanes) {
    const slug = lane.slug || `${(lane.origin || "").split(",")[0].trim().toLowerCase().replace(/\s+/g, "-")}-to-${(lane.destination || "").split(",")[0].trim().toLowerCase().replace(/\s+/g, "-")}`;
    if (publishedSlugs.has(slug)) {
      already.push(slug);
      continue;
    }

    const oCity = (lane.origin || "").split(",")[0].trim().toLowerCase();
    const dCity = (lane.destination || "").split(",")[0].trim().toLowerCase();
    const oIn = clusterSet.has(oCity);
    const dIn = clusterSet.has(dCity);

    if (oIn && dIn) {
      tierA.push({ ...lane, slug, tier: "A" });
    } else {
      tierB.push({ ...lane, slug, tier: "B" });
    }
  }

  console.log(`  Tier A (both in cluster): ${tierA.length}`);
  console.log(`  Tier B (one in cluster):  ${tierB.length}`);
  console.log(`  Already published:        ${already.length}`);

  // Sort each tier by priority
  const sorted = [...tierA, ...tierB];

  // Write manifest
  if (!fs.existsSync(ARTIFACTS)) fs.mkdirSync(ARTIFACTS, { recursive: true });

  const manifest = {
    generated_at: new Date().toISOString(),
    dry_run: DRY_RUN,
    metros: CLUSTER_METROS,
    total_cluster_lanes: clusterLanes.length,
    already_published: already.length,
    tier_a_count: tierA.length,
    tier_b_count: tierB.length,
    lanes: sorted.map((l) => ({
      slug: l.slug,
      origin: l.origin,
      destination: l.destination,
      mode: l.mode || "LTL",
      tier: l.tier,
    })),
  };

  fs.writeFileSync(
    path.join(ARTIFACTS, "cluster_manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  console.log(`\n  Manifest written: artifacts/launch_cluster/cluster_manifest.json`);
  console.log(`  Total publishable: ${sorted.length}`);

  // Print first 20
  console.log(`\n  Top 20 candidates:`);
  for (const l of sorted.slice(0, 20)) {
    console.log(`    [${l.tier}] ${l.slug} (${l.origin} → ${l.destination})`);
  }

  if (sorted.length > 20) {
    console.log(`    ... and ${sorted.length - 20} more`);
  }
}

main();
