import { createManifest, addPublished, addFailed, addBlocked, finalizeManifest, setEmail } from "../lib/publish-manifest.js";
import { buildReceipt, buildConfirmationEmailHtml } from "../lib/publish-receipt.js";
import fs from "fs";

// Create a sample manifest that mirrors the real scenario
const m = createManifest({ scriptName: "publish_next.js" });

// 3 verified live pages
addPublished(m, { slug: "los-angeles-to-new-york", webflow_item_id: "id1", url: "https://www.wearewarp.com/lanes/los-angeles-to-new-york" });
addPublished(m, { slug: "atlanta-to-new-york", webflow_item_id: "id2", url: "https://www.wearewarp.com/lanes/atlanta-to-new-york" });
addPublished(m, { slug: "houston-to-new-york", webflow_item_id: "id3", url: "https://www.wearewarp.com/lanes/houston-to-new-york" });

// 1 published but unverified
addPublished(m, { slug: "kansas-city-to-chicago", webflow_item_id: "id4", url: "https://www.wearewarp.com/lanes/kansas-city-to-chicago" });

// 1 failed
addFailed(m, { slug: "test-failed-lane", reason: "Webflow API 500 error" });

// 2 blocked
addBlocked(m, { slug: "dallas-to-houston", reason: "duplicate slug", rule_id: "DUP-SLUG-01" });
addBlocked(m, { slug: "chicago-to-atlanta", reason: "duplicate slug", rule_id: "DUP-SLUG-01" });

setEmail(m, { attempted: true, sent: true, recipient: "troy@wearewarp.com" });
finalizeManifest(m);

// Build verification results
const verificationResults = [
  { slug: "los-angeles-to-new-york", url: "https://www.wearewarp.com/lanes/los-angeles-to-new-york", status: "verified_live", httpStatus: 200, identityMatch: true, error: null },
  { slug: "atlanta-to-new-york", url: "https://www.wearewarp.com/lanes/atlanta-to-new-york", status: "verified_live", httpStatus: 200, identityMatch: true, error: null },
  { slug: "houston-to-new-york", url: "https://www.wearewarp.com/lanes/houston-to-new-york", status: "verified_live", httpStatus: 200, identityMatch: true, error: null },
  { slug: "kansas-city-to-chicago", url: "https://www.wearewarp.com/lanes/kansas-city-to-chicago", status: "published_unverified", httpStatus: 404, identityMatch: false, error: "HTTP 404 — CDN propagation pending" },
];

const receipt = buildReceipt(m, verificationResults);
receipt.recipient = "troy@wearewarp.com";

const html = buildConfirmationEmailHtml(receipt);

// Write sample HTML
fs.writeFileSync("artifacts/sample_receipt_email.html", html);
console.log("Sample receipt email written to artifacts/sample_receipt_email.html");

// Validate
const dq = '"';
const hrefRe = new RegExp(`href=${dq}([^${dq}]+)${dq}`, "g");
const hrefs = [];
let match;
while ((match = hrefRe.exec(html)) !== null) { hrefs.push(match[1]); }

console.log("\n=== VALIDATION ===\n");
console.log("Total <a href> links:", hrefs.length);
console.log("All hrefs are absolute https:", hrefs.every(h => h.startsWith("https://")));
console.log("No manifest file paths linked:", !hrefs.some(h => h.includes("manifests/")));
console.log("No artifact file paths linked:", !hrefs.some(h => h.includes("artifacts/")));
console.log("No buttons (display:inline-block+padding:12px):", !html.includes("display:inline-block") || !html.includes("padding:12px"));

// Check verified vs unverified link separation
const verifiedLinked = hrefs.filter(h => h.includes("los-angeles") || h.includes("atlanta") || h.includes("houston"));
const unverifiedLinked = hrefs.filter(h => h.includes("kansas-city"));
console.log("Verified pages linked:", verifiedLinked.length === 3 ? "YES (3/3)" : `NO (${verifiedLinked.length}/3)`);
console.log("Unverified pages NOT linked:", unverifiedLinked.length === 0 ? "YES (0 links)" : `FAIL (${unverifiedLinked.length} links)`);

// Check sections
console.log("\nSections present:");
console.log("  Verified Live Pages:", html.includes("Verified Live Pages"));
console.log("  Not Yet Verified:", html.includes("Not Yet Verified"));
console.log("  Failed / Blocked:", html.includes("Failed / Blocked"));
console.log("  Metadata:", html.includes("Metadata"));
console.log("  Manifest as plain text:", html.includes("manifests/publish_") && !hrefs.some(h => h.includes("manifests/")));
console.log("  Receipt as plain text:", html.includes("publish-receipts/receipt_") && !hrefs.some(h => h.includes("publish-receipts/")));

// Check for unverified slug with reason
console.log("  Unverified slug text shown:", html.includes("kansas-city-to-chicago"));
console.log("  Unverified reason shown:", html.includes("HTTP 404"));

// Check for failed entry
console.log("  Failed slug shown:", html.includes("test-failed-lane"));
console.log("  Failed reason shown:", html.includes("Webflow API 500 error"));

// Check for blocked
console.log("  Blocked slug shown:", html.includes("dallas-to-houston"));
console.log("  Blocked reason shown:", html.includes("duplicate slug"));

console.log("\n=== END VALIDATION ===");
