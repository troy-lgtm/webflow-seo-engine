export const dashboardData = {
  generated_at: "2026-03-04 09:39 UTC",
  goals: {
    north_star: "Maximize qualified quote starts and enterprise fit calls from SEO.",
    primary_kpis: [
      "CTA CTR",
      "Quote/Book start rate",
      "Form submit rate",
      "Qualified pipeline from SEO"
    ],
    guardrail: "Content-only optimization; no design system drift."
  },
  pipeline: {
    keywords: 5,
    generated: 5,
    approved: 8,
    optimized: 2,
    published: 2
  },
  top_backlog: [
    {
      slug: "flexport-alternative",
      priority_score: -260.69,
      friction_score: 11.25,
      conversion_score: 815.83,
      hypotheses: [
        "clarify CTA copy and remove ambiguous action language above the fold",
        "front-load direct answer snippet and strengthen intent match in intro"
      ]
    },
    {
      slug: "self-service-freight-quotes",
      priority_score: -345.56,
      friction_score: 7.5,
      conversion_score: 1059.18,
      hypotheses: [
        "tighten message-to-intent match in first fold"
      ]
    }
  ],
  recent_pages: [
    {
      slug: "dallas-tx-to-chicago-il-ftl",
      seo_title: "Dallas to Chicago FTL freight quotes | WARP",
      target_segment: "smb"
    },
    {
      slug: "los-angeles-ca-to-seattle-wa-ltl",
      seo_title: "Los Angeles to Seattle LTL Freight Quotes | WARP",
      target_segment: "enterprise"
    },
    {
      slug: "self-service-freight-quotes",
      seo_title: "self service freight quotes | WARP",
      target_segment: "smb"
    }
  ]
};

export const initialBuilderConfig = {
  origins: "Los Angeles, CA\nPhoenix, AZ\nDallas, TX",
  destinations: "San Francisco, CA\nSeattle, WA\nChicago, IL",
  mode: "LTL",
  segment: "smb",
  audience: "Logistics Manager",
  topN: 10,
  defaults: {
    weekly_shipments: 18,
    avg_quote_value: 2200,
    win_rate: 0.22,
    strategic_priority: 6
  },
  weights: {
    volume: 1.2,
    value: 0.02,
    win: 2.8,
    strategic: 1.4
  },
  metricsCsv: "origin,destination,mode,weekly_shipments,avg_quote_value,win_rate,strategic_priority\nLos Angeles, CA,Seattle, WA,LTL,48,4200,0.31,9\nPhoenix, AZ,San Francisco, CA,LTL,34,3200,0.28,8",
  design: {
    accent: "#00ff33",
    bg: "#1b232e",
    surface1: "#27323f",
    surface2: "#313d4c",
    border: "#4a5a6e",
    radius: 12,
    glow: 10
  }
};
