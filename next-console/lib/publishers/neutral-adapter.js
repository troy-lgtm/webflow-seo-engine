/**
 * neutral-adapter.js — CMS-Neutral Publisher Adapter
 *
 * Produces structured output suitable for consumption by:
 *   - A Next.js static site generator (getStaticProps / generateStaticParams)
 *   - A headless CMS (Contentful, Sanity, Strapi, etc.)
 *   - A structured JSON artifact for review/preview
 *   - Any future rendering target that is NOT Webflow
 *
 * ADAPTER RESPONSIBILITY:
 *   - Transform the publish contract into a clean, structured page payload
 *   - Separate HTML content from metadata and data
 *   - Produce JSON output that a frontend framework can directly consume
 *   - Strip Webflow-specific concerns (template flags, CSS hacks, etc.)
 *
 * OUTPUT STRUCTURE:
 *   The neutral adapter produces a page payload with:
 *   - metadata: SEO, Open Graph, canonical, structured data (parsed JSON-LD)
 *   - hero: headline, subhead, KPIs, CTAs
 *   - sections: ordered array of content sections with type, heading, and content
 *   - data: raw lane stats, network proof, comparison points
 *   - quality: quality gate report
 *
 * @module publishers/neutral-adapter
 */

// ── Adapter Interface ────────────────────────────────────────────────

export const ADAPTER_ID = "neutral";
export const ADAPTER_NAME = "CMS-Neutral / Next.js";
export const ADAPTER_VERSION = "1.0.0";

// ── Section Parser ───────────────────────────────────────────────────

/**
 * Extract structured sections from the primary content HTML.
 * The primary_content_html (faq-schema embed) contains multiple H2 sections.
 * This parser splits them into an ordered section array.
 *
 * @param {string} html - Primary content HTML
 * @returns {Array<{ id: string, heading: string, html: string }>}
 */
function extractSections(html) {
  if (!html) return [];

  const sections = [];
  // Split on H2 headings to find section boundaries
  const h2Pattern = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let lastIndex = 0;
  let match;
  const headings = [];

  while ((match = h2Pattern.exec(html)) !== null) {
    headings.push({
      heading: match[1].replace(/<[^>]+>/g, "").trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].end;
    const end = i + 1 < headings.length ? headings[i + 1].start : html.length;
    const content = html.slice(start, end).trim();

    sections.push({
      id: slugify(headings[i].heading),
      heading: headings[i].heading,
      html: content,
    });
  }

  // If there's content before the first H2, include it as a preamble
  if (headings.length > 0 && headings[0].start > 0) {
    const preamble = html.slice(0, headings[0].start).trim();
    if (preamble.length > 50) {
      sections.unshift({
        id: "preamble",
        heading: "",
        html: preamble,
      });
    }
  }

  return sections;
}

/**
 * Extract JSON-LD objects from structured data HTML.
 * @param {string} html - HTML containing <script type="application/ld+json"> blocks
 * @returns {Array<object>} Parsed JSON-LD objects
 */
function extractJsonLd(html) {
  if (!html) return [];

  const schemas = [];
  const scriptPattern = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptPattern.exec(html)) !== null) {
    try {
      schemas.push(JSON.parse(match[1].trim()));
    } catch {
      // Skip malformed JSON-LD
    }
  }

  return schemas;
}

function slugify(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
}

// ── Comparison Parser ────────────────────────────────────────────────

/**
 * Parse comparison text into structured data.
 * @param {string} traditional - Traditional comparison text
 * @param {string} warp - WARP comparison text
 * @returns {Array<{ metric: string, traditional: string, warp: string }>}
 */
function parseComparison(traditional, warp) {
  const tradLines = (traditional || "").split("\n").filter(Boolean);
  const warpLines = (warp || "").split("\n").filter(Boolean);

  const points = [];
  for (let i = 0; i < tradLines.length; i++) {
    const tradParts = tradLines[i].split(": ");
    const warpParts = (warpLines[i] || "").split(": ");
    const metric = tradParts[0] || warpParts[0] || `Point ${i + 1}`;
    points.push({
      metric,
      traditional: tradParts.slice(1).join(": ") || "",
      warp: warpParts.slice(1).join(": ") || "",
    });
  }

  return points;
}

// ── Adapter Functions ────────────────────────────────────────────────

/**
 * Convert a publish contract to a CMS-neutral page payload.
 *
 * This is the primary adapter function. It produces structured output
 * that any frontend framework or headless CMS can consume directly.
 *
 * @param {object} contract - CMS-neutral publish contract from buildPublishContract()
 * @returns {object} Structured page payload
 */
