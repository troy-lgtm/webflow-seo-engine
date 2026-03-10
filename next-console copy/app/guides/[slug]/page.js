import Link from "next/link";
import corridorsData from "@/data/corridors.json";
import registryData from "@/data/lane_registry.json";

const guides = {
  ltl: {
    title: "LTL Freight Shipping Guide | WARP",
    h1: "LTL Freight Shipping: The Operator's Guide",
    description: "Complete guide to Less-Than-Truckload shipping — consolidation strategies, freight class optimization, and lane-level quoting workflows.",
    mode: "LTL",
    sections: [
      { heading: "What is LTL shipping?", body: "Less-Than-Truckload (LTL) shipping consolidates freight from multiple shippers into a single truck. Shippers pay only for the space they use, making it cost-effective for shipments between 150 and 15,000 pounds." },
      { heading: "When to use LTL vs FTL", body: "Choose LTL when your shipment is 1-10 pallets and doesn't fill a full trailer. For consistent high-volume lanes, evaluate whether FTL or cargo van / box truck service offers better unit economics." },
      { heading: "Freight classification matters", body: "LTL pricing depends heavily on freight class (NMFC codes 50-500). Higher density, lower liability freight gets better rates. Accurate classification prevents reclassification charges." },
      { heading: "Lane-level LTL strategy", body: "Instead of negotiating network-wide discounts, focus on your top 5-10 lanes. Lane-specific contracts with carriers who have direct service on those corridors deliver better transit and pricing than broad tariff agreements." },
      { heading: "Quoting workflow", body: "Request quotes per lane with accurate weight, dimensions, freight class, and accessorial requirements. Compare carriers on transit time, damage rates, and claim resolution speed — not just rate." }
    ],
    schema_type: "Article"
  },
  ftl: {
    title: "FTL Freight Shipping Guide | WARP",
    h1: "FTL Freight Shipping: Capacity and Cost Control",
    description: "Guide to Full Truckload shipping — securing capacity, rate negotiation, lane-level carrier management, and scaling freight operations.",
    mode: "FTL",
    sections: [
      { heading: "What is FTL shipping?", body: "Full Truckload (FTL) means your freight occupies an entire trailer from origin to destination. FTL shipments move direct without terminal stops, offering faster transit and lower damage risk." },
      { heading: "Capacity planning by lane", body: "FTL capacity fluctuates by lane, season, and market conditions. Build carrier relationships on your core lanes and use contract rates for predictable spend. Spot market rates work for overflow." },
      { heading: "Equipment selection", body: "Match equipment to freight: dry vans for standard goods, reefers for temperature-sensitive products, flatbeds for oversized or construction materials. Specifying correctly avoids delays and accessorial charges." },
      { heading: "Rate structures", body: "FTL rates are typically quoted per mile or as a flat rate per lane. Factors include distance, fuel surcharge, lane demand balance (headhaul vs backhaul), and seasonal patterns." },
      { heading: "Performance tracking", body: "Track on-time pickup, on-time delivery, tender acceptance rate, and claim frequency per carrier per lane. Use this data to optimize your routing guide quarterly." }
    ],
    schema_type: "Article"
  },
  "cargo-van-box-truck": {
    title: "Cargo Van & Box Truck Shipping Guide | WARP",
    h1: "Cargo Van & Box Truck Freight: Right-Sized Shipping",
    description: "How cargo van and box truck freight shipping works, when to use it, and how it delivers the right vehicle for smaller shipments without overpaying for trailer space.",
    mode: "Cargo Van / Box Truck",
    sections: [
      { heading: "What is cargo van / box truck shipping?", body: "Cargo van and box truck shipping uses right-sized vehicles for freight that doesn't need a full trailer. These vehicles are ideal for smaller, time-sensitive shipments that need direct delivery without terminal handling." },
      { heading: "Ideal use cases", body: "Cargo van and box truck service works best for shipments under 5,000 lbs that need fast, direct delivery. It's especially effective for last-mile, expedited, and local/regional freight on high-demand corridors." },
      { heading: "Cost advantages", body: "By matching the vehicle to the freight size, shippers avoid paying for unused trailer space. Cargo van and box truck rates are competitive for smaller loads that would be inefficient as LTL or FTL." },
      { heading: "Service comparison", body: "Cargo van and box truck service eliminates terminal handling entirely — freight moves direct from pickup to delivery with fewer damage risks and faster transit times than multi-stop LTL." },
      { heading: "Getting started", body: "Start with your highest-volume smaller shipment lanes. Request cargo van or box truck quotes alongside LTL and FTL to compare the total cost of shipping on each lane." }
    ],
    schema_type: "Article"
  },
  smb: {
    title: "SMB Freight Buyer's Guide | WARP",
    h1: "Freight Shipping for Small and Mid-Size Businesses",
    description: "How SMB shipping teams can build efficient freight operations — self-serve quoting, lane prioritization, and scaling without enterprise complexity.",
    sections: [
      { heading: "Start with your top lanes", body: "Identify your 5-10 highest-volume shipping lanes. Focus optimization efforts here first — even small improvements on high-volume lanes compound into significant savings." },
      { heading: "Self-serve quoting", body: "Modern freight platforms let SMB teams get instant quotes without calling brokers. Compare rates across modes (LTL, FTL, cargo van / box truck) for each lane to find the right fit." },
      { heading: "When to lock in contracts", body: "Once you have consistent weekly volume on a lane, negotiate a contract rate. This protects you from spot market volatility and gives carriers predictable freight." },
      { heading: "Technology over headcount", body: "SMB teams can't hire large logistics departments. Use platforms that consolidate quoting, booking, tracking, and analytics into one interface." },
      { heading: "Scaling decisions", body: "Expand to new lanes only when your core lanes are optimized. Use data — not gut feel — to decide which new corridors to add." }
    ],
    schema_type: "Article"
  },
  enterprise: {
    title: "Enterprise Logistics Guide | WARP",
    h1: "Enterprise Freight Operations: Governance and Scale",
    description: "Guide for enterprise logistics teams — structured procurement, multi-mode optimization, compliance controls, and KPI-driven expansion.",
    sections: [
      { heading: "Structured procurement", body: "Enterprise freight procurement requires formal RFP processes, carrier scorecards, and defined evaluation criteria. Build a routing guide that balances cost, service, and risk diversification." },
      { heading: "Multi-mode optimization", body: "Evaluate LTL, FTL, shared, and intermodal for each lane based on shipment profile, transit requirements, and total cost including damage and claims." },
      { heading: "Compliance and controls", body: "Establish standard operating procedures for carrier onboarding, insurance requirements, safety ratings, and sustainability reporting. Automate compliance checks." },
      { heading: "KPI framework", body: "Track carrier performance by lane: on-time delivery rate, damage rate, tender acceptance, invoice accuracy, and sustainability metrics. Review quarterly." },
      { heading: "Scaling with governance", body: "Use pilot programs to test new lanes and carriers. Set clear KPI gates — only expand when defined performance thresholds are met." }
    ],
    schema_type: "Article"
  },
  midmarket: {
    title: "Midmarket Freight Guide | WARP",
    h1: "Freight Operations for Growing Logistics Teams",
    description: "How midmarket shipping operations can balance speed and rigor — building scalable processes without enterprise overhead.",
    sections: [
      { heading: "Building scalable processes", body: "Midmarket teams need processes that grow with them. Start with standardized quoting and booking workflows before adding complexity like routing guides and carrier scorecards." },
      { heading: "Balancing speed and rigor", body: "You need to move fast but make data-driven decisions. Focus on 3-5 KPIs that matter most: cost per shipment, transit reliability, damage rate, and quote response time." },
      { heading: "Technology selection", body: "Choose platforms that handle your current volume but can scale 3-5x without requiring migration. Integration with your ERP or OMS is a priority." },
      { heading: "Carrier strategy", body: "Work with 3-5 core carriers per lane rather than spreading volume too thin. Concentrated volume gives you leverage for better rates and service priority." },
      { heading: "Growth planning", body: "Map your expansion corridors 6-12 months ahead. Test new lanes with small pilot volumes before committing to contract rates." }
    ],
    schema_type: "Article"
  },
  "freight-class": {
    title: "Understanding Freight Classification | WARP",
    h1: "Freight Classification: NMFC Codes, Classes, and Pricing Impact",
    description: "How freight classification works, why it matters for LTL pricing, and how to ensure accurate classification to avoid costly reclassification charges.",
    sections: [
      { heading: "What is freight class?", body: "Freight class is a standardized classification system (NMFC) that categorizes commodities from class 50 to class 500. It considers density, handling, stowability, and liability to determine pricing tiers." },
      { heading: "Why classification matters", body: "Incorrect freight class is the leading cause of LTL billing disputes. Under-classing leads to reclassification inspections and penalty charges. Over-classing means you pay more than necessary." },
      { heading: "Density-based pricing", body: "Many carriers now use density-based pricing instead of or alongside class-based pricing. Measure and report accurate dimensions to ensure fair rates under either system." },
      { heading: "Common classification mistakes", body: "Failing to account for packaging (palletized vs loose), mixing commodity types on one pallet, and using outdated NMFC codes are the most common errors." },
      { heading: "How to get it right", body: "Weigh and measure every shipment. Use the NMFC database to verify codes. When in doubt, request a classification ruling from the NMFTA before shipping." }
    ],
    schema_type: "Article"
  },
  "damage-prevention": {
    title: "Freight Damage Prevention Guide | WARP",
    h1: "Preventing Freight Damage: Packaging, Loading, and Claims",
    description: "Practical guide to reducing freight damage — packaging standards, loading best practices, carrier selection criteria, and claims process management.",
    sections: [
      { heading: "Root causes of freight damage", body: "Most damage occurs during loading/unloading (40%), in-transit shifting (35%), and terminal handling (25%). Understanding root causes helps target prevention efforts." },
      { heading: "Packaging standards", body: "Use new, structurally sound pallets. Stretch wrap loads to the pallet (not just around the product). Apply corner boards for stacking protection. Label fragile items clearly." },
      { heading: "Loading best practices", body: "Fill voids to prevent shifting. Load heaviest items on the bottom. Never stack beyond the pallet footprint. Take photos before and after loading for documentation." },
      { heading: "Carrier selection for damage prevention", body: "Track damage rates by carrier and lane. Carriers with direct service (fewer handling points) have lower damage rates. Cargo van and box truck service typically outperforms LTL on damage metrics." },
      { heading: "Claims management", body: "File claims within 9 months of delivery (per the Carmack Amendment). Include photos, original invoice, and inspection report. Concealed damage must be reported within 15 days of delivery." }
    ],
    schema_type: "Article"
  },
  tendering: {
    title: "Freight Tendering Best Practices | WARP",
    h1: "Freight Tendering: Building a Routing Guide That Works",
    description: "How to build and manage a freight routing guide — tender strategies, waterfall logic, carrier compliance, and fallback planning.",
    sections: [
      { heading: "What is freight tendering?", body: "Tendering is the process of offering a shipment to carriers in priority order based on your routing guide. A well-structured tender process maximizes acceptance rates and minimizes costs." },
      { heading: "Building your routing guide", body: "Assign primary, secondary, and spot carriers per lane based on rate, service level, and capacity reliability. Update quarterly based on performance data." },
      { heading: "Waterfall tender logic", body: "Set automatic escalation rules: offer to primary carrier first, escalate to secondary after 2 hours, fall to spot market after 4 hours. Time-based waterfalls prevent shipment delays." },
      { heading: "Measuring tender performance", body: "Track tender acceptance rate, first-tender acceptance rate, and time-to-accept per carrier per lane. Low acceptance rates signal rate or capacity misalignment." },
      { heading: "Contract compliance", body: "Monitor contracted carriers against their committed volumes and service levels. Carriers who consistently reject tenders should be addressed in quarterly business reviews." }
    ],
    schema_type: "Article"
  }
};

