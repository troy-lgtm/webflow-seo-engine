/**
 * AI Search Optimizer
 * Optimizes lane pages for AI search engines (ChatGPT, Perplexity, Gemini, AI Overviews).
 * Ensures pages are easy to extract, quote, and surface in AI-generated answers.
 */

// ── Helpers ────────────────────────────────────────────────────────

function countWords(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function countSentences(text) {
  if (!text) return 0;
  return text.split(/[.!?]+/).filter((s) => s.trim().length > 5).length;
}

function avgSentenceLen(text) {
  const sents = countSentences(text);
  return sents > 0 ? Math.round(countWords(text) / sents) : 0;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function score(val, max) {
  return clamp(Math.round(val), 0, max);
}

// ── Query Match Patterns ───────────────────────────────────────────

export function buildQueryMatchPatterns(page) {
  const o = page.origin_city || page.origin || "";
  const d = page.destination_city || page.destination || "";
  const m = (page.mode || "LTL").toUpperCase();
  const oFull = page.origin_state ? `${o}, ${page.origin_state}` : o;
  const dFull = page.destination_state ? `${d}, ${page.destination_state}` : d;

  return [
    `${o} to ${d} freight`,
    `${o} to ${d} ${m} rates`,
    `${o} to ${d} shipping cost`,
    `how much to ship from ${o} to ${d}`,
    `transit time ${o} to ${d}`,
    `${m} freight ${o} to ${d}`,
    `${oFull} to ${dFull} freight quotes`,
    `ship freight from ${o} to ${d}`,
    `${o} ${d} trucking rates`,
    `cost to ship ${m} from ${o} to ${d}`,
  ];
}

// ── Snippet Candidates ─────────────────────────────────────────────

export function generateAiSnippetCandidates(page) {
  const o = page.origin_city || page.origin || "Origin";
  const d = page.destination_city || page.destination || "Destination";
  const m = (page.mode || "LTL").toUpperCase();
  const ls = page.lane_stats || {};
  const snippets = [];

  // Quick answer snippet
  if (page.quick_answer) {
    snippets.push({
      type: "quick_answer",
      text: page.quick_answer,
      query_match: `${o} to ${d} freight`,
      extractability_score: 0.9,
    });
  }

  // Transit snippet
  if (ls.transit_days_range) {
    const text = `Typical ${m} transit from ${o} to ${d} is ${ls.transit_days_range} business days, covering approximately ${ls.distance_miles || "N/A"} miles.`;
    snippets.push({
      type: "transit",
      text,
      query_match: `transit time ${o} to ${d}`,
      extractability_score: 0.85,
    });
  }

  // Cost snippet
  if (ls.rate_range_usd) {
    const text = `${m} rates from ${o} to ${d} typically range from ${ls.rate_range_usd}. Actual rates depend on freight class, weight, and seasonal demand.`;
    snippets.push({
      type: "cost",
      text,
      query_match: `${o} to ${d} shipping cost`,
      extractability_score: 0.85,
    });
  }

  // How-to snippet
  snippets.push({
    type: "how_to_quote",
    text: `To get an exact ${m} freight quote from ${o} to ${d}, enter your shipment details (weight, dimensions, freight class) into WARP's instant quoting tool. Quotes are generated in seconds with real-time carrier rates.`,
    query_match: `how to get freight quote ${o} to ${d}`,
    extractability_score: 0.8,
  });

  // Cost drivers snippet
  if (page.cost_drivers) {
    snippets.push({
      type: "cost_drivers",
      text: typeof page.cost_drivers === "string" ? page.cost_drivers : JSON.stringify(page.cost_drivers),
      query_match: `what affects ${m} cost ${o} to ${d}`,
      extractability_score: 0.75,
    });
  }

  // FAQ snippets
  if (Array.isArray(page.faq)) {
    for (const f of page.faq.slice(0, 3)) {
      snippets.push({
        type: "faq",
        text: `Q: ${f.q}\nA: ${f.a}`,
        query_match: f.q,
        extractability_score: 0.7,
      });
    }
  }

  return snippets;
}

// ── AI Extractability Score ────────────────────────────────────────

export function scoreAiExtractability(page) {
  const breakdown = {};
  let total = 0;

  // 1. Quick answer presence (0-15)
  const hasQA = !!page.quick_answer && countWords(page.quick_answer) >= 10;
  breakdown.has_quick_answer = score(hasQA ? 15 : (page.intro && countWords(page.intro) > 20 ? 8 : 0), 15);
  total += breakdown.has_quick_answer;

  // 2. Answer-first structure (0-10)
  const introLen = countWords(page.intro || "");
  const qaLen = countWords(page.quick_answer || "");
  const answerFirst = (qaLen > 0 || introLen < 80) ? 10 : (introLen < 120 ? 6 : 3);
  breakdown.answer_first_structure = score(answerFirst, 10);
  total += breakdown.answer_first_structure;

  // 3. FAQ quality (0-15)
  const faqCount = Array.isArray(page.faq) ? page.faq.length : 0;
  const faqWithDirectAnswers = Array.isArray(page.faq)
    ? page.faq.filter((f) => f.a && avgSentenceLen(f.a) <= 20).length
    : 0;
  const faqScore = Math.min(15, (faqCount >= 5 ? 8 : faqCount * 1.5) + faqWithDirectAnswers * 1.5);
  breakdown.faq_quality = score(faqScore, 15);
  total += breakdown.faq_quality;

  // 4. Paragraph brevity (0-10)
  const allText = [page.intro, page.quick_answer, page.problem, page.solution, page.lane_insight, page.cost_drivers]
    .filter(Boolean)
    .join(" ");
  const avgSL = avgSentenceLen(allText);
  const brevityScore = avgSL <= 15 ? 10 : avgSL <= 20 ? 8 : avgSL <= 25 ? 5 : 2;
  breakdown.paragraph_brevity = score(brevityScore, 10);
  total += breakdown.paragraph_brevity;

  // 5. Query matching (0-15)
  const queries = buildQueryMatchPatterns(page);
  const textLower = allText.toLowerCase();
  const matchCount = queries.filter((q) => {
    const words = q.toLowerCase().split(/\s+/);
    return words.filter((w) => w.length > 3 && textLower.includes(w)).length >= words.length * 0.5;
  }).length;
  breakdown.query_matching = score(Math.min(15, matchCount * 2), 15);
  total += breakdown.query_matching;

  // 6. Schema richness (0-10)
  const schemas = Array.isArray(page.schema_jsonld) ? page.schema_jsonld : [];
  const schemaTypes = schemas.map((s) => s["@type"]).filter(Boolean);
  const hasTypes = ["FAQPage", "BreadcrumbList", "WebPage", "Article"].filter((t) =>
    schemaTypes.includes(t)
  ).length;
  breakdown.schema_richness = score(hasTypes * 2.5, 10);
  total += breakdown.schema_richness;

  // 7. Numeric specificity (0-10)
  const ls = page.lane_stats || {};
  let numScore = 0;
  if (ls.distance_miles) numScore += 3;
  if (ls.transit_days_range) numScore += 3;
  if (ls.rate_range_usd) numScore += 3;
  if (ls.equipment) numScore += 1;
  breakdown.numeric_specificity = score(numScore, 10);
  total += breakdown.numeric_specificity;

  // 8. Commercial intent handling (0-10)
  const ctaOk = page.cta_label && /quote|rate|price/i.test(page.cta_label);
  const ctaUrlOk = page.cta_url && !/localhost/i.test(page.cta_url);
  breakdown.commercial_intent_handling = score((ctaOk ? 6 : 0) + (ctaUrlOk ? 4 : 0), 10);
  total += breakdown.commercial_intent_handling;

  // 9. Structured data coverage (0-5)
  let structScore = 0;
  if (page.h1) structScore += 1;
  if (page.seo_title) structScore += 1;
  if (page.meta_description) structScore += 1;
  if (page.slug) structScore += 1;
  if (ls.rate_range_usd && ls.transit_days_range) structScore += 1;
  breakdown.structured_data_coverage = score(structScore, 5);
  total += breakdown.structured_data_coverage;

  // Grade
  const grade = total >= 85 ? "A" : total >= 70 ? "B" : total >= 55 ? "C" : total >= 40 ? "D" : "F";

  const snippets = generateAiSnippetCandidates(page);

  return { total_score: total, breakdown, snippets, grade };
}

// ── Schema Block Generation ────────────────────────────────────────

export function generateSchemaBlocks(page) {
  const blocks = [];
  const o = page.origin_city || page.origin || "";
  const d = page.destination_city || page.destination || "";
  const oState = page.origin_state || "";
  const dState = page.destination_state || "";
  const m = (page.mode || "LTL").toUpperCase();
  const slug = page.slug || `${o.toLowerCase().replace(/\s+/g, "-")}-to-${d.toLowerCase().replace(/\s+/g, "-")}`;
  const baseUrl = "https://www.wearewarp.com";

  // FAQPage
  if (Array.isArray(page.faq) && page.faq.length > 0) {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: page.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: f.a,
        },
      })),
    });
  }

  // BreadcrumbList
  blocks.push({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: baseUrl,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Lanes",
        item: `${baseUrl}/lanes`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: `${o}${oState ? `, ${oState}` : ""} to ${d}${dState ? `, ${dState}` : ""}`,
        item: `${baseUrl}/lanes/${slug}`,
      },
    ],
  });

  // WebPage
  blocks.push({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.seo_title || `${o} to ${d} ${m} Freight Quotes`,
    description: page.meta_description || "",
    url: `${baseUrl}/lanes/${slug}`,
    datePublished: page.published_at_iso || new Date().toISOString(),
    publisher: {
      "@type": "Organization",
      name: "WARP",
      url: baseUrl,
    },
  });

  // Article (if substantial content)
  const contentLen = countWords([page.intro, page.quick_answer, page.lane_insight, page.cost_drivers].filter(Boolean).join(" "));
  if (contentLen >= 200) {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: page.h1 || page.seo_title || `${o} to ${d} ${m} Freight`,
      description: page.meta_description || "",
      author: { "@type": "Organization", name: "WARP" },
      publisher: { "@type": "Organization", name: "WARP", url: baseUrl },
      datePublished: page.published_at_iso || new Date().toISOString(),
    });
  }

  return blocks;
}
