/**
 * render-authority-page.js — Content Renderer for Authority Pages
 *
 * Takes canonical authority page data (from authority-page-schema.js) and
 * produces deterministic HTML/text content for each page type.
 *
 * Mirrors the render-lane-page.js pattern:
 *   - Deterministic: same input always produces same output
 *   - No randomness, no external calls
 *   - Section-exclusive rendering (each function owns its section)
 *   - Operational freight language, not generic marketing
 *
 * Output types:
 *   - renderAuthorityPageBody(pageData) → plain text body summary
 *   - renderAuthorityPrimaryContent(pageData) → HTML primary content
 *   - renderAuthorityFaqSchema(pageData) → JSON-LD FAQ schema embed
 *   - renderAuthorityBreadcrumbSchema(pageData) → JSON-LD breadcrumb
 *
 * @module render-authority-page
 */

const SITE_BASE = "https://www.wearewarp.com";

// ── Helpers ──────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash;
}

// ── Body Text Renderer ───────────────────────────────────────────────

/**
 * Render a plain-text body summary for the authority page.
 * Follows the same pattern as renderLanePageBody() — plain text,
 * double line breaks for paragraph separation.
 *
 * @param {object} pageData - Canonical authority page data
 * @returns {string} Plain text body content
 */
export function renderAuthorityPageBody(pageData) {
  const type = pageData.page_type;
  const paragraphs = [];

  if (type === "solution") {
    paragraphs.push(renderSolutionBody(pageData));
  } else if (type === "concept") {
    paragraphs.push(renderConceptBody(pageData));
  } else if (type === "equipment") {
    paragraphs.push(renderEquipmentBody(pageData));
  }

  return paragraphs.join("\n\n");
}

function renderSolutionBody(pd) {
  const parts = [];
  const label = pd.hero?.headline?.replace(" Freight Solutions", "") || pd.slug;

  // Overview
  parts.push(pd.overview?.content || "");

  // WARP approach
  if (pd.warp_approach?.differentiators?.length > 0) {
    parts.push(`WARP runs ${label.toLowerCase()} programs with ${pd.warp_approach.differentiators.slice(0, 2).join(", and ").toLowerCase()}.`);
  }

  // Modes
  if (pd.modes?.length > 0) {
    parts.push(`Available across ${pd.modes.join(" and ")} shipping modes. Get an instant rate at wearewarp.com/quote.`);
  }

  return parts.filter(Boolean).join("\n\n");
}

function renderConceptBody(pd) {
  const parts = [];

  parts.push(pd.overview?.content || "");

  if (pd.how_it_works?.content) {
    parts.push(pd.how_it_works.content);
  }

  if (pd.applies_to_modes?.length > 0) {
    parts.push(`Applies to ${pd.applies_to_modes.join(", ")} freight operations. Learn how WARP implements this at wearewarp.com/quote.`);
  }

  return parts.filter(Boolean).join("\n\n");
}

function renderEquipmentBody(pd) {
  const parts = [];
  const label = pd.hero?.headline?.replace(" Freight Shipping", "") || pd.slug;
  const specs = pd.specs?.data || {};

  parts.push(pd.overview?.content || "");

  if (specs.capacity_pallets) {
    parts.push(`A ${label.toLowerCase()} handles ${specs.capacity_pallets} pallets with a capacity of ${specs.capacity_lbs || "varies"} lbs. Interior dimensions: ${specs.interior_length_ft || "varies"} ft length, ${specs.interior_height_ft || "varies"} ft height.`);
  }

  if (pd.best_fit?.items?.length > 0) {
    parts.push(`Best fit for: ${pd.best_fit.items.slice(0, 2).join("; ")}.`);
  }

  parts.push(`Get an instant ${label.toLowerCase()} freight rate at wearewarp.com/quote.`);

  return parts.filter(Boolean).join("\n\n");
}

// ── Primary Content HTML Renderer ────────────────────────────────────

/**
 * Render the full HTML primary content for an authority page.
 * This is the main rendered content area — equivalent to the
 * lane page's FAQ schema embed that carries the full content experience.
 *
 * @param {object} pageData - Canonical authority page data
 * @returns {string} HTML content
 */
