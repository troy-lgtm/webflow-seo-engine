/**
 * app/lanes/[slug]/page.js — Next.js Lane Page Route
 *
 * Server component rendering a lane page through the lane page factory:
 *   factory → knowledge → schema → contract → route contract → React
 *
 * ARCHITECTURE:
 *   - Uses produceLanePage() from lib/lane-page-factory.js as single entry point
 *   - Factory wraps: buildLaneKnowledge → buildCanonicalLanePageData → buildRouteContract
 *   - Factory runs quality gate (assessPublishQuality) on every request
 *   - Preserves section ownership from render-lane-page.js
 *   - Preserves JSON-LD (breadcrumb, service, org, FAQ)
 *   - Pre-rendered HTML sections injected via dangerouslySetInnerHTML
 *   - Structured data sections (FAQ, Why WARP, comparison) rendered as React
 *
 * DOES NOT DEPEND ON:
 *   - renderWebflowFields()
 *   - WEBFLOW_TEMPLATE_HIDE_CSS
 *   - LANE_PAGE_MODE_CSS
 *
 * ROUTE BEHAVIOR:
 *   - Fully dynamic (no generateStaticParams) — any valid lane slug is served
 *   - Slug format: {origin}-to-{destination} (e.g. atlanta-to-orlando)
 *   - Factory produces route-ready payload with quality gate validation
 *   - Non-publishable lanes still render (quality gate is informational, not blocking)
 *
 * @module app/lanes/[slug]/page
 */

import { produceLanePage } from "../../../lib/lane-page-factory.js";
import { extractNextMetadata, extractJsonLdObjects } from "../../../lib/route-contract.js";
import styles from "./lane-page.module.css";

// ── HTML Sanitizer ──────────────────────────────────────────────────

/**
 * Balance unclosed HTML tags to prevent hydration mismatches.
 *
 * Legacy renderers (render-lane-page.js) produce section HTML fragments
 * that assume concatenation into a single HTML stream. Some sections
 * open wrapper <div> tags that are closed by subsequent sections.
 * When each section is injected into its own dangerouslySetInnerHTML
 * container, the browser auto-closes orphaned tags, creating a DOM
 * tree that doesn't match what React expects during hydration.
 *
 * This function:
 *   1. Strips orphan closing tags at the start (no matching opener)
 *   2. Appends missing closing tags at the end (no matching closer)
 *
 * Only applied in the Next.js route path — does not modify renderers.
 */
function balanceSectionHtml(html) {
  if (!html) return html;

  const VOID_ELEMENTS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
  ]);
  const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g;
  const stack = [];
  const orphanCloses = [];
  let m;

  while ((m = TAG_RE.exec(html)) !== null) {
    const full = m[0];
    const tagName = m[1].toLowerCase();
    if (VOID_ELEMENTS.has(tagName) || full.endsWith("/>")) continue;

    if (full.startsWith("</")) {
      // Closing tag — pop stack or mark as orphan
      const idx = stack.lastIndexOf(tagName);
      if (idx >= 0) {
        stack.splice(idx); // pop back to matching open
      } else {
        orphanCloses.push({ tag: tagName, index: m.index, length: full.length });
      }
    } else {
      stack.push(tagName);
    }
  }

  // Strip orphan closing tags from the front (work backwards to preserve indices)
  let result = html;
  for (let i = orphanCloses.length - 1; i >= 0; i--) {
    const { index, length } = orphanCloses[i];
    result = result.slice(0, index) + result.slice(index + length);
  }

  // Append missing closing tags (reverse order — innermost first)
  for (let i = stack.length - 1; i >= 0; i--) {
    result += `</${stack[i]}>`;
  }

  return result;
}

// ── Lane Data Loader ─────────────────────────────────────────────────

/**
 * Parse a lane slug into origin + destination display names.
 * @param {string} slug — e.g. "atlanta-to-orlando"
 * @returns {{ origin: string, destination: string } | null}
 */
