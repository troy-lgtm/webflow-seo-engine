import Link from "next/link";
import corridorsData from "@/data/corridors.json";

export async function generateStaticParams() {
  return corridorsData.corridors
    .filter(c => c.id !== "other")
    .map(c => ({ corridorId: c.id }));
}

export async function generateMetadata({ params }) {
  const { corridorId } = await params;
  const corridor = corridorsData.corridors.find(c => c.id === corridorId);
  if (!corridor) return { title: "Not Found | WARP" };
  return {
    title: `How Warp Runs the ${corridor.name} | WARP`,
    description: `Learn how WARP operates the ${corridor.name} with carrier networks, lane optimization, and technology-driven freight management.`,
  };
}

export default async function CorridorExplainerPage({ params }) {
  const { corridorId } = await params;
  const corridor = corridorsData.corridors.find(c => c.id === corridorId);

  if (!corridor) {
    return (
      <main style={{ padding: 32, maxWidth: 720, margin: "0 auto" }}>
        <h1>Corridor Not Found</h1>
        <Link href="/corridors">← Back to Corridors</Link>
      </main>
    );
  }

  const originCities = corridor.origin_cluster.join(", ");
  const destCities = corridor.destination_cluster.join(", ");

  return (
    <main style={{ padding: 32, maxWidth: 800, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <nav style={{ marginBottom: 24, fontSize: 14, color: "#666" }}>
        <Link href="/" style={{ color: "#0066cc", textDecoration: "none" }}>WARP</Link>
        {" › "}
        <Link href="/corridors" style={{ color: "#0066cc", textDecoration: "none" }}>Corridors</Link>
        {" › "}
        <Link href={`/corridors/${corridor.id}`} style={{ color: "#0066cc", textDecoration: "none" }}>{corridor.name}</Link>
        {" › "}
        <span>How Warp Runs This Corridor</span>
      </nav>

      <h1 data-testid="explainer-h1">How Warp Runs the {corridor.name}</h1>

      <section style={{ marginBottom: 28 }}>
        <h2>Corridor Profile</h2>
        <p>
          The {corridor.name} connects {originCities} on the origin side with {destCities} as key destinations.
          This is a {corridor.priority}-priority corridor in the WARP freight network.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>Carrier Network Strategy</h2>
        <p>
          WARP maintains dedicated carrier relationships on this corridor. By consolidating shipper demand
          across multiple lane combinations within the cluster, WARP secures capacity commitments and
          competitive rates that individual shippers cannot access independently.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>Lane Optimization</h2>
        <p>
          Each lane within the corridor is individually optimized for transit time, cost, and service reliability.
          WARP analyzes historical performance data — including on-time rates, damage frequency, and carrier
          tender acceptance — to continuously improve routing decisions.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>Multi-Mode Coverage</h2>
        <p>
          The corridor supports LTL, FTL, and cargo van / box truck service types. WARP recommends the optimal
          mode for each shipment based on weight, pallet count, and delivery timeline requirements.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2>Technology Integration</h2>
        <p>
          Real-time tracking, automated exception management, and lane-level analytics give shippers
          complete visibility into their corridor operations without manual intervention.
        </p>
      </section>

      <div style={{ marginTop: 32, padding: 20, background: "#f5f5f5", borderRadius: 8 }}>
        <p style={{ margin: 0 }}>
          <Link
            href={`/corridors/${corridor.id}`}
            style={{ color: "#0066cc", textDecoration: "none", fontWeight: 600 }}
          >
            ← View all lanes in the {corridor.name}
          </Link>
        </p>
      </div>
    </main>
  );
}
