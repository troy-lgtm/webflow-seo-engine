// Wave-based publishing system for controlled crawl budget management
// Waves define strategic publish stages with increasing lane counts

export const WAVE_DEFINITIONS = [
  {
    id: "wave-1",
    label: "Wave 1 — Beachhead",
    description: "Top 500 lane pairs. Highest-volume corridors to establish indexing trust.",
    lane_pair_limit: 500,
    priority: 1,
    crawl_budget_notes: "Submit sitemap immediately. Request indexing via GSC for first 50 URLs.",
    quality_threshold: 70,
    recommended_modes: ["LTL", "FTL"],
    recommended_segments: ["smb"]
  },
  {
    id: "wave-2",
    label: "Wave 2 — Expansion",
    description: "1,500 lane pairs. Add secondary corridors and Cargo Van / Box Truck mode.",
    lane_pair_limit: 1500,
    priority: 2,
    crawl_budget_notes: "Monitor crawl stats in GSC. Only launch when Wave 1 has 80%+ indexed.",
    quality_threshold: 65,
    recommended_modes: ["LTL", "FTL", "Cargo Van / Box Truck"],
    recommended_segments: ["smb", "midmarket"]
  },
  {
    id: "wave-3",
    label: "Wave 3 — Saturation",
    description: "5,000 lane pairs. Full mode coverage, add enterprise segment.",
    lane_pair_limit: 5000,
    priority: 3,
    crawl_budget_notes: "Ensure server response time <200ms. Add pagination sitemaps if needed.",
    quality_threshold: 60,
    recommended_modes: ["LTL", "FTL", "Cargo Van / Box Truck"],
    recommended_segments: ["smb", "midmarket", "enterprise"]
  },
  {
    id: "wave-4",
    label: "Wave 4 — Domination",
    description: "15,000 lane pairs. Full matrix coverage for long-tail capture.",
    lane_pair_limit: 15000,
    priority: 4,
    crawl_budget_notes: "Split sitemap into sitemap index with per-mode sitemaps. Monitor thin content flags.",
    quality_threshold: 55,
    recommended_modes: ["LTL", "FTL", "Cargo Van / Box Truck"],
    recommended_segments: ["smb", "midmarket", "enterprise"]
  }
];

// Select lanes for a wave from the full seed, respecting lane_pair_limit
export function selectWaveLanes(allLanes, waveId) {
  const wave = WAVE_DEFINITIONS.find((w) => w.id === waveId);
  if (!wave) return { wave: null, lanes: [], error: "Unknown wave" };

  // Sort by lane_set priority (tier1_core first), then take up to limit
  const sorted = [...allLanes].sort((a, b) => {
    const aP = a.lane_set === "tier1_core" ? 0 : 1;
    const bP = b.lane_set === "tier1_core" ? 0 : 1;
    return aP - bP;
  });

  const selected = sorted.slice(0, wave.lane_pair_limit);
  return { wave, lanes: selected, error: null };
}

// Calculate total pages for a wave given modes and segments
export function wavePageCount(lanePairCount, modes, segments) {
  return lanePairCount * modes.length * segments.length;
}

// Build a publish manifest for a wave
export function buildWaveManifest(pages, waveId) {
  const wave = WAVE_DEFINITIONS.find((w) => w.id === waveId);
  if (!wave) return null;

  const now = new Date().toISOString().slice(0, 10);
  return {
    wave_id: waveId,
    wave_label: wave.label,
    published_date: now,
    quality_threshold: wave.quality_threshold,
    page_count: pages.length,
    pages: pages.map((p) => ({
      slug: p.slug,
      seo_title: p.seo_title,
      status: "published",
      published_date: now,
      lane: p.lane,
      target_segment: p.target_segment,
      wave: waveId
    }))
  };
}

// Check if a wave is ready to publish (quality gate)
export function waveQualityGate(pages, waveId) {
  const wave = WAVE_DEFINITIONS.find((w) => w.id === waveId);
  if (!wave) return { pass: false, issues: ["Unknown wave"], score: 0 };

  const issues = [];
  let deductions = 0;

  // Check title uniqueness
  const titles = pages.map((p) => p.seo_title?.toLowerCase() || "");
  const uniqueTitles = new Set(titles);
  const dupPct = 1 - (uniqueTitles.size / Math.max(titles.length, 1));
  if (dupPct > 0.05) {
    issues.push(`${Math.round(dupPct * 100)}% duplicate titles`);
    deductions += 20;
  }

  // Check meta description length
  const shortMetas = pages.filter((p) => (p.meta_description?.length || 0) < 80);
  if (shortMetas.length > pages.length * 0.1) {
    issues.push(`${shortMetas.length} pages with short meta descriptions`);
    deductions += 10;
  }

  // Check estimate presence
  const noEstimates = pages.filter((p) => !p.lane_stats?.estimated_distance_miles);
  if (noEstimates.length > 0) {
    issues.push(`${noEstimates.length} pages missing estimates`);
    deductions += 15;
  }

  // Check disclaimer presence
  const noDisclaimers = pages.filter((p) => !p.lane_stats?.disclaimers?.length);
  if (noDisclaimers.length > 0) {
    issues.push(`${noDisclaimers.length} pages missing disclaimers`);
    deductions += 15;
  }

  // Check internal links
  const lowLinks = pages.filter((p) => (p.related_lanes?.length || 0) < 6);
  if (lowLinks.length > pages.length * 0.2) {
    issues.push(`${lowLinks.length} pages with fewer than 6 internal links`);
    deductions += 10;
  }

  // Check FAQ presence
  const noFaq = pages.filter((p) => (p.faq?.length || 0) < 3);
  if (noFaq.length > pages.length * 0.1) {
    issues.push(`${noFaq.length} pages with fewer than 3 FAQs`);
    deductions += 10;
  }

  const score = Math.max(0, 100 - deductions);
  return {
    pass: score >= wave.quality_threshold,
    issues,
    score,
    threshold: wave.quality_threshold
  };
}