export function renderAuthorityPrimaryContent(pageData) {
  const type = pageData.page_type;

  if (type === "solution") return renderSolutionContent(pageData);
  if (type === "concept") return renderConceptContent(pageData);
  if (type === "equipment") return renderEquipmentContent(pageData);

  return "";
}

function renderSolutionContent(pd) {
  const parts = [];

  // Overview section
  parts.push(`<h2>${escapeHtml(pd.overview?.heading || "Overview")}</h2>`);
  parts.push(`<p>${escapeHtml(pd.overview?.content || "")}</p>`);
  if (pd.modes?.length > 0) {
    parts.push(`<p><strong>Shipping modes:</strong> ${escapeHtml(pd.modes.join(", "))}</p>`);
  }

  // How it works
  if (pd.how_it_works?.steps?.length > 0) {
    parts.push(`<h2>${escapeHtml(pd.how_it_works.heading)}</h2>`);
    parts.push("<ul>");
    for (const step of pd.how_it_works.steps) {
      parts.push(`<li>${escapeHtml(step)}</li>`);
    }
    parts.push("</ul>");
  }

  // WARP approach
  if (pd.warp_approach?.differentiators?.length > 0) {
    parts.push(`<h2>${escapeHtml(pd.warp_approach.heading)}</h2>`);
    parts.push("<ul>");
    for (const d of pd.warp_approach.differentiators) {
      parts.push(`<li>${escapeHtml(d)}</li>`);
    }
    parts.push("</ul>");
  }

  // Use cases
  if (pd.use_cases?.cases?.length > 0) {
    parts.push(`<h2>${escapeHtml(pd.use_cases.heading)}</h2>`);
    parts.push("<ul>");
    for (const c of pd.use_cases.cases) {
      parts.push(`<li>${escapeHtml(c)}</li>`);
    }
    parts.push("</ul>");
  }

  // Equipment fit
  if (pd.equipment_fit?.equipment?.length > 0) {
    parts.push(`<h2>${escapeHtml(pd.equipment_fit.heading)}</h2>`);
    for (const eq of pd.equipment_fit.equipment) {
      parts.push(`<h3><a href="${escapeHtml(eq.path)}">${escapeHtml(eq.label)}</a></h3>`);
      parts.push(`<p>${escapeHtml(eq.description)}</p>`);
      if (eq.specs?.capacity_pallets) {
        parts.push(`<p>Capacity: ${escapeHtml(eq.specs.capacity_pallets)} pallets, ${escapeHtml(eq.specs.capacity_lbs || "varies")} lbs</p>`);
      }
    }
  }

  // Related concepts
  if (pd.related_concepts?.concepts?.length > 0) {
    parts.push(`<h2>${escapeHtml(pd.related_concepts.heading)}</h2>`);
    parts.push("<ul>");
    for (const c of pd.related_concepts.concepts) {
      parts.push(`<li><a href="${escapeHtml(c.path)}">${escapeHtml(c.label)}</a> — ${escapeHtml(c.description)}</li>`);
    }
    parts.push("</ul>");
  }

  // CTA
  parts.push(renderCtaSection(pd.cta));

  return parts.join("\n");
}

