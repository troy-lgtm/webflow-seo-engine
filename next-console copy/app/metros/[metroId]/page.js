import Link from "next/link";
import metroMapData from "@/data/metro_map.json";
import corridorsData from "@/data/corridors.json";

export async function generateStaticParams() {
  return metroMapData.metros.map(m => ({ metroId: m.metro_id }));
}

export async function generateMetadata({ params }) {
  const { metroId } = await params;
  const metro = metroMapData.metros.find(m => m.metro_id === metroId);
  if (!metro) return { title: "Metro Not Found | WARP" };
  return {
    title: `${metro.city} Freight Shipping | WARP`,
    description: `Explore freight shipping lanes to and from ${metro.city}, ${metro.state}. View ${metro.total_lanes} LTL, FTL, and cargo van / box truck lanes with instant quoting.`,
  };
}

export default async function MetroHubPage({ params }) {
  const { metroId } = await params;
  const metro = metroMapData.metros.find(m => m.metro_id === metroId);

  if (!metro) {
    return (
      <main style={{ padding: 32, maxWidth: 720, margin: "0 auto" }}>
        <h1>Metro Not Found</h1>
        <p>The metro &quot;{metroId}&quot; does not exist.</p>
        <Link href="/metros">&#8592; Back to Metros</Link>
      </main>
    );
  }

  return (
    <main style={{ padding: 32, maxWidth: 900, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      {/* Breadcrumb */}
      <nav style={{ marginBottom: 24, fontSize: 14, color: "#666" }}>
        <Link href="/" style={{ color: "#0066cc", textDecoration: "none" }}>WARP</Link>
        {" \u203A "}
        <Link href="/metros" style={{ color: "#0066cc", textDecoration: "none" }}>Metros</Link>
        {" \u203A "}
        <span>{metro.city} Freight</span>
      </nav>

      <h1 data-testid="metro-h1">{metro.city} Freight Shipping</h1>

      <p style={{ fontSize: 17, color: "#444", marginBottom: 24 }}>
        {metro.city}, {metro.state} is a freight hub
        with {metro.total_lanes} active lane{metro.total_lanes !== 1 ? "s" : ""} connecting
        to major markets across the country. WARP offers LTL, FTL, and shared
        truckload options for every lane below.
      </p>

      {/* Outbound Lanes */}
      <section style={{ marginBottom: 32 }}>
        <h2>Outbound Lanes ({metro.outbound_lane_slugs.length})</h2>
        {metro.outbound_lane_slugs.length === 0 ? (
          <p style={{ color: "#888" }}>No outbound lanes from {metro.city} yet.</p>
        ) : (
          <ul style={{ columns: 2, listStyle: "none", padding: 0 }}>
            {metro.outbound_lane_slugs.map(slug => (
              <li key={slug} style={{ marginBottom: 8 }}>
                <Link
                  href={`/lanes/${slug}`}
                  style={{ color: "#0066cc", textDecoration: "none" }}
                >
                  {slug}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Inbound Lanes */}
      <section style={{ marginBottom: 32 }}>
        <h2>Inbound Lanes ({metro.inbound_lane_slugs.length})</h2>
        {metro.inbound_lane_slugs.length === 0 ? (
          <p style={{ color: "#888" }}>No inbound lanes to {metro.city} yet.</p>
        ) : (
          <ul style={{ columns: 2, listStyle: "none", padding: 0 }}>
            {metro.inbound_lane_slugs.map(slug => (
              <li key={slug} style={{ marginBottom: 8 }}>
                <Link
                  href={`/lanes/${slug}`}
                  style={{ color: "#0066cc", textDecoration: "none" }}
                >
                  {slug}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Corridor Links */}
      {metro.corridor_ids.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2>Corridors</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {metro.corridor_ids.map(cid => {
              const corridor = corridorsData.corridors.find(c => c.id === cid);
              const label = corridor ? corridor.name : cid;
              return (
                <li key={cid} style={{ marginBottom: 8 }}>
                  <Link
                    href={`/corridors/${cid}`}
                    style={{ color: "#0066cc", textDecoration: "none" }}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Shipping Guides */}
      <section style={{ marginBottom: 32 }} data-testid="metro-guides">
        <h2>Shipping Guides</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {[
            { slug: "ltl", label: "LTL Shipping Guide" },
            { slug: "ftl", label: "FTL Shipping Guide" },
            { slug: "cargo-van-box-truck", label: "Cargo Van / Box Truck Guide" },
            { slug: "freight-class", label: "Freight Class Guide" },
            { slug: "damage-prevention", label: "Damage Prevention" },
            { slug: "tendering", label: "Tendering Guide" },
          ].map(g => (
            <Link
              key={g.slug}
              href={`/guides/${g.slug}`}
              style={{
                display: "block",
                padding: 12,
                background: "#f0f7ff",
                borderRadius: 8,
                color: "#0066cc",
                textDecoration: "none",
                fontWeight: 500,
                fontSize: 14,
              }}
            >
              {g.label}
            </Link>
          ))}
        </div>
      </section>

      {/* Quote CTA */}
      <section style={{ marginBottom: 32 }}>
        <h2>Get a Freight Quote</h2>
        <p style={{ color: "#444", marginBottom: 12 }}>
          Ship to or from {metro.city} today. Get an instant quote for LTL, FTL,
          or cargo van / box truck.
        </p>
        <a
          href="https://www.wearewarp.com/quote"
          style={{
            display: "inline-block",
            padding: "12px 24px",
            background: "#FF6B35",
            color: "#fff",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Get a Quote
        </a>
      </section>

      {/* Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": `${metro.city} Freight Shipping`,
            "description": `Freight shipping lanes to and from ${metro.city}, ${metro.state}`,
            "url": `https://www.wearewarp.com/metros/${metro.metro_id}`,
            "provider": {
              "@type": "Organization",
              "name": "WARP",
              "url": "https://www.wearewarp.com",
            },
          }),
        }}
      />
    </main>
  );
}
