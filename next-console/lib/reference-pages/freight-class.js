/**
 * Freight Class Guide — Reference Authority Page
 * Explains NMFC freight classifications with tables, examples, and definitions.
 * Internal links to lane pages that reference freight class.
 */

export function getFreightClassContent() {
  return {
    slug: "freight-class",
    title: "Freight Class Guide: NMFC Classifications Explained | WARP",
    meta_description: "Understand NMFC freight classes 50-500. Learn how density, stowability, handling, and liability determine your freight class and impact LTL shipping rates.",
    h1: "Freight Class Guide",
    intro: "Freight class is the primary factor that determines LTL shipping rates. The National Motor Freight Classification (NMFC) system assigns classes from 50 to 500 based on four characteristics: density, stowability, handling difficulty, and liability. Lower class numbers mean lower rates.",
    sections: [
      {
        heading: "What Is Freight Class?",
        content: "Freight class is a standardized classification system created by the National Motor Freight Traffic Association (NMFTA). It groups commodities into 18 classes (50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500) based on transportability characteristics. Your freight class directly impacts your LTL shipping rate — class 50 items cost the least to ship, while class 500 items cost the most.",
      },
      {
        heading: "Freight Class Table",
        content: "| Class | Density (lbs/ft³) | Example Commodities |\n|-------|-------------------|---------------------|\n| 50 | 50+ | Clean brick, sand, nuts/bolts |\n| 55 | 35-50 | Hardwood flooring, cement |\n| 60 | 30-35 | Car parts, steel cables |\n| 65 | 22.5-30 | Bottled beverages, books |\n| 70 | 15-22.5 | Food items, auto parts |\n| 77.5 | 13.5-15 | Tires, bathroom fixtures |\n| 85 | 12-13.5 | Crated machinery, transmissions |\n| 92.5 | 10.5-12 | Computers, monitors |\n| 100 | 9-10.5 | Boat covers, wine |\n| 110 | 8-9 | Cabinets, table saws |\n| 125 | 7-8 | Small appliances |\n| 150 | 6-7 | Auto sheet metal |\n| 175 | 5-6 | Clothing, couches |\n| 200 | 4-5 | Sheet metal, TVs |\n| 250 | 3-4 | Bamboo furniture, mattresses |\n| 300 | 2-3 | Model boats, wood cabinets |\n| 400 | 1-2 | Deer antlers, ping pong balls |\n| 500 | <1 | Gold dust, bags of feathers |",
      },
      {
        heading: "Four Factors That Determine Freight Class",
        content: "**Density** is the weight per cubic foot — denser items get lower (cheaper) classes. **Stowability** measures how easily the freight fits with other cargo. **Handling** reflects whether special equipment or care is needed. **Liability** accounts for the risk of damage, theft, or perishability. Most classifications are density-based, but high-value or hazardous goods may receive a higher class regardless of density.",
      },
      {
        heading: "How to Calculate Your Freight Class",
        content: "Step 1: Measure your shipment's length, width, and height in inches. Step 2: Convert to cubic feet (L × W × H ÷ 1,728). Step 3: Divide total weight by cubic feet to get density. Step 4: Match density to the freight class table above. Step 5: Check the NMFC code for your specific commodity — some items have fixed class assignments regardless of density.",
      },
      {
        heading: "How Freight Class Impacts Your Rate",
        content: "LTL carriers use freight class as a multiplier on their base rate. A shipment classified as class 100 might cost 40-60% more than the same weight at class 50. Re-classing freight to a lower class through better packaging or palletization can reduce costs. Always verify your class before booking — incorrect classification leads to carrier re-weighing fees and rate adjustments.",
      },
    ],
    faq: [
      { q: "What freight class is most common?", a: "Classes 50-100 represent the majority of LTL shipments, with class 70 and 85 being especially common for manufactured goods and consumer products." },
      { q: "Can I choose my own freight class?", a: "No. Freight class is determined by the commodity's NMFC code and density. Carriers can re-class shipments during transit if the declared class is incorrect, resulting in additional charges." },
      { q: "What happens if I use the wrong freight class?", a: "Carriers will re-weigh and re-class your shipment, applying the correct rate plus a re-classification fee. This typically increases your total cost by 15-30%." },
      { q: "Does freight class apply to FTL shipments?", a: "No. Freight class is specific to LTL shipping. FTL rates are based on total distance, equipment type, and market conditions rather than commodity classification." },
      { q: "How often do freight classes change?", a: "The NMFTA updates classifications periodically. Major revisions happen every few years, but individual commodity codes can be updated at any time." },
    ],
    internal_link_categories: ["lane_pages_ltl", "freight_cost_breakdown", "ltl_vs_ftl"],
  };
}
