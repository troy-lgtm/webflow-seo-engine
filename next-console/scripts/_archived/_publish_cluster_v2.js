import { config } from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { safeRegistryUpdate } from "../lib/publish-registry-disk.js";
import {
  createManifest, setIntended, addPublished, addFailed,
  setDeploy, setEmail, setSampleLiveUrls, addWarning,
  finalizeManifest, saveManifest, printManifestSummary,
} from "../lib/publish-manifest.js";
import {
  verifyLiveUrls, buildReceipt, saveReceipt, printReceipt,
  buildConfirmationEmailHtml,
} from "../lib/publish-receipt.js";
import { transitionState } from "../lib/approval-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
config({ path: path.join(ROOT, ".env.local") });

const RATE_LIMIT_MS = 1200;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildWebflowSafePayload(fullPayload) {
  const bodyParts = [
    fullPayload["body-content"] || "",
    fullPayload["proof-section"] || "",
    fullPayload["faq-schema"] || "",
    fullPayload["breadcrumb-schema"] || "",
  ].filter(Boolean);

  return {
    name: fullPayload["name"] || "",
    slug: fullPayload["slug"] || "",
    "hero-headline": fullPayload["hero-headline"] || "",
    subheadline: fullPayload["subheadline"] || "",
    "body-content": bodyParts.join("\n\n"),
    "seo-title": fullPayload["seo-title"] || "",
    "seo-meta-description": fullPayload["seo-description"] || fullPayload["seo-meta-description"] || "",
    address: fullPayload["address"] || "",
    "traditional-ltl": (fullPayload["traditional-ltl"] || "").replace(/\n/g, " | "),
    "warp-ltl": (fullPayload["warp-ltl"] || "").replace(/\n/g, " | "),
    "index-page": fullPayload["index-page"] ?? true,
  };
}