function parseSlug(slug) {
  const match = slug.match(/^(.+?)-to-(.+?)$/);
  if (!match) return null;

  const toDisplayName = (s) =>
    s.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  return {
    origin: toDisplayName(match[1]),
    destination: toDisplayName(match[2]),
  };
}

/**
 * Load lane data through the lane page factory.
 *
 * Uses produceLanePage() as the single canonical entry point.
 * The factory runs the full pipeline:
 *   buildLaneKnowledge → buildCanonicalLanePageData → buildRouteContract
 *   + quality gate validation + structural validation
 *
 * Returns the route contract payload consumed by the page component.
 */
function loadLaneData(slug) {
  const parsed = parseSlug(slug);
  if (!parsed) return null;

  try {
    const result = produceLanePage(parsed);
    return result.payload;
  } catch (err) {
    console.error(`[lane-page] Failed to load lane "${slug}":`, err?.message || err);
    return null;
  }
}

// ── Metadata Generation ──────────────────────────────────────────────

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const payload = loadLaneData(slug);

  if (!payload) {
    return {
      title: "Lane Not Found | WARP",
      description: "The requested freight lane page could not be found.",
      robots: "noindex, nofollow",
    };
  }

  return extractNextMetadata(payload);
}

// ── Page Component ───────────────────────────────────────────────────

