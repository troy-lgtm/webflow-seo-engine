import { buildSitemapXml, buildEmptySitemap } from "@/lib/sitemap-utils";
import fs from "fs";
import { resolveFromRoot } from "@/lib/fs/project-root.js";

const PUBLISHED_PATH = resolveFromRoot("data", "published_pages.json");
const BASE_URL = "https://www.wearewarp.com";

// Slugs disallowed in robots.txt — must not appear in sitemap
const DISALLOWED_SLUGS = new Set([
  "warp-meeting-confirmation",
  "book-a-freight-instantly-pseudo",
]);

export async function GET() {
  let xml;
  try {
    if (fs.existsSync(PUBLISHED_PATH)) {
      const raw = fs.readFileSync(PUBLISHED_PATH, "utf-8");
      const pages = JSON.parse(raw);
      const indexable = (Array.isArray(pages) ? pages : [])
        .filter((p) => p.slug && p.status !== "draft" && p.status !== "removed" && !DISALLOWED_SLUGS.has(p.slug));

      if (indexable.length === 0) {
        xml = buildEmptySitemap("Published manifest exists but contains no indexable pages");
      } else {
        const entries = indexable.map((p) => ({
          loc: `${BASE_URL}/${p.slug}`,
          lastmod: p.published_date || new Date().toISOString().slice(0, 10),
          changefreq: "weekly",
          priority: 0.7
        }));
        xml = buildSitemapXml(entries);
      }
    } else {
      xml = buildEmptySitemap("No published_pages.json found. Export and publish pages first.");
    }
  } catch {
    xml = buildEmptySitemap("Error reading published manifest");
  }

  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "application/xml; charset=utf-8" }
  });
}