function renderConceptContent(pd) {
  const parts = [];

  // Overview
  parts.push(`<h2>${escapeHtml(pd.overview?.heading || "Overview")}</h2>`);
  parts.push(`<p>${escapeHtml(pd.overview?.content || "")}</p>`);
  if (pd.applies_to_modes?.length > 0) {
    parts.push(`<p><strong>Applies to:</strong> ${escapeHtml(pd.applies_to_modes.join(", "))}</p>`);
  }

  // How it works
  if (pd.how_it_works?.content) {
    parts.push(`<h2>${escapeHtml(pd.how_it_works.heading)}</h2>`);
    parts.push(`<p>${escapeHtml(pd.how_it_works.content)}</p>`);
  }

  // WARP implementation
  if (pd.warp_implementation?.points?.length > 0) {
    parts.push(`<h2>${escapeHtml(pd.warp_implementation.heading)}</h2>`);
    parts.push("<ul>");
    for (const p of pd.warp_implementation.points) {
      parts.push(`<li>${escapeHtml(p)}</li>`);
    }
    parts.push("</ul>");
  }

  // When to use
  if (pd.when_to_use?.content) {
    parts.push(`<h2>${escapeHtml(pd.when_to_use.heading)}</h2>`);
    parts.push(`<p>${escapeHtml(pd.when_to_use.content)}</p>`);
  }

  // Metrics
  if (pd.metrics?.items?.length > 0) {
    parts.push(`<h2>${escapeHtml(pd.metrics.heading)}</h2>`);
    parts.push("<ul>");
    for (const m of pd.metrics.items) {
      parts.push(`<li><strong>${escapeHtml(m.label)}</strong></li>`);
    }
    parts.push("</ul>");
  }

  // Related
  if (pd.related) {
    const hasSolutions = pd.related.solutions?.length > 0;
    const hasEquipment = pd.related.equipment?.length > 0;
    const hasConcepts = pd.related.concepts?.length > 0;
    if (hasSolutions || hasEquipment || hasConcepts) {
      parts.push(`<h2>${escapeHtml(pd.related.heading)}</h2>`);
      if (hasSolutions) {
        parts.push("<h3>Solutions</h3><ul>");
        for (const s of pd.related.solutions) {
          parts.push(`<li><a href="${escapeHtml(s.path)}">${escapeHtml(s.label)}</a> — ${escapeHtml(s.description)}</li>`);
        }
        parts.push("</ul>");
      }
      if (hasEquipment) {
        parts.push("<h3>Equipment</h3><ul>");
        for (const e of pd.related.equipment) {
          parts.push(`<li><a href="${escapeHtml(e.path)}">${escapeHtml(e.label)}</a> — ${escapeHtml(e.description)}</li>`);
        }
        parts.push("</ul>");
      }
      if (hasConcepts) {
        parts.push("<h3>Related Concepts</h3><ul>");
        for (const c of pd.related.concepts) {
          parts.push(`<li><a href="${escapeHtml(c.path)}">${escapeHtml(c.label)}</a> — ${escapeHtml(c.description)}</li>`);
        }
        parts.push("</ul>");
      }
    }
  }

  // CTA
  parts.push(renderCtaSection(pd.cta));

  return parts.join("\n");
}

function renderEquipmentContent(pd) {
  const parts = [];

  // Overview
  parts.push(`<h2>${escapeHtml(pd.overview?.heading || "Overview")}</h2>`);
  parts.push(`<p>${escapeHtml(pd.overview?.content || "")}</p>`);
  if (pd.mode) {
    parts.push(`<p><strong>Mode:</strong> ${escapeHtml(pd.mode)}</p>`);
  }

  // Specs table
  if (pd.specs?.data && Object.keys(pd.specs.data).length > 0) {
    parts.push(`<h2>${escapeHtml(pd.specs.heading)}</h2>`);
    parts.push("<table><thead><tr><th>Specification</th><th>Value</th></tr></thead><tbody>");
    for (const [key, value] of Object.entries(pd.specs.data)) {
      const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      parts.push(`<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`);
    }
    parts.push("</tbody></table>");
  }

  // Best fit
  if (pd.best_fit?.items?.length > 0) {
    parts.push(`<h2>${escapeHtml(pd.best_fit.heading)}</h2>`);
    parts.push("<ul>");
    for (const item of pd.best_fit.items) {
      parts.push(`<li>${escapeHtml(item)}</li>`);
    }
    parts.push("</ul>");
  }

  // Not ideal for
  if (pd.not_ideal?.items?.length > 0) {
    parts.push(`<h2>${escapeHtml(pd.not_ideal.heading)}</h2>`);
    parts.push("<ul>");
    for (const item of pd.not_ideal.items) {
      parts.push(`<li>${escapeHtml(item)}</li>`);
    }
    parts.push("</ul>");
  }

  // Related solutions
  if (pd.related_solutions?.solutions?.length > 0) {
    parts.push(`<h2>${escapeHtml(pd.related_solutions.heading)}</h2>`);
    parts.push("<ul>");
    for (const s of pd.related_solutions.solutions) {
      parts.push(`<li><a href="${escapeHtml(s.path)}">${escapeHtml(s.label)}</a> — ${escapeHtml(s.description)}</li>`);
    }
    parts.push("</ul>");
  }

  // Related concepts
  if (pd.related_concepts?.concepts?.length > 0) {
    parts.push(`<h2>${escapeHtml(pd.related_concepts.heading)}</h2>`);
    parts.push("<ul>");
    for (const c of pd.related_concepts.concepts) {
      parts.push(`<li><a href="${escapeHtml(c.path)}">${escapeHtml(c.label)}</a> — ${escapeHtml(c.description)}</li>`);
    }
    parts.push("</ul>");
  }

  // CTA
  parts.push(renderCtaSection(pd.cta));

  return parts.join("\n");
}

