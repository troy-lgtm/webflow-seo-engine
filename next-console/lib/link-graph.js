import cities from "@/data/cities.json";
import { getIndexLinks } from "@/lib/index-builders";

function normCity(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9,. ]+/g, "").replace(/\s+/g, " ").trim();
}

function lookupRegion(city) {
  const key = normCity(city);
  if (cities[key]) return cities[key].region;
  const noState = key.replace(/,\s*[a-z]{2}$/, "").trim();
  for (const [k, v] of Object.entries(cities)) {
    if (k.startsWith(noState)) return v.region;
  }
  return null;
}

// All known guide slugs with link text
const guideLinks = {
  mode: {
    LTL: { href: "/guides/ltl", text: "LTL Freight Shipping Guide" },
    FTL: { href: "/guides/ftl", text: "FTL Freight Shipping Guide" },
    "Cargo Van / Box Truck": { href: "/guides/cargo-van-box-truck", text: "Cargo Van / Box Truck Shipping Guide" }
  },
  segment: {
    smb: { href: "/guides/smb", text: "SMB Freight Buyer's Guide" },
    enterprise: { href: "/guides/enterprise", text: "Enterprise Logistics Guide" },
    midmarket: { href: "/guides/midmarket", text: "Midmarket Freight Guide" }
  },
  problem: [
    { href: "/guides/freight-class", text: "Understanding Freight Classification" },
    { href: "/guides/damage-prevention", text: "Freight Damage Prevention Guide" },
    { href: "/guides/tendering", text: "Freight Tendering Best Practices" }
  ],
  reference: [
    { href: "/reference/freight-cost-breakdown", text: "Freight Cost Breakdown: What Drives Shipping Rates" },
    { href: "/reference/ltl-vs-ftl-guide", text: "LTL vs FTL: Complete Comparison Guide" },
    { href: "/index/transit-times", text: "Transit Times by Lane" },
    { href: "/index/rate-ranges", text: "Rate Ranges by Corridor" }
  ]
};

// Attach related_lanes (min 12) and related_guides (min 6) to each page.
// Ensures link diversity: reverse/near-reverse, same origin/dest, region hub, guides.
export function attachLinks(pages) {
  if (!pages?.length) return pages;

  const slugSet = new Set(pages.map((p) => p.slug));

  pages.forEach((page) => {
    if (!page?.lane) return;
    const { origin, destination, mode } = page.lane;
    const segment = page.target_segment || "smb";
    const oRegion = lookupRegion(origin);
    const dRegion = lookupRegion(destination);
    const seen = new Set();
    seen.add(page.slug);

    // Categorized links for diversity enforcement
    const reverseLinks = [];
    const sameOriginLinks = [];
    const sameDestLinks = [];
    const regionLinks = [];

    function makeLink(p, reason) {
      if (seen.has(p.slug) || !slugSet.has(p.slug)) return null;
      seen.add(p.slug);
      return { href: `/${p.slug}`, text: `${p.lane.origin} to ${p.lane.destination} ${p.lane.mode} Quotes`, reason };
    }

    // 1. Reverse and near-reverse lanes (target: at least 2)
    pages.forEach((p) => {
      if (!p.lane || seen.has(p.slug)) return;
      if (p.lane.origin === destination && p.lane.destination === origin) {
        const link = makeLink(p, "reverse lane");
        if (link) reverseLinks.push(link);
      }
    });
    // Near-reverse: same destination as origin (close match)
    pages.forEach((p) => {
      if (!p.lane || seen.has(p.slug)) return;
      if (p.lane.destination === origin && p.lane.origin !== destination) {
        const link = makeLink(p, "near-reverse");
        if (link) reverseLinks.push(link);
      }
    });

    // 2. Same origin, different destinations (target: at least 4 total with same-dest)
    pages.forEach((p) => {
      if (!p.lane || seen.has(p.slug)) return;
      if (p.lane.origin === origin && p.lane.destination !== destination) {
        const link = makeLink(p, "same origin");
        if (link) sameOriginLinks.push(link);
      }
    });

    // 3. Same destination, different origins
    pages.forEach((p) => {
      if (!p.lane || seen.has(p.slug)) return;
      if (p.lane.destination === destination && p.lane.origin !== origin) {
        const link = makeLink(p, "same destination");
        if (link) sameDestLinks.push(link);
      }
    });

    // 4. Region hub based (target: at least 2)
    if (oRegion || dRegion) {
      pages.forEach((p) => {
        if (!p.lane || seen.has(p.slug)) return;
        const pORegion = lookupRegion(p.lane.origin);
        const pDRegion = lookupRegion(p.lane.destination);
        if ((pORegion === oRegion || pDRegion === dRegion) && p.slug !== page.slug) {
          const link = makeLink(p, "region hub");
          if (link) regionLinks.push(link);
        }
      });
    }

    // Assemble with diversity requirements:
    // At least 2 reverse/near-reverse, 4 same-origin/dest, 2 region hub
    const related = [];
    related.push(...reverseLinks.slice(0, Math.max(2, reverseLinks.length)));
    related.push(...sameOriginLinks.slice(0, 4));
    related.push(...sameDestLinks.slice(0, 4));
    related.push(...regionLinks.slice(0, Math.max(2, regionLinks.length)));

    // If we haven't hit 12 yet, add more from remaining pools
    const remaining = [
      ...sameOriginLinks.slice(4),
      ...sameDestLinks.slice(4),
      ...regionLinks.slice(Math.max(2, regionLinks.length)),
      ...reverseLinks.slice(Math.max(2, reverseLinks.length))
    ];
    while (related.length < 12 && remaining.length > 0) {
      related.push(remaining.shift());
    }

    page.related_lanes = related.slice(0, 16);

    // Guide links: at least 6 with 4+ guide links
    const guides = [];
    const modeGuide = guideLinks.mode[mode];
    if (modeGuide) guides.push({ ...modeGuide, reason: "mode guide" });
    Object.entries(guideLinks.mode).forEach(([m, g]) => {
      if (m !== mode) guides.push({ ...g, reason: "alt mode guide" });
    });
    const segGuide = guideLinks.segment[segment];
    if (segGuide) guides.push({ ...segGuide, reason: "segment guide" });
    Object.entries(guideLinks.segment).forEach(([s, g]) => {
      if (s !== segment && guides.length < 8) guides.push({ ...g, reason: "alt segment guide" });
    });
    guideLinks.problem.forEach((g) => guides.push({ ...g, reason: "problem guide" }));
    guideLinks.reference.forEach((g) => guides.push({ ...g, reason: "reference page" }));

    page.related_guides = guides.slice(0, 12);

    // Index page links: at least 2 per lane page
    page.related_indexes = getIndexLinks().slice(0, 4);
  });

  return pages;
}
