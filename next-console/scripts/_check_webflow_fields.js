import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "..", ".env.local") });

async function main() {
  const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID;
  const token = process.env.WEBFLOW_API_TOKEN;

  const res = await fetch(`https://api.webflow.com/v2/collections/${collectionId}`, {
    headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
  });

  if (!res.ok) {
    console.log("Error:", res.status, await res.text());
    return;
  }

  const data = await res.json();
  console.log("Collection:", data.displayName || data.slug);
  console.log(`Fields (${data.fields.length}):`);
  for (const f of data.fields) {
    const flags = [];
    if (f.isRequired) flags.push("REQUIRED");
    if (f.isEditable === false) flags.push("readonly");
    console.log(`  ${f.slug} (${f.type})${flags.length ? " [" + flags.join(", ") + "]" : ""}`);
  }
}

main().catch((e) => console.error(e));
