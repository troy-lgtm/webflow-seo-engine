import Link from "next/link";
import corridorsData from "@/data/corridors.json";
import metroMapData from "@/data/metro_map.json";
import { listCorridorLaneCandidates, selectToolPage } from "@/lib/corridors";

export async function generateStaticParams() {
  return corridorsData.corridors
    .filter(c => c.id !== "other")
    .map(c => ({ corridorId: c.id }));
}

export async function generateMetadata({ params }) {
  const { corridorId } = await params;
  const corridor = corridorsData.corridors.find(c => c.id === corridorId);
  if (!corridor) return { title: "Corridor Not Found | WARP" };
  return {
    title: `${corridor.name} | WARP`,
    description: `Explore freight shipping lanes in the ${corridor.name}. Compare LTL, FTL, and cargo van / box truck options across this high-demand corridor.`,
  };
}

export default async function CorridorHubPage({ params }) {
  const { corridorId } = await params;
  const corridor = corridorsData.corridors.find(c => c.id === corridorId);

  if (!corridor) {
    return (
      <main style={{ padding: 32, maxWidth: 720, margin: "0 auto" }}>
        <h1>Corridor Not Found</h1>
        <p>The corridor &quot;{corridorId}&quot; does not exist.</p>
        <Link href="/corridors">← Back to Corridors</Link>
      </main>
    );
  }

  const candidates = listCorridorLaneCandidates(corridorId);
  const tool = selectToolPage({ mode: "LTL", pageType: "lane_service" });

  const originCities = corridor.origin_cluster.join(", ");
  const destCities = corridor.destination_cluster.join(", ");

  return (
    <main style={{ padding: 32, maxWidth: 900, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <nav style={{ marginBottom: 24, fontSize: 14, color: "#666" }}>
        <Link href="/" style={{ color: "#0066cc", textDecoration: "none" }}>WARP</Link>
        {" › "}
        <Link href="/corridors" style={{ color: "#0066cc", textDecoration: "none" }}>Corridors</Link>
        {" › "}
        <span>{corridor.name}</span>
      </nav>

      <h1 data-testid="corridor-h1">{corridor.name}</h1>

      <p style={{ fontSize: 17, color: "#444", marginBottom: 24 }}>
        The {corridor.name} connects freight origins in {originCities} to destinations in {destCities}.
        This {corridor.priority}-priority corridor carries consistent LTL, FTL, and cargo van / box truck volume.
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2>Corridor Overview</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <div style={{ padding: 16, background: "#f5f5f5", borderRadius: 8 }}>
            <strong>Origin Cluster</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              {corridor.origin_cluster.map(c => <li key={c}>{c}</li>)}
            </ul>
          </div>
          <div style={{ padding: 16, background: "#f5f5f5", borderRadius: 8 }}>
            <strong>Destination Cluster</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
              {corridor.destination_cluster.map(c => <li key={c}>{c}</li>)}
            </ul>
          </div>
        </div>
        <p><strong>Priority:</strong> {corridor.priority}</p>
      </section>

      <section style={{ marginBottom: 32 }} data-testid="corridor-lanes">
        <h2>Lane Pages in This Corridor ({candidates.length})</h2>
        {candidates.length === 0 ? (
          <p>No lane pages have been generated for this corridor yet.</p>
        ) : (
          <ul style={{ columns: 2, listStyle: "none", padding: 0 }}>
            {candidates.slice(0, 40).map(c => (
              <li key={c.slug} style={{ marginBottom: 8 }}>
                <Link
                  href={`/lanes/${c.slug}`}
                  style={{ color: "#0066cc", textDecoration: "none" }}
                >
                  {c.origin} → {c.destination}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(() => {
        const allClusterCities = [
          ...corridor.origin_cluster,
          ...corridor.destination_cluster,
        ];
        const matchedMetros = allClusterCities
          .map(city => {
            const metro = metroMapData.metros.find(
              m => m.city.toLowerCase() === city.toLowerCase()
            );
            return metro ? { city, metro } : null;
          })
          .filter(Boolean);

        return matchedMetros.length > 0 ? (
          <section style={{ marginBottom: 32 }} data-testid="metro-hubs">
            <h2>Metro Hubs</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {matchedMetros.map(({ city, metro }) => (
                <Link
                  key={metro.metro_id}
                  href={`/metros/${metro.metro_id}`}
                  style={{
                    display: "block",
                    padding: "12px 16px",
                    background: "#f5f5f5",
                    borderRadius: 8,
                    color: "#0066cc",
                    textDecoration: "none",
                    fontWeight: 500,
                  }}
                >
                  {city} Freight Hub
                </Link>
              ))}
            </div>
          </section>
        ) : null;
      })()}

      <section style={{ marginBottom: 32 }} data-testid="shipping-guides">
        <h2>Shipping Guides</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {[
            { href: "/guides/ltl", label: "LTL Guide" },
            { href: "/guides/ftl", label: "FTL Guide" },
            { href: "/guides/cargo-van-box-truck", label: "Cargo Van / Box Truck Guide" },
            { href: "/guides/freight-class", label: "Freight Class Guide" },
            { href: "/guides/tendering", label: "Tendering Guide" },
          ].map(guide => (
            <Link
              key={guide.href}
              href={guide.href}
              style={{
                display: "block",
                padding: "14px 16px",
                background: "#f0f7ff",
                borderRadius: 8,
                color: "#0066cc",
                textDecoration: "none",
                fontWeight: 500,
                textAlign: "center",
              }}
            >
              {guide.label}
            </Link>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>Tools</h2>
        {tool && (
          <Link
            href={tool.url}
            style={{ display: "inline-block", padding: "12px 24px", background: "#FF6B35", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 600 }}
          >
            {tool.text}
          </Link>
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>How Warp Runs This Corridor</h2>
        <p style={{ color: "#444" }}>
          Learn how WARP operates the {corridor.name} with dedicated carrier networks,
          optimized routing, and real-time visibility.
        </p>
        <Link
          href={`/corridors/${corridor.id}/how-warp-runs-this-corridor`}
          style={{ color: "#0066cc", textDecoration: "none", fontWeight: 600 }}
        >
          Read the corridor explainer →
        </Link>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": corridor.name,
            "description": `Freight shipping lanes in the ${corridor.name}`,
            "url": `https://www.wearewarp.com/corridors/${corridor.id}`,
            "provider": {
              "@type": "Organization",
              "name": "WARP",
              "url": "https://www.wearewarp.com"
            }
          })
        }}
      />
    </main>
  );
}
