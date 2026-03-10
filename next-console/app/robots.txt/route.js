export async function GET() {
  const body = `User-agent: *
Allow: /
Disallow: /warp-meeting-confirmation
Disallow: /book-a-freight-instantly-pseudo

Sitemap: https://www.wearewarp.com/sitemap.xml
`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}