const validSlugs = Object.keys(guides);

export async function generateStaticParams() {
  return validSlugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const p = await params;
  const guide = guides[p.slug];
  if (!guide) return { title: "Guide Not Found | WARP" };
  return { title: guide.title, description: guide.description };
}

export default async function GuidePage({ params }) {
  const p = await params;
  const guide = guides[p.slug];

  if (!guide) {
    return (
      <main className="shell">
        <section className="surface hero">
          <h1 className="title">Guide not found</h1>
          <p className="sub">The requested guide does not exist.</p>
          <Link className="btn" href="/">Back to Dashboard</Link>
        </section>
      </main>
    );
  }

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "WARP", item: "https://www.wearewarp.com" },
      { "@type": "ListItem", position: 2, name: "Guides", item: "https://www.wearewarp.com/guides" },
      { "@type": "ListItem", position: 3, name: guide.h1 }
    ]
  };

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": guide.schema_type,
    headline: guide.h1,
    description: guide.description,
    publisher: { "@type": "Organization", name: "WARP", url: "https://www.wearewarp.com" }
  };

  return (
    <main className="shell" data-warp-page="guide" data-warp-guide={p.slug}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />

      <section className="surface hero">
        <div className="hero-row">
          <div>
            <p className="overline">WARP Guide</p>
            <h1 className="title">{guide.h1}</h1>
            <p className="sub">{guide.description}</p>
          </div>
          <div className="actions">
            <Link className="btn ghost" href="/">Dashboard</Link>
            <Link className="btn ghost" href="/builder">Builder</Link>
            <a className="btn primary" href="https://www.wearewarp.com/quote" target="_blank" rel="noreferrer" data-warp-event="guide-cta-quote">Get Instant Quote</a>
          </div>
        </div>
      </section>

      {guide.sections.map((section, i) => (
        <article className="surface panel" key={`${p.slug}-${i}`}>
          <h2 style={{ fontSize: "1rem", color: "var(--text)", letterSpacing: 0, textTransform: "none" }}>{section.heading}</h2>
          <p className="sub" style={{ lineHeight: 1.6 }}>{section.body}</p>
        </article>
      ))}

      {/* Top Corridors — shown for mode guides and segment guides */}
      {(() => {
        const showCorridorSlugs = ["ltl", "ftl", "cargo-van-box-truck", "smb", "enterprise", "midmarket"];
        if (!showCorridorSlugs.includes(p.slug)) return null;
        const sorted = [...corridorsData.corridors]
          .filter((c) => c.priority === "high" || c.priority === "medium")
          .sort((a, b) => (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1))
          .slice(0, 6);
        return (
          <section className="surface panel">
            <h2>Top Corridors</h2>
            <div className="grid-3">
              {sorted.map((c) => (
                <Link key={c.id} href={`/corridors/${c.id}`} className="preview-card" style={{ textDecoration: "none" }}>
                  <span className="k">{c.name}</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Popular Lanes — mode-aware selection */}
      {(() => {
        const modeGuides = ["ltl", "ftl", "cargo-van-box-truck"];
        let lanes;
        if (modeGuides.includes(p.slug) && guide.mode) {
          lanes = registryData
            .filter((l) => l.modes.includes(guide.mode))
            .sort((a, b) => {
              const aCore = a.lane_set === "tier1_core" ? 0 : 1;
              const bCore = b.lane_set === "tier1_core" ? 0 : 1;
              return aCore - bCore || a.order - b.order;
            })
            .slice(0, 8);
        } else {
          // For segment, freight-class, damage-prevention, tendering guides — pick diverse lanes from different corridors
          const seen = new Set();
          lanes = [];
          for (const l of registryData) {
            if (l.corridor_id === "other") continue;
            if (seen.has(l.corridor_id)) continue;
            seen.add(l.corridor_id);
            lanes.push(l);
            if (lanes.length >= 8) break;
          }
        }
        if (!lanes || lanes.length === 0) return null;
        return (
          <section className="surface panel">
            <h2>Popular Lanes</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              {lanes.map((l) => (
                <Link key={l.slug} href={`/lanes/${l.slug}`} style={{ textDecoration: "none", color: "var(--text)", padding: "0.5rem 0.75rem", borderRadius: 6, background: "var(--surface)", border: "1px solid var(--border, #e2e2e2)" }}>
                  {l.origin_city} &rarr; {l.destination_city}
                </Link>
              ))}
            </div>
          </section>
        );
      })()}

      <section className="surface panel">
        <h2>Related Guides</h2>
        <div className="grid-3">
          {validSlugs.filter((s) => s !== p.slug).slice(0, 6).map((s) => (
            <Link key={s} href={`/guides/${s}`} className="preview-card" style={{ textDecoration: "none" }}>
              <span className="k">{s.replace(/-/g, " ")}</span>
              <p className="v" style={{ fontSize: "0.82rem" }}>{guides[s].h1}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