async function main() {
  const token = process.env.WEBFLOW_API_TOKEN;
  const collectionId = process.env.WEBFLOW_LANE_COLLECTION_ID;
  const siteId = process.env.WEBFLOW_SITE_ID;
  const SLUGS = ["los-angeles-to-phoenix", "long-beach-to-phoenix", "san-diego-to-phoenix"];
  const domainIds = ["689442045dc003d002d08285", "689442045dc003d002d08271"];

  // Create manifest for this run
  const manifest = createManifest({
    scriptName: "_publish_cluster_v2.js",
    triggerSource: "manual",
    dryRun: false,
  });
  setIntended(manifest, SLUGS.length);

  console.log("=== Publish Cluster v2 ===\n");

  // Step 1: Delete the draft items we created
  console.log("Step 1: Cleanup draft items...");
  const draftIds = [
    "69aab045c0f8adcccfbb16a5",
    "69aab0411f9db619d9678216",
    "69aab03d7c32141c926c9625",
  ];
  for (const id of draftIds) {
    const delRes = await fetch(`https://api.webflow.com/v2/collections/${collectionId}/items/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
    });
    console.log(`  DELETE ${id}: ${delRes.status}`);
    await sleep(RATE_LIMIT_MS);
  }

  // Step 2: Process each lane
  console.log("\nStep 2: Create/Patch items...");
  const results = [];

  for (const slug of SLUGS) {
    console.log(`\n  ${slug}:`);

    // Load payload
    const payloadPath = path.join(ROOT, "artifacts", "rendered_lanes", slug, "webflow_payload.json");
    const fullPayload = JSON.parse(fs.readFileSync(payloadPath, "utf-8"));
    const payload = buildWebflowSafePayload(fullPayload);

    // Check for existing item
    const existing = await findExistingItem(token, collectionId, slug);

    let itemId;
    if (existing) {
      console.log(`    Found existing: ${existing.id} (slug=${existing.fieldData?.slug})`);
      const patchRes = await fetch(
        `https://api.webflow.com/v2/collections/${collectionId}/items/${existing.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ fieldData: payload }),
        }
      );
      if (!patchRes.ok) {
        const err = await patchRes.text();
        console.log(`    PATCH FAILED: ${patchRes.status} — ${err}`);
        results.push({ slug, error: err, published: false });
        addFailed(manifest, { slug, reason: `PATCH ${patchRes.status}: ${err.slice(0, 200)}` });
        continue;
      }
      itemId = existing.id;
      console.log(`    PATCHED ✓`);
    } else {
      const createRes = await fetch(
        `https://api.webflow.com/v2/collections/${collectionId}/items`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ isArchived: false, isDraft: false, fieldData: payload }),
        }
      );
      if (!createRes.ok) {
        const err = await createRes.text();
        console.log(`    CREATE FAILED: ${createRes.status} — ${err}`);
        results.push({ slug, error: err, published: false });
        addFailed(manifest, { slug, reason: `CREATE ${createRes.status}: ${err.slice(0, 200)}` });
        continue;
      }
      const data = await createRes.json();
      itemId = data.id;
      console.log(`    CREATED ✓ (${itemId})`);
    }

    await sleep(RATE_LIMIT_MS);

    // Publish item
    const pubRes = await fetch(
      `https://api.webflow.com/v2/collections/${collectionId}/items/publish`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ itemIds: [itemId] }),
      }
    );
    const pubData = await pubRes.json();
    console.log(`    Publish: ${pubRes.status} — ${JSON.stringify(pubData)}`);

    results.push({ slug, itemId, published: true });
    addPublished(manifest, {
      slug,
      webflow_item_id: itemId,
      url: `https://www.wearewarp.com/lanes/${slug}`,
    });
    await sleep(RATE_LIMIT_MS);
  }

  // Step 3: Publish site
  console.log("\nStep 3: Publishing site to custom domains...");
  const siteRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ customDomains: domainIds }),
  });
  const siteResText = await siteRes.text();
  console.log(`  Site publish: ${siteRes.status} — ${siteResText}`);
  setDeploy(manifest, {
    status: siteRes.ok ? "success" : "failed",
    id: siteRes.ok ? "site-publish" : null,
    provider: "webflow",
  });

  // Step 4: Wait and verify
  console.log("\nStep 4: Waiting 20s for propagation...");
  await sleep(20000);

  console.log("\nStep 5: Verification:");
  const liveUrls = [];
  for (const slug of SLUGS) {
    try {
      const res = await fetch(`https://www.wearewarp.com/lanes/${slug}`, { method: "HEAD", redirect: "follow" });
      console.log(`  ${slug}: HTTP ${res.status}`);
      if (res.status === 200) {
        liveUrls.push(`https://www.wearewarp.com/lanes/${slug}`);
      }
    } catch (e) {
      console.log(`  ${slug}: Error - ${e.message}`);
    }
  }
  setSampleLiveUrls(manifest, liveUrls);

  // Step 6: Update registry using shared module (safe merge)
  const registryEntries = results
    .filter(r => r.published)
    .map(r => ({
      slug: r.slug,
      webflow_item_id: r.itemId,
      published_at_iso: new Date().toISOString(),
      wave_id: "_publish_cluster_v2",
      dry_run: false,
    }));

  const registryResult = safeRegistryUpdate(registryEntries, { source: "_publish_cluster_v2" });
  console.log(`  Registry: ${registryResult.added} added, ${registryResult.updated} updated, ${registryResult.total} total`);
  if (registryResult.warnings.length > 0) {
    for (const w of registryResult.warnings) {
      console.log(`  ⚠ ${w}`);
      addWarning(manifest, w);
    }
  }

  // Step 7: Write legacy artifact (backward compat)
  fs.writeFileSync(
    path.join(ROOT, "artifacts", "test_lane_cluster_publish_result.json"),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      mode: "live",
      summary: {
        published: results.filter(r => r.published).length,
        failed: results.filter(r => !r.published).length,
      },
      pages: results.map(r => ({
        lane_slug: r.slug,
        published: r.published,
        url: `https://www.wearewarp.com/lanes/${r.slug}`,
        webflow_item_id: r.itemId || null,
        error: r.error || null,
      })),
    }, null, 2) + "\n"
  );

  // Step 8: Finalize and save manifest
  finalizeManifest(manifest);
  const { path: manifestPath } = saveManifest(manifest);
  printManifestSummary(manifest);

  // Step 9: Generate receipt with live URL verification
  console.log("\nStep 9: Generate receipt...");
  const publishedPages = results
    .filter(r => r.published)
    .map(r => ({ slug: r.slug, url: `https://www.wearewarp.com/lanes/${r.slug}` }));

  let verificationResults = [];
  if (publishedPages.length > 0) {
    console.log(`  Verifying ${publishedPages.length} URLs...`);
    verificationResults = await verifyLiveUrls(publishedPages, { delayMs: 1000, timeoutMs: 10000 });
    for (const v of verificationResults) {
      // Transition approval state on verification
      if (v.status === "verified_live") {
        transitionState(v.slug, "LTL", "verified_live", {
          by: "_publish_cluster_v2.js",
          note: `Verified at ${v.url || ""}`,
        });
      }
      const icon = v.status === "verified_live" ? "✓" : "✗";
      console.log(`  ${icon} ${v.slug} — ${v.status} (HTTP ${v.httpStatus || "N/A"})`);
    }
  }

  const DEFAULT_RECIPIENT = "troy@wearewarp.com";
  const receipt = buildReceipt(manifest, verificationResults);
  receipt.recipient = DEFAULT_RECIPIENT;
  const { path: receiptPath } = saveReceipt(receipt);
  printReceipt(receipt);

  // Step 10: Send confirmation email
  console.log("\nStep 10: Send confirmation email...");
  const { EMAIL_USER, EMAIL_APP_PASSWORD } = process.env;
  if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {
    console.log("  ⚠ Cannot send email — EMAIL_USER or EMAIL_APP_PASSWORD not set.");
    setEmail(manifest, { attempted: true, sent: false, recipient: DEFAULT_RECIPIENT, error: "missing_credentials" });
  } else if (receipt.verified_live_count === 0 && receipt.published_unverified_count === 0) {
    console.log("  Skipping email — no pages published or verified.");
    setEmail(manifest, { attempted: false, sent: false, skipReason: "no_verified_pages" });
  } else {
    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.default.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD },
      });
      await transport.verify();

      const emailHtml = buildConfirmationEmailHtml(receipt);
      const subjectStatus = receipt.verified_live_count > 0
        ? `${receipt.verified_live_count} verified live`
        : `${receipt.published_count} published`;
      const subject = `Warp Publish Receipt — ${subjectStatus} — ${receipt.run_id.split("T")[0]}`;

      const info = await transport.sendMail({
        from: EMAIL_USER,
        to: DEFAULT_RECIPIENT,
        subject,
        html: emailHtml,
      });

      console.log(`  ✓ Email sent: ${info.messageId} → ${DEFAULT_RECIPIENT}`);
      setEmail(manifest, { attempted: true, sent: true, recipient: DEFAULT_RECIPIENT, providerResponse: info.messageId });
    } catch (emailErr) {
      console.error(`  ✗ Email failed: ${emailErr.message}`);
      setEmail(manifest, { attempted: true, sent: false, recipient: DEFAULT_RECIPIENT, error: emailErr.message });
    }
  }

  // Re-save manifest with email status
  saveManifest(manifest);

  console.log(`\n  Manifest saved: ${manifestPath}`);
  console.log(`  Receipt saved:  ${receiptPath}`);
  console.log("=== Done ===");
}

async function findExistingItem(token, collectionId, slug) {
  let offset = 0;
  while (true) {
    const res = await fetch(
      `https://api.webflow.com/v2/collections/${collectionId}/items?limit=100&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}`, accept: "application/json" } }
    );
    const data = await res.json();
    const match = (data.items || []).find(
      item => item.fieldData?.slug === slug
    );
    if (match) return match;
    if (!data.items || data.items.length < 100) break;
    offset += 100;
    await sleep(500);
  }
  return null;
}

main().catch(e => console.error(e));
