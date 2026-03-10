/**
 * Apply edit instructions to a lane page package.
 *
 * Uses deterministic rules:
 * - If instruction references a section name, rewrite only that section
 * - If instruction says "shorter", shorten the section by ~30%
 * - Never changes canonical, slug, or structured data
 *
 * @param {object} packageData - Current package from buildLanePackage or ship script
 * @param {string} editInstructions - Plain text edit instructions
 * @returns {object} Updated packageData (mutated copy)
 */
export function applyEdits(packageData, editInstructions) {
  const updated = JSON.parse(JSON.stringify(packageData));
  const page = updated.page;
  const instructions = editInstructions.toLowerCase();

  // Map section keywords to page fields
  const sectionMap = {
    intro: "intro",
    introduction: "intro",
    problem: "problem_section",
    solution: "solution_section",
    h1: "h1",
    heading: "h1",
    "seo title": "seo_title",
    title: "seo_title",
    "meta description": "meta_description",
    description: "meta_description",
    "cta primary": "cta_primary",
    "cta secondary": "cta_secondary"
  };

  // Protected fields — never change these
  const protectedFields = new Set(["slug", "canonical_path"]);

  // Detect "shorter" / "shorten" requests
  const wantsShorter = /\bshort(er|en)\b/i.test(instructions);

  // Detect "longer" / "expand" requests
  const wantsLonger = /\b(longer|expand|elaborate)\b/i.test(instructions);

  // Find which sections are referenced
  const referencedFields = [];
  for (const [keyword, field] of Object.entries(sectionMap)) {
    if (instructions.includes(keyword) && !protectedFields.has(field)) {
      referencedFields.push(field);
    }
  }

  // If no specific section is referenced but shorter/longer is requested,
  // apply to the main content sections
  const targetFields =
    referencedFields.length > 0
      ? [...new Set(referencedFields)]
      : wantsShorter || wantsLonger
        ? ["intro", "problem_section", "solution_section"]
        : [];

  for (const field of targetFields) {
    if (!page[field] || typeof page[field] !== "string") continue;

    if (wantsShorter) {
      page[field] = shortenText(page[field]);
    } else if (wantsLonger) {
      page[field] = expandText(page[field], field);
    }
  }

  // Handle specific rewrite instructions that aren't just shorter/longer
  // If the instruction contains replacement text after a colon pattern like "change intro to: ..."
  const rewriteMatch = instructions.match(
    /(?:change|set|replace|rewrite)\s+(\w+)\s+(?:to|with|as)[:\s]+(.+)/i
  );
  if (rewriteMatch) {
    const sectionKey = rewriteMatch[1].toLowerCase();
    const newText = editInstructions.slice(
      editInstructions.toLowerCase().indexOf(rewriteMatch[2].toLowerCase()),
      editInstructions.length
    ).trim();
    const field = sectionMap[sectionKey];
    if (field && !protectedFields.has(field) && newText) {
      page[field] = newText;
    }
  }

  // Update seo_title in the package name field if it was changed
  updated.page = page;
  return updated;
}

function shortenText(text) {
  const words = text.split(/\s+/);
  const targetLen = Math.max(5, Math.ceil(words.length * 0.7));
  return words.slice(0, targetLen).join(" ") + (targetLen < words.length ? "." : "");
}

function expandText(text, field) {
  // Add a clarifying sentence based on field type
  const additions = {
    intro:
      " This lane-specific approach helps teams move faster with less manual work.",
    problem_section:
      " These challenges compound over time, leading to higher costs and lower service reliability.",
    solution_section:
      " The result is a measurable improvement in both speed and cost efficiency for every shipment."
  };
  return text + (additions[field] || "");
}