export default async function LanePage({ params }) {
  const { slug } = await params;
  const payload = loadLaneData(slug);

  if (!payload) {
    return (
      <div className={styles.lanePage}>
        <div className={styles.pageContainer}>
          <div className={styles.hero}>
            <h1 className={styles.heroHeadline}>Lane Not Found</h1>
            <p className={styles.heroSubhead}>
              The freight lane &ldquo;{slug}&rdquo; could not be loaded.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const jsonLdObjects = extractJsonLdObjects(payload);

  return (
    <div className={styles.lanePage}>
      {/* JSON-LD Structured Data */}
      {jsonLdObjects.map((schema, i) => (
        <script
          key={`jsonld-${i}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}

      <div className={styles.pageContainer}>
        <HeroSection hero={payload.hero} route={payload.route} />

        {payload.kpi_panel?.html && (
          <section className={styles.kpiPanel}>
            <div className={styles.renderedContent}
              dangerouslySetInnerHTML={{ __html: balanceSectionHtml(payload.kpi_panel.html) }} />
          </section>
        )}

        {payload.execution_flow?.html && (
          <section className={styles.executionFlow}>
            <div className={styles.renderedContent}
              dangerouslySetInnerHTML={{ __html: balanceSectionHtml(payload.execution_flow.html) }} />
          </section>
        )}

        {payload.sections?.length > 0 && (
          <section className={styles.contentSections}>
            {payload.sections.map((section, i) => (
              <div key={section.id || i} className={styles.sectionBlock}>
                <div className={styles.renderedContent}
                  dangerouslySetInnerHTML={{ __html: balanceSectionHtml(section.html) }} />
              </div>
            ))}
          </section>
        )}

        {payload.proof?.html && (
          <section className={styles.proofSection}>
            <div className={styles.renderedContent}
              dangerouslySetInnerHTML={{ __html: balanceSectionHtml(payload.proof.html) }} />
          </section>
        )}

        {payload.faqs?.length > 0 && (
          <FaqSection faqs={payload.faqs} route={payload.route} />
        )}

        {payload.why_warp?.length > 0 && (
          <WhyWarpSection reasons={payload.why_warp} />
        )}

        {payload.comparison?.length > 0 && (
          <ComparisonSection points={payload.comparison} route={payload.route} />
        )}

        {payload.ctas?.final && (
          <FinalCtaSection cta={payload.ctas.final} />
        )}

        {payload.authority_links?.html && (
          <section className={styles.authorityLinks}>
            <div className={styles.renderedContent}
              dangerouslySetInnerHTML={{ __html: balanceSectionHtml(payload.authority_links.html) }} />
          </section>
        )}
      </div>

      {payload.quality && (
        <div className={styles.qualityBadge} data-grade={payload.quality.grade}>
          <span>{payload.quality.grade}</span>
          <span>{payload.quality.score}%</span>
          <span>{payload.quality.gates_passed}/{payload.quality.gates_total} gates</span>
        </div>
      )}
    </div>
  );
}

// ── Section Components ───────────────────────────────────────────────

function HeroSection({ hero, route }) {
  return (
    <section className={styles.hero}>
      <span className={styles.heroBadge}>{route?.mode || "LTL"} Freight</span>
      <h1 className={styles.heroHeadline}>{hero.headline}</h1>
      <p className={styles.heroSubhead}>{hero.subhead}</p>
      {hero.kpis?.length > 0 && (
        <div className={styles.heroKpis}>
          {hero.kpis.map((kpi, i) => (
            <div key={i} className={styles.kpiChip}>
              <span className={styles.kpiLabel}>{kpi.label}</span>
              <span className={styles.kpiValue}>{kpi.value}</span>
            </div>
          ))}
        </div>
      )}
      <div className={styles.heroCtas}>
        {hero.ctas?.primary?.url && (
          <a href={hero.ctas.primary.url} className={styles.ctaPrimary}>
            {hero.ctas.primary.label || "Get Instant Quote"}
          </a>
        )}
        {hero.ctas?.secondary?.url && (
          <a href={hero.ctas.secondary.url} className={styles.ctaSecondary}>
            {hero.ctas.secondary.label || "Book a Fit Call"}
          </a>
        )}
      </div>
    </section>
  );
}

function FaqSection({ faqs, route }) {
  const oCity = route?.origin?.city || "";
  const dCity = route?.destination?.city || "";
  const mode = route?.mode || "LTL";

  return (
    <section className={styles.faqSection}>
      <h2 className={styles.sectionHeading}>
        Frequently Asked Questions: {oCity} to {dCity} {mode}
      </h2>
      <div className={styles.faqList}>
        {faqs.map((faq, i) => (
          <div key={i} className={styles.faqItem}>
            <h3 className={styles.faqQuestion}>{faq.question}</h3>
            <p className={styles.faqAnswer}>{faq.answer}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WhyWarpSection({ reasons }) {
  return (
    <section className={styles.whyWarpSection}>
      <h2 className={styles.sectionHeading}>Why Shippers Choose WARP</h2>
      <div className={styles.cardGrid}>
        {reasons.map((reason, i) => (
          <div key={i} className={styles.reasonCard}>
            <h3 className={styles.reasonCardHeading}>{reason.heading}</h3>
            <p className={styles.reasonCardBody}>{reason.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ComparisonSection({ points, route }) {
  const mode = route?.mode || "LTL";
  return (
    <section className={styles.comparisonSection}>
      <h2 className={styles.sectionHeading}>Traditional {mode} vs WARP</h2>
      <table className={styles.comparisonTable}>
        <thead>
          <tr><th>Metric</th><th>Traditional</th><th>WARP</th></tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td className={styles.metricCell}>{p.metric}</td>
              <td className={styles.traditionalCell}>{p.traditional}</td>
              <td className={styles.warpCell}>{p.warp}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FinalCtaSection({ cta }) {
  if (!cta.headline) return null;
  return (
    <section className={styles.finalCta}>
      <h2 className={styles.finalCtaHeadline}>{cta.headline}</h2>
      {cta.body && <p className={styles.finalCtaBody}>{cta.body}</p>}
      <div className={styles.finalCtaActions}>
        {cta.primary?.url && (
          <a href={cta.primary.url} className={styles.ctaPrimary}>
            {cta.primary.label || "Get Instant Quote"}
          </a>
        )}
        {cta.secondary?.url && (
          <a href={cta.secondary.url} className={styles.ctaSecondary}>
            {cta.secondary.label || "Book a Fit Call"}
          </a>
        )}
      </div>
      {cta.trust_signals?.length > 0 && (
        <div className={styles.trustSignals}>
          {cta.trust_signals.map((signal, i) => (
            <span key={i}>{signal}</span>
          ))}
        </div>
      )}
    </section>
  );
}
