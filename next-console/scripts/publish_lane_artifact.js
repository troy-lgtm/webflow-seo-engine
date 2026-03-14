#!/usr/bin/env node
/**
 * publish_lane_artifact.js — Publish Lane Artifact to Vercel Blob
 *
 * Generates benchmark lane pages through the canonical pipeline,
 * enforces quality gates, builds a versioned artifact, and publishes
 * it to Vercel Blob for the main site to consume.
 *
 * Usage:
 *   node scripts/publish_lane_artifact.js                    # benchmark lanes only
 *   node scripts/publish_lane_artifact.js --dry-run           # build + validate, no upload
 *   node scripts/publish_lane_artifact.js --lanes "slug1,slug2"  # custom lane list
 *
 * Requires BLOB_READ_WRITE_TOKEN in .env.local
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });
import { buildLaneArtifact, validateLaneArtifact, ARTIFACT_VERSION } from "../lib/publishers/lane-artifact-contract.js";
import { publishArtifact, verifyPublishedArtifact } from "../lib/publishers/blob-publisher.js";

// ── Benchmark lanes ──────────────────────────────────────────────────
const BENCHMARK_LANES = [
  { origin: "Atlanta", destination: "Orlando", mode: "LTL" },
  { origin: "Atlanta", destination: "Miami", mode: "LTL" },
  { origin: "Los Angeles", destination: "New York", mode: "LTL" },
];

// ── Parse CLI args ───────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const lanesArg = args.find((a) => a.startsWith("--lanes="))?.split("=")[1]
  || (args.includes("--lanes") ? args[args.indexOf("--lanes") + 1] : null);

function parseLaneArg(str) {
  return str.split(",").map((slug) => {
    const parts = slug.trim().split("-to-");
    if (parts.length < 2) throw new Error(`Invalid lane slug: "${slug}". Expected format: origin-to-destination`);
    const cap = (s) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { origin: cap(parts[0]), destination: cap(parts.slice(1).join("-to-")), mode: "LTL" };
  });
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  LANE ARTIFACT PUBLISHER");
  console.log(`  Version: ${ARTIFACT_VERSION}`);
  console.log(`  Mode: ${dryRun ? "DRY RUN (no upload)" : "LIVE PUBLISH"}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── Determine lane set ─────────────────────────────────────────────
  const lanes = lanesArg ? parseLaneArg(lanesArg) : BENCHMARK_LANES;
  console.log(`Building ${lanes.length} lane(s):\n`);
  for (const l of lanes) console.log(`  • ${l.origin} → ${l.destination} (${l.mode})`);
  console.log();

  // ── Build artifact ─────────────────────────────────────────────────
  const artifact = buildLaneArtifact(lanes, { source: "mac-studio-engine" });

  console.log("── Build Results ──\n");
  console.log(`  Publishable: ${artifact.laneCount}`);
  console.log(`  Rejected:    ${artifact.rejected.length}`);
  console.log(`  Generated:   ${artifact.generatedAt}\n`);

  for (const lane of artifact.lanes) {
    console.log(`  ✓ ${lane.slug}  ${lane.qualityGrade} ${lane.qualityScore}%  ${lane.gatesPassed}/${lane.gatesTotal} gates`);
  }
  for (const lane of artifact.rejected) {
    console.log(`  ✗ ${lane.slug}  ${lane.rejectReason}`);
  }
  console.log();

  // ── Validate ───────────────────────────────────────────────────────
  const validation = validateLaneArtifact(artifact);
  if (!validation.valid) {
    console.error("ARTIFACT VALIDATION FAILED:");
    for (const err of validation.errors) console.error(`  ✗ ${err}`);
    process.exit(1);
  }
  console.log("  ✓ Artifact validation passed\n");

  // ── Publish ────────────────────────────────────────────────────────
  if (dryRun) {
    console.log("── Dry Run ── Skipping upload.\n");
    console.log(`Artifact size: ${JSON.stringify(artifact).length} bytes`);
    console.log("Dry run complete.");
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("FATAL: BLOB_READ_WRITE_TOKEN not set. Add it to .env.local.");
    process.exit(1);
  }

  console.log("── Publishing to Vercel Blob ──\n");
  const { versionedUrl, currentUrl, versionPath } = await publishArtifact(artifact);

  console.log(`  Versioned: ${versionedUrl}`);
  console.log(`  Current:   ${currentUrl}`);
  console.log(`  Path:      ${versionPath}\n`);

  // ── Verify ─────────────────────────────────────────────────────────
  console.log("── Verifying Published Artifact ──\n");

  const currentVerify = await verifyPublishedArtifact(currentUrl);
  const versionedVerify = await verifyPublishedArtifact(versionedUrl);

  if (!currentVerify.valid) {
    console.error("VERIFICATION FAILED for current.json:");
    for (const err of currentVerify.errors) console.error(`  ✗ ${err}`);
    process.exit(1);
  }
  console.log("  ✓ current.json verified");

  if (!versionedVerify.valid) {
    console.error("VERIFICATION FAILED for versioned artifact:");
    for (const err of versionedVerify.errors) console.error(`  ✗ ${err}`);
    process.exit(1);
  }
  console.log(`  ✓ ${versionPath} verified`);

  // ── Verify benchmark slugs present ─────────────────────────────────
  const benchmarkSlugs = ["atlanta-to-orlando", "atlanta-to-miami", "los-angeles-to-new-york"];
  const publishedSlugs = new Set(currentVerify.artifact.lanes.map((l) => l.slug));
  const missingSlugs = benchmarkSlugs.filter((s) => !publishedSlugs.has(s));

  if (missingSlugs.length > 0) {
    console.error(`VERIFICATION FAILED: Missing benchmark slugs: ${missingSlugs.join(", ")}`);
    process.exit(1);
  }
  console.log("  ✓ All benchmark slugs present");

  // ── Verify routeContract on each lane ──────────────────────────────
  for (const lane of currentVerify.artifact.lanes) {
    if (!lane.routeContract?._route_contract_version) {
      console.error(`VERIFICATION FAILED: Lane ${lane.slug} missing routeContract`);
      process.exit(1);
    }
  }
  console.log("  ✓ All lanes include routeContract\n");

  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  PUBLISHED: ${artifact.laneCount} lanes`);
  console.log(`  VERSION:   ${artifact.generatedAt}`);
  console.log(`  CURRENT:   ${currentUrl}`);
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("FATAL:", err.message || err);
  process.exit(1);
});
