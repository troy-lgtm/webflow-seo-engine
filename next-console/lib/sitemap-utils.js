// Build a valid sitemap XML string from a list of URL entries.
// Each entry: { loc, lastmod?, changefreq?, priority? }
export function buildSitemapXml(entries) {
  const urls = (entries || [])
    .filter((e) => e.loc)
    .map((e) => {
      let xml = `  <url>\n    <loc>${escapeXml(e.loc)}</loc>`;
      if (e.lastmod) xml += `\n    <lastmod>${escapeXml(e.lastmod)}</lastmod>`;
      if (e.changefreq) xml += `\n    <changefreq>${escapeXml(e.changefreq)}</changefreq>`;
      if (e.priority !== undefined) xml += `\n    <priority>${e.priority}</priority>`;
      xml += "\n  </url>";
      return xml;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

// Build an empty sitemap with an XML comment
export function buildEmptySitemap(comment) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${escapeXml(comment || "No published pages yet")} -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>`;
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
