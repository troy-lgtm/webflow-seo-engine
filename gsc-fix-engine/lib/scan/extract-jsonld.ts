import * as cheerio from "cheerio";

export interface JsonLdBlock {
  index: number;
  raw: string;
  parsed: Record<string, unknown> | null;
  parseError?: string;
  types: string[];
}

/**
 * Extract all application/ld+json script blocks from HTML.
 * Parses each defensively, returning both raw and parsed forms.
 */
export function extractJsonLd(html: string): JsonLdBlock[] {
  const $ = cheerio.load(html);
  const blocks: JsonLdBlock[] = [];

  $('script[type="application/ld+json"]').each((index, el) => {
    const raw = $(el).text().trim();
    let parsed: Record<string, unknown> | null = null;
    let parseError: string | undefined;
    const types: string[] = [];

    try {
      const obj = JSON.parse(raw);
      parsed = obj;

      // Extract @type(s)
      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (item?.["@type"]) {
            types.push(
              Array.isArray(item["@type"]) ? item["@type"].join(", ") : item["@type"]
            );
          }
        }
      } else if (obj?.["@graph"]) {
        for (const item of obj["@graph"]) {
          if (item?.["@type"]) {
            types.push(
              Array.isArray(item["@type"]) ? item["@type"].join(", ") : item["@type"]
            );
          }
        }
      } else if (obj?.["@type"]) {
        types.push(
          Array.isArray(obj["@type"]) ? obj["@type"].join(", ") : obj["@type"]
        );
      }
    } catch (e) {
      parseError = e instanceof Error ? e.message : "JSON parse error";
    }

    blocks.push({ index, raw, parsed, parseError, types });
  });

  return blocks;
}

/**
 * Extract the HTML <title> from a page.
 */
export function extractTitle(html: string): string {
  const $ = cheerio.load(html);
  return $("title").first().text().trim();
}
