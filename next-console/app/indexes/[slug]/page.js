import Link from "next/link";
import {
  buildFreightLanesIndex,
  buildFreightClassIndex,
  buildAccessorialsIndex,
  buildTransitTimesIndex,
  getIndexSlugs,
  getIndexLinks
} from "@/lib/index-builders";

const builders = {
  "freight-lanes": buildFreightLanesIndex,
  "freight-class": buildFreightClassIndex,
  "accessorials": buildAccessorialsIndex,
  "transit-times": buildTransitTimesIndex
};

export function generateStaticParams() {
  return getIndexSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const builder = builders[slug];
  if (!builder) return { title: "Index not found" };
  const data = builder();
  return {
    title: data.title,
    description: data.description,
    openGraph: { title: data.title, description: data.description }
  };
}

function QuickAnswers({ answers }) {
  if (!answers?.length) return null;
  return (
    <section className="stack" style={{ gap: 12 }} data-testid="quick-answers">
      <h2>Quick Answers</h2>
      {answers.map((qa, i) => (
        <div key={`qa-${i}`} className="faq-item">
          <p className="faq-q">{qa.q}</p>
          <p className="faq-a">{qa.a}</p>
        </div>
      ))}
    </section>
  );
}

function FreightLanesContent({ data }) {
  return (
    <>
      <div className="grid-3" style={{ marginBottom: 16 }}>
        <article className="metric"><span className="metric-k">Cities</span><p className="metric-v">{data.total_cities}</p></article>
        <article className="metric"><span className="metric-k">Lane Pairs</span><p className="metric-v">{data.total_lanes.toLocaleString()}</p></article>
        <article className="metric"><span className="metric-k">Regions</span><p className="metric-v">{data.regions.length}</p></article>
      </div>

      {data.regions.map((region) => (
        <section key={region} style={{ marginBottom: 16 }}>
          <h3>{region} Lanes</h3>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(data.lanes_by_region[region] || []).map((lp, i) => (
              <Link
                key={`${lp.origin}-${lp.destination}-${i}`}
                href={`/${lp.origin.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-to-${lp.destination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-ltl`}
                className="pill"
                style={{ textDecoration: "none" }}
              >
                {lp.origin} → {lp.destination}
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section style={{ marginTop: 16 }}>
        <h3>All Cities</h3>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {data.cities.map((c) => (
            <span key={c.name} className="pill">{c.name} ({c.region})</span>
          ))}
        </div>
      </section>
    </>
  );
}

function FreightClassContent({ data }) {
  return (
    <section>
      <table className="table" data-testid="freight-class-table">
        <thead>
          <tr><th>Class</th><th>Density</th><th>Rate Impact</th><th>Est. 500mi LTL</th><th>Examples</th></tr>
        </thead>
        <tbody>
          {data.classes.map((c) => (
            <tr key={c.class}>
              <td><strong>{c.class}</strong></td>
              <td style={{ fontSize: "0.78rem" }}>{c.density_range}</td>
              <td>{(c.multiplier * 100).toFixed(0)}%</td>
              <td>${c.example_rate_500mi.low.toLocaleString()}-${c.example_rate_500mi.high.toLocaleString()}</td>
              <td style={{ fontSize: "0.76rem" }}>{c.commodity_examples.slice(0, 2).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AccessorialsContent({ data }) {
  return (
    <section>
      <p className="sub" style={{ marginBottom: 12 }}>{data.buffer_note}</p>
      <div className="stack" style={{ gap: 8 }}>
        {data.accessorials.map((acc) => (
          <div key={acc.code} className="preview-card" style={{ padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>{acc.name}</strong>
              <span className="pill" style={{ fontSize: "0.68rem" }}>{acc.typical_cost}</span>
            </div>
            <p className="sub" style={{ marginTop: 4 }}>{acc.description}</p>
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              {acc.applies_to.map((m) => <span key={m} className="pill" style={{ fontSize: "0.6rem" }}>{m}</span>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TransitTimesContent({ data }) {
  return (
    <section>
      {data.transit_bands.map((mode) => (
        <div key={mode.mode} style={{ marginBottom: 16 }}>
          <h3>{mode.mode} Transit Times</h3>
          <table className="table">
            <thead>
              <tr><th>Distance</th><th>Min Days</th><th>Max Days</th></tr>
            </thead>
            <tbody>
              {mode.bands.map((b, i) => (
                <tr key={`${mode.mode}-${i}`}>
                  <td>{b.distance_label}</td>
                  <td>{b.transit_min}</td>
                  <td>{b.transit_max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <h3 style={{ marginTop: 16 }}>Sample Corridors</h3>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {data.sample_corridors.map((c) => (
          <Link
            key={`${c.origin}-${c.destination}`}
            href={`/${c.origin.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-to-${c.destination.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-ltl`}
            className="preview-card"
            style={{ textDecoration: "none", padding: "8px 10px", minWidth: 140 }}
          >
            <span className="k">{c.origin} → {c.destination}</span>
            <p className="v">~{c.approx_miles.toLocaleString()} mi</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

const CONTENT_MAP = {
  "freight-lanes": FreightLanesContent,
  "freight-class": FreightClassContent,
  "accessorials": AccessorialsContent,
  "transit-times": TransitTimesContent
};

export default async function IndexPage({ params }) {
  const { slug } = await params;
  const builder = builders[slug];

  if (!builder) {
    return (
      <main className="shell">
        <section className="surface hero">
          <h1 className="title">Index not found</h1>
          <p className="sub">This freight reference page does not exist.</p>
          <Link href="/" className="btn ghost">Back to Dashboard</Link>
        </section>
      </main>
    );
  }

  const data = builder();
  const ContentComponent = CONTENT_MAP[slug];
  const indexLinks = getIndexLinks().filter((l) => !l.href.includes(slug));

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "WARP", item: "https://www.wearewarp.com" },
      { "@type": "ListItem", position: 2, name: "Freight Reference", item: "https://www.wearewarp.com/indexes" },
      { "@type": "ListItem", position: 3, name: data.h1 }
    ]
  };

  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: data.h1,
    description: data.description,
    publisher: { "@type": "Organization", name: "WARP", url: "https://www.wearewarp.com" }
  };

  return (
    <main className="shell" data-warp-page="index">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }} />

      <section className="surface hero">
        <p className="overline">Freight Reference</p>
        <h1 className="title" data-testid="index-h1">{data.h1}</h1>
        <p className="sub">{data.description}</p>
        <div className="actions">
          <Link href="/" className="btn ghost">Dashboard</Link>
          <Link href="/builder" className="btn ghost">Builder</Link>
        </div>
      </section>

      <section className="surface panel" data-testid="index-content">
        {ContentComponent && <ContentComponent data={data} />}
      </section>

      <section className="surface panel">
        <QuickAnswers answers={data.quick_answers} />
      </section>

      <section className="surface panel">
        <h2>Related References</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {indexLinks.map((l) => (
            <Link key={l.href} href={l.href} className="preview-card" style={{ textDecoration: "none", padding: "10px 14px" }}>
              <span className="k">{l.reason}</span>
              <p className="v" style={{ fontSize: "0.82rem" }}>{l.text}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
