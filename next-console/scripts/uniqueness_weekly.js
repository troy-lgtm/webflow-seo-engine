#!/usr/bin/env node
/**
 * Weekly Uniqueness Report
 * Scans published pages and produces a uniqueness analysis report.
 *
 * Usage: node scripts/uniqueness_weekly.js
 * Output: artifacts/weekly_uniqueness_report.md + weekly_uniqueness_report.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

// ---------------------------------------------------------------------------
// Inline helpers (scripts can't use @/ aliases)
// ---------------------------------------------------------------------------

/** djb2 stable hash */
function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Tokenize text into lowercase alpha-only words, filter short ones. */
function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/** Jaccard similarity between two token arrays. */
function jaccardSimilarity(textA, textB) {
  const tokensA = new Set(tokenize(textA));
  const tokensB = new Set(tokenize(textB));
  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;
  let intersectionSize = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersectionSize++;
  }
  const unionSize = tokensA.size + tokensB.size - intersectionSize;
  return unionSize === 0 ? 0.0 : intersectionSize / unionSize;
}

/** Split text into sentences on ". " boundaries, normalize. */
function splitSentences(text) {
  if (!text) return [];
  return String(text)
    .split(/\.\s+/)
    .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " "))
    .filter((s) => s.length > 10);
}

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
  console.log("Weekly Uniqueness Report");
  console.log("========================\n");

  // 1. Load published pages
  const publishedPath = path.join(ROOT, "data", "published_pages.json");
  const publishedPages = loadJson(publishedPath, []);
  console.log(`Published pages loaded: ${publishedPages.length}`);

  // 2. Load metro cluster pages from manifest
  const manifestPath = path.join(ROOT, "artifacts", "metro_cluster", "manifest.json");
  const manifest = loadJson(manifestPath, null);
  let clusterPages = [];
  if (manifest && manifest.pages) {
    const pagesDir = path.join(ROOT, "artifacts", "metro_cluster", "pages");
    for (const entry of manifest.pages) {
      const pagePath = path.join(pagesDir, `${entry.slug}.json`);
      const page = loadJson(pagePath, null);
      if (page) clusterPages.push(page);
    }
  }
  console.log(`Metro cluster pages loaded: ${clusterPages.length}`);

  // Combine all pages for analysis
  const allPages = [...publishedPages, ...clusterPages];
  console.log(`Total pages for analysis: ${allPages.length}\n`);

  if (allPages.length === 0) {
    console.log("No pages found. Generate metro cluster first or add published pages.");
    console.log("  Run: node scripts/generate-metro-cluster.js");

    // Write empty report
    const emptyReport = {
      generated_at: new Date().toISOString(),
      total_pages: 0,
      status: "no_pages",
      metrics: {},
      issues: [],
    };
    const artifactsDir = path.join(ROOT, "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactsDir, "weekly_uniqueness_report.json"),
      JSON.stringify(emptyReport, null, 2)
    );
    fs.writeFileSync(
      path.join(artifactsDir, "weekly_uniqueness_report.md"),
      "# Weekly Uniqueness Report\n\nNo pages found for analysis.\n"
    );
    process.exit(0);
  }

  // ---------------------------------------------------------------------------
  // 3. Compute uniqueness metrics
  // ---------------------------------------------------------------------------

  // 3a. Count unique seo_titles, h1s, intro prefixes
  const titles = allPages.map((p) => p.seo_title || "");
  const h1s = allPages.map((p) => p.h1 || "");
  const introPrefixes = allPages.map((p) => (p.intro || "").slice(0, 100));

  const uniqueTitles = new Set(titles);
  const uniqueH1s = new Set(h1s);
  const uniqueIntroPrefixes = new Set(introPrefixes);

  // 3b. Find duplicate sentences across pages
  const sentenceIndex = new Map(); // normalized sentence -> Set of slugs
  for (const page of allPages) {
    const slug = page.slug || page.canonical_path || "unknown";
    const textParts = [
      page.seo_title || "",
      page.h1 || "",
      page.intro || "",
      page.meta_description || "",
    ];
    // Include FAQ answers
    if (page.faq) {
      for (const f of page.faq) {
        if (f.a) textParts.push(f.a);
      }
    }
    const fullText = textParts.join(". ");
    const sentences = splitSentences(fullText);
    for (const sent of sentences) {
      if (!sentenceIndex.has(sent)) sentenceIndex.set(sent, new Set());
      sentenceIndex.get(sent).add(slug);
    }
  }

  // Sentences appearing on more than 1 page
  const duplicateSentences = [];
  for (const [sent, slugs] of sentenceIndex.entries()) {
    if (slugs.size > 1) {
      duplicateSentences.push({
        sentence: sent.slice(0, 120),
        page_count: slugs.size,
        pages: [...slugs].slice(0, 5),
      });
    }
  }
  duplicateSentences.sort((a, b) => b.page_count - a.page_count);

  // 3c. Find duplicate FAQ questions
  const faqIndex = new Map(); // normalized question -> Set of slugs
  for (const page of allPages) {
    const slug = page.slug || "unknown";
    if (page.faq) {
      for (const f of page.faq) {
        if (!f.q) continue;
        const norm = f.q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
        if (!faqIndex.has(norm)) faqIndex.set(norm, new Set());
        faqIndex.get(norm).add(slug);
      }
    }
  }

  const duplicateFaqs = [];
  for (const [q, slugs] of faqIndex.entries()) {
    if (slugs.size > 1) {
      duplicateFaqs.push({
        question: q.slice(0, 120),
        page_count: slugs.size,
        pages: [...slugs].slice(0, 5),
      });
    }
  }
  duplicateFaqs.sort((a, b) => b.page_count - a.page_count);

  // 3d. Top 20 most similar page pairs by title similarity
  const titlePairs = [];
  for (let i = 0; i < allPages.length; i++) {
    for (let j = i + 1; j < allPages.length; j++) {
      const sim = jaccardSimilarity(
        allPages[i].seo_title || "",
        allPages[j].seo_title || ""
      );
      if (sim > 0.5) {
        titlePairs.push({
          slugA: allPages[i].slug || `page-${i}`,
          slugB: allPages[j].slug || `page-${j}`,
          similarity: Math.round(sim * 1000) / 1000,
        });
      }
    }
  }
  titlePairs.sort((a, b) => b.similarity - a.similarity);
  const topTitlePairs = titlePairs.slice(0, 20);

  // ---------------------------------------------------------------------------
  // 4. Compute risk scores
  // ---------------------------------------------------------------------------
  const maxTitleSim = topTitlePairs.length > 0 ? topTitlePairs[0].similarity : 0;
  const totalSentences = sentenceIndex.size;
  const sharedSentenceCount = duplicateSentences.length;
  const pctSharedSentences = totalSentences > 0 ? sharedSentenceCount / totalSentences : 0;
  const totalFaqQuestions = faqIndex.size;
  const sharedFaqCount = duplicateFaqs.length;
  const faqOverlap = totalFaqQuestions > 0 ? sharedFaqCount / totalFaqQuestions : 0;

  const riskScore =
    0.4 * maxTitleSim + 0.3 * pctSharedSentences + 0.3 * faqOverlap;

  // ---------------------------------------------------------------------------
  // 5. Load previous report for delta tracking
  // ---------------------------------------------------------------------------
  const lastReportPath = path.join(ROOT, "artifacts", "weekly_uniqueness_last.json");
  const lastReport = loadJson(lastReportPath, null);
  let delta = null;
  if (lastReport && lastReport.metrics) {
    delta = {
      risk_score_change: riskScore - (lastReport.metrics.risk_score || 0),
      pages_change: allPages.length - (lastReport.total_pages || 0),
      shared_sentences_change:
        sharedSentenceCount - (lastReport.metrics.shared_sentence_count || 0),
      shared_faqs_change:
        sharedFaqCount - (lastReport.metrics.shared_faq_count || 0),
    };
  }

  // ---------------------------------------------------------------------------
  // Build report object
  // ---------------------------------------------------------------------------
  const report = {
    generated_at: new Date().toISOString(),
    total_pages: allPages.length,
    published_pages: publishedPages.length,
    cluster_pages: clusterPages.length,
    metrics: {
      unique_titles: uniqueTitles.size,
      unique_h1s: uniqueH1s.size,
      unique_intro_prefixes: uniqueIntroPrefixes.size,
      total_sentences: totalSentences,
      shared_sentence_count: sharedSentenceCount,
      pct_shared_sentences: Math.round(pctSharedSentences * 1000) / 1000,
      total_faq_questions: totalFaqQuestions,
      shared_faq_count: sharedFaqCount,
      faq_overlap: Math.round(faqOverlap * 1000) / 1000,
      max_title_similarity: maxTitleSim,
      risk_score: Math.round(riskScore * 1000) / 1000,
    },
    delta,
    top_similar_title_pairs: topTitlePairs,
    top_duplicate_sentences: duplicateSentences.slice(0, 20),
    top_duplicate_faqs: duplicateFaqs.slice(0, 20),
  };

  // ---------------------------------------------------------------------------
  // 6. Write reports
  // ---------------------------------------------------------------------------
  const artifactsDir = path.join(ROOT, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });

  // JSON report
  const jsonPath = path.join(artifactsDir, "weekly_uniqueness_report.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Markdown report
  const mdPath = path.join(artifactsDir, "weekly_uniqueness_report.md");
  const md = buildMarkdown(report);
  fs.writeFileSync(mdPath, md);

  // 7. Copy to last report for next week's delta
  fs.writeFileSync(lastReportPath, JSON.stringify(report, null, 2));

  // 8. Generate action queue
  const actionQueue = buildActionQueue(report);
  fs.writeFileSync(
    path.join(artifactsDir, "action_queue.json"),
    JSON.stringify(actionQueue, null, 2)
  );

  // Console output
  console.log("Results:");
  console.log(`  Risk Score: ${report.metrics.risk_score}`);
  console.log(`  Unique Titles: ${uniqueTitles.size}/${allPages.length}`);
  console.log(`  Unique H1s: ${uniqueH1s.size}/${allPages.length}`);
  console.log(`  Unique Intro Prefixes: ${uniqueIntroPrefixes.size}/${allPages.length}`);
  console.log(`  Shared Sentences: ${sharedSentenceCount}/${totalSentences}`);
  console.log(`  Shared FAQ Questions: ${sharedFaqCount}/${totalFaqQuestions}`);
  console.log(`  Max Title Similarity: ${maxTitleSim}`);
  if (delta) {
    console.log(`\nDelta from last report:`);
    console.log(`  Risk Score Change: ${delta.risk_score_change > 0 ? "+" : ""}${Math.round(delta.risk_score_change * 1000) / 1000}`);
    console.log(`  Pages Change: ${delta.pages_change > 0 ? "+" : ""}${delta.pages_change}`);
  }
  console.log(`\nOutput:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);
  console.log(`  ${path.join(artifactsDir, "action_queue.json")}`);
}

// ---------------------------------------------------------------------------
// Markdown builder
// ---------------------------------------------------------------------------
function buildMarkdown(report) {
  const m = report.metrics;
  const lines = [
    "# Weekly Uniqueness Report",
    "",
    `**Generated:** ${report.generated_at}`,
    `**Total Pages:** ${report.total_pages} (${report.published_pages} published, ${report.cluster_pages} cluster)`,
    "",
    "## Risk Score",
    "",
    `**Overall Risk:** ${m.risk_score}`,
    "",
    "| Component | Weight | Value |",
    "|-----------|--------|-------|",
    `| Max Title Similarity | 0.4 | ${m.max_title_similarity} |`,
    `| % Shared Sentences | 0.3 | ${m.pct_shared_sentences} |`,
    `| FAQ Overlap | 0.3 | ${m.faq_overlap} |`,
    "",
  ];

  if (report.delta) {
    const d = report.delta;
    lines.push("## Delta from Last Report");
    lines.push("");
    lines.push("| Metric | Change |");
    lines.push("|--------|--------|");
    lines.push(`| Risk Score | ${d.risk_score_change > 0 ? "+" : ""}${Math.round(d.risk_score_change * 1000) / 1000} |`);
    lines.push(`| Pages | ${d.pages_change > 0 ? "+" : ""}${d.pages_change} |`);
    lines.push(`| Shared Sentences | ${d.shared_sentences_change > 0 ? "+" : ""}${d.shared_sentences_change} |`);
    lines.push(`| Shared FAQs | ${d.shared_faqs_change > 0 ? "+" : ""}${d.shared_faqs_change} |`);
    lines.push("");
  }

  lines.push("## Uniqueness Metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Unique SEO Titles | ${m.unique_titles} / ${report.total_pages} |`);
  lines.push(`| Unique H1s | ${m.unique_h1s} / ${report.total_pages} |`);
  lines.push(`| Unique Intro Prefixes (100 chars) | ${m.unique_intro_prefixes} / ${report.total_pages} |`);
  lines.push(`| Total Unique Sentences | ${m.total_sentences} |`);
  lines.push(`| Shared Sentences (multi-page) | ${m.shared_sentence_count} |`);
  lines.push(`| Total Unique FAQ Questions | ${m.total_faq_questions} |`);
  lines.push(`| Shared FAQ Questions | ${m.shared_faq_count} |`);
  lines.push("");

  if (report.top_similar_title_pairs.length > 0) {
    lines.push("## Top Similar Title Pairs");
    lines.push("");
    lines.push("| Page A | Page B | Similarity |");
    lines.push("|--------|--------|------------|");
    for (const p of report.top_similar_title_pairs) {
      lines.push(`| ${p.slugA} | ${p.slugB} | ${(p.similarity * 100).toFixed(1)}% |`);
    }
    lines.push("");
  }

  if (report.top_duplicate_sentences.length > 0) {
    lines.push("## Top Duplicate Sentences");
    lines.push("");
    for (const s of report.top_duplicate_sentences.slice(0, 10)) {
      lines.push(`- **${s.page_count} pages:** "${s.sentence}..."`);
    }
    lines.push("");
  }

  if (report.top_duplicate_faqs.length > 0) {
    lines.push("## Top Duplicate FAQ Questions");
    lines.push("");
    for (const f of report.top_duplicate_faqs.slice(0, 10)) {
      lines.push(`- **${f.page_count} pages:** "${f.question}..."`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Action queue builder
// ---------------------------------------------------------------------------
function buildActionQueue(report) {
  const actions = [];
  const m = report.metrics;

  // High risk score
  if (m.risk_score > 0.5) {
    actions.push({
      priority: "high",
      action: "review_content_uniqueness",
      description: `Risk score ${m.risk_score} exceeds 0.5 threshold. Review and diversify page content templates.`,
      affected_pages: [],
    });
  }

  // Title duplicates
  if (m.unique_titles < report.total_pages) {
    const dupeCount = report.total_pages - m.unique_titles;
    actions.push({
      priority: "high",
      action: "fix_duplicate_titles",
      description: `${dupeCount} duplicate SEO titles found. Each page must have a unique title tag.`,
      affected_pages: [],
    });
  }

  // H1 duplicates
  if (m.unique_h1s < report.total_pages) {
    const dupeCount = report.total_pages - m.unique_h1s;
    actions.push({
      priority: "high",
      action: "fix_duplicate_h1s",
      description: `${dupeCount} duplicate H1 headings found. Each page must have a unique H1.`,
      affected_pages: [],
    });
  }

  // High sentence overlap
  if (m.pct_shared_sentences > 0.2) {
    actions.push({
      priority: "medium",
      action: "reduce_shared_sentences",
      description: `${(m.pct_shared_sentences * 100).toFixed(1)}% of sentences appear on multiple pages. Rewrite shared copy to add lane-specific detail.`,
      affected_pages: report.top_duplicate_sentences.slice(0, 5).flatMap((s) => s.pages),
    });
  }

  // FAQ overlap
  if (m.faq_overlap > 0.15) {
    actions.push({
      priority: "medium",
      action: "diversify_faq_questions",
      description: `${(m.faq_overlap * 100).toFixed(1)}% FAQ overlap detected. Rotate questions per archetype and lane.`,
      affected_pages: report.top_duplicate_faqs.slice(0, 5).flatMap((f) => f.pages),
    });
  }

  // High title similarity
  if (m.max_title_similarity > 0.8) {
    actions.push({
      priority: "medium",
      action: "differentiate_titles",
      description: `Highest title similarity is ${(m.max_title_similarity * 100).toFixed(1)}%. Add distinguishing keywords per page.`,
      affected_pages: report.top_similar_title_pairs.slice(0, 3).flatMap((p) => [p.slugA, p.slugB]),
    });
  }

  // Intro prefix duplicates
  if (m.unique_intro_prefixes < report.total_pages * 0.9) {
    actions.push({
      priority: "low",
      action: "vary_intro_openings",
      description: `Only ${m.unique_intro_prefixes}/${report.total_pages} unique intro openings. Vary the first sentence per archetype.`,
      affected_pages: [],
    });
  }

  return {
    generated_at: new Date().toISOString(),
    total_actions: actions.length,
    actions,
  };
}

main();
