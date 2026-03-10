import fs from "fs";
import { resolveFromRoot } from "@/lib/fs/project-root.js";

const PUBLISHED_PATH = resolveFromRoot("data", "published_pages.json");
const BASE_URL = "https://www.wearewarp.com";

export async function GET() {
  let items = [];
  try {
    if (fs.existsSync(PUBLISHED_PATH)) {
      const raw = fs.readFileSync(PUBLISHED_PATH, "utf-8");
      const manifest = JSON.parse(raw);
      const pages = Array.isArray(manifest) ? manifest : manifest.pages || [];
      items = pages
        .filter((p) => p.slug && p.status !== "draft" && p.status !== "removed")
        .slice(0, 50)
        .map((p) => ({
          title: p.seo_title || p.slug,
          link: `${BASE_URL}/${p.slug}`,
          pubDate: p.published_date || new Date().toISOString().slice(0, 10),
          description: p.meta_description || `Freight lane page: ${p.slug}`
        }));
    }
  } catch {
    // fallback to empty
  }

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>WARP Freight Lanes — New Pages</title>
    <link>${BASE_URL}</link>
    <description>Recently published freight lane pages on WARP</description>
    <language>en-us</language>
    <atom:link href="${BASE_URL}/rss.xml" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.map((it) => `    <item>
      <title>${escapeXml(it.title)}</title>
      <link>${it.link}</link>
      <pubDate>${it.pubDate}</pubDate>
      <description>${escapeXml(it.description)}</description>
      <guid>${it.link}</guid>
    </item>`).join("\n")}
  </channel>
</rss>`;

  return new Response(rss, {
    status: 200,
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" }
  });
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
