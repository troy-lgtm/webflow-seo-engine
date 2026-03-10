import { config } from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
config({ path: path.join(ROOT, ".env.local") });

const RATE_LIMIT_MS = 1200;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const token = process.env.WEBFLOW_API_TOKEN;
  const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID;
  const siteId = process.env.WEBFLOW_SITE_ID;

  // Step 1: Get site domains
  console.log("Step 1: Getting site domains...");
  const domainsRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}/custom_domains`, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (domainsRes.ok) {
    const domainData = await domainsRes.json();
    console.log("  Custom domains:", JSON.stringify(domainData));
  } else {
    console.log("  Domains fetch failed:", domainsRes.status);
    // Try alternative endpoint
    const siteRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}`, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const siteData = await siteRes.json();
    console.log("  Site data:", JSON.stringify(siteData.customDomains || siteData.domains || siteData, null, 2));
  }

  // Step 2: Get our 3 test items
  console.log("\nStep 2: Finding our 3 test items...");
  const testSlugs = ["los-angeles-to-phoenix", "long-beach-to-phoenix", "san-diego-to-phoenix"];
  const allItems = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items?limit=100&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    const data = await res.json();
    allItems.push(...(data.items || []));
    if (!data.items || data.items.length < 100) break;
    offset += 100;
    await sleep(RATE_LIMIT_MS);
  }
  console.log(`  Total items in collection: ${allItems.length}`);

  const testItems = allItems.filter(item => {
    const slug = item.fieldData?.slug || "";
    return testSlugs.some(ts => slug.startsWith(ts));
  });
  console.log(`  Test items found: ${testItems.length}`);
  for (const item of testItems) {
    console.log(`    ${item.id}  slug=${item.fieldData?.slug}  isDraft=${item.isDraft}  lastPublished=${item.lastPublished || "never"}`);
  }

  // Step 3: Publish the items
  if (testItems.length > 0) {
    console.log("\nStep 3: Publishing items...");
    const itemIds = testItems.map(i => i.id);
    const pubRes = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items/publish`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ itemIds }),
    });
    console.log(`  Publish items status: ${pubRes.status}`);
    const pubData = await pubRes.text();
    console.log(`  Response: ${pubData}`);
    await sleep(RATE_LIMIT_MS);
  }

  // Step 4: Publish site
  console.log("\nStep 4: Publishing site...");
  // Try the publishToWebflowSubdomain approach first
  const siteRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ publishToWebflowSubdomain: true }),
  });
  console.log(`  Site publish status: ${siteRes.status}`);
  const siteData = await siteRes.text();
  console.log(`  Response: ${siteData}`);

  // Step 5: Verify after delay
  console.log("\nStep 5: Waiting 15s for propagation...");
  await sleep(15000);

  for (const slug of testSlugs) {
    try {
      const res = await fetch(`https://www.wearewarp.com/lanes/${slug}`, { method: "HEAD", redirect: "follow" });
      console.log(`  ${slug}: HTTP ${res.status}`);
    } catch (e) {
      console.log(`  ${slug}: Error - ${e.message}`);
    }
  }

  // Update published_pages.json
  const publishedPath = path.join(ROOT, "data", "published_pages.json");
  const published = testItems.map(item => ({
    slug: item.fieldData?.slug || "",
    origin: item.fieldData?.["hero-headline"]?.split(" to ")[0]?.replace(/ (LTL|FTL).*/, "") || "",
    destination: "",
    webflow_item_id: item.id,
    published_at: new Date().toISOString(),
    quality_score: 100,
  }));
  fs.writeFileSync(publishedPath, JSON.stringify(published, null, 2) + "\n");
  console.log(`\n  Updated published_pages.json (${published.length} entries)`);
}

main().catch(e => console.error(e));
