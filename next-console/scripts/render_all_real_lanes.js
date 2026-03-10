#!/usr/bin/env node

/**
 * Render All Real Lanes — Full Registry Pipeline
 *
 * Reads the enriched lane registry (data/lane_registry.json) built by
 * build_lane_registry.js and runs the canonical render pipeline for every
 * lane in LTL mode:
 *
 *   1. buildLaneKnowledge(laneObj)
 *   2. buildCanonicalLanePageData(knowledge, relatedLinks)
 *   3. renderWebflowFields(canonicalData)
 *   4. Write webflow payload to artifacts/rendered_lanes/{slug}/webflow_payload.json
 *
 * Produces:
 *   artifacts/rendered_lanes/{slug}/webflow_payload.json  — per-lane payloads
 *   artifacts/lane_render_summary.json                    — run summary
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { buildLaneKnowledge } from "../lib/lane-knowledge.js";
import { buildCanonicalLanePageData } from "../lib/lane-page-schema.js";
import { renderWebflowFields } from "../lib/render-lane-page.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const REGISTRY_PATH = path.join(ROOT, "data", "lane_registry.json");
const LINK_GRAPH_PATH = path.join(ROOT, "data", "internal_link_graph.json");
const CORRIDOR_MAP_PATH = path.join(ROOT, "data", "corridor_map.json");
const OUTPUT_DIR = path.join(ROOT, "artifacts", "rendered_lanes");
const SUMMARY_PATH = path.join(ROOT, "artifacts", "lane_render_summary.json");

// ── Main ──────────────────────────────────────────────────────────────

function main() {
  console.log("=== Render All Real Lanes ===\n");

  // ── 1. Load registry ────────────────────────────────────────────────
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error(`Registry not found at ${REGISTRY_PATH}`);
    console.error("Run build_lane_registry.js first.");
    process.exit(1);
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
  const lanes = Array.isArray(registry) ? registry : registry.lanes || [];

  if (lanes.length === 0) {
    console.error("Registry is empty — nothing to render.");
    process.exit(1);
  }

  console.log(`  Loaded ${lanes.length} lanes from registry.\n`);

  // ── 1b. Load internal link graph (optional) ──────────────────────
  let linkGraph = null;
  if (fs.existsSync(LINK_GRAPH_PATH)) {
    try {
      const linkGraphData = JSON.parse(fs.readFileSync(LINK_GRAPH_PATH, "utf-8"));
      linkGraph = linkGraphData.graph || linkGraphData;
      console.log(`  Loaded internal link graph (${Object.keys(linkGraph).length} entries).\n`);
    } catch (err) {
      console.warn(`  Warning: Could not parse ${LINK_GRAPH_PATH}: ${err.message}`);
    }
  } else {
    console.log("  No internal_link_graph.json found — falling back to corridor-based links.\n");
  }

  // ── 1c. Load corridor map (optional) ─────────────────────────────
  let corridorMap = {};
  if (fs.existsSync(CORRIDOR_MAP_PATH)) {
    try {
      const corridorData = JSON.parse(fs.readFileSync(CORRIDOR_MAP_PATH, "utf-8"));
      const corridors = corridorData.corridors || corridorData;
      if (Array.isArray(corridors)) {
        for (const c of corridors) {
          corridorMap[c.corridor_id] = c;
        }
      }
      console.log(`  Loaded corridor map (${Object.keys(corridorMap).length} corridors).\n`);
    } catch (err) {
      console.warn(`  Warning: Could not parse ${CORRIDOR_MAP_PATH}: ${err.message}`);
    }
  }

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ── 2. Process each lane ────────────────────────────────────────────
  let totalRendered = 0;
  let totalFailed = 0;
  const byCorridor = {};
  const byLaneSet = {};
  const failedSlugs = [];
  let totalBodyContentLength = 0;

  const startTime = Date.now();

  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const slug = lane.slug || "unknown";

    // Progress logging every 100 lanes
    if (i > 0 && i % 100 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  [${i}/${lanes.length}] processed (${elapsed}s elapsed, ${totalFailed} failed)`);
    }

    try {
      // 2a. Build lane knowledge (LTL mode — primary mode)
      const knowledge = buildLaneKnowledge({
        origin: lane.origin,
        destination: lane.destination,
        mode: "LTL",
      });

      // 2b. Enrich knowledge with origin, destination, segment from registry
      knowledge.origin = lane.origin;
      knowledge.destination = lane.destination;
      knowledge.segment = lane.lane_set || "smb";
      knowledge.corridor_id = lane.corridor_id || null;

      // 2c. Build related links from link graph + corridor map
      const corridorId = lane.corridor_id || null;
      const corridorHub =
        corridorId && corridorId !== "other" && corridorMap[corridorId]
          ? corridorMap[corridorId].canonical_path
          : corridorId && corridorId !== "other"
            ? `/corridors/${corridorId}`
            : null;

      let relatedLanes;
      if (linkGraph && linkGraph[slug]) {
        // Use the full internal link graph
        const entry = linkGraph[slug];
        const seen = new Set();
        const combined = [];

        const addLinks = (arr) => {
          if (!Array.isArray(arr)) return;
          for (const link of arr) {
            if (link && link.url && !seen.has(link.url)) {
              seen.add(link.url);
              combined.push({ label: link.label, url: link.url });
            }
          }
        };

        addLinks(entry.corridor_links);
        if (entry.reverse_lane) {
          addLinks([entry.reverse_lane]);
        }
        addLinks(entry.same_origin);
        addLinks(entry.same_destination);

        relatedLanes = combined.slice(0, 12);
      } else {
        // Fallback: same-corridor lanes (original approach)
        relatedLanes = lanes
          .filter((l) => l.corridor_id === lane.corridor_id && l.slug !== lane.slug)
          .slice(0, 5)
          .map((l) => ({
            label: `${l.origin.split(",")[0]} \u2192 ${l.destination.split(",")[0]}`,
            url: `/lanes/${l.slug}`,
          }));
      }

      // Metro page links derived from origin/destination cities
      const toSlug = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const originCity = lane.origin_city || lane.origin.split(",")[0].trim();
      const destCity = lane.destination_city || lane.destination.split(",")[0].trim();
      const metroLinks = [
        { label: `${originCity} Freight Hub`, url: `/metros/${toSlug(originCity)}-freight` },
        { label: `${destCity} Freight Hub`, url: `/metros/${toSlug(destCity)}-freight` },
      ];

      // Guide link based on mode
      const mode = "LTL";
      const guideLinkMap = { LTL: "/guides/ltl", FTL: "/guides/ftl", "Cargo Van / Box Truck": "/guides/cargo-van-box-truck" };
      const guideLink = guideLinkMap[mode] || "/guides/ltl";

      const relatedLinks = {
        corridor_hub: corridorHub,
        related_lanes: relatedLanes,
        tool_link: "https://www.wearewarp.com/quote",
        data_link: null,
        metro_links: metroLinks,
        guide_link: guideLink,
      };

      // 2d. Build canonical page data
      const canonicalData = buildCanonicalLanePageData(knowledge, relatedLinks);

      // 2e. Render Webflow fields
      const webflowPayload = renderWebflowFields(canonicalData);

      // 2f. Write per-lane artifact
      const laneDir = path.join(OUTPUT_DIR, slug);
      fs.mkdirSync(laneDir, { recursive: true });
      fs.writeFileSync(
        path.join(laneDir, "webflow_payload.json"),
        JSON.stringify(webflowPayload, null, 2)
      );

      // Track stats
      totalRendered++;
      const bodyLen = (webflowPayload["body-content"] || "").length;
      totalBodyContentLength += bodyLen;

      const statCorridorId = lane.corridor_id || "unknown";
      byCorridor[statCorridorId] = (byCorridor[statCorridorId] || 0) + 1;

      const laneSet = lane.lane_set || "unknown";
      byLaneSet[laneSet] = (byLaneSet[laneSet] || 0) + 1;
    } catch (err) {
      totalFailed++;
      failedSlugs.push(slug);
      if (totalFailed <= 10) {
        console.error(`  FAIL: ${slug} — ${err.message}`);
      } else if (totalFailed === 11) {
        console.error("  ... suppressing further error details (see summary)");
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  [${lanes.length}/${lanes.length}] done (${elapsed}s)\n`);

  // ── 3. Write summary ───────────────────────────────────────────────
  const avgBodyContentLength =
    totalRendered > 0 ? Math.round(totalBodyContentLength / totalRendered) : 0;

  const summary = {
    timestamp: new Date().toISOString(),
    total_rendered: totalRendered,
    total_failed: totalFailed,
    by_corridor: byCorridor,
    by_lane_set: byLaneSet,
    failed_slugs: failedSlugs,
    avg_body_content_length: avgBodyContentLength,
  };

  fs.mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

  // ── Console summary ────────────────────────────────────────────────
  console.log("=== Summary ===");
  console.log(`  Total rendered:       ${totalRendered}`);
  console.log(`  Total failed:         ${totalFailed}`);
  console.log(`  Avg body content:     ${avgBodyContentLength} chars`);
  console.log(`  Corridors:            ${Object.keys(byCorridor).length}`);
  console.log(`  Lane sets:            ${Object.keys(byLaneSet).length}`);
  if (failedSlugs.length > 0) {
    console.log(`  Failed slugs (first 10): ${failedSlugs.slice(0, 10).join(", ")}`);
  }
  console.log("");
  console.log(`  Payloads:  ${OUTPUT_DIR}/`);
  console.log(`  Summary:   ${SUMMARY_PATH}`);

  if (totalFailed > 0) {
    process.exit(1);
  }
}

main();