function renderCtaSection(cta) {
  if (!cta) return "";
  const parts = [];
  parts.push(`<div class="authority-cta">`);
  parts.push(`<h2>${escapeHtml(cta.heading || "Get Started")}</h2>`);
  if (cta.primary) {
    parts.push(`<a href="${escapeHtml(cta.primary.url)}" class="cta-primary">${escapeHtml(cta.primary.label)}</a>`);
  }
  if (cta.secondary) {
    parts.push(`<a href="${escapeHtml(cta.secondary.url)}" class="cta-secondary">${escapeHtml(cta.secondary.label)}</a>`);
  }
  parts.push("</div>");
  return parts.join("\n");
}

// ── FAQ Schema Renderer ──────────────────────────────────────────────

/**
 * Render JSON-LD FAQ schema markup for the authority page.
 * Embedded as a <script type="application/ld+json"> tag.
 *
 * @param {object} pageData - Canonical authority page data
 * @returns {string} HTML script tag with FAQ JSON-LD
 */
export function renderAuthorityFaqSchema(pageData) {
  const faqItems = pageData.faq?.items || [];
  if (faqItems.length === 0) return "";

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map(item => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };

  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

// ── Breadcrumb Schema Renderer ───────────────────────────────────────

/**
 * Render JSON-LD breadcrumb schema for the authority page.
 *
 * Structure:
 *   Home → {Family} → {Page}
 *   e.g., Home → Solutions → Store Replenishment
 *
 * @param {object} pageData - Canonical authority page data
 * @returns {string} HTML script tag with breadcrumb JSON-LD
 */
export function renderAuthorityBreadcrumbSchema(pageData) {
  const type = pageData.page_type;
  const familyLabel = type === "solution" ? "Solutions"
    : type === "concept" ? "Network"
    : type === "equipment" ? "Equipment"
    : "Pages";
  const familyPath = type === "solution" ? "/solutions"
    : type === "concept" ? "/network"
    : type === "equipment" ? "/equipment"
    : "";

  const label = pageData.hero?.headline || pageData.slug || "";
  const canonicalPath = pageData.canonical_path || "";

  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: SITE_BASE,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: familyLabel,
        item: `${SITE_BASE}${familyPath}`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: label,
        item: `${SITE_BASE}${canonicalPath}`,
      },
    ],
  };

  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

// ── Service Schema Renderer ──────────────────────────────────────────

/**
 * Render JSON-LD Service schema for solution/concept pages.
 *
 * @param {object} pageData - Canonical authority page data
 * @returns {string} HTML script tag with Service JSON-LD
 */
export function renderAuthorityServiceSchema(pageData) {
  const label = pageData.hero?.headline || pageData.slug || "";
  const description = pageData.meta_description || pageData.overview?.content || "";

  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: label,
    description: description,
    provider: {
      "@type": "Organization",
      name: "WARP",
      url: SITE_BASE,
    },
    areaServed: {
      "@type": "Country",
      name: "United States",
    },
    serviceType: "Freight Logistics",
  };

  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

// ── Full Page Render ─────────────────────────────────────────────────

/**
 * Render all content for an authority page in a single call.
 * Returns an object with all rendered fields.
 *
 * @param {object} pageData - Canonical authority page data
 * @returns {object} All rendered content fields
 */
export function renderAuthorityPage(pageData) {
  return {
    body_text: renderAuthorityPageBody(pageData),
    primary_content_html: renderAuthorityPrimaryContent(pageData),
    faq_schema_html: renderAuthorityFaqSchema(pageData),
    breadcrumb_schema_html: renderAuthorityBreadcrumbSchema(pageData),
    service_schema_html: renderAuthorityServiceSchema(pageData),
  };
}
