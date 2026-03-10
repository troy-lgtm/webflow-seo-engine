import type { ScanFinding } from "@/lib/types";
import type { JsonLdBlock } from "./extract-jsonld";

/**
 * Analyze JSON-LD blocks for FAQ-related issues.
 * Detects:
 * - Multiple FAQPage objects on the same page
 * - Duplicate FAQPage emission (layout + page)
 * - Malformed or empty FAQ entries
 * - Missing required FAQ fields
 */
export function findFaqIssues(blocks: JsonLdBlock[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const faqBlocks: { block: JsonLdBlock; source: string }[] = [];

  for (const block of blocks) {
    if (block.parseError) {
      findings.push({
        type: "json_parse_error",
        message: `JSON-LD block ${block.index} failed to parse: ${block.parseError}`,
        context: { raw: block.raw.slice(0, 200) },
      });
      continue;
    }

    if (!block.parsed) continue;

    // Check for FAQPage types
    const faqSources = findFaqPageInObject(block.parsed, block.index);
    for (const src of faqSources) {
      faqBlocks.push({ block, source: src });
    }
  }

  // Multiple FAQPage objects = duplicate field issue
  if (faqBlocks.length > 1) {
    findings.push({
      type: "faq_duplicate",
      message: `Found ${faqBlocks.length} FAQPage objects on the same page. Google requires exactly one.`,
      context: {
        sources: faqBlocks.map((f) => f.source),
        blockIndices: faqBlocks.map((f) => f.block.index),
      },
    });
  }

  // Validate individual FAQ entries
  for (const { block } of faqBlocks) {
    const faqObj = extractFaqPage(block.parsed!);
    if (faqObj) {
      const entryIssues = validateFaqEntries(faqObj, block.index);
      findings.push(...entryIssues);
    }
  }

  // No FAQ at all (might be expected, but flag for scan results)
  if (faqBlocks.length === 0 && blocks.length > 0) {
    // Not an issue per se — some pages don't have FAQ
  }

  return findings;
}

function findFaqPageInObject(obj: Record<string, unknown>, blockIndex: number): string[] {
  const sources: string[] = [];

  if (obj["@type"] === "FAQPage") {
    sources.push(`block[${blockIndex}] root`);
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if ((obj[i] as Record<string, unknown>)?.["@type"] === "FAQPage") {
        sources.push(`block[${blockIndex}] array[${i}]`);
      }
    }
  }

  if (obj["@graph"] && Array.isArray(obj["@graph"])) {
    for (let i = 0; i < obj["@graph"].length; i++) {
      const item = obj["@graph"][i] as Record<string, unknown>;
      if (item?.["@type"] === "FAQPage") {
        sources.push(`block[${blockIndex}] @graph[${i}]`);
      }
    }
  }

  return sources;
}

function extractFaqPage(obj: Record<string, unknown>): Record<string, unknown> | null {
  if (obj["@type"] === "FAQPage") return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if ((item as Record<string, unknown>)?.["@type"] === "FAQPage") return item as Record<string, unknown>;
    }
  }
  if (obj["@graph"] && Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"]) {
      if ((item as Record<string, unknown>)?.["@type"] === "FAQPage") return item as Record<string, unknown>;
    }
  }
  return null;
}

function validateFaqEntries(faqPage: Record<string, unknown>, blockIndex: number): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const mainEntity = faqPage.mainEntity;

  if (!mainEntity) {
    findings.push({
      type: "faq_missing_main_entity",
      message: `FAQPage in block[${blockIndex}] has no mainEntity array.`,
    });
    return findings;
  }

  if (!Array.isArray(mainEntity)) {
    findings.push({
      type: "faq_invalid_main_entity",
      message: `FAQPage in block[${blockIndex}] mainEntity is not an array.`,
    });
    return findings;
  }

  if (mainEntity.length === 0) {
    findings.push({
      type: "faq_empty_main_entity",
      message: `FAQPage in block[${blockIndex}] has an empty mainEntity array.`,
    });
  }

  for (let i = 0; i < mainEntity.length; i++) {
    const entry = mainEntity[i] as Record<string, unknown>;
    if (!entry?.["@type"] || entry["@type"] !== "Question") {
      findings.push({
        type: "faq_invalid_entry_type",
        message: `FAQ entry ${i} in block[${blockIndex}] is not @type Question.`,
      });
    }
    if (!entry?.name) {
      findings.push({
        type: "faq_missing_question",
        message: `FAQ entry ${i} in block[${blockIndex}] missing "name" (question text).`,
      });
    }
    const answer = entry?.acceptedAnswer as Record<string, unknown> | undefined;
    if (!answer?.text) {
      findings.push({
        type: "faq_missing_answer",
        message: `FAQ entry ${i} in block[${blockIndex}] missing accepted answer text.`,
      });
    }
  }

  return findings;
}