export function toTargetFields(contract) {
  if (!contract) throw new Error("neutral-adapter: contract is required");

  const pd = contract.canonical || {};
  const ls = pd.lane_stats || {};
  const np = pd.network_proof || {};

  return {
    // ── Adapter metadata ──────────────────────────────────────────
    _adapter: ADAPTER_ID,
    _adapter_version: ADAPTER_VERSION,
    _contract_version: contract._contract_version,
    _generated_at: new Date().toISOString(),

    // ── Page identity ─────────────────────────────────────────────
    slug: contract.identity?.slug || "",
    path: contract.seo?.canonical_path || "",

    // ── Route data ────────────────────────────────────────────────
    route: {
      origin: {
        city: contract.identity?.origin_city || "",
        full: contract.identity?.origin || "",
      },
      destination: {
        city: contract.identity?.destination_city || "",
        full: contract.identity?.destination || "",
      },
      mode: contract.identity?.mode || "LTL",
      segment: contract.identity?.segment || "smb",
      badge: contract.flags?.badge || "regional",
    },

    // ── SEO metadata ──────────────────────────────────────────────
    metadata: {
      title: contract.seo?.title || "",
      description: contract.seo?.meta_description || "",
      canonical: contract.seo?.canonical_url || "",
      robots: contract.flags?.indexable ? "index, follow" : "noindex, nofollow",
      jsonLd: extractJsonLd(contract.schema?.structured_data_html || ""),
    },

    // ── AI search summary ─────────────────────────────────────────
    ai_answer_summary: pd.ai_answer_summary || "",

    // ── Hero section ──────────────────────────────────────────────
    hero: {
      headline: contract.hero?.headline || "",
      subhead: contract.hero?.subhead || "",
      kpis: [
        { label: "Distance", value: contract.hero?.kpi_distance || "" },
        { label: "Transit", value: contract.hero?.kpi_transit || "" },
        { label: "Carriers", value: contract.hero?.kpi_carriers || "" },
      ].filter(k => k.value),
      map: {
        origin: contract.hero?.map_origin || "",
        destination: contract.hero?.map_destination || "",
      },
      ctas: {
        primary: contract.hero?.primary_cta || {},
        secondary: contract.hero?.secondary_cta || {},
      },
    },

    // ── Content sections (parsed from rendered HTML) ──────────────
    sections: extractSections(contract.content?.primary_content_html || ""),

    // ── Dedicated rendered sections ───────────────────────────────
    kpi_panel: {
      html: contract.sections?.kpi_panel_html || "",
    },
    execution_flow: {
      html: contract.sections?.execution_flow_html || "",
    },

    // ── Proof section ─────────────────────────────────────────────
    proof: {
      html: contract.content?.proof_html || "",
    },

    // ── Lane statistics (structured data) ─────────────────────────
    stats: {
      distance_miles: ls.estimated_distance_miles || 0,
      transit_days: {
        min: ls.estimated_transit_days_range?.min || 0,
        max: ls.estimated_transit_days_range?.max || 0,
      },
      rate_range_usd: {
        low: ls.estimated_rate_range_usd?.low || 0,
        high: ls.estimated_rate_range_usd?.high || 0,
      },
      common_equipment: ls.common_equipment || [],
      seasonality: ls.seasonality_notes || "",
      confidence: ls.confidence || {},
    },

    // ── Network proof (structured data) ───────────────────────────
    network: {
      carrier_count: np.estimated_carrier_count || 0,
      cross_docks: np.nearest_cross_docks || [],
      service_notes: np.service_notes || [],
      origin_region: np.origin_region || "",
      destination_region: np.destination_region || "",
    },

    // ── Comparison data ───────────────────────────────────────────
    comparison: parseComparison(
      contract.comparison?.traditional_text,
      contract.comparison?.warp_text
    ),

    // ── FAQs (structured) ─────────────────────────────────────────
    faqs: (pd.lane_specific_faqs || []).map(f => ({
      question: f.question,
      answer: f.answer,
    })),

    // ── Why WARP (structured) ─────────────────────────────────────
    why_warp: (pd.why_warp?.reasons || []).map(r => ({
      heading: r.heading,
      body: r.body,
    })),

    // ── CTAs ──────────────────────────────────────────────────────
    ctas: {
      hero: contract.hero?.primary_cta || {},
      final: {
        headline: pd.final_cta?.headline || "",
        body: pd.final_cta?.body || "",
        primary: pd.final_cta?.primary_cta || {},
        secondary: pd.final_cta?.secondary_cta || {},
        trust_signals: pd.final_cta?.trust_signals || [],
      },
    },

    // ── Quality report ────────────────────────────────────────────
    quality: contract.quality || null,
  };
}

/**
 * Full adapter pipeline: contract → structured page payload.
 * For the neutral adapter, this is equivalent to toTargetFields().
 *
 * @param {object} contract - CMS-neutral publish contract
 * @returns {object} Structured page payload
 */
export function adaptForPublish(contract) {
  return toTargetFields(contract);
}

/**
 * Write the neutral adapter output to a JSON file.
 * This is the "publish" action for the neutral adapter — writes to disk.
 *
 * @param {object} params
 * @param {object} params.payload  - Output of adaptForPublish()
 * @param {string} params.outputDir - Directory to write to
 * @param {boolean} [params.dryRun] - If true, return payload without writing
 * @returns {Promise<object>} Result with path and metadata
 */
export async function publish(params) {
  const { payload, outputDir, dryRun } = params;

  if (!payload) throw new Error("neutral-adapter publish: payload required");

  const slug = payload.slug || "unknown";
  const filename = `${slug}.json`;

  if (dryRun) {
    return {
      adapter: ADAPTER_ID,
      dryRun: true,
      slug,
      filename,
      sectionCount: payload.sections?.length || 0,
      faqCount: payload.faqs?.length || 0,
      payload,
    };
  }

  if (!outputDir) throw new Error("neutral-adapter publish: outputDir required for live mode");

  const fs = await import("fs");
  const path = await import("path");

  const dir = path.default.resolve(outputDir);
  fs.default.mkdirSync(dir, { recursive: true });

  const filePath = path.default.join(dir, filename);
  fs.default.writeFileSync(filePath, JSON.stringify(payload, null, 2));

  return {
    adapter: ADAPTER_ID,
    dryRun: false,
    slug,
    path: filePath,
    sectionCount: payload.sections?.length || 0,
    faqCount: payload.faqs?.length || 0,
  };
}
