import { num } from "@/lib/lane-engine";

// Parse GSC CSV export (tab or comma separated)
// Expected columns: query, page, clicks, impressions, ctr, position
export function parseGscCsv(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].toLowerCase().split(sep).map((h) => h.trim());
  const qi = headers.indexOf("query") >= 0 ? headers.indexOf("query") : 0;
  const pi = headers.indexOf("page") >= 0 ? headers.indexOf("page") : headers.indexOf("url") >= 0 ? headers.indexOf("url") : 1;
  const ci = headers.indexOf("clicks") >= 0 ? headers.indexOf("clicks") : 2;
  const ii = headers.indexOf("impressions") >= 0 ? headers.indexOf("impressions") : 3;
  const ctri = headers.indexOf("ctr") >= 0 ? headers.indexOf("ctr") : 4;
  const posi = headers.indexOf("position") >= 0 ? headers.indexOf("position") : 5;

  return lines.slice(1).map((line) => {
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    return {
      query: cols[qi] || "",
      page: cols[pi] || "",
      clicks: num(cols[ci], 0),
      impressions: num(cols[ii], 0),
      ctr: num(String(cols[ctri] || "").replace("%", ""), 0),
      position: num(cols[posi], 0)
    };
  }).filter((r) => r.query);
}

// Parse GA4 CSV export
// Expected columns: page_path (or landing_page), sessions, conversions, conversion_rate
export function parseGa4Csv(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].toLowerCase().split(sep).map((h) => h.trim());
  const pathIdx = headers.findIndex((h) => h.includes("page") || h.includes("path") || h.includes("landing"));
  const sessIdx = headers.findIndex((h) => h.includes("session"));
  const convIdx = headers.findIndex((h) => h.includes("conversion") && !h.includes("rate"));
  const rateIdx = headers.findIndex((h) => h.includes("rate"));

  return lines.slice(1).map((line) => {
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    return {
      page_path: cols[pathIdx >= 0 ? pathIdx : 0] || "",
      sessions: num(cols[sessIdx >= 0 ? sessIdx : 1], 0),
      conversions: num(cols[convIdx >= 0 ? convIdx : 2], 0),
      conversion_rate: num(String(cols[rateIdx >= 0 ? rateIdx : 3] || "").replace("%", ""), 0)
    };
  }).filter((r) => r.page_path);
}

// Fuzzy match GSC queries to lane pages by slug/origin/destination tokens
export function mapQueriesToLanes(gscData, pages) {
  const mapped = new Map(); // slug → { queries, totalClicks, totalImpressions, avgPosition }

  pages.forEach((p) => {
    if (!p?.slug) return;
    const tokens = [
      p.slug.replace(/-/g, " "),
      p.lane?.origin?.toLowerCase(),
      p.lane?.destination?.toLowerCase(),
      p.lane?.mode?.toLowerCase(),
      p.h1?.toLowerCase()
    ].filter(Boolean);

    const matching = gscData.filter((row) => {
      const q = row.query.toLowerCase();
      return tokens.some((t) => q.includes(t) || t.includes(q));
    });

    if (matching.length) {
      const totalClicks = matching.reduce((s, r) => s + r.clicks, 0);
      const totalImpressions = matching.reduce((s, r) => s + r.impressions, 0);
      const avgPosition = matching.reduce((s, r) => s + r.position, 0) / matching.length;
      mapped.set(p.slug, { queries: matching, totalClicks, totalImpressions, avgPosition: Math.round(avgPosition * 10) / 10 });
    }
  });

  return mapped;
}

