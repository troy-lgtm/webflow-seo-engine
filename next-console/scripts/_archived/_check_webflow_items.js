import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

async function main() {
  const token = process.env.WEBFLOW_API_TOKEN;
  const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID;
  const siteId = process.env.WEBFLOW_SITE_ID;

  // List items
  const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items?limit=20`, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
  });
  const data = await res.json();
  console.log(`Items in collection: ${data.items?.length || 0}`);
  for (const item of data.items || []) {
    console.log(`  ${item.id}  slug=${item.fieldData?.slug}  isDraft=${item.isDraft}  isArchived=${item.isArchived}  lastPublished=${item.lastPublished || "never"}`);
  }

  // Re-publish the site
  console.log("\nPublishing site to custom domains...");
  const pubRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ publishToWebflowSubdomain: false }),
  });
  console.log("Publish status:", pubRes.status);
  const pubData = await pubRes.text();
  console.log("Response:", pubData);
}

main().catch((e) => console.error(e));
