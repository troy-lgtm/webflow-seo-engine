/**
 * Transit Times Index — Reference Authority Page
 * Overview of transit expectations by distance, mode, and corridor.
 * Hub page linking into lane pages.
 */

export function getTransitTimesContent() {
  return {
    slug: "transit-times",
    title: "Freight Transit Times: LTL & FTL Delivery Estimates by Lane | WARP",
    meta_description: "Estimated freight transit times for LTL and FTL shipments by distance and corridor. Understand what affects delivery speed and how to plan your supply chain.",
    h1: "Freight Transit Times Guide",
    intro: "Transit time is the number of business days between pickup and delivery. LTL transit varies from 1-7 days depending on distance, while FTL typically runs 1-5 days. These are estimates — actual transit depends on carrier capacity, weather, and terminal network density.",
    sections: [
      {
        heading: "LTL Transit Time Estimates by Distance",
        content: "| Distance | Typical Transit | Notes |\n|----------|----------------|-------|\n| 0-250 miles | 1-2 days | Same-region, often next-day |\n| 250-500 miles | 2-3 days | Adjacent regions |\n| 500-1,000 miles | 3-4 days | Cross-regional, one terminal transfer |\n| 1,000-1,500 miles | 4-5 days | Multi-terminal routing |\n| 1,500-2,500 miles | 5-7 days | Coast-to-coast, multiple transfers |\n| 2,500+ miles | 6-8 days | Extended corridors |",
      },
      {
        heading: "FTL Transit Time Estimates",
        content: "| Distance | Solo Driver | Team Drivers |\n|----------|------------|-------------|\n| 0-500 miles | 1 day | 1 day |\n| 500-1,000 miles | 1-2 days | 1 day |\n| 1,000-1,500 miles | 2-3 days | 1-2 days |\n| 1,500-2,500 miles | 3-4 days | 2-3 days |\n| 2,500+ miles | 4-5 days | 3-4 days |",
      },
      {
        heading: "Factors That Affect Transit Time",
        content: "Distance is the primary factor, but terminal density matters for LTL — lanes between major hubs have faster service because freight moves through fewer terminals. Seasonal disruptions (winter weather, peak shipping) can add 1-2 days. Pickup timing matters — freight picked up after carrier cutoff time may not move until the next business day. Accessorial requirements like appointment delivery may also affect the delivery window.",
      },
      {
        heading: "How to Get Faster Transit",
        content: "Use FTL for time-critical shipments over 500 miles. For LTL, choose carriers with direct service on your lane. Ship early in the week to avoid weekend delays. Use guaranteed service options when available — these cost more but provide contractual delivery commitments. WARP shows estimated transit times for each carrier option during the quoting process.",
      },
    ],
    faq: [
      { q: "What is the difference between transit time and delivery time?", a: "Transit time is carrier movement time in business days. Delivery time includes pickup scheduling, transit, and any delivery appointment windows. Total delivery time is typically transit time plus 1-2 days for pickup and scheduling." },
      { q: "Are transit time estimates guaranteed?", a: "Standard transit times are estimates, not guarantees. Carriers offer guaranteed service at a premium (typically 20-40% more). Without a guarantee, the published transit time is a service standard that carriers meet approximately 85-95% of the time." },
      { q: "Do weekends count in transit time?", a: "No. Transit times are measured in business days (Monday-Friday). A shipment picked up Friday with a 3-day transit would be expected Wednesday, not Monday." },
      { q: "Why is LTL slower than FTL?", a: "LTL freight moves through a terminal network where shipments are consolidated and transferred between trucks. Each terminal stop adds time. FTL moves directly from pickup to delivery without intermediate handling." },
      { q: "How does weather affect transit times?", a: "Severe weather (winter storms, hurricanes, flooding) can add 1-3 days to transit. Carriers may also embargo certain regions during extreme conditions, temporarily suspending pickup and delivery service." },
    ],
    internal_link_categories: ["lane_pages_ltl", "lane_pages_ftl", "freight_cost_breakdown"],
  };
}
