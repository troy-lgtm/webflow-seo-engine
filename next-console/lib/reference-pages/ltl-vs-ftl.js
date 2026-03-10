/**
 * LTL vs FTL Guide — reference page builder.
 * Generates a comparison page with side-by-side analysis of LTL, FTL, and Cargo Van / Box Truck modes.
 * Uses actual rate constants from estimate-config.
 */

export function buildLtlVsFtlGuide() {
  return {
    slug: "ltl-vs-ftl-guide",
    canonical_path: "/reference/ltl-vs-ftl-guide",
    seo_title: "LTL vs FTL Shipping: Complete Comparison Guide | WARP",
    meta_description:
      "Compare LTL, FTL, and Cargo Van / Box Truck shipping side by side. Learn when each mode saves money, transit differences, and how to choose the right option for your freight.",
    h1: "LTL vs FTL shipping: how to choose the right freight mode",
    page_type: "reference",
    sections: [
      {
        id: "overview",
        h2: "Overview: three freight shipping modes",
        content:
          "Freight shippers have three primary modes to move goods over the road: LTL (less-than-truckload), FTL (full truckload), and Cargo Van / Box Truck. Each mode serves a different shipment profile and comes with distinct cost structures, transit characteristics, and operational trade-offs. Understanding when to use each mode is one of the highest-leverage decisions a shipping team can make, directly impacting per-shipment cost, delivery speed, and freight damage risk.",
        data_points: [
          { label: "LTL rate per mile", value: "$2.60 - $5.20" },
          { label: "FTL rate per mile", value: "$1.90 - $3.60" },
          { label: "Cargo Van / Box Truck rate per mile", value: "$1.70 - $3.40" }
        ]
      },
      {
        id: "when-to-use-ltl",
        h2: "When to use LTL shipping",
        content:
          "LTL is the right choice when you are shipping fewer than 6 pallets or under 10,000 pounds and do not need the entire trailer. LTL carriers consolidate freight from multiple shippers onto a single truck, which keeps costs lower for smaller shipments. The minimum rate floor is $250, making it accessible for light loads. However, LTL involves more handling at carrier terminals, which increases transit time and the risk of damage. LTL transit for a 300-mile lane is typically 1-2 days, extending to 5-7 days for cross-country moves over 1,500 miles.",
        data_points: [
          { label: "Best for", value: "1-6 pallets, under 10,000 lbs" },
          { label: "Minimum rate", value: "$250" },
          { label: "Accessorial buffer", value: "~20%" }
        ]
      },
      {
        id: "when-to-use-ftl",
        h2: "When to use FTL shipping",
        content:
          "FTL makes sense when your shipment fills most or all of a 53-foot trailer, typically 10 or more pallets or over 20,000 pounds. With FTL, your freight travels directly from origin to destination without terminal transfers, reducing handling risk and transit time. FTL rates range from $1.90 to $3.60 per mile with a minimum rate floor of $600. A dedicated truck on a 400-mile lane typically delivers in a single day, while cross-country FTL moves complete in 4-6 days. The lower per-mile cost and reduced damage exposure make FTL the preferred mode for high-value or high-volume shipments.",
        data_points: [
          { label: "Best for", value: "10+ pallets, over 20,000 lbs" },
          { label: "Minimum rate", value: "$600" },
          { label: "Accessorial buffer", value: "~12%" }
        ]
      },
      {
        id: "cargo-van-box-truck",
        h2: "Cargo Van / Box Truck: right-sized shipping",
        content:
          "Cargo Van / Box Truck shipping uses smaller, right-sized vehicles instead of full 53-foot trailers, making it ideal for mid-size shipments that do not need a full truck. Per-mile rates of $1.70-$3.40 are the lowest of any mode, with a $350 minimum rate floor. Cargo Van / Box Truck works best for mid-size shipments of 4-8 pallets where LTL is too expensive per unit and FTL requires more capacity than needed. Transit times fall between LTL and FTL, with the accessorial buffer at approximately 15%. The trade-off is that Cargo Van / Box Truck capacity is lane-dependent and not available on every corridor.",
        data_points: [
          { label: "Best for", value: "4-8 pallets on popular corridors" },
          { label: "Minimum rate", value: "$350" },
          { label: "Accessorial buffer", value: "~15%" }
        ]
      },
      {
        id: "comparison-table",
        h2: "Side-by-side comparison",
        content:
          "The table below summarizes the key differences between LTL, FTL, and Cargo Van / Box Truck across the criteria that matter most to shipping operations. Cost, speed, handling, and flexibility vary significantly by mode, and the right choice depends on your specific shipment size, lane, and service requirements.",
        data_points: []
      },
      {
        id: "breakeven-analysis",
        h2: "Breakeven analysis: when to switch modes",
        content:
          "The crossover point between LTL and FTL typically occurs around 6-8 pallets on lanes over 500 miles. Below this threshold, LTL's shared-cost model keeps per-shipment prices lower despite higher per-mile rates. Above it, FTL's lower per-mile rates and absence of terminal handling fees make it more economical. Cargo Van / Box Truck can beat both LTL and FTL in the 4-8 pallet range on high-volume corridors where right-sized vehicles keep costs low. To find your specific breakeven point, compare quoted rates across all three modes for your actual lane and shipment profile.",
        data_points: [
          { label: "LTL-to-FTL crossover", value: "~6-8 pallets" },
          { label: "Cargo Van / Box Truck sweet spot", value: "4-8 pallets, popular lanes" },
          { label: "Volume discount cap", value: "25% max" }
        ]
      },
      {
        id: "decision-framework",
        h2: "Decision framework: choosing the right mode",
        content:
          "Start with shipment size: under 4 pallets defaults to LTL, over 10 pallets defaults to FTL. For 4-10 pallets, check if Cargo Van / Box Truck is available on your lane. Next, evaluate transit urgency: FTL offers the fastest point-to-point delivery with no terminal stops. Then consider freight sensitivity: high-value or fragile goods benefit from FTL's reduced handling. Finally, factor in frequency: consistent weekly volumes on the same lane unlock volume discounts of up to 25% and may qualify for dedicated carrier commitments at even lower rates.",
        data_points: [
          { label: "Under 4 pallets", value: "LTL" },
          { label: "4-10 pallets", value: "Cargo Van / Box Truck or FTL" },
          { label: "Over 10 pallets", value: "FTL" }
        ]
      }
    ],
    comparison_table: [
      {
        criteria: "Typical shipment size",
        ltl: "1-6 pallets",
        ftl: "10-26 pallets (full trailer)",
        "Cargo Van / Box Truck": "4-8 pallets"
      },
      {
        criteria: "Per-mile cost",
        ltl: "$2.60 - $5.20",
        ftl: "$1.90 - $3.60",
        "Cargo Van / Box Truck": "$1.70 - $3.40"
      },
      {
        criteria: "Minimum rate floor",
        ltl: "$250",
        ftl: "$600",
        "Cargo Van / Box Truck": "$350"
      },
      {
        criteria: "Transit speed",
        ltl: "Slower (terminal transfers)",
        ftl: "Fastest (direct point-to-point)",
        "Cargo Van / Box Truck": "Moderate (fewer stops than LTL)"
      },
      {
        criteria: "Handling touchpoints",
        ltl: "High (multiple terminals)",
        ftl: "Low (origin to destination)",
        "Cargo Van / Box Truck": "Medium (1-2 co-loads)"
      },
      {
        criteria: "Damage risk",
        ltl: "Higher (more handling)",
        ftl: "Lowest (dedicated trailer)",
        "Cargo Van / Box Truck": "Moderate"
      },
      {
        criteria: "Accessorial buffer",
        ltl: "~20%",
        ftl: "~12%",
        "Cargo Van / Box Truck": "~15%"
      },
      {
        criteria: "Tracking granularity",
        ltl: "Terminal scans",
        ftl: "Real-time GPS",
        "Cargo Van / Box Truck": "GPS with stop visibility"
      },
      {
        criteria: "Lane availability",
        ltl: "Nationwide",
        ftl: "Nationwide",
        "Cargo Van / Box Truck": "High-volume corridors only"
      },
      {
        criteria: "Best for",
        ltl: "Small, frequent shipments",
        ftl: "Large or time-sensitive loads",
        "Cargo Van / Box Truck": "Mid-size on popular lanes"
      }
    ],
    faq: [
      {
        q: "What is the difference between LTL and FTL shipping?",
        a: "LTL (less-than-truckload) consolidates multiple shippers' freight on one truck, ideal for 1-6 pallets at $2.60-$5.20/mile. FTL (full truckload) dedicates the entire trailer to one shipper, best for 10+ pallets at $1.90-$3.60/mile with faster transit and less handling."
      },
      {
        q: "When should I switch from LTL to FTL?",
        a: "The crossover point is typically 6-8 pallets on lanes over 500 miles. Above this threshold, FTL's lower per-mile rates and direct routing make it more cost-effective than LTL despite the higher minimum rate of $600."
      },
      {
        q: "What is cargo van / box truck shipping?",
        a: "Cargo Van / Box Truck shipping uses smaller, right-sized vehicles for mid-size freight that does not need a full 53-foot trailer. It offers the lowest per-mile rates at $1.70-$3.40 and works best for 4-8 pallet shipments on high-volume corridors."
      },
      {
        q: "Is LTL or FTL cheaper for small shipments?",
        a: "LTL is almost always cheaper for shipments under 4 pallets due to its lower minimum rate of $250 versus FTL's $600 floor. The per-mile rate is higher for LTL, but total cost stays lower because you only pay for the space you use."
      },
      {
        q: "How do transit times compare between LTL and FTL?",
        a: "FTL is consistently faster because freight travels direct without terminal stops. On a 600-mile lane, FTL typically delivers in 1-2 days versus 2-3 days for LTL. Cross-country FTL moves complete in 4-6 days compared to 5-7 for LTL."
      }
    ],
    cta_primary: "Compare Rates for Your Lane",
    cta_primary_url: "https://www.wearewarp.com/quote",
    related_links: [
      { href: "/reference/freight-cost-breakdown", text: "Freight Cost Breakdown" },
      { href: "/guides/freight-class", text: "Understanding Freight Classification" },
      { href: "/index/rate-ranges", text: "Rate Ranges by Corridor" }
    ]
  };
}