// Generate copy upgrade suggestions for a lane based on its performance data
export function generateCopyUpgrades(page, perfData) {
  const suggestions = [];
  if (!perfData) {
    suggestions.push({ priority: "info", text: "No search performance data matched to this lane yet." });
    return suggestions;
  }

  const { totalClicks, totalImpressions, avgPosition, queries } = perfData;
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  if (avgPosition > 20) {
    suggestions.push({ priority: "high", text: `Avg position ${avgPosition}. Strengthen topical depth: expand the intro with more lane-specific detail and add 2-3 more FAQ entries.` });
  } else if (avgPosition > 10) {
    suggestions.push({ priority: "high", text: `Position ${avgPosition} — close to page 1. Add a direct-answer snippet matching the top query "${queries[0]?.query}" and tighten H1-to-intent alignment.` });
  } else if (avgPosition <= 10 && ctr < 3) {
    suggestions.push({ priority: "high", text: `Ranking well (pos ${avgPosition}) but CTR only ${ctr.toFixed(1)}%. Rewrite the meta description to be more action-oriented and add structured data for rich snippets.` });
  }

  if (totalImpressions > 100 && totalClicks < 5) {
    suggestions.push({ priority: "medium", text: `High impressions (${totalImpressions}) but very few clicks. The title tag may not match searcher intent — test a more specific, benefit-driven title.` });
  }

  if (totalClicks > 20 && avgPosition < 5) {
    suggestions.push({ priority: "low", text: `Strong position and clicks. Focus on conversion optimization: test CTA copy variants and add social proof near the quote button.` });
  }

  // Check for query gaps
  const topQueries = queries.slice(0, 3).map((q) => q.query);
  const h1Lower = (page.h1 || "").toLowerCase();
  const missingTerms = topQueries.filter((q) => !h1Lower.includes(q.split(" ")[0]));
  if (missingTerms.length) {
    suggestions.push({ priority: "medium", text: `Top queries "${missingTerms.join('", "')}" aren't reflected in H1. Consider adjusting the heading to better match search intent.` });
  }

  if (!suggestions.length) {
    suggestions.push({ priority: "low", text: "Performance looks solid. Monitor and test incremental improvements." });
  }

  return suggestions;
}

// Parse quote feedback CSV
// Required: origin, destination, mode, quote_amount
// Optional: pallet_count, weight_lbs, freight_class
export function parseQuoteCsv(text) {
  const lines = String(text || "").split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].toLowerCase().split(sep).map((h) => h.trim());
  const oi = headers.findIndex((h) => h.includes("origin"));
  const di = headers.findIndex((h) => h.includes("destination") || h.includes("dest"));
  const mi = headers.findIndex((h) => h.includes("mode"));
  const qi = headers.findIndex((h) => h.includes("quote") || h.includes("amount") || h.includes("rate"));

  if (oi < 0 || di < 0 || qi < 0) return [];

  return lines.slice(1).map((line) => {
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    return {
      origin: cols[oi] || "",
      destination: cols[di] || "",
      mode: mi >= 0 ? cols[mi] || "LTL" : "LTL",
      quote_amount: num(String(cols[qi] || "").replace(/[$,]/g, ""), 0)
    };
  }).filter((r) => r.origin && r.destination && r.quote_amount > 0);
}

// Aggregate quote rows into per-lane stats keyed by normalized lane key
export function aggregateQuotes(quoteRows) {
  const map = new Map(); // laneKey → { quote_count, min_quote, max_quote, median_quote, last_seen_date }
  quoteRows.forEach((r) => {
    const key = `${r.origin}|${r.destination}|${r.mode}`.toLowerCase().replace(/[^a-z0-9|]+/g, " ").replace(/\s+/g, " ").trim();
    if (!map.has(key)) map.set(key, { quotes: [] });
    map.get(key).quotes.push(r.quote_amount);
  });
  const result = new Map();
  for (const [key, v] of map) {
    const sorted = v.quotes.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    result.set(key, {
      quote_count: sorted.length,
      min_quote: sorted[0],
      max_quote: sorted[sorted.length - 1],
      median_quote: sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid],
      last_seen_date: new Date().toISOString().slice(0, 10)
    });
  }
  return result;
}

// Rank pages by live performance data, strategic weights, or blended
export function rankByMode(pages, mode, gscMap, ga4Data) {
  const scored = pages.map((p) => {
    const perf = gscMap?.get(p.slug);
    const ga4Match = (ga4Data || []).find((r) => r.page_path.includes(p.slug));
    const stratScore = num(p.priority?.score, 0);
    const perfScore = (perf?.totalClicks || 0) * 2 + (perf?.totalImpressions || 0) * 0.01 + (ga4Match?.conversions || 0) * 10;
    let finalScore;
    if (mode === "performance") finalScore = perfScore;
    else if (mode === "strategic") finalScore = stratScore;
    else finalScore = stratScore * 0.5 + perfScore * 0.5; // blended
    return { ...p, _rankScore: finalScore, _perfData: perf || null };
  });
  scored.sort((a, b) => b._rankScore - a._rankScore);
  scored.forEach((p, i) => { p.priority = { ...p.priority, rank: i + 1 }; });
  return scored;
}
