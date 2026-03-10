// Create publish batches from a set of pages
export function createPublishBatch(pages, batchSize = 250) {
  if (!pages?.length) return [];
  const batches = [];
  for (let i = 0; i < pages.length; i += batchSize) {
    const slice = pages.slice(i, i + batchSize);
    batches.push({
      id: `batch-${batches.length + 1}`,
      index: batches.length,
      pages: slice,
      summary: batchSummary(slice)
    });
  }
  return batches;
}

function batchSummary(pages) {
  const modes = {};
  const segments = {};
  const laneSets = {};

  pages.forEach((p) => {
    const mode = p.lane?.mode || "Unknown";
    const seg = p.target_segment || "unknown";
    const ls = p._lane_set || "unspecified";
    modes[mode] = (modes[mode] || 0) + 1;
    segments[seg] = (segments[seg] || 0) + 1;
    laneSets[ls] = (laneSets[ls] || 0) + 1;
  });

  return {
    page_count: pages.length,
    mode_distribution: modes,
    segment_distribution: segments,
    lane_set_distribution: laneSets
  };
}

// Batch-level quality check
export function batchQualityScore(batch, allPages) {
  const pages = batch.pages;
  if (!pages?.length) return { score: 0, issues: ["Empty batch"], safe: false };

  const issues = [];
  let deductions = 0;

  // Check title uniqueness within batch
  const titles = pages.map((p) => p.seo_title?.toLowerCase() || "");
  const uniqueTitles = new Set(titles);
  if (uniqueTitles.size < titles.length * 0.9) {
    issues.push(`${titles.length - uniqueTitles.size} duplicate titles in batch`);
    deductions += 15;
  }

  // Check intro token diversity
  const introTokenSets = pages.map((p) => {
    const tokens = (p.intro || "").toLowerCase().split(/\s+/).filter((t) => t.length > 3);
    return new Set(tokens);
  });
  let highSimilarityIntros = 0;
  for (let i = 0; i < introTokenSets.length; i++) {
    for (let j = i + 1; j < Math.min(introTokenSets.length, i + 10); j++) {
      const a = introTokenSets[i];
      const b = introTokenSets[j];
      const overlap = [...a].filter((t) => b.has(t)).length;
      const sim = overlap / Math.max(a.size, 1);
      if (sim > 0.7) highSimilarityIntros++;
    }
  }
  if (highSimilarityIntros > pages.length * 0.3) {
    issues.push(`${highSimilarityIntros} intro pairs with >70% token overlap`);
    deductions += 20;
  }

  // Check FAQ diversity
  const faqQuestions = new Set();
  let duplicateFaqs = 0;
  pages.forEach((p) => {
    (p.faq || []).forEach((f) => {
      const norm = f.q?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (norm && faqQuestions.has(norm)) duplicateFaqs++;
      faqQuestions.add(norm);
    });
  });
  if (duplicateFaqs > pages.length * 0.5) {
    issues.push(`${duplicateFaqs} duplicate FAQ questions across batch`);
    deductions += 15;
  }

  // Check transit range diversity
  const transitStrings = pages.map((p) => {
    const r = p.lane_stats?.estimated_transit_days_range;
    return r ? `${r.min}-${r.max}` : "";
  }).filter(Boolean);
  const uniqueTransit = new Set(transitStrings);
  if (uniqueTransit.size < Math.min(3, transitStrings.length)) {
    issues.push("Most pages share identical transit ranges");
    deductions += 10;
  }

  // Check rate range diversity
  const rateStrings = pages.map((p) => {
    const r = p.lane_stats?.estimated_rate_range_usd;
    return r ? `${r.low}-${r.high}` : "";
  }).filter(Boolean);
  const uniqueRates = new Set(rateStrings);
  if (uniqueRates.size < Math.min(5, rateStrings.length)) {
    issues.push("Most pages share identical rate ranges");
    deductions += 10;
  }

  // Check meta description token minimums
  const shortMetas = pages.filter((p) => {
    const tokens = new Set((p.meta_description || "").toLowerCase().split(/\s+/).filter((t) => t.length > 3));
    return tokens.size < 8;
  });
  if (shortMetas.length > pages.length * 0.2) {
    issues.push(`${shortMetas.length} pages with thin meta descriptions`);
    deductions += 10;
  }

  const score = Math.max(0, 100 - deductions);
  return { score, issues, safe: score >= 60 };
}
