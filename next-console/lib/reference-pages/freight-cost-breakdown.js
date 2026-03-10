/**
 * Freight Cost Breakdown — reference page builder.
 * Generates a long-form page covering cost factors: distance/fuel, freight class,
 * mode selection, accessorials, seasonal factors, and volume discounts.
 * Uses actual rate constants from estimate-config.
 */

export function buildFreightCostBreakdown() {
  return {
    slug: "freight-cost-breakdown",
    canonical_path: "/reference/freight-cost-breakdown",
    seo_title: "Freight Shipping Cost Breakdown: What Drives Your Rates | WARP",
    meta_description:
      "Understand the 6 key factors that determine freight shipping costs. Learn how distance, freight class, mode, accessorials, seasons, and volume affect your rates.",
    h1: "Freight shipping cost breakdown: what drives your rates",
    page_type: "reference",
    sections: [
      {
        id: "distance-fuel",
        h2: "Distance and fuel surcharges",
        content:
          "Distance is the single largest driver of freight cost. Carriers price lanes based on road miles, which average 1.18x the straight-line distance between origin and destination due to highway routing. LTL shipments typically cost $2.60 to $5.20 per mile, while FTL rates range from $1.90 to $3.60 per mile because dedicated trucks move more efficiently over long hauls. Fuel surcharges fluctuate with diesel prices and are applied as a percentage on top of the base line-haul rate, meaning longer lanes amplify fuel cost exposure.",
        data_points: [
          { label: "LTL rate per mile", value: "$2.60 - $5.20" },
          { label: "FTL rate per mile", value: "$1.90 - $3.60" },
          { label: "Road distance multiplier", value: "1.18x straight-line" }
        ]
      },
      {
        id: "freight-class",
        h2: "Freight classification and density",
        content:
          "The National Motor Freight Classification (NMFC) system assigns freight classes from 50 to 500 based on density, stowability, handling difficulty, and liability. Higher-density goods like steel or machinery receive lower classes and lower multipliers, while lightweight, bulky items like furniture receive higher classes and higher rates. Class 70 is the standard baseline at a 1.00x multiplier, while Class 50 items ship at roughly 0.80x and Class 200 items at 2.20x the base rate. Accurately classifying your freight is one of the most effective ways to avoid unexpected surcharges and billing corrections.",
        data_points: [
          { label: "Class 50 (highest density)", value: "0.80x base rate" },
          { label: "Class 70 (standard)", value: "1.00x base rate" },
          { label: "Class 200 (low density)", value: "2.20x base rate" }
        ]
      },
      {
        id: "mode-selection",
        h2: "Mode selection: LTL vs FTL vs Cargo Van / Box Truck",
        content:
          "Choosing the right shipping mode has a major impact on cost efficiency. LTL (less-than-truckload) is best for shipments under 6 pallets, with a minimum rate floor of $250 and per-mile costs of $2.60-$5.20. FTL (full truckload) dedicates the entire trailer to your freight, starting at a $600 minimum but offering lower per-mile rates of $1.90-$3.60 for larger volumes. Cargo Van / Box Truck uses smaller, right-sized vehicles with a $350 minimum, offering per-mile rates of $1.70-$3.40 that can beat both LTL and FTL for mid-size shipments in the right lane.",
        data_points: [
          { label: "LTL minimum", value: "$250" },
          { label: "FTL minimum", value: "$600" },
          { label: "Cargo Van / Box Truck minimum", value: "$350" }
        ]
      },
      {
        id: "accessorials",
        h2: "Accessorial charges and surcharges",
        content:
          "Accessorials are service charges beyond standard dock-to-dock transport. Common accessorials include liftgate service, inside delivery, residential delivery, limited-access pickup, and detention time. LTL shipments carry the highest accessorial exposure at roughly 20% above the base rate because they involve more handling touchpoints and hub transfers. FTL shipments average about 12% in accessorial buffers, while Cargo Van / Box Truck falls in between at approximately 15%. Understanding which accessorials apply to your shipments is critical for accurate budgeting and avoiding invoice surprises.",
        data_points: [
          { label: "LTL accessorial buffer", value: "~20%" },
          { label: "FTL accessorial buffer", value: "~12%" },
          { label: "Cargo Van / Box Truck accessorial buffer", value: "~15%" }
        ]
      },
      {
        id: "seasonal-factors",
        h2: "Seasonal and market factors",
        content:
          "Freight rates are not static and shift significantly with market conditions throughout the year. Produce season from August through October tightens refrigerated and dry van capacity in agricultural corridors, pushing rates upward. Holiday retail peaks from October through December create surges in consumer goods lanes. Winter weather disruptions and hurricane season can restrict capacity in affected regions, sometimes increasing rates 15-30% above baseline. Monitoring these seasonal patterns helps shippers plan shipment timing and negotiate contracts that account for predictable fluctuations.",
        data_points: []
      },
      {
        id: "volume-discounts",
        h2: "Volume discounts and pallet count impact",
        content:
          "Shipping higher volumes on consistent lanes provides meaningful cost savings. Each additional pallet in a multi-pallet shipment reduces the per-unit cost by approximately 3%, reflecting better trailer utilization and lower carrier handling costs per unit. This volume discount scales up to a maximum of 25% for large, regular shipments. Shippers who consolidate orders into fewer, larger shipments on predictable schedules can negotiate even better contractual rates by reducing carrier deadhead and improving load planning efficiency.",
        data_points: [
          { label: "Per-pallet discount", value: "3% per additional pallet" },
          { label: "Maximum volume discount", value: "25%" }
        ]
      }
    ],
    faq: [
      {
        q: "How is freight shipping cost calculated?",
        a: "Freight cost is determined by six primary factors: distance, freight classification, shipping mode, accessorial charges, seasonal market conditions, and shipment volume. Each factor independently affects the final rate."
      },
      {
        q: "What is the cheapest way to ship freight?",
        a: "Cargo Van / Box Truck offers the lowest per-mile rates at $1.70-$3.40/mile, but LTL may be more economical for smaller shipments under 6 pallets. Compare modes for your specific lane to find the best rate."
      },
      {
        q: "Why do freight rates change seasonally?",
        a: "Capacity tightens during produce season (Aug-Oct), holiday retail peaks (Oct-Dec), and weather disruption periods. These supply-demand shifts can increase rates 15-30% above baseline."
      },
      {
        q: "How does freight class affect shipping cost?",
        a: "Higher freight classes (lower density items) cost more to ship. Class 200 items cost approximately 2.2x the base rate, while Class 50 items cost about 0.8x. Most standard freight ships at Class 70."
      },
      {
        q: "Can I reduce freight costs with higher volume?",
        a: "Yes. Multi-pallet shipments receive approximately 3% discount per additional pallet, up to a maximum 25% volume discount. Consolidating shipments on consistent lanes also helps negotiate better rates."
      }
    ],
    cta_primary: "Get Instant Quote",
    cta_primary_url: "https://www.wearewarp.com/quote",
    related_links: [
      { href: "/reference/ltl-vs-ftl-guide", text: "LTL vs FTL Comparison Guide" },
      { href: "/guides/freight-class", text: "Understanding Freight Classification" },
      { href: "/index/rate-ranges", text: "Rate Ranges by Corridor" }
    ]
  };
}
