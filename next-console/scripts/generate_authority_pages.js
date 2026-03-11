#!/usr/bin/env node
/**
 * generate_authority_pages.js — Authority Page Generation Script
 *
 * Generates all authority pages (solutions, concepts, equipment) through
 * the canonical pipeline:
 *   Entity Registry → Knowledge Graph → Canonical Page Data →
 *   Content Rendering → Quality Gate → Artifacts
 *
 * Outputs inspectable JSON artifacts to artifacts/authority/ for review.
 *
 * Usage:
 *   node scripts/generate_authority_pages.js [options]
 *
 * Options:
 *   --family solution|concept|equipment   Generate only one family
 *   --entity entity-id                    Generate a single entity
 *   --validate-only                       Run validation without generating
 *   --summary                             Print summary table only
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getAllEntities, getEntity, getGraphStats, validateGraph } from "../lib/authority-graph.js";
import { buildAuthorityPageData, SOLUTION_SECTIONS, CONCEPT_SECTIONS, EQUIPMENT_SECTIONS } from "../lib/authority-page-schema.js";
import { renderAuthorityPage } from "../lib/render-authority-page.js";
import { assessAuthorityQuality } from "../lib/authority-page-validator.js";
import { buildAuthorityToAuthorityLinks, validateLinkGraph } from "../lib/authority-linker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts", "authority");

// Parse CLI args
const args = process.argv.slice(2);
const familyIdx = args.indexOf("--family");
const targetFamily = familyIdx >= 0 ? args[familyIdx + 1] : null;
const entityIdx = args.indexOf("--entity");
const targetEntity = entityIdx >= 0 ? args[entityIdx + 1] : null;
const validateOnly = args.includes("--validate-only");
const summaryOnly = args.includes("--summary");

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  AUTHORITY PAGE GENERATOR                                   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ── Step 1: Graph Validation ──────────────────────────────────────
  console.log("Step 1: Validating knowledge graph...");
  const graphStats = getGraphStats();
  console.log(`  Entities: ${graphStats.entity_count} (${graphStats.solution_count} solutions, ${graphStats.concept_count} concepts, ${graphStats.equipment_count} equipment)`);
  console.log(`  Edges: ${graphStats.total_edges} (avg ${graphStats.avg_edges_per_entity}/entity)`);
  console.log(`  Isolated: ${graphStats.isolated_entities}`);

  const graphValidation = validateGraph();
  console.log(`  Graph valid: ${graphValidation.valid} (${graphValidation.errors.length} errors, ${graphValidation.warnings.length} warnings)`);
  if (graphValidation.errors.length > 0) {
    for (const err of graphValidation.errors) {
      console.log(`    ✗ ${err}`);
    }
    if (!validateOnly) {
      console.log("\n⛔ Graph validation failed. Fix errors before generating.");
      process.exit(1);
    }
  }

  // ── Step 2: Link Graph Validation ─────────────────────────────────
  console.log("\nStep 2: Validating link graph...");
  const linkValidation = validateLinkGraph();
  console.log(`  Links valid: ${linkValidation.valid}`);
  console.log(`  Total links: ${linkValidation.stats.total_links}`);
  console.log(`  Cross-family: ${linkValidation.stats.cross_family_links}`);
  console.log(`  Avg links/entity: ${linkValidation.stats.avg_links_per_entity}`);
  if (linkValidation.errors.length > 0) {
    for (const err of linkValidation.errors) {
      console.log(`    ✗ ${err}`);
    }
  }

  if (validateOnly) {
    console.log("\n✓ Validation complete (--validate-only mode)");
    return;
  }

  // ── Step 3: Select entities to generate ───────────────────────────
  let entities = getAllEntities();
  if (targetEntity) {
    const entity = getEntity(targetEntity);
    if (!entity) {
      console.log(`\n⛔ Unknown entity: ${targetEntity}`);
      process.exit(1);
    }
    entities = [entity];
  } else if (targetFamily) {
    const familyMap = { solution: "solution", concept: "concept", equipment: "equipment" };
    const family = familyMap[targetFamily];
    if (!family) {
      console.log(`\n⛔ Unknown family: ${targetFamily}`);
      process.exit(1);
    }
    entities = entities.filter(e => e.family === family);
  }

  console.log(`\nStep 3: Generating ${entities.length} authority pages...`);

  // ── Step 4: Generate each page ────────────────────────────────────
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const results = [];
  let publishable = 0;
  let blocked = 0;

  for (const entity of entities) {
    try {
      // Build canonical page data
      const pageData = buildAuthorityPageData(entity.id);

      // Render content
      const rendered = renderAuthorityPage(pageData);

      // Build internal links
      const authorityLinks = buildAuthorityToAuthorityLinks(entity.id);

      // Run quality gate
      const quality = assessAuthorityQuality(pageData, rendered);

      const result = {
        entity_id: entity.id,
        family: entity.family,
        slug: entity.slug,
        page_title: pageData.page_title,
        canonical_path: pageData.canonical_path,
        quality_score: quality.score,
        quality_grade: quality.grade,
        publishable: quality.publishable,
        gates_passed: quality.gates_passed,
        gate_count: quality.gate_count,
        body_length: rendered.body_text.length,
        html_length: rendered.primary_content_html.length,
        faq_count: pageData.faq?.items?.length || 0,
        link_count: authorityLinks.length,
        errors: quality.errors,
        warnings: quality.warnings,
      };

      results.push(result);

      if (quality.publishable) {
        publishable++;
      } else {
        blocked++;
      }

      if (!summaryOnly) {
        console.log(`\n  ─── ${entity.id} ────────────────────────────────`);
        console.log(`  Family:    ${entity.family}`);
        console.log(`  Title:     ${pageData.page_title}`);
        console.log(`  Path:      ${pageData.canonical_path}`);
        console.log(`  H1:        ${pageData.hero.headline}`);
        console.log(`  Body:      ${rendered.body_text.length} chars`);
        console.log(`  HTML:      ${rendered.primary_content_html.length} chars`);
        console.log(`  FAQs:      ${pageData.faq?.items?.length || 0}`);
        console.log(`  Links:     ${authorityLinks.length} authority links`);
        console.log(`  Quality:   ${quality.score}% (${quality.grade}) — ${quality.gates_passed}/${quality.gate_count} gates`);
        console.log(`  Publish:   ${quality.publishable ? "✓ READY" : "⛔ BLOCKED"}`);

        if (quality.errors.length > 0) {
          for (const err of quality.errors) {
            console.log(`    ✗ ${err.gate}: ${err.message}`);
          }
        }
        if (quality.warnings.length > 0) {
          for (const w of quality.warnings) {
            console.log(`    ⚠ ${w.gate}: ${w.message}`);
          }
        }
      }

      // Write artifact
      const artifact = {
        _generated_at: new Date().toISOString(),
        _generator: "generate_authority_pages.js",
        entity: {
          id: entity.id,
          family: entity.family,
          label: entity.label,
        },
        page_data: pageData,
        rendered,
        quality,
        links: authorityLinks,
      };

      // Remove circular canonical ref for JSON serialization
      if (artifact.page_data._section_order) {
        // Keep section order, it's useful
      }

      const artifactPath = path.join(ARTIFACTS_DIR, `${entity.id}.json`);
      fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    } catch (err) {
      console.log(`\n  ⛔ ${entity.id}: ${err.message}`);
      blocked++;
      results.push({
        entity_id: entity.id,
        family: entity.family,
        error: err.message,
        publishable: false,
      });
    }
  }

  // ── Step 5: Summary ───────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  GENERATION SUMMARY");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Total:       ${entities.length}`);
  console.log(`  Publishable: ${publishable}`);
  console.log(`  Blocked:     ${blocked}`);
  console.log(`  Artifacts:   ${ARTIFACTS_DIR}/`);

  // Summary table
  console.log("\n  Entity                    Family     Score  Grade  Gates     Status");
  console.log("  ─────────────────────────────────────────────────────────────────────");
  for (const r of results) {
    if (r.error) {
      console.log(`  ${(r.entity_id || "?").padEnd(26)} ${(r.family || "?").padEnd(10)} ERROR  -      -         ⛔`);
    } else {
      console.log(
        `  ${r.entity_id.padEnd(26)} ${r.family.padEnd(10)} ${String(r.quality_score).padStart(3)}%   ${r.quality_grade}      ${r.gates_passed}/${r.gate_count}      ${r.publishable ? "✓" : "⛔"}`
      );
    }
  }

  // Write summary manifest
  const manifest = {
    _generated_at: new Date().toISOString(),
    _generator: "generate_authority_pages.js",
    graph_stats: graphStats,
    link_stats: linkValidation.stats,
    results,
    summary: {
      total: entities.length,
      publishable,
      blocked,
    },
  };
  const manifestPath = path.join(ARTIFACTS_DIR, "_manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n  Manifest: ${manifestPath}`);
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
