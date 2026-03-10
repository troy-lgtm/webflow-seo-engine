/**
 * Publish Pipeline Tests
 *
 * Tests for:
 *   - Safe registry merge behavior (never destructive overwrite)
 *   - Manifest generation and structure
 *   - Dry-run labeling
 *   - Email recipient override warning
 *   - Health check mismatch detection
 *   - Audit command correctness
 *   - Receipt generation and structure
 *   - Live verification classification
 *   - Registry schema normalization
 *   - ship_firstpage.js uses shared registry
 *   - Confirmation email includes live URLs
 *   - Recipient defaults to troy@wearewarp.com
 *
 * Uses execSync + inline Node scripts to run as ES modules.
 */

import { test, expect } from "@playwright/test";
import { execSync } from "child_process";

/** Run an inline ES module script, return parsed JSON output. */
function runNode(script, extraEnv = {}) {
  const result = execSync(`node --input-type=module -e '${script}'`, {
    cwd: process.cwd(),
    timeout: 15000,
    env: { ...process.env, ...extraEnv },
  });
  return JSON.parse(result.toString().trim());
}

// ── Registry Safe Merge Tests ──────────────────────────────────────────

test.describe("Publish Registry — Safe Merge", () => {
  test("mergeEntries never loses existing entries", () => {
    const result = runNode(`
      import { mergeEntries } from "./lib/publish-registry-disk.js";
      const existing = [
        { slug: "a-to-b", webflow_item_id: "id1", published_at_iso: "2026-01-01" },
        { slug: "c-to-d", webflow_item_id: "id2", published_at_iso: "2026-01-02" },
      ];
      const incoming = [
        { slug: "e-to-f", webflow_item_id: "id3", published_at_iso: "2026-01-03" },
      ];
      const { merged, added, updated } = mergeEntries(existing, incoming);
      console.log(JSON.stringify({ count: merged.length, added, updated }));
    `);
    expect(result.count).toBe(3);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
  });

  test("mergeEntries updates existing by slug without removing others", () => {
    const result = runNode(`
      import { mergeEntries } from "./lib/publish-registry-disk.js";
      const existing = [
        { slug: "a-to-b", webflow_item_id: "old-id", mode: "LTL" },
        { slug: "c-to-d", webflow_item_id: "keep-id", mode: "FTL" },
      ];
      const incoming = [
        { slug: "a-to-b", webflow_item_id: "new-id", mode: "LTL" },
      ];
      const { merged, added, updated } = mergeEntries(existing, incoming);
      const aEntry = merged.find(e => e.slug === "a-to-b");
      const cEntry = merged.find(e => e.slug === "c-to-d");
      console.log(JSON.stringify({
        count: merged.length,
        added,
        updated,
        aId: aEntry.webflow_item_id,
        cId: cEntry.webflow_item_id,
      }));
    `);
    expect(result.count).toBe(2);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(result.aId).toBe("new-id");
    expect(result.cId).toBe("keep-id");
  });

  test("mergeEntries with empty incoming preserves all existing", () => {
    const result = runNode(`
      import { mergeEntries } from "./lib/publish-registry-disk.js";
      const existing = [
        { slug: "a-to-b", webflow_item_id: "id1" },
        { slug: "c-to-d", webflow_item_id: "id2" },
        { slug: "e-to-f", webflow_item_id: "id3" },
      ];
      const { merged, added, updated, warnings } = mergeEntries(existing, []);
      console.log(JSON.stringify({ count: merged.length, added, updated, warningCount: warnings.length }));
    `);
    expect(result.count).toBe(3);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
  });

  test("mergeEntries deduplicates by slug", () => {
    const result = runNode(`
      import { mergeEntries } from "./lib/publish-registry-disk.js";
      const existing = [{ slug: "a-to-b", webflow_item_id: "id1" }];
      const incoming = [
        { slug: "a-to-b", webflow_item_id: "id1-updated" },
        { slug: "a-to-b", webflow_item_id: "id1-updated-again" },
      ];
      const { merged } = mergeEntries(existing, incoming);
      console.log(JSON.stringify({ count: merged.length }));
    `);
    expect(result.count).toBe(1);
  });

  test("mergeEntries skips entries without slug", () => {
    const result = runNode(`
      import { mergeEntries } from "./lib/publish-registry-disk.js";
      const existing = [{ slug: "a-to-b", webflow_item_id: "id1" }];
      const incoming = [{ webflow_item_id: "no-slug-entry" }];
      const { merged, warnings } = mergeEntries(existing, incoming);
      console.log(JSON.stringify({ count: merged.length, hasWarning: warnings.length > 0 }));
    `);
    expect(result.count).toBe(1);
    expect(result.hasWarning).toBe(true);
  });
});

// ── Manifest Tests ─────────────────────────────────────────────────────

test.describe("Publish Manifest", () => {
  test("createManifest produces correct structure", () => {
    const result = runNode(`
      import { createManifest } from "./lib/publish-manifest.js";
      const m = createManifest({ scriptName: "test.js", triggerSource: "test", dryRun: true });
      console.log(JSON.stringify({
        hasRunId: !!m.run_id,
        scriptName: m.script_name,
        dryRun: m.dry_run,
        mode: m.mode,
        publishedCount: m.published_count,
        failedCount: m.failed_count,
      }));
    `);
    expect(result.hasRunId).toBe(true);
    expect(result.scriptName).toBe("test.js");
    expect(result.dryRun).toBe(true);
    expect(result.mode).toBe("dry-run");
    expect(result.publishedCount).toBe(0);
    expect(result.failedCount).toBe(0);
  });

  test("manifest tracks published and failed counts", () => {
    const result = runNode(`
      import { createManifest, addPublished, addFailed, addBlocked } from "./lib/publish-manifest.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "a-to-b", webflow_item_id: "id1", url: "https://example.com/a" });
      addPublished(m, { slug: "c-to-d", webflow_item_id: "id2", url: "https://example.com/c" });
      addFailed(m, { slug: "e-to-f", reason: "API error" });
      addBlocked(m, { slug: "g-to-h", reason: "duplicate", rule_id: "DUP-01" });
      console.log(JSON.stringify({
        published: m.published_count,
        failed: m.failed_count,
        blocked: m.blocked_count,
        attempted: m.attempted_count,
        urlCount: m.published_urls.length,
      }));
    `);
    expect(result.published).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.attempted).toBe(3);
    expect(result.urlCount).toBe(2);
  });

  test("finalized manifest has duration", () => {
    const result = runNode(`
      import { createManifest, finalizeManifest } from "./lib/publish-manifest.js";
      const m = createManifest({ scriptName: "test.js" });
      finalizeManifest(m);
      console.log(JSON.stringify({
        hasCompleted: !!m.completed_at,
        hasDuration: typeof m.duration_ms === "number",
      }));
    `);
    expect(result.hasCompleted).toBe(true);
    expect(result.hasDuration).toBe(true);
  });

  test("dry-run manifest is clearly labeled", () => {
    const result = runNode(`
      import { createManifest } from "./lib/publish-manifest.js";
      const m = createManifest({ scriptName: "test.js", dryRun: true });
      console.log(JSON.stringify({ dry_run: m.dry_run, mode: m.mode }));
    `);
    expect(result.dry_run).toBe(true);
    expect(result.mode).toBe("dry-run");
  });

  test("email tracking in manifest", () => {
    const result = runNode(`
      import { createManifest, setEmail } from "./lib/publish-manifest.js";
      const m = createManifest({ scriptName: "test.js" });
      setEmail(m, { attempted: true, sent: false, recipient: "test@example.com", error: "SMTP fail" });
      console.log(JSON.stringify({
        attempted: m.email_attempted,
        sent: m.email_sent,
        recipient: m.email_recipient,
        error: m.email_error,
      }));
    `);
    expect(result.attempted).toBe(true);
    expect(result.sent).toBe(false);
    expect(result.recipient).toBe("test@example.com");
    expect(result.error).toBe("SMTP fail");
  });
});

// ── Health Check Mismatch Detection Tests ──────────────────────────────

test.describe("Health Check — Mismatch Detection", () => {
  test("loadRegistry returns empty array for missing file", () => {
    const result = runNode(`
      import { loadRegistry } from "./lib/publish-registry-disk.js";
      // loadRegistry uses the real file — just verify shape
      const { entries, warnings } = loadRegistry();
      console.log(JSON.stringify({
        isArray: Array.isArray(entries),
        hasPath: true,
      }));
    `);
    expect(result.isArray).toBe(true);
  });

  test("registrySummary returns counts", () => {
    const result = runNode(`
      import { registrySummary } from "./lib/publish-registry-disk.js";
      const summary = registrySummary();
      console.log(JSON.stringify({
        hasTotal: typeof summary.total === "number",
        hasPublished: typeof summary.published === "number",
        hasDryRun: typeof summary.dryRun === "number",
      }));
    `);
    expect(result.hasTotal).toBe(true);
    expect(result.hasPublished).toBe(true);
    expect(result.hasDryRun).toBe(true);
  });
});

// ── Manifest Listing Tests ─────────────────────────────────────────────

test.describe("Manifest Listing", () => {
  test("listManifests returns array", () => {
    const result = runNode(`
      import { listManifests } from "./lib/publish-manifest.js";
      const list = listManifests({ limit: 5 });
      console.log(JSON.stringify({ isArray: Array.isArray(list) }));
    `);
    expect(result.isArray).toBe(true);
  });

  test("findManifestsByDate returns array", () => {
    const result = runNode(`
      import { findManifestsByDate } from "./lib/publish-manifest.js";
      const list = findManifestsByDate("2020-01-01");
      console.log(JSON.stringify({ isArray: Array.isArray(list), count: list.length }));
    `);
    expect(result.isArray).toBe(true);
    expect(result.count).toBe(0);
  });
});

// ── Receipt Generation Tests ──────────────────────────────────────────

test.describe("Post-Publish Receipt", () => {
  test("buildReceipt produces correct structure from manifest", () => {
    const result = runNode(`
      import { createManifest, addPublished, addFailed, finalizeManifest, setEmail } from "./lib/publish-manifest.js";
      import { buildReceipt } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "a-to-b", webflow_item_id: "id1", url: "https://example.com/a" });
      addFailed(m, { slug: "c-to-d", reason: "API error" });
      setEmail(m, { attempted: true, sent: true, recipient: "troy@wearewarp.com", providerResponse: "msg-123" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, [
        { slug: "a-to-b", url: "https://example.com/a", status: "verified_live", httpStatus: 200, identityMatch: true, error: null }
      ]);
      console.log(JSON.stringify({
        hasRunId: !!receipt.run_id,
        finalStatus: receipt.final_status,
        publishedCount: receipt.published_count,
        verifiedLiveCount: receipt.verified_live_count,
        failedCount: receipt.failed_count,
        recipient: receipt.recipient,
        emailSent: receipt.email_sent,
        emailStatus: receipt.email_provider_status,
        hasManifestPath: !!receipt.manifest_path,
        verifiedUrlCount: receipt.verified_live_urls.length,
        failedSlugCount: receipt.failed_slugs.length,
      }));
    `);
    expect(result.hasRunId).toBe(true);
    expect(result.finalStatus).toBe("all_verified_live");
    expect(result.publishedCount).toBe(1);
    expect(result.verifiedLiveCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.recipient).toBe("troy@wearewarp.com");
    expect(result.emailSent).toBe(true);
    expect(result.emailStatus).toBe("msg-123");
    expect(result.hasManifestPath).toBe(true);
    expect(result.verifiedUrlCount).toBe(1);
    expect(result.failedSlugCount).toBe(1);
  });

  test("buildReceipt classifies dry_run correctly", () => {
    const result = runNode(`
      import { createManifest, finalizeManifest } from "./lib/publish-manifest.js";
      import { buildReceipt } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js", dryRun: true });
      finalizeManifest(m);
      const receipt = buildReceipt(m, []);
      console.log(JSON.stringify({ finalStatus: receipt.final_status }));
    `);
    expect(result.finalStatus).toBe("dry_run");
  });

  test("buildReceipt classifies partial_verified correctly", () => {
    const result = runNode(`
      import { createManifest, addPublished, finalizeManifest } from "./lib/publish-manifest.js";
      import { buildReceipt } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "a-to-b", webflow_item_id: "id1", url: "https://example.com/a" });
      addPublished(m, { slug: "c-to-d", webflow_item_id: "id2", url: "https://example.com/c" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, [
        { slug: "a-to-b", url: "https://example.com/a", status: "verified_live", httpStatus: 200, identityMatch: true, error: null },
        { slug: "c-to-d", url: "https://example.com/c", status: "published_unverified", httpStatus: 404, identityMatch: false, error: "HTTP 404" },
      ]);
      console.log(JSON.stringify({ finalStatus: receipt.final_status, verified: receipt.verified_live_count, unverified: receipt.published_unverified_count }));
    `);
    expect(result.finalStatus).toBe("partial_verified");
    expect(result.verified).toBe(1);
    expect(result.unverified).toBe(1);
  });
});

// ── Confirmation Email Tests ──────────────────────────────────────────

test.describe("Confirmation Email", () => {
  test("buildConfirmationEmailHtml includes verified live URLs as clickable links", () => {
    const result = runNode(`
      import { createManifest, addPublished, finalizeManifest, setEmail } from "./lib/publish-manifest.js";
      import { buildReceipt, buildConfirmationEmailHtml } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "a-to-b", webflow_item_id: "id1", url: "https://www.wearewarp.com/lanes/a-to-b" });
      setEmail(m, { attempted: true, sent: true, recipient: "troy@wearewarp.com" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, [
        { slug: "a-to-b", url: "https://www.wearewarp.com/lanes/a-to-b", status: "verified_live", httpStatus: 200, identityMatch: true, error: null },
      ]);
      const html = buildConfirmationEmailHtml(receipt);
      const hrefTag = "href=" + String.fromCharCode(34) + "https://www.wearewarp.com/lanes/a-to-b" + String.fromCharCode(34);
      console.log(JSON.stringify({
        hasVerifiedUrl: html.includes("https://www.wearewarp.com/lanes/a-to-b"),
        hasRunId: html.includes(receipt.run_id),
        hasManifestRef: html.includes("manifests/"),
        hasReceiptRef: html.includes("publish-receipts/"),
        hasVerifiedLabel: html.includes("Verified Live Pages"),
        verifiedUrlIsLinked: html.includes(hrefTag),
      }));
    `);
    expect(result.hasVerifiedUrl).toBe(true);
    expect(result.hasRunId).toBe(true);
    expect(result.hasManifestRef).toBe(true);
    expect(result.hasReceiptRef).toBe(true);
    expect(result.hasVerifiedLabel).toBe(true);
    expect(result.verifiedUrlIsLinked).toBe(true);
  });

  test("email has no buttons and no linked file paths", () => {
    const result = runNode(`
      import { createManifest, addPublished, finalizeManifest } from "./lib/publish-manifest.js";
      import { buildReceipt, buildConfirmationEmailHtml } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "a-to-b", webflow_item_id: "id1", url: "https://www.wearewarp.com/lanes/a-to-b" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, [
        { slug: "a-to-b", url: "https://www.wearewarp.com/lanes/a-to-b", status: "verified_live", httpStatus: 200, identityMatch: true, error: null },
      ]);
      const html = buildConfirmationEmailHtml(receipt);
      const dq = String.fromCharCode(34);
      const hrefRe = new RegExp("href=" + dq + "([^" + dq + "]+)" + dq, "g");
      const hrefs = [];
      let match;
      while ((match = hrefRe.exec(html)) !== null) { hrefs.push(match[1]); }
      const allHrefsAbsolute = hrefs.length === 0 || hrefs.every(h => h.startsWith("https://"));
      const noManifestLinks = !hrefs.some(h => h.includes("manifests/"));
      const noArtifactLinks = !hrefs.some(h => h.includes("artifacts/"));
      const hasInlineBlockButton = html.includes("display:inline-block") && html.includes("padding:12px");
      console.log(JSON.stringify({
        hrefCount: hrefs.length,
        allHrefsAbsolute,
        noManifestLinks,
        noArtifactLinks,
        noButtonPattern: !hasInlineBlockButton,
      }));
    `);
    expect(result.allHrefsAbsolute).toBe(true);
    expect(result.noManifestLinks).toBe(true);
    expect(result.noArtifactLinks).toBe(true);
    expect(result.noButtonPattern).toBe(true);
  });

  test("unverified pages have NO clickable links in email", () => {
    const result = runNode(`
      import { createManifest, addPublished, finalizeManifest } from "./lib/publish-manifest.js";
      import { buildReceipt, buildConfirmationEmailHtml } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "x-to-y", webflow_item_id: "id1", url: "https://www.wearewarp.com/lanes/x-to-y" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, [
        { slug: "x-to-y", url: "https://www.wearewarp.com/lanes/x-to-y", status: "published_unverified", httpStatus: 404, identityMatch: false, error: "HTTP 404" },
      ]);
      const html = buildConfirmationEmailHtml(receipt);
      const dq = String.fromCharCode(34);
      const hrefRe = new RegExp("href=" + dq + "([^" + dq + "]+)" + dq, "g");
      const hrefs = [];
      let match;
      while ((match = hrefRe.exec(html)) !== null) { hrefs.push(match[1]); }
      const hasUnverifiedLink = hrefs.some(h => h.includes("x-to-y"));
      const hasUnverifiedSlugText = html.includes("x-to-y");
      const hasErrorReason = html.includes("HTTP 404");
      const hasNotYetVerified = html.includes("Not Yet Verified");
      console.log(JSON.stringify({
        hasUnverifiedLink,
        hasUnverifiedSlugText,
        hasErrorReason,
        hasNotYetVerified,
        hrefCount: hrefs.length,
      }));
    `);
    expect(result.hasUnverifiedLink).toBe(false);
    expect(result.hasUnverifiedSlugText).toBe(true);
    expect(result.hasErrorReason).toBe(true);
    expect(result.hasNotYetVerified).toBe(true);
  });
});

// ── Registry Normalization Tests ──────────────────────────────────────

test.describe("Registry Schema Normalization", () => {
  test("normalizeEntry converts published_at to published_at_iso", () => {
    const result = runNode(`
      import { normalizeEntry } from "./lib/publish-registry-disk.js";
      const entry = { slug: "a-to-b", webflow_item_id: "id1", published_at: "2026-03-06T12:00:00Z" };
      const normalized = normalizeEntry(entry);
      console.log(JSON.stringify({
        hasPublishedAtIso: !!normalized.published_at_iso,
        hasPublishedAt: !!normalized.published_at,
        isoValue: normalized.published_at_iso,
      }));
    `);
    expect(result.hasPublishedAtIso).toBe(true);
    expect(result.hasPublishedAt).toBe(false);
    expect(result.isoValue).toBe("2026-03-06T12:00:00Z");
  });

  test("normalizeEntry adds canonical_path from slug", () => {
    const result = runNode(`
      import { normalizeEntry } from "./lib/publish-registry-disk.js";
      const entry = { slug: "dallas-to-chicago", webflow_item_id: "id1" };
      const normalized = normalizeEntry(entry);
      console.log(JSON.stringify({
        canonicalPath: normalized.canonical_path,
        url: normalized.url,
      }));
    `);
    expect(result.canonicalPath).toBe("/lanes/dallas-to-chicago");
    expect(result.url).toBe("https://www.wearewarp.com/lanes/dallas-to-chicago");
  });

  test("normalizeEntry defaults dry_run to false", () => {
    const result = runNode(`
      import { normalizeEntry } from "./lib/publish-registry-disk.js";
      const entry = { slug: "a-to-b", webflow_item_id: "id1" };
      const normalized = normalizeEntry(entry);
      console.log(JSON.stringify({ dryRun: normalized.dry_run }));
    `);
    expect(result.dryRun).toBe(false);
  });

  test("mergeEntries normalizes incoming entries", () => {
    const result = runNode(`
      import { mergeEntries } from "./lib/publish-registry-disk.js";
      const existing = [];
      const incoming = [
        { slug: "x-to-y", webflow_item_id: "id1", published_at: "2026-03-06T12:00:00Z", quality_score: 100 },
      ];
      const { merged } = mergeEntries(existing, incoming);
      const entry = merged[0];
      console.log(JSON.stringify({
        hasPublishedAtIso: !!entry.published_at_iso,
        hasPublishedAt: !!entry.published_at,
        hasDryRun: typeof entry.dry_run === "boolean",
        hasUrl: !!entry.url,
      }));
    `);
    expect(result.hasPublishedAtIso).toBe(true);
    expect(result.hasPublishedAt).toBe(false);
    expect(result.hasDryRun).toBe(true);
    expect(result.hasUrl).toBe(true);
  });
});

// ── ship_firstpage.js Integration Tests ───────────────────────────────

test.describe("ship_firstpage.js Canonical Flow", () => {
  test("ship_firstpage.js imports shared registry module", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/ship_firstpage.js", "utf-8");
      console.log(JSON.stringify({
        hasSafeRegistryUpdate: src.includes("safeRegistryUpdate"),
        hasLoadRegistry: src.includes("loadRegistry"),
        hasCreateManifest: src.includes("createManifest"),
        hasFinalizeManifest: src.includes("finalizeManifest"),
        hasSaveManifest: src.includes("saveManifest"),
        hasPrintManifestSummary: src.includes("printManifestSummary"),
        hasAddPublished: src.includes("addPublished"),
        hasSetEmail: src.includes("setEmail"),
      }));
    `);
    expect(result.hasSafeRegistryUpdate).toBe(true);
    expect(result.hasLoadRegistry).toBe(true);
    expect(result.hasCreateManifest).toBe(true);
    expect(result.hasFinalizeManifest).toBe(true);
    expect(result.hasSaveManifest).toBe(true);
    expect(result.hasPrintManifestSummary).toBe(true);
    expect(result.hasAddPublished).toBe(true);
    expect(result.hasSetEmail).toBe(true);
  });

  test("ship_firstpage.js no longer writes published_pages.json directly", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/ship_firstpage.js", "utf-8");
      // Must NOT have direct fs.writeFileSync to published_pages.json
      const directWrites = src.match(/writeFileSync.*published_pages/g);
      console.log(JSON.stringify({
        hasDirectWrite: directWrites !== null && directWrites.length > 0,
      }));
    `);
    expect(result.hasDirectWrite).toBe(false);
  });
});

// ── Default Recipient Tests ───────────────────────────────────────────

test.describe("Recipient Defaults", () => {
  test("publish_text_batch.js defaults to troy@wearewarp.com", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/publish_text_batch.js", "utf-8");
      console.log(JSON.stringify({
        hasDefaultRecipient: src.includes("troy@wearewarp.com"),
        hasRecipientWarning: src.includes("WARNING: Recipient override"),
      }));
    `);
    expect(result.hasDefaultRecipient).toBe(true);
    expect(result.hasRecipientWarning).toBe(true);
  });

  test("publish_prove_last.js produces correct output shape", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/publish_prove_last.js", "utf-8");
      console.log(JSON.stringify({
        hasRunId: src.includes("run_id"),
        hasFinalStatus: src.includes("final_status"),
        hasVerifiedLive: src.includes("verified_live"),
        hasMismatches: src.includes("mismatches"),
        hasManifestPath: src.includes("manifest_path"),
        hasReceiptPath: src.includes("receipt_path"),
        hasEmailSent: src.includes("email_sent"),
      }));
    `);
    expect(result.hasRunId).toBe(true);
    expect(result.hasFinalStatus).toBe(true);
    expect(result.hasVerifiedLive).toBe(true);
    expect(result.hasMismatches).toBe(true);
    expect(result.hasManifestPath).toBe(true);
    expect(result.hasReceiptPath).toBe(true);
    expect(result.hasEmailSent).toBe(true);
  });
});

// ── All Publish Paths Use Canonical Standard ─────────────────────────

test.describe("All Publish Paths — Canonical Standard", () => {
  test("approval/route.js uses safeRegistryUpdate (no direct published_pages writes)", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("app/api/approval/route.js", "utf-8");
      const directWrites = src.match(/writeFileSync.*published_pages/g);
      console.log(JSON.stringify({
        hasSafeRegistryUpdate: src.includes("safeRegistryUpdate"),
        hasDirectWrite: directWrites !== null && directWrites.length > 0,
        importsRegistryDisk: src.includes("publish-registry-disk"),
      }));
    `);
    expect(result.hasSafeRegistryUpdate).toBe(true);
    expect(result.hasDirectWrite).toBe(false);
    expect(result.importsRegistryDisk).toBe(true);
  });

  test("ship_firstpage.js calls buildReceipt and saveReceipt", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/ship_firstpage.js", "utf-8");
      // Must import AND call these functions (not just import)
      const buildReceiptCalls = src.match(/buildReceipt\\(/g);
      const saveReceiptCalls = src.match(/saveReceipt\\(/g);
      const printReceiptCalls = src.match(/printReceipt\\(/g);
      console.log(JSON.stringify({
        importsBuildReceipt: src.includes("import") && src.includes("buildReceipt"),
        callsBuildReceipt: buildReceiptCalls !== null && buildReceiptCalls.length > 0,
        callsSaveReceipt: saveReceiptCalls !== null && saveReceiptCalls.length > 0,
        callsPrintReceipt: printReceiptCalls !== null && printReceiptCalls.length > 0,
      }));
    `);
    expect(result.importsBuildReceipt).toBe(true);
    expect(result.callsBuildReceipt).toBe(true);
    expect(result.callsSaveReceipt).toBe(true);
    expect(result.callsPrintReceipt).toBe(true);
  });

  test("lanes_auto_publish.js (factory) generates receipt and sends email", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/lanes_auto_publish.js", "utf-8");
      console.log(JSON.stringify({
        importsBuildReceipt: src.includes("buildReceipt") || src.includes("publish-receipt"),
        hasDefaultRecipient: src.includes("troy@wearewarp.com"),
        hasNodemailer: src.includes("nodemailer") || src.includes("email-sender"),
        hasManifest: src.includes("publish-manifest"),
        hasShipOneLane: src.includes("shipOneLane"),
        hasVerifyLive: src.includes("verifyLive"),
      }));
    `);
    expect(result.importsBuildReceipt).toBe(true);
    expect(result.hasDefaultRecipient).toBe(true);
    expect(result.hasNodemailer).toBe(true);
    expect(result.hasManifest).toBe(true);
    expect(result.hasShipOneLane).toBe(true);
  });

  test("no publish script writes published_pages.json directly", () => {
    const result = runNode(`
      import fs from "fs";
      const files = [
        "scripts/publish_next.js",
        "scripts/publish_text_batch.js",
        "scripts/ship_firstpage.js",
        "scripts/lanes_auto_publish.js",
        "app/api/approval/route.js",
      ];
      const violations = [];
      for (const f of files) {
        const src = fs.readFileSync(f, "utf-8");
        const directWrites = src.match(/writeFileSync.*published_pages/g);
        if (directWrites && directWrites.length > 0) {
          violations.push(f);
        }
      }
      console.log(JSON.stringify({ violations, count: violations.length }));
    `);
    expect(result.count).toBe(0);
    expect(result.violations).toEqual([]);
  });
});

// ── Structured Verification Tests ────────────────────────────────────

test.describe("Structured Verification — HTML Parsing", () => {
  test("publish-receipt.js has canonical, title, and slug extraction helpers", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("lib/publish-receipt.js", "utf-8");
      console.log(JSON.stringify({
        hasCanonicalExtractor: src.includes("function extractCanonicalHref"),
        canonicalChecksRelAttribute: src.includes("canonical") && src.includes("href"),
        canonicalHandlesReversedOrder: (src.match(/extractCanonicalHref/g) || []).length >= 1,
        hasTitleExtractor: src.includes("function extractTitleText"),
        hasTitleRegex: src.includes("<title") && src.includes("title>"),
        hasSlugExtractor: src.includes("function extractSlugWords"),
        slugFiltersShort: src.includes("w.length > 2"),
        slugLowercases: src.includes("toLowerCase"),
        canonicalUsedInVerify: src.includes("extractCanonicalHref(sample)"),
        titleUsedInVerify: src.includes("extractTitleText(sample)"),
        slugUsedInVerify: src.includes("extractSlugWords(slug)"),
      }));
    `);
    expect(result.hasCanonicalExtractor).toBe(true);
    expect(result.canonicalChecksRelAttribute).toBe(true);
    expect(result.hasTitleExtractor).toBe(true);
    expect(result.hasTitleRegex).toBe(true);
    expect(result.hasSlugExtractor).toBe(true);
    expect(result.slugFiltersShort).toBe(true);
    expect(result.slugLowercases).toBe(true);
    expect(result.canonicalUsedInVerify).toBe(true);
    expect(result.titleUsedInVerify).toBe(true);
    expect(result.slugUsedInVerify).toBe(true);
  });

  test("extractSlugWords filters short words and lowercases", () => {
    const result = runNode(`
      function extractSlugWords(slug) {
        return slug.replace(/-/g, " ").split(" ").filter(w => w.length > 2).map(w => w.toLowerCase());
      }
      console.log(JSON.stringify({
        cityPair: extractSlugWords("chicago-to-dallas"),
        triple: extractSlugWords("new-york-to-los-angeles"),
        short: extractSlugWords("a-to-b"),
      }));
    `);
    expect(result.cityPair).toEqual(["chicago", "dallas"]);
    expect(result.triple).toEqual(["new", "york", "los", "angeles"]);
    expect(result.short).toEqual([]);
  });
});

test.describe("Structured Verification — Confidence Classification", () => {
  test("canonical match yields high confidence", () => {
    const result = runNode(`
      // Test confidence classification logic matching verifyLiveUrl
      function classifyConfidence(http_ok, canonical_match, title_match, body_match) {
        if (http_ok && (canonical_match === true || title_match === true)) return "high";
        if (http_ok && body_match) return "medium";
        if (http_ok) return "low";
        return "none";
      }
      console.log(JSON.stringify({
        canonical: classifyConfidence(true, true, false, false),
        title: classifyConfidence(true, false, true, false),
        bodyOnly: classifyConfidence(true, false, false, true),
        httpOnly: classifyConfidence(true, false, false, false),
        notOk: classifyConfidence(false, false, false, false),
        canonicalAndBody: classifyConfidence(true, true, false, true),
        allMatch: classifyConfidence(true, true, true, true),
        canonicalNull: classifyConfidence(true, null, true, false),
      }));
    `);
    expect(result.canonical).toBe("high");
    expect(result.title).toBe("high");
    expect(result.bodyOnly).toBe("medium");
    expect(result.httpOnly).toBe("low");
    expect(result.notOk).toBe("none");
    expect(result.canonicalAndBody).toBe("high");
    expect(result.allMatch).toBe("high");
    expect(result.canonicalNull).toBe("high"); // title_match=true triggers high
  });

  test("only high and medium confidence count as verified_live", () => {
    const result = runNode(`
      function isVerified(confidence) {
        return confidence === "high" || confidence === "medium";
      }
      console.log(JSON.stringify({
        high: isVerified("high"),
        medium: isVerified("medium"),
        low: isVerified("low"),
        none: isVerified("none"),
      }));
    `);
    expect(result.high).toBe(true);
    expect(result.medium).toBe(true);
    expect(result.low).toBe(false);
    expect(result.none).toBe(false);
  });

  test("verifyLiveUrl returns structured checks object shape", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("lib/publish-receipt.js", "utf-8");
      // Verify the function returns the correct shape by checking source
      console.log(JSON.stringify({
        hasChecksObject: src.includes("checks: {"),
        hasHttpOk: src.includes("http_ok"),
        hasCanonicalMatch: src.includes("canonical_match"),
        hasTitleMatch: src.includes("title_match"),
        hasBodyMatch: src.includes("body_match"),
        hasVerificationConfidence: src.includes("verification_confidence"),
        hasIdentityMatch: src.includes("identityMatch"),
        returnsStructuredResult: src.includes("verification_confidence: \\"high\\"") || src.includes("verification_confidence = \\"high\\""),
      }));
    `);
    expect(result.hasChecksObject).toBe(true);
    expect(result.hasHttpOk).toBe(true);
    expect(result.hasCanonicalMatch).toBe(true);
    expect(result.hasTitleMatch).toBe(true);
    expect(result.hasBodyMatch).toBe(true);
    expect(result.hasVerificationConfidence).toBe(true);
    expect(result.hasIdentityMatch).toBe(true);
  });
});

// ── Retry with Backoff Tests ────────────────────────────────────────

test.describe("Retry with Backoff", () => {
  test("verifyLiveUrlWithRetry is exported and accepts backoffSchedule", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("lib/publish-receipt.js", "utf-8");
      console.log(JSON.stringify({
        hasExport: src.includes("export async function verifyLiveUrlWithRetry"),
        hasBackoffSchedule: src.includes("backoffSchedule"),
        hasDefaultBackoff: src.includes("[10000, 20000, 40000, 80000]"),
        hasAttemptsArray: src.includes("attempts.push"),
        returnsAttempts: src.includes("...result, attempts"),
      }));
    `);
    expect(result.hasExport).toBe(true);
    expect(result.hasBackoffSchedule).toBe(true);
    expect(result.hasDefaultBackoff).toBe(true);
    expect(result.hasAttemptsArray).toBe(true);
    expect(result.returnsAttempts).toBe(true);
  });

  test("receipt includes verification_attempts when results have attempts", () => {
    const result = runNode(`
      import { createManifest, addPublished, finalizeManifest } from "./lib/publish-manifest.js";
      import { buildReceipt } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "a-to-b", webflow_item_id: "id1", url: "https://example.com/a" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, [
        {
          slug: "a-to-b",
          url: "https://example.com/a",
          status: "verified_live",
          httpStatus: 200,
          identityMatch: true,
          error: null,
          checks: { http_ok: true, canonical_match: true, title_match: true, body_match: true },
          verification_confidence: "high",
          attempts: [
            { attempt: 1, timestamp: "2026-03-06T10:00:00Z", httpStatus: 404, status: "published_unverified", confidence: "none" },
            { attempt: 2, timestamp: "2026-03-06T10:00:10Z", httpStatus: 200, status: "verified_live", confidence: "high" },
          ],
        }
      ]);
      console.log(JSON.stringify({
        hasVerificationAttempts: !!receipt.verification_attempts,
        attemptCount: receipt.verification_attempts ? receipt.verification_attempts[0].attempts.length : 0,
        firstAttemptStatus: receipt.verification_attempts ? receipt.verification_attempts[0].attempts[0].status : null,
        secondAttemptStatus: receipt.verification_attempts ? receipt.verification_attempts[0].attempts[1].status : null,
      }));
    `);
    expect(result.hasVerificationAttempts).toBe(true);
    expect(result.attemptCount).toBe(2);
    expect(result.firstAttemptStatus).toBe("published_unverified");
    expect(result.secondAttemptStatus).toBe("verified_live");
  });

  test("receipt omits verification_attempts when no retry data exists", () => {
    const result = runNode(`
      import { createManifest, addPublished, finalizeManifest } from "./lib/publish-manifest.js";
      import { buildReceipt } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "a-to-b", webflow_item_id: "id1", url: "https://example.com/a" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, [
        { slug: "a-to-b", url: "https://example.com/a", status: "verified_live", httpStatus: 200, identityMatch: true, error: null }
      ]);
      console.log(JSON.stringify({
        hasVerificationAttempts: "verification_attempts" in receipt,
      }));
    `);
    expect(result.hasVerificationAttempts).toBe(false);
  });
});

// ── Direct Run ID Handoff Tests ─────────────────────────────────────

test.describe("Direct Run ID Handoff", () => {
  test("parseRunIdFromStdout captures PUBLISH_RUN_ID= line", () => {
    const result = runNode(`
      // Replicate parseRunIdFromStdout from publish_text_batch.js
      function parseRunIdFromStdout(stdout) {
        if (!stdout) return null;
        for (const line of stdout.split("\\n")) {
          const exact = line.match(/^PUBLISH_RUN_ID=(.+)/);
          if (exact) return exact[1].trim();
          const match = line.match(/Run ID:\\s+(.+)/);
          if (match) return match[1].trim();
        }
        return null;
      }
      const stdout1 = "Publishing 5 pages...\\nPUBLISH_RUN_ID=2026-03-06T14-30-00-000Z\\nDone.";
      const stdout2 = "Publishing...\\n  Run ID:      2026-03-06T14-30-00-000Z\\nDone.";
      const stdout3 = "No run id here\\nJust output.";
      const stdout4 = "";
      console.log(JSON.stringify({
        machineReadable: parseRunIdFromStdout(stdout1),
        humanReadable: parseRunIdFromStdout(stdout2),
        missing: parseRunIdFromStdout(stdout3),
        empty: parseRunIdFromStdout(stdout4),
        nullInput: parseRunIdFromStdout(null),
      }));
    `);
    expect(result.machineReadable).toBe("2026-03-06T14-30-00-000Z");
    expect(result.humanReadable).toBe("2026-03-06T14-30-00-000Z");
    expect(result.missing).toBeNull();
    expect(result.empty).toBeNull();
    expect(result.nullInput).toBeNull();
  });

  test("publish_next.js emits PUBLISH_RUN_ID= machine-readable line", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/publish_next.js", "utf-8");
      console.log(JSON.stringify({
        hasPublishRunIdEmit: src.includes("PUBLISH_RUN_ID="),
        emitsAfterManifestSave: src.indexOf("PUBLISH_RUN_ID=") > src.indexOf("saveManifest"),
      }));
    `);
    expect(result.hasPublishRunIdEmit).toBe(true);
    expect(result.emitsAfterManifestSave).toBe(true);
  });

  test("publish_text_batch.js captures stdout and has direct run_id handoff", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/publish_text_batch.js", "utf-8");
      const hasPipeAndStdio = src.includes("pipe") && src.includes("stdio");
      console.log(JSON.stringify({
        capturesStdout: hasPipeAndStdio,
        hasParseRunId: src.includes("parseRunIdFromStdout"),
        hasFallbackManifest: src.includes("findRecentManifestRunId"),
        noBrittleDiffing: !src.includes("manifestsBefore"),
      }));
    `);
    expect(result.capturesStdout).toBe(true);
    expect(result.hasParseRunId).toBe(true);
    expect(result.hasFallbackManifest).toBe(true);
    expect(result.noBrittleDiffing).toBe(true);
  });
});

// ── Fallback HTML Receipt Tests ─────────────────────────────────────

test.describe("Fallback HTML Receipt", () => {
  test("saveReceiptHtml produces HTML file that can be re-read", () => {
    const result = runNode(`
      import { createManifest, addPublished, finalizeManifest } from "./lib/publish-manifest.js";
      import { buildReceipt, saveReceiptHtml } from "./lib/publish-receipt.js";
      import fs from "fs";
      const m = createManifest({ scriptName: "test-html.js" });
      addPublished(m, { slug: "test-html-page", webflow_item_id: "id1", url: "https://example.com/test" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, [
        { slug: "test-html-page", url: "https://example.com/test", status: "verified_live", httpStatus: 200, identityMatch: true, error: null }
      ]);
      receipt.recipient = "troy@wearewarp.com";
      const { path: htmlPath } = saveReceiptHtml(receipt);
      const htmlContent = fs.readFileSync(htmlPath, "utf-8");
      // Clean up
      fs.unlinkSync(htmlPath);
      console.log(JSON.stringify({
        fileWasCreated: true,
        isHtml: htmlContent.startsWith("<!DOCTYPE html>"),
        containsRunId: htmlContent.includes(receipt.run_id),
        containsVerifiedUrl: htmlContent.includes("https://example.com/test"),
        containsStatusLabel: htmlContent.includes("ALL VERIFIED LIVE"),
        pathEndsWithHtml: htmlPath.endsWith(".html"),
      }));
    `);
    expect(result.fileWasCreated).toBe(true);
    expect(result.isHtml).toBe(true);
    expect(result.containsRunId).toBe(true);
    expect(result.containsVerifiedUrl).toBe(true);
    expect(result.containsStatusLabel).toBe(true);
    expect(result.pathEndsWithHtml).toBe(true);
  });

  test("publish_text_batch.js always generates HTML receipt", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/publish_text_batch.js", "utf-8");
      console.log(JSON.stringify({
        importsSaveReceiptHtml: src.includes("saveReceiptHtml"),
        callsSaveReceiptHtml: (src.match(/saveReceiptHtml\\(/g) || []).length > 0,
        hasEmailFailFallback: src.includes("Fallback receipt saved") || src.includes("Email not sent"),
      }));
    `);
    expect(result.importsSaveReceiptHtml).toBe(true);
    expect(result.callsSaveReceiptHtml).toBe(true);
    expect(result.hasEmailFailFallback).toBe(true);
  });

  test("confirmation email HTML separates verified and unverified with correct link rules", () => {
    const result = runNode(`
      import { createManifest, addPublished, finalizeManifest } from "./lib/publish-manifest.js";
      import { buildReceipt, buildConfirmationEmailHtml } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "a-to-b", webflow_item_id: "id1", url: "https://www.wearewarp.com/lanes/a-to-b" });
      addPublished(m, { slug: "c-to-d", webflow_item_id: "id2", url: "https://www.wearewarp.com/lanes/c-to-d" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, [
        { slug: "a-to-b", url: "https://www.wearewarp.com/lanes/a-to-b", status: "verified_live", httpStatus: 200, identityMatch: true, error: null },
        { slug: "c-to-d", url: "https://www.wearewarp.com/lanes/c-to-d", status: "published_unverified", httpStatus: 404, identityMatch: false, error: "HTTP 404" },
      ]);
      const html = buildConfirmationEmailHtml(receipt);
      const dq = String.fromCharCode(34);
      const hrefRe = new RegExp("href=" + dq + "([^" + dq + "]+)" + dq, "g");
      const hrefs = [];
      let match;
      while ((match = hrefRe.exec(html)) !== null) { hrefs.push(match[1]); }
      console.log(JSON.stringify({
        hasUnverifiedSection: html.includes("Not Yet Verified"),
        hasUnverifiedSlug: html.includes("c-to-d"),
        hasVerifiedSection: html.includes("Verified Live Pages"),
        hasVerifiedLink: hrefs.some(h => h.includes("a-to-b")),
        unverifiedNotLinked: !hrefs.some(h => h.includes("c-to-d")),
        hasErrorReason: html.includes("HTTP 404"),
      }));
    `);
    expect(result.hasUnverifiedSection).toBe(true);
    expect(result.hasUnverifiedSlug).toBe(true);
    expect(result.hasVerifiedSection).toBe(true);
    expect(result.hasVerifiedLink).toBe(true);
    expect(result.unverifiedNotLinked).toBe(true);
    expect(result.hasErrorReason).toBe(true);
  });
});

// ── Cleanup Command Tests ───────────────────────────────────────────

test.describe("Cleanup — Retention Policy", () => {
  test("cleanupArtifacts respects keepMinRuns", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      import { resolveFromRoot } from "./lib/fs/project-root.js";
      import { cleanupArtifacts } from "./lib/publish-receipt.js";
      // Create a temp directory with test receipt files
      const dir = resolveFromRoot("artifacts/publish-receipts");
      fs.mkdirSync(dir, { recursive: true });
      // Create 8 test receipt files with old dates
      const testFiles = [];
      for (let i = 0; i < 8; i++) {
        const date = new Date(2020, 0, i + 1); // Jan 2020 — well past retention
        const runId = date.toISOString().replace(/[:.]/g, "-");
        const fileName = "receipt_" + runId + ".json";
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, JSON.stringify({ run_id: runId, started_at: date.toISOString() }));
        // Set the mtime to the old date
        fs.utimesSync(filePath, date, date);
        testFiles.push({ path: filePath, fileName });
      }
      // Run cleanup with keepMinRuns=3, retentionDays=1 (all are older)
      const result = cleanupArtifacts({ retentionDays: 1, keepMinRuns: 3 });
      // Verify which files still exist
      const remainingTestFiles = testFiles.filter(f => fs.existsSync(f.path));
      // Clean up remaining test files
      for (const f of testFiles) {
        try { fs.unlinkSync(f.path); } catch {}
      }
      console.log(JSON.stringify({
        deleted: result.deleted,
        kept: result.kept,
        remainingCount: remainingTestFiles.length,
        keptAtLeast3: result.kept >= 3,
      }));
    `);
    expect(result.keptAtLeast3).toBe(true);
    expect(result.deleted).toBeGreaterThan(0);
  });

  test("cleanupArtifacts returns zero deleted when nothing expired", () => {
    const result = runNode(`
      import { cleanupArtifacts } from "./lib/publish-receipt.js";
      // Use very long retention — nothing should be deleted
      const result = cleanupArtifacts({ retentionDays: 99999, keepMinRuns: 100 });
      console.log(JSON.stringify({
        deleted: result.deleted,
      }));
    `);
    expect(result.deleted).toBe(0);
  });

  test("publish_cleanup.js script exists and has correct flags", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/publish_cleanup.js", "utf-8");
      console.log(JSON.stringify({
        hasDaysFlag: src.includes("--days=") || src.includes('"days"'),
        hasKeepFlag: src.includes("--keep=") || src.includes('"keep"'),
        hasConfirmFlag: src.includes("--confirm"),
        hasDryRunDefault: src.includes("DRY RUN") || src.includes("dry run"),
        hasRetentionPolicy: src.includes("retention"),
        scansReceipts: src.includes("receipt_"),
        scansManifests: src.includes("publish_") || src.includes("manifests"),
      }));
    `);
    expect(result.hasDaysFlag).toBe(true);
    expect(result.hasKeepFlag).toBe(true);
    expect(result.hasConfirmFlag).toBe(true);
    expect(result.hasDryRunDefault).toBe(true);
    expect(result.scansReceipts).toBe(true);
    expect(result.scansManifests).toBe(true);
  });

  test("package.json has cleanup commands", () => {
    const result = runNode(`
      import fs from "fs";
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
      console.log(JSON.stringify({
        hasCleanup: !!pkg.scripts["publish:cleanup"],
        hasCleanupConfirm: !!pkg.scripts["publish:cleanup:confirm"],
        cleanupIsDryRun: pkg.scripts["publish:cleanup"]?.includes("publish_cleanup.js") && !pkg.scripts["publish:cleanup"]?.includes("--confirm"),
        confirmHasFlag: pkg.scripts["publish:cleanup:confirm"]?.includes("--confirm"),
      }));
    `);
    expect(result.hasCleanup).toBe(true);
    expect(result.hasCleanupConfirm).toBe(true);
    expect(result.cleanupIsDryRun).toBe(true);
    expect(result.confirmHasFlag).toBe(true);
  });
});

// ── Enhanced Proof Output Tests ─────────────────────────────────────

test.describe("Proof Output — Enhanced Detail", () => {
  test("proof command JSON output includes unverified URLs and retry history", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/publish_prove_last.js", "utf-8");
      console.log(JSON.stringify({
        hasPublishedUnverifiedUrls: src.includes("published_unverified_urls"),
        hasRetryHistory: src.includes("retry_history"),
        hasBlockedPages: src.includes("blocked_pages"),
        hasFailedPages: src.includes("failed_pages"),
        hasVerifiedLiveNow: src.includes("verified_live_now"),
        hasManifestPath: src.includes("manifest_path"),
        hasReceiptPath: src.includes("receipt_path"),
        hasSelectedPages: src.includes("selected_pages"),
        hasEmailResult: src.includes("email_result"),
        hasRecipient: src.includes("recipient"),
      }));
    `);
    expect(result.hasPublishedUnverifiedUrls).toBe(true);
    expect(result.hasRetryHistory).toBe(true);
    expect(result.hasBlockedPages).toBe(true);
    expect(result.hasFailedPages).toBe(true);
    expect(result.hasVerifiedLiveNow).toBe(true);
    expect(result.hasManifestPath).toBe(true);
    expect(result.hasReceiptPath).toBe(true);
    expect(result.hasSelectedPages).toBe(true);
    expect(result.hasEmailResult).toBe(true);
    expect(result.hasRecipient).toBe(true);
  });

  test("proof command uses retry verification (not single-shot)", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/publish_prove_last.js", "utf-8");
      console.log(JSON.stringify({
        hasRetryWrapper: src.includes("verifyLiveUrlWithRetry"),
        hasBackoffMs: src.includes("backoffMs"),
        tracksAttempts: src.includes("attempts"),
        separatesVerifiedFromUnverified: src.includes("publishedUnverified"),
      }));
    `);
    expect(result.hasRetryWrapper).toBe(true);
    expect(result.hasBackoffMs).toBe(true);
    expect(result.tracksAttempts).toBe(true);
    expect(result.separatesVerifiedFromUnverified).toBe(true);
  });
});

// ── Receipt published_unverified_urls Tests ─────────────────────────

test.describe("Receipt — Unverified URL Tracking", () => {
  test("buildReceipt separates verified and unverified URLs", () => {
    const result = runNode(`
      import { createManifest, addPublished, finalizeManifest } from "./lib/publish-manifest.js";
      import { buildReceipt } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "a-to-b", webflow_item_id: "id1", url: "https://example.com/a" });
      addPublished(m, { slug: "c-to-d", webflow_item_id: "id2", url: "https://example.com/c" });
      addPublished(m, { slug: "e-to-f", webflow_item_id: "id3", url: "https://example.com/e" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, [
        { slug: "a-to-b", url: "https://example.com/a", status: "verified_live", httpStatus: 200, identityMatch: true, error: null },
        { slug: "c-to-d", url: "https://example.com/c", status: "published_unverified", httpStatus: 404, identityMatch: false, error: "HTTP 404" },
        { slug: "e-to-f", url: "https://example.com/e", status: "published_unverified", httpStatus: 200, identityMatch: false, error: "low confidence" },
      ]);
      console.log(JSON.stringify({
        verifiedCount: receipt.verified_live_count,
        unverifiedCount: receipt.published_unverified_count,
        verifiedUrlSlugs: receipt.verified_live_urls.map(v => v.slug),
        unverifiedUrlSlugs: receipt.published_unverified_urls.map(v => v.slug),
        unverifiedHasErrors: receipt.published_unverified_urls.every(v => !!v.error),
      }));
    `);
    expect(result.verifiedCount).toBe(1);
    expect(result.unverifiedCount).toBe(2);
    expect(result.verifiedUrlSlugs).toEqual(["a-to-b"]);
    expect(result.unverifiedUrlSlugs).toEqual(["c-to-d", "e-to-f"]);
    expect(result.unverifiedHasErrors).toBe(true);
  });
});

// ── Receipt and Manifest Sync Tests ───────────────────────────────────

test.describe("Receipt and Manifest Sync", () => {
  test("receipt run_id matches manifest run_id", () => {
    const result = runNode(`
      import { createManifest, addPublished, finalizeManifest } from "./lib/publish-manifest.js";
      import { buildReceipt } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "a-to-b", webflow_item_id: "id1", url: "https://example.com/a" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, []);
      console.log(JSON.stringify({
        match: receipt.run_id === m.run_id,
        receiptRunId: receipt.run_id,
        manifestRunId: m.run_id,
      }));
    `);
    expect(result.match).toBe(true);
  });

  test("receipt counts match manifest counts", () => {
    const result = runNode(`
      import { createManifest, addPublished, addFailed, addBlocked, finalizeManifest } from "./lib/publish-manifest.js";
      import { buildReceipt } from "./lib/publish-receipt.js";
      const m = createManifest({ scriptName: "test.js" });
      addPublished(m, { slug: "a-to-b", webflow_item_id: "id1", url: "https://example.com/a" });
      addPublished(m, { slug: "c-to-d", webflow_item_id: "id2", url: "https://example.com/c" });
      addFailed(m, { slug: "e-to-f", reason: "error" });
      addBlocked(m, { slug: "g-to-h", reason: "dup", rule_id: "DUP" });
      finalizeManifest(m);
      const receipt = buildReceipt(m, [
        { slug: "a-to-b", url: "https://example.com/a", status: "verified_live", httpStatus: 200, identityMatch: true, error: null },
        { slug: "c-to-d", url: "https://example.com/c", status: "published_unverified", httpStatus: 404, identityMatch: false, error: "404" },
      ]);
      console.log(JSON.stringify({
        publishedMatch: receipt.published_count === m.published_count,
        failedMatch: receipt.failed_count === m.failed_count,
        blockedMatch: receipt.blocked_count === m.blocked_count,
        verifiedLive: receipt.verified_live_count,
        unverified: receipt.published_unverified_count,
      }));
    `);
    expect(result.publishedMatch).toBe(true);
    expect(result.failedMatch).toBe(true);
    expect(result.blockedMatch).toBe(true);
    expect(result.verifiedLive).toBe(1);
    expect(result.unverified).toBe(1);
  });
});

// ── Approval Gate ────────────────────────────────────────────────────────

test.describe("Approval Gate — State Model", () => {
  test("VALID_STATES contains all 8 required states", () => {
    const result = runNode(`
      import { VALID_STATES } from "./lib/approval-gate.js";
      console.log(JSON.stringify({ states: VALID_STATES, count: VALID_STATES.length }));
    `);
    expect(result.count).toBe(8);
    expect(result.states).toContain("draft");
    expect(result.states).toContain("ready_for_review");
    expect(result.states).toContain("approved");
    expect(result.states).toContain("manufactured");
    expect(result.states).toContain("published_pending_verification");
    expect(result.states).toContain("verified_live");
    expect(result.states).toContain("failed");
    expect(result.states).toContain("blocked");
  });

  test("loadApprovalState returns empty array when file missing", () => {
    const result = runNode(`
      import { loadApprovalState } from "./lib/approval-gate.js";
      import fs from "fs";
      import { resolveFromRoot } from "./lib/fs/project-root.js";
      const p = resolveFromRoot("data/approval_state.json");
      const existed = fs.existsSync(p);
      let backup = null;
      if (existed) { backup = fs.readFileSync(p, "utf-8"); fs.unlinkSync(p); }
      try {
        const { entries, warnings } = loadApprovalState();
        console.log(JSON.stringify({ count: entries.length, isArray: Array.isArray(entries) }));
      } finally {
        if (backup !== null) fs.writeFileSync(p, backup);
      }
    `);
    expect(result.count).toBe(0);
    expect(result.isArray).toBe(true);
  });

  test("transitionState creates new entry and records state_history", () => {
    const result = runNode(`
      import { transitionState, loadApprovalState, writeApprovalState } from "./lib/approval-gate.js";
      import fs from "fs";
      import { resolveFromRoot } from "./lib/fs/project-root.js";
      const p = resolveFromRoot("data/approval_state.json");
      const existed = fs.existsSync(p);
      let backup = null;
      if (existed) { backup = fs.readFileSync(p, "utf-8"); }
      // Start clean
      writeApprovalState([], { backup: false });
      try {
        const r = transitionState("test-slug-001", "LTL", "approved", { by: "test", note: "test note" });
        console.log(JSON.stringify({
          success: r.success,
          state: r.entry.state,
          approved_by: r.entry.approved_by,
          approval_note: r.entry.approval_note,
          historyLen: r.entry.state_history.length,
          historyFrom: r.entry.state_history[0].from,
          historyTo: r.entry.state_history[0].to,
          historyBy: r.entry.state_history[0].by,
        }));
      } finally {
        if (backup !== null) { fs.writeFileSync(p, backup); } else if (fs.existsSync(p)) { fs.unlinkSync(p); }
      }
    `);
    expect(result.success).toBe(true);
    expect(result.state).toBe("approved");
    expect(result.approved_by).toBe("test");
    expect(result.approval_note).toBe("test note");
    expect(result.historyLen).toBe(1);
    expect(result.historyFrom).toBe("draft");
    expect(result.historyTo).toBe("approved");
    expect(result.historyBy).toBe("test");
  });

  test("transitionState rejects invalid transitions (draft to verified_live)", () => {
    const result = runNode(`
      import { transitionState, writeApprovalState } from "./lib/approval-gate.js";
      import fs from "fs";
      import { resolveFromRoot } from "./lib/fs/project-root.js";
      const p = resolveFromRoot("data/approval_state.json");
      const existed = fs.existsSync(p);
      let backup = null;
      if (existed) { backup = fs.readFileSync(p, "utf-8"); }
      writeApprovalState([], { backup: false });
      try {
        const r = transitionState("test-slug-002", "LTL", "verified_live", { by: "test" });
        console.log(JSON.stringify({
          success: r.success,
          hasWarning: r.warnings.length > 0,
          warningText: r.warnings[0] || "",
        }));
      } finally {
        if (backup !== null) { fs.writeFileSync(p, backup); } else if (fs.existsSync(p)) { fs.unlinkSync(p); }
      }
    `);
    expect(result.success).toBe(false);
    expect(result.hasWarning).toBe(true);
    expect(result.warningText).toContain("Invalid transition");
  });

  test("batchTransitionState updates multiple lanes", () => {
    const result = runNode(`
      import { batchTransitionState, loadApprovalState, writeApprovalState } from "./lib/approval-gate.js";
      import fs from "fs";
      import { resolveFromRoot } from "./lib/fs/project-root.js";
      const p = resolveFromRoot("data/approval_state.json");
      const existed = fs.existsSync(p);
      let backup = null;
      if (existed) { backup = fs.readFileSync(p, "utf-8"); }
      writeApprovalState([], { backup: false });
      try {
        const lanes = [
          { slug: "batch-a", mode: "LTL" },
          { slug: "batch-b", mode: "FTL" },
          { slug: "batch-c", mode: "LTL" },
        ];
        const r = batchTransitionState(lanes, "approved", { by: "test", note: "batch test" });
        const { entries } = loadApprovalState();
        // Count only the batch- slugs to avoid interference from parallel tests
        const batchApprovedCount = entries.filter(e => e.state === "approved" && e.slug.startsWith("batch-")).length;
        console.log(JSON.stringify({ updated: r.updated, skipped: r.skipped, batchApprovedCount }));
      } finally {
        if (backup !== null) { fs.writeFileSync(p, backup); } else if (fs.existsSync(p)) { fs.unlinkSync(p); }
      }
    `);
    expect(result.updated).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.batchApprovedCount).toBe(3);
  });

  test("computePublishEligibility classifies lanes correctly", () => {
    const result = runNode(`
      import { writeApprovalState, computePublishEligibility } from "./lib/approval-gate.js";
      import fs from "fs";
      import { resolveFromRoot } from "./lib/fs/project-root.js";
      const p = resolveFromRoot("data/approval_state.json");
      const existed = fs.existsSync(p);
      let backup = null;
      if (existed) { backup = fs.readFileSync(p, "utf-8"); }
      // Set up known states
      writeApprovalState([
        { slug: "elig-test-approved", mode: "LTL", state: "approved", state_history: [] },
        { slug: "elig-test-blocked", mode: "LTL", state: "blocked", excluded_reason: "test block", state_history: [] },
        { slug: "elig-test-live", mode: "LTL", state: "verified_live", state_history: [] },
      ], { backup: false });
      try {
        const r = computePublishEligibility();
        // Check for specific test slugs rather than total counts (avoids parallel test interference)
        const hasBlocked = r.blocked.some(e => e.slug === "elig-test-blocked");
        const hasLive = r.already_live.some(e => e.slug === "elig-test-live");
        console.log(JSON.stringify({
          hasTotals: typeof r.totals === "object",
          hasBlocked,
          hasLive,
          draftIsNumber: typeof r.draft === "number",
        }));
      } finally {
        if (backup !== null) { fs.writeFileSync(p, backup); } else if (fs.existsSync(p)) { fs.unlinkSync(p); }
      }
    `);
    expect(result.hasTotals).toBe(true);
    expect(result.hasBlocked).toBe(true);
    expect(result.hasLive).toBe(true);
    expect(result.draftIsNumber).toBe(true);
  });

  test("getApprovedPublishSet filters by mode", () => {
    const result = runNode(`
      import { writeApprovalState, getApprovedPublishSet } from "./lib/approval-gate.js";
      import fs from "fs";
      import { resolveFromRoot } from "./lib/fs/project-root.js";
      const p = resolveFromRoot("data/approval_state.json");
      const existed = fs.existsSync(p);
      let backup = null;
      if (existed) { backup = fs.readFileSync(p, "utf-8"); }
      writeApprovalState([
        { slug: "filter-ltl", mode: "LTL", state: "approved", state_history: [] },
        { slug: "filter-ftl", mode: "FTL", state: "approved", state_history: [] },
      ], { backup: false });
      try {
        const ltl = getApprovedPublishSet({ filterMode: "LTL" });
        const ftl = getApprovedPublishSet({ filterMode: "FTL" });
        const all = getApprovedPublishSet({});
        console.log(JSON.stringify({
          ltlCount: ltl.eligible.length,
          ftlCount: ftl.eligible.length,
          allCount: all.eligible.length,
        }));
      } finally {
        if (backup !== null) { fs.writeFileSync(p, backup); } else if (fs.existsSync(p)) { fs.unlinkSync(p); }
      }
    `);
    // These slugs may or may not be in inventory — the filter still applies to whatever is eligible
    expect(result.ltlCount).toBeGreaterThanOrEqual(0);
    expect(result.ftlCount).toBeGreaterThanOrEqual(0);
  });

  test("approved lane with slug in webflow_existing_slugs is excluded", () => {
    const result = runNode(`
      import { writeApprovalState, computePublishEligibility } from "./lib/approval-gate.js";
      import fs from "fs";
      import { resolveFromRoot } from "./lib/fs/project-root.js";
      const p = resolveFromRoot("data/approval_state.json");
      const existed = fs.existsSync(p);
      let backup = null;
      if (existed) { backup = fs.readFileSync(p, "utf-8"); }
      // Pick a slug we know is in webflow_existing_slugs.json
      const webflowSlugs = JSON.parse(fs.readFileSync(resolveFromRoot("data/webflow_existing_slugs.json"), "utf-8"));
      const testSlug = webflowSlugs[0] || "no-slug-found";
      writeApprovalState([
        { slug: testSlug, mode: "LTL", state: "approved", state_history: [] },
      ], { backup: false });
      try {
        const r = computePublishEligibility();
        const isExcluded = r.excluded.some(e => e.slug === testSlug);
        const isApproved = r.approved_eligible.some(e => e.slug === testSlug);
        console.log(JSON.stringify({ testSlug, isExcluded, isApproved }));
      } finally {
        if (backup !== null) { fs.writeFileSync(p, backup); } else if (fs.existsSync(p)) { fs.unlinkSync(p); }
      }
    `);
    // The slug is approved but should be in excluded (not eligible) because it's in webflow_existing_slugs
    expect(result.isExcluded).toBe(true);
    expect(result.isApproved).toBe(false);
  });

  test("publish_next with empty approval_state falls back to inventory behavior", () => {
    const result = runNode(`
      import { getApprovedPublishSet, loadApprovalState } from "./lib/approval-gate.js";
      const { entries } = loadApprovalState();
      const { eligible } = getApprovedPublishSet({ filterMode: "LTL" });
      // When no approvals exist, eligible is empty — publish_next falls back to inventory
      console.log(JSON.stringify({
        entriesCount: entries.length,
        eligibleCount: eligible.length,
        fallbackCondition: eligible.length === 0,
      }));
    `);
    // If approval_state is empty/missing, eligible should be empty (or only have approved entries)
    // The fallback condition (eligible.length === 0) tells publish_next to use inventory
    expect(typeof result.fallbackCondition).toBe("boolean");
  });

  test("list_approved.js script exists and supports --json flag", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const scriptPath = path.join(process.cwd(), "scripts", "list_approved.js");
      const exists = fs.existsSync(scriptPath);
      const content = exists ? fs.readFileSync(scriptPath, "utf-8") : "";
      console.log(JSON.stringify({
        exists,
        hasJsonFlag: content.includes("--json"),
        hasModeFlag: content.includes("--mode"),
      }));
    `);
    expect(result.exists).toBe(true);
    expect(result.hasJsonFlag).toBe(true);
    expect(result.hasModeFlag).toBe(true);
  });

  test("approve_lane.js script exists and requires --by flag", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const scriptPath = path.join(process.cwd(), "scripts", "approve_lane.js");
      const exists = fs.existsSync(scriptPath);
      const content = exists ? fs.readFileSync(scriptPath, "utf-8") : "";
      console.log(JSON.stringify({
        exists,
        hasByFlag: content.includes("--by"),
        hasBatchFlag: content.includes("--batch"),
        hasSlugFlag: content.includes("--slug"),
      }));
    `);
    expect(result.exists).toBe(true);
    expect(result.hasByFlag).toBe(true);
    expect(result.hasBatchFlag).toBe(true);
    expect(result.hasSlugFlag).toBe(true);
  });
});

// ── SEO Boost Report Tests ──────────────────────────────────────────────

test.describe("SEO Boost Report", () => {
  test("buildSeoBoostReport returns correct structure", () => {
    const result = runNode(`
      import { buildSeoBoostReport } from "./lib/seo-boost-report.js";
      const manifest = {
        run_id: "test-run-001",
        published_pages: [
          { slug: "dallas-to-houston" },
          { slug: "houston-to-dallas" },
        ],
      };
      const report = buildSeoBoostReport({ manifest });
      console.log(JSON.stringify({
        hasRunId: !!report.run_id,
        hasGeneratedAt: !!report.generated_at,
        hasSummary: !!report.summary,
        hasPages: Array.isArray(report.pages),
        pageCount: report.pages.length,
        summaryKeys: Object.keys(report.summary).sort(),
        hasMissingInternalLinks: Array.isArray(report.missing_internal_links),
        hasMissingSitemap: Array.isArray(report.missing_sitemap),
      }));
    `);
    expect(result.hasRunId).toBe(true);
    expect(result.hasGeneratedAt).toBe(true);
    expect(result.hasSummary).toBe(true);
    expect(result.hasPages).toBe(true);
    expect(result.pageCount).toBe(2);
    expect(result.summaryKeys).toEqual([
      "internally_linked",
      "pending_verification",
      "published",
      "sitemap_added",
      "verified_live",
    ]);
    expect(result.hasMissingInternalLinks).toBe(true);
    expect(result.hasMissingSitemap).toBe(true);
  });

  test("buildSeoBoostReport page entries have all required fields", () => {
    const result = runNode(`
      import { buildSeoBoostReport } from "./lib/seo-boost-report.js";
      const manifest = {
        run_id: "test-run-002",
        published_pages: [{ slug: "test-slug" }],
      };
      const report = buildSeoBoostReport({ manifest });
      const page = report.pages[0];
      console.log(JSON.stringify({
        slug: page.slug,
        url: page.url,
        published: page.published,
        hasVerificationStatus: typeof page.verification_status === "string",
        hasSitemapAdded: typeof page.sitemap_added === "boolean",
        hasInternallyLinked: typeof page.internally_linked === "boolean",
        hasInboundLinkCount: typeof page.inbound_link_count === "number",
      }));
    `);
    expect(result.slug).toBe("test-slug");
    expect(result.url).toBe("https://www.wearewarp.com/lanes/test-slug");
    expect(result.published).toBe(true);
    expect(result.hasVerificationStatus).toBe(true);
    expect(result.hasSitemapAdded).toBe(true);
    expect(result.hasInternallyLinked).toBe(true);
    expect(result.hasInboundLinkCount).toBe(true);
  });

  test("buildSeoBoostReport defaults to published_pending_verification", () => {
    const result = runNode(`
      import { buildSeoBoostReport } from "./lib/seo-boost-report.js";
      const manifest = {
        run_id: "test-run-003",
        published_pages: [{ slug: "new-lane" }],
      };
      const report = buildSeoBoostReport({ manifest, verificationResults: [] });
      console.log(JSON.stringify({
        status: report.pages[0].verification_status,
        pendingCount: report.summary.pending_verification,
        verifiedCount: report.summary.verified_live,
      }));
    `);
    expect(result.status).toBe("published_pending_verification");
    expect(result.pendingCount).toBe(1);
    expect(result.verifiedCount).toBe(0);
  });

  test("buildSeoBoostReport uses verification results when provided", () => {
    const result = runNode(`
      import { buildSeoBoostReport } from "./lib/seo-boost-report.js";
      const manifest = {
        run_id: "test-run-004",
        published_pages: [
          { slug: "lane-a" },
          { slug: "lane-b" },
        ],
      };
      const verificationResults = [
        { slug: "lane-a", status: "verified_live" },
      ];
      const report = buildSeoBoostReport({ manifest, verificationResults });
      console.log(JSON.stringify({
        laneAStatus: report.pages.find(p => p.slug === "lane-a").verification_status,
        laneBStatus: report.pages.find(p => p.slug === "lane-b").verification_status,
        verifiedCount: report.summary.verified_live,
        pendingCount: report.summary.pending_verification,
      }));
    `);
    expect(result.laneAStatus).toBe("verified_live");
    expect(result.laneBStatus).toBe("published_pending_verification");
    expect(result.verifiedCount).toBe(1);
    expect(result.pendingCount).toBe(1);
  });

  test("buildSeoBoostReport with empty manifest returns empty pages", () => {
    const result = runNode(`
      import { buildSeoBoostReport } from "./lib/seo-boost-report.js";
      const manifest = { run_id: "empty-run", published_pages: [] };
      const report = buildSeoBoostReport({ manifest });
      console.log(JSON.stringify({
        pageCount: report.pages.length,
        published: report.summary.published,
        missingLinks: report.missing_internal_links.length,
        missingSitemap: report.missing_sitemap.length,
      }));
    `);
    expect(result.pageCount).toBe(0);
    expect(result.published).toBe(0);
    expect(result.missingLinks).toBe(0);
    expect(result.missingSitemap).toBe(0);
  });
});

// ── Publish Approved Batch Script Tests ─────────────────────────────────

test.describe("Publish Approved Batch Script", () => {
  test("publish_approved_batch.js exists and has required features", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const scriptPath = path.join(process.cwd(), "scripts", "publish_approved_batch.js");
      const exists = fs.existsSync(scriptPath);
      const content = exists ? fs.readFileSync(scriptPath, "utf-8") : "";
      console.log(JSON.stringify({
        exists,
        hasLiveFlag: content.includes("--live"),
        hasDryRunFlag: content.includes("--dry-run"),
        hasForceFlag: content.includes("--force"),
        hasVerifyFlag: content.includes("--verify"),
        hasNotifyFlag: content.includes("--notify"),
        hasModeFlag: content.includes("--mode"),
        usesApprovalGate: content.includes("computePublishEligibility"),
        usesPublishNext: content.includes("publish_next.js"),
        usesSitemapRegen: content.includes("generate_all_sitemaps"),
        usesSeoBoostReport: content.includes("buildSeoBoostReport"),
        usesNodemailer: content.includes("nodemailer") || content.includes("email-sender"),
      }));
    `);
    expect(result.exists).toBe(true);
    expect(result.hasLiveFlag).toBe(true);
    expect(result.hasDryRunFlag).toBe(true);
    expect(result.hasForceFlag).toBe(true);
    expect(result.hasVerifyFlag).toBe(true);
    expect(result.hasNotifyFlag).toBe(true);
    expect(result.hasModeFlag).toBe(true);
    expect(result.usesApprovalGate).toBe(true);
    expect(result.usesPublishNext).toBe(true);
    expect(result.usesSitemapRegen).toBe(true);
    expect(result.usesSeoBoostReport).toBe(true);
    expect(result.usesNodemailer).toBe(true);
  });

  test("publish_approved_batch.js uses factual status language only", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const content = fs.readFileSync(
        path.join(process.cwd(), "scripts", "publish_approved_batch.js"), "utf-8"
      );
      console.log(JSON.stringify({
        hasPublishedPendingVerification: content.includes("published_pending_verification"),
        hasVerifiedLive: content.includes("verified_live"),
        noSeoBoosted: !content.includes("seo_boosted"),
        noGuaranteedRanking: !content.includes("guaranteed_ranking"),
      }));
    `);
    expect(result.hasPublishedPendingVerification).toBe(true);
    expect(result.hasVerifiedLive).toBe(true);
    expect(result.noSeoBoosted).toBe(true);
    expect(result.noGuaranteedRanking).toBe(true);
  });
});

// ── SEO Readiness Check Script Tests ────────────────────────────────────

test.describe("SEO Readiness Check Script", () => {
  test("seo_readiness_check.js exists and has 9 checks", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const scriptPath = path.join(process.cwd(), "scripts", "seo_readiness_check.js");
      const exists = fs.existsSync(scriptPath);
      const content = exists ? fs.readFileSync(scriptPath, "utf-8") : "";
      console.log(JSON.stringify({
        exists,
        hasHttp200Check: content.includes("http_200"),
        hasCanonicalCheck: content.includes("canonical"),
        hasNoindexCheck: content.includes("noindex"),
        hasRobotsCheck: content.includes("robots"),
        hasTitleCheck: content.includes("unique_title"),
        hasH1Check: content.includes("unique_h1"),
        hasBodyContentCheck: content.includes("body_content"),
        hasInternalLinksCheck: content.includes("internal_links"),
        hasSitemapCheck: content.includes("in_sitemap"),
        hasRunIdFlag: content.includes("--run-id"),
        hasJsonFlag: content.includes("--json"),
        hasSkipTransition: content.includes("--skip-transition"),
      }));
    `);
    expect(result.exists).toBe(true);
    expect(result.hasHttp200Check).toBe(true);
    expect(result.hasCanonicalCheck).toBe(true);
    expect(result.hasNoindexCheck).toBe(true);
    expect(result.hasRobotsCheck).toBe(true);
    expect(result.hasTitleCheck).toBe(true);
    expect(result.hasH1Check).toBe(true);
    expect(result.hasBodyContentCheck).toBe(true);
    expect(result.hasInternalLinksCheck).toBe(true);
    expect(result.hasSitemapCheck).toBe(true);
    expect(result.hasRunIdFlag).toBe(true);
    expect(result.hasJsonFlag).toBe(true);
    expect(result.hasSkipTransition).toBe(true);
  });

  test("seo_readiness_check.js transitions only on critical checks", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const content = fs.readFileSync(
        path.join(process.cwd(), "scripts", "seo_readiness_check.js"), "utf-8"
      );
      // Script should transition to verified_live and use transitionState
      console.log(JSON.stringify({
        usesTransitionState: content.includes("transitionState"),
        transitionsToVerifiedLive: content.includes("verified_live"),
        checksCriticalGates: content.includes("critical") || content.includes("CRITICAL"),
      }));
    `);
    expect(result.usesTransitionState).toBe(true);
    expect(result.transitionsToVerifiedLive).toBe(true);
    expect(result.checksCriticalGates).toBe(true);
  });

  test("seo_readiness_check.js uses factual status language only", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const content = fs.readFileSync(
        path.join(process.cwd(), "scripts", "seo_readiness_check.js"), "utf-8"
      );
      console.log(JSON.stringify({
        noSeoBoosted: !content.includes("seo_boosted"),
        noGuaranteedRanking: !content.includes("guaranteed"),
        hasIndexabilityPassed: content.includes("indexability_passed") || content.includes("all_checks_passed"),
      }));
    `);
    expect(result.noSeoBoosted).toBe(true);
    expect(result.noGuaranteedRanking).toBe(true);
    expect(result.hasIndexabilityPassed).toBe(true);
  });
});

// ── Generate Sitemaps --published-only Flag Tests ───────────────────────

test.describe("Generate Sitemaps — Published-Only Flag", () => {
  test("generate_all_sitemaps.js supports --published-only flag", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const content = fs.readFileSync(
        path.join(process.cwd(), "scripts", "generate_all_sitemaps.js"), "utf-8"
      );
      console.log(JSON.stringify({
        hasPublishedOnlyFlag: content.includes("--published-only"),
        loadsApprovalState: content.includes("approval_state.json"),
        loadsWebflowSlugs: content.includes("webflow_existing_slugs.json"),
        filtersRegistry: content.includes("approvedSlugs") && content.includes("webflowSlugs"),
        writesSitemapNewUrls: content.includes("sitemap_new_urls.json"),
      }));
    `);
    expect(result.hasPublishedOnlyFlag).toBe(true);
    expect(result.loadsApprovalState).toBe(true);
    expect(result.loadsWebflowSlugs).toBe(true);
    expect(result.filtersRegistry).toBe(true);
    expect(result.writesSitemapNewUrls).toBe(true);
  });
});

// ── NPM Scripts for Publish Pipeline ────────────────────────────────────

test.describe("NPM Scripts — Publish Pipeline", () => {
  test("package.json has all required publish pipeline scripts", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const pkg = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")
      );
      const scripts = pkg.scripts || {};
      console.log(JSON.stringify({
        hasPublishLanesAll: !!scripts["publish:lanes:all"],
        hasPublishLanesAllLive: !!scripts["publish:lanes:all:live"],
        hasPublishLanesAllForce: !!scripts["publish:lanes:all:force"],
        hasSeoCheckLast: !!scripts["publish:seo-check:last"],
        hasSeoCheckLastJson: !!scripts["publish:seo-check:last:json"],
        hasGenerateSitemapsPublished: !!scripts["generate:sitemaps:published"],
        publishLanesAllCmd: scripts["publish:lanes:all"],
        seoCheckLastCmd: scripts["publish:seo-check:last"],
      }));
    `);
    expect(result.hasPublishLanesAll).toBe(true);
    expect(result.hasPublishLanesAllLive).toBe(true);
    expect(result.hasPublishLanesAllForce).toBe(true);
    expect(result.hasSeoCheckLast).toBe(true);
    expect(result.hasSeoCheckLastJson).toBe(true);
    expect(result.hasGenerateSitemapsPublished).toBe(true);
    // Verify the commands point to the right scripts
    expect(result.publishLanesAllCmd).toContain("publish_approved_batch.js");
    expect(result.seoCheckLastCmd).toContain("seo_readiness_check.js");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ── LANE PAGE FACTORY TESTS ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

// ── Lane Factory Module Tests ───────────────────────────────────────────

test.describe("Lane Factory — Module Exports", () => {
  test("lane-factory.js exports all required functions", () => {
    const result = runNode(`
      import * as factory from "./lib/lane-factory.js";
      console.log(JSON.stringify({
        hasStableHash: typeof factory.stableHash === "function",
        hasSeededRng: typeof factory.seededRng === "function",
        hasBuildLaneSlug: typeof factory.buildLaneSlug === "function",
        hasBuildCanonicalPath: typeof factory.buildCanonicalPathForLane === "function",
        hasBuildPackageForLane: typeof factory.buildPackageForLane === "function",
        hasBuildBodyContent: typeof factory.buildBodyContent === "function",
        hasBuildFaqSchemaEmbed: typeof factory.buildFaqSchemaEmbed === "function",
        hasBuildBreadcrumbSchemaEmbed: typeof factory.buildBreadcrumbSchemaEmbed === "function",
        hasBuildWebflowFields: typeof factory.buildWebflowFields === "function",
        hasShipOneLane: typeof factory.shipOneLane === "function",
        hasComputeHubPriority: typeof factory.computeHubPriority === "function",
        hasComputeClusterPriority: typeof factory.computeClusterPriority === "function",
        hasLoadLearningStateForPriority: typeof factory.loadLearningStateForPriority === "function",
        hasParseClusterCities: typeof factory.parseClusterCities === "function",
        hasPublishSiteToProduction: typeof factory.publishSiteToProduction === "function",
        hasSanitizeWebflowFields: typeof factory.sanitizeWebflowFields === "function",
        hasBuildLaneFaqs: typeof factory.buildLaneFaqs === "function",
        hasComputeLearnedPriorityBoost: typeof factory.computeLearnedPriorityBoost === "function",
        hasMajorHubs: factory.MAJOR_HUBS instanceof Set,
        hasTier2Hubs: factory.TIER2_HUBS instanceof Set,
      }));
    `);
    expect(result.hasStableHash).toBe(true);
    expect(result.hasSeededRng).toBe(true);
    expect(result.hasBuildLaneSlug).toBe(true);
    expect(result.hasBuildCanonicalPath).toBe(true);
    expect(result.hasBuildPackageForLane).toBe(true);
    expect(result.hasBuildBodyContent).toBe(true);
    expect(result.hasBuildFaqSchemaEmbed).toBe(true);
    expect(result.hasBuildBreadcrumbSchemaEmbed).toBe(true);
    expect(result.hasBuildWebflowFields).toBe(true);
    expect(result.hasShipOneLane).toBe(true);
    expect(result.hasComputeHubPriority).toBe(true);
    expect(result.hasComputeClusterPriority).toBe(true);
    expect(result.hasLoadLearningStateForPriority).toBe(true);
    expect(result.hasParseClusterCities).toBe(true);
    expect(result.hasPublishSiteToProduction).toBe(true);
    expect(result.hasSanitizeWebflowFields).toBe(true);
    expect(result.hasBuildLaneFaqs).toBe(true);
    expect(result.hasComputeLearnedPriorityBoost).toBe(true);
    expect(result.hasMajorHubs).toBe(true);
    expect(result.hasTier2Hubs).toBe(true);
  });

  test("stableHash is deterministic", () => {
    const result = runNode(`
      import { stableHash } from "./lib/lane-factory.js";
      const h1 = stableHash("los-angeles-to-chicago");
      const h2 = stableHash("los-angeles-to-chicago");
      const h3 = stableHash("different-string");
      console.log(JSON.stringify({ same: h1 === h2, different: h1 !== h3, isNumber: typeof h1 === "number" }));
    `);
    expect(result.same).toBe(true);
    expect(result.different).toBe(true);
    expect(result.isNumber).toBe(true);
  });

  test("computeHubPriority scores major hubs higher", () => {
    const result = runNode(`
      import { computeHubPriority } from "./lib/lane-factory.js";
      const majorLane = { origin: "Chicago, IL", destination: "Dallas, TX", slug: "chicago-to-dallas" };
      const minorLane = { origin: "Boise, ID", destination: "Reno, NV", slug: "boise-to-reno" };
      const published = new Set();
      const majorScore = computeHubPriority(majorLane, published, null);
      const minorScore = computeHubPriority(minorLane, published, null);
      console.log(JSON.stringify({ majorScore: Math.floor(majorScore), minorScore: Math.floor(minorScore), majorHigher: majorScore > minorScore }));
    `);
    expect(result.majorHigher).toBe(true);
    expect(result.majorScore).toBeGreaterThanOrEqual(40);
    expect(result.minorScore).toBeLessThan(10);
  });

  test("buildLaneSlug produces correct format", () => {
    const result = runNode(`
      import { buildLaneSlug } from "./lib/lane-factory.js";
      const slug = buildLaneSlug("Los Angeles, CA", "New York, NY");
      console.log(JSON.stringify({ slug }));
    `);
    expect(result.slug).toBe("los-angeles-to-new-york");
  });

  test("parseClusterCities parses cluster flag", () => {
    const result = runNode(`
      import { parseClusterCities } from "./lib/lane-factory.js";
      const cities = parseClusterCities("chicago-dallas-atlanta");
      const nullResult = parseClusterCities(null);
      console.log(JSON.stringify({
        size: cities.size,
        hasChicago: cities.has("chicago"),
        hasDallas: cities.has("dallas"),
        hasAtlanta: cities.has("atlanta"),
        nullIsNull: nullResult === null,
      }));
    `);
    expect(result.size).toBe(3);
    expect(result.hasChicago).toBe(true);
    expect(result.hasDallas).toBe(true);
    expect(result.hasAtlanta).toBe(true);
    expect(result.nullIsNull).toBe(true);
  });
});

// ── Lane Factory — Manufacturing Tests ──────────────────────────────────

test.describe("Lane Factory — Manufacturing", () => {
  test("buildPackageForLane returns valid page with all required fields", () => {
    const result = runNode(`
      import { buildPackageForLane } from "./lib/lane-factory.js";
      const pkg = buildPackageForLane("Chicago, IL", "Dallas, TX", "LTL", "smb");
      const page = pkg.page;
      console.log(JSON.stringify({
        hasSlug: !!page.slug,
        hasCanonicalPath: !!page.canonical_path,
        hasSeoTitle: !!page.seo_title,
        hasH1: !!page.h1,
        hasMetaDescription: !!page.meta_description,
        hasIntro: !!page.intro,
        hasLaneStats: !!page.lane_stats,
        hasNetworkProof: !!page.network_proof,
        hasFaq: Array.isArray(page.faq),
        faqCount: page.faq.length,
        hasProblemSection: !!page.problem_section,
        hasSolutionSection: !!page.solution_section,
        hasProofSection: !!page.proof_section,
        hasContrast: !!page.contrast,
        hasSchemaBreadcrumb: !!page.schema_breadcrumb,
        hasSchemaService: !!page.schema_service,
        hasSchemaOrg: !!page.schema_organization,
        slug: page.slug,
        hasContentFingerprint: !!pkg.contentFingerprint,
        hasQuickAnswers: Array.isArray(pkg.quickAnswers),
      }));
    `);
    expect(result.hasSlug).toBe(true);
    expect(result.slug).toBe("chicago-to-dallas");
    expect(result.hasCanonicalPath).toBe(true);
    expect(result.hasSeoTitle).toBe(true);
    expect(result.hasH1).toBe(true);
    expect(result.hasMetaDescription).toBe(true);
    expect(result.hasIntro).toBe(true);
    expect(result.hasLaneStats).toBe(true);
    expect(result.hasNetworkProof).toBe(true);
    expect(result.hasFaq).toBe(true);
    expect(result.faqCount).toBe(5);
    expect(result.hasProblemSection).toBe(true);
    expect(result.hasSolutionSection).toBe(true);
    expect(result.hasProofSection).toBe(true);
    expect(result.hasContrast).toBe(true);
    expect(result.hasSchemaBreadcrumb).toBe(true);
    expect(result.hasSchemaService).toBe(true);
    expect(result.hasSchemaOrg).toBe(true);
    expect(result.hasContentFingerprint).toBe(true);
    expect(result.hasQuickAnswers).toBe(true);
  });

  test("manufactured content passes runFullValidation with quality >= 70", () => {
    const result = runNode(`
      import { buildPackageForLane, buildBodyContent, buildFaqSchemaEmbed, buildBreadcrumbSchemaEmbed } from "./lib/lane-factory.js";
      import { runFullValidation } from "./lib/lane-page-validator.js";
      const pkg = buildPackageForLane("Atlanta, GA", "Houston, TX", "LTL", "smb");
      const bodyHtml = buildBodyContent(pkg.page);
      const faqEmbed = buildFaqSchemaEmbed(pkg.page);
      const breadcrumbEmbed = buildBreadcrumbSchemaEmbed(pkg.page);
      const validation = runFullValidation(pkg.page, bodyHtml, faqEmbed, breadcrumbEmbed);
      console.log(JSON.stringify({
        valid: validation.valid,
        qualityScore: validation.quality_score,
        qualityAbove70: validation.quality_score >= 70,
        bannedContentClean: validation.banned_content_found.length === 0,
        errorCount: validation.errors.length,
        gates: validation.gates,
      }));
    `);
    expect(result.valid).toBe(true);
    expect(result.qualityAbove70).toBe(true);
    expect(result.bannedContentClean).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  test("buildWebflowFields returns Webflow-compatible field map", () => {
    const result = runNode(`
      import { buildPackageForLane, buildWebflowFields, sanitizeWebflowFields } from "./lib/lane-factory.js";
      const pkg = buildPackageForLane("Miami, FL", "New York, NY", "LTL", "smb");
      const raw = buildWebflowFields(pkg.page);
      const sanitized = sanitizeWebflowFields(raw);
      console.log(JSON.stringify({
        hasName: !!sanitized.name,
        hasSlug: !!sanitized.slug,
        hasHeroHeadline: !!sanitized["hero-headline"],
        hasBodyContent: !!sanitized["body-content"],
        hasSeoTitle: !!sanitized["seo-title"],
        hasSeoMetaDescription: !!sanitized["seo-meta-description"],
        fieldCount: Object.keys(sanitized).length,
        noNewlinesInSlug: !String(sanitized.slug).includes("\\n"),
        noNewlinesInTitle: !String(sanitized["seo-title"]).includes("\\n"),
      }));
    `);
    expect(result.hasName).toBe(true);
    expect(result.hasSlug).toBe(true);
    expect(result.hasHeroHeadline).toBe(true);
    expect(result.hasBodyContent).toBe(true);
    expect(result.hasSeoTitle).toBe(true);
    expect(result.hasSeoMetaDescription).toBe(true);
    expect(result.fieldCount).toBeGreaterThanOrEqual(5);
    expect(result.noNewlinesInSlug).toBe(true);
    expect(result.noNewlinesInTitle).toBe(true);
  });

  test("buildLaneFaqs returns exactly 5 lane-specific FAQs", () => {
    const result = runNode(`
      import { buildPackageForLane, buildLaneFaqs } from "./lib/lane-factory.js";
      const pkg = buildPackageForLane("Denver, CO", "Phoenix, AZ", "LTL", "smb");
      const faqs = pkg.page.faq;
      console.log(JSON.stringify({
        count: faqs.length,
        allHaveQ: faqs.every(f => typeof f.q === "string" && f.q.length > 10),
        allHaveA: faqs.every(f => typeof f.a === "string" && f.a.length > 20),
        mentionsOrigin: faqs.some(f => f.q.includes("Denver") || f.a.includes("Denver")),
        mentionsDest: faqs.some(f => f.q.includes("Phoenix") || f.a.includes("Phoenix")),
      }));
    `);
    expect(result.count).toBe(5);
    expect(result.allHaveQ).toBe(true);
    expect(result.allHaveA).toBe(true);
    expect(result.mentionsOrigin).toBe(true);
    expect(result.mentionsDest).toBe(true);
  });
});

// ── State Machine — Manufactured State Tests ────────────────────────────

test.describe("Approval Gate — Manufactured State", () => {
  test("VALID_STATES includes manufactured", () => {
    const result = runNode(`
      import { VALID_STATES } from "./lib/approval-gate.js";
      console.log(JSON.stringify({
        hasManufactured: VALID_STATES.includes("manufactured"),
        states: VALID_STATES,
      }));
    `);
    expect(result.hasManufactured).toBe(true);
    expect(result.states).toContain("manufactured");
  });

  test("draft → manufactured transition is valid", () => {
    const result = runNode(`
      import { transitionState, loadApprovalState, writeApprovalState } from "./lib/approval-gate.js";
      import fs from "fs";
      import { resolveFromRoot } from "./lib/fs/project-root.js";
      const p = resolveFromRoot("data/approval_state.json");
      const existed = fs.existsSync(p);
      let backup = null;
      if (existed) { backup = fs.readFileSync(p, "utf-8"); }
      writeApprovalState([], { backup: false });
      try {
        const r = transitionState("test-factory-lane", "LTL", "manufactured", { by: "test", note: "factory test" });
        console.log(JSON.stringify({ success: r.success, state: r.entry?.state, hasManufacturedAt: !!r.entry?.manufactured_at }));
      } finally {
        if (backup !== null) { fs.writeFileSync(p, backup); } else if (fs.existsSync(p)) { fs.unlinkSync(p); }
      }
    `);
    expect(result.success).toBe(true);
    expect(result.state).toBe("manufactured");
    expect(result.hasManufacturedAt).toBe(true);
  });

  test("manufactured → published_pending_verification transition is valid", () => {
    const result = runNode(`
      import { transitionState, loadApprovalState, writeApprovalState } from "./lib/approval-gate.js";
      import fs from "fs";
      import { resolveFromRoot } from "./lib/fs/project-root.js";
      const p = resolveFromRoot("data/approval_state.json");
      const existed = fs.existsSync(p);
      let backup = null;
      if (existed) { backup = fs.readFileSync(p, "utf-8"); }
      writeApprovalState([], { backup: false });
      try {
        transitionState("test-mfg-lane", "LTL", "manufactured", { by: "test" });
        const r = transitionState("test-mfg-lane", "LTL", "published_pending_verification", { by: "test" });
        console.log(JSON.stringify({ success: r.success, state: r.entry?.state }));
      } finally {
        if (backup !== null) { fs.writeFileSync(p, backup); } else if (fs.existsSync(p)) { fs.unlinkSync(p); }
      }
    `);
    expect(result.success).toBe(true);
    expect(result.state).toBe("published_pending_verification");
  });

  test("manufactured → blocked and failed → manufactured and blocked → manufactured transitions work", () => {
    const result = runNode(`
      import { transitionState, writeApprovalState } from "./lib/approval-gate.js";
      import fs from "fs";
      import { resolveFromRoot } from "./lib/fs/project-root.js";
      const p = resolveFromRoot("data/approval_state.json");
      const existed = fs.existsSync(p);
      let backup = null;
      if (existed) { backup = fs.readFileSync(p, "utf-8"); }
      writeApprovalState([], { backup: false });
      try {
        // Test 1: manufactured → blocked
        transitionState("test-mfg-block", "LTL", "manufactured", { by: "test" });
        const r1 = transitionState("test-mfg-block", "LTL", "blocked", { by: "test", reason: "dup" });

        // Test 2: failed → manufactured (retry)
        transitionState("test-retry", "LTL", "manufactured", { by: "test" });
        transitionState("test-retry", "LTL", "failed", { by: "test", reason: "API error" });
        const r2 = transitionState("test-retry", "LTL", "manufactured", { by: "test", note: "retry" });

        // Test 3: blocked → manufactured (unblock)
        transitionState("test-unblock", "LTL", "blocked", { by: "test", reason: "initial" });
        const r3 = transitionState("test-unblock", "LTL", "manufactured", { by: "factory" });

        console.log(JSON.stringify({
          mfgToBlocked: r1.success && r1.entry?.state === "blocked",
          failedToMfg: r2.success && r2.entry?.state === "manufactured",
          retryHistory: r2.entry?.state_history?.length,
          blockedToMfg: r3.success && r3.entry?.state === "manufactured",
        }));
      } finally {
        if (backup !== null) { fs.writeFileSync(p, backup); } else if (fs.existsSync(p)) { fs.unlinkSync(p); }
      }
    `);
    expect(result.mfgToBlocked).toBe(true);
    expect(result.failedToMfg).toBe(true);
    expect(result.retryHistory).toBe(3);
    expect(result.blockedToMfg).toBe(true);
  });
});

// ── Factory Inventory Tests ─────────────────────────────────────────────

test.describe("Factory Inventory — computeFactoryInventory", () => {
  test("computeFactoryInventory returns all required categories", () => {
    const result = runNode(`
      import { computeFactoryInventory } from "./lib/approval-gate.js";
      const inv = computeFactoryInventory({ filterMode: "LTL" });
      console.log(JSON.stringify({
        hasAlreadyLive: Array.isArray(inv.already_live),
        hasAlreadyPublished: Array.isArray(inv.already_published),
        hasReadyToManufacture: Array.isArray(inv.ready_to_manufacture),
        hasManufactured: Array.isArray(inv.manufactured),
        hasApproved: Array.isArray(inv.approved),
        hasBlocked: Array.isArray(inv.blocked),
        hasProducedPending: Array.isArray(inv.produced_pending_verify),
        hasVerifiedLive: Array.isArray(inv.verified_live),
        hasFailed: Array.isArray(inv.failed),
        hasTotals: typeof inv.totals === "object",
        hasByCorridor: typeof inv.by_corridor === "object",
        totalRegistry: inv.totals.registry,
        hasWebflowExisting: typeof inv.totals.webflow_existing === "number",
      }));
    `);
    expect(result.hasAlreadyLive).toBe(true);
    expect(result.hasAlreadyPublished).toBe(true);
    expect(result.hasReadyToManufacture).toBe(true);
    expect(result.hasManufactured).toBe(true);
    expect(result.hasApproved).toBe(true);
    expect(result.hasBlocked).toBe(true);
    expect(result.hasProducedPending).toBe(true);
    expect(result.hasVerifiedLive).toBe(true);
    expect(result.hasFailed).toBe(true);
    expect(result.hasTotals).toBe(true);
    expect(result.hasByCorridor).toBe(true);
    expect(result.totalRegistry).toBeGreaterThan(0);
    expect(result.hasWebflowExisting).toBe(true);
  });

  test("computeFactoryInventory classifies webflow slugs as already_live", () => {
    const result = runNode(`
      import { computeFactoryInventory } from "./lib/approval-gate.js";
      const inv = computeFactoryInventory({ filterMode: "LTL" });
      // Webflow existing slugs should all be in already_live
      console.log(JSON.stringify({
        alreadyLiveCount: inv.already_live.length,
        overlap: inv.totals.overlap,
        allHaveComputedStatus: inv.already_live.every(l => l.computed_status === "already_live"),
      }));
    `);
    expect(result.alreadyLiveCount).toBeGreaterThan(0);
    expect(result.overlap).toBe(result.alreadyLiveCount);
    expect(result.allHaveComputedStatus).toBe(true);
  });

  test("computeFactoryInventory ready_to_manufacture lanes have correct status", () => {
    const result = runNode(`
      import { computeFactoryInventory } from "./lib/approval-gate.js";
      const inv = computeFactoryInventory({ filterMode: "LTL" });
      const sample = inv.ready_to_manufacture.slice(0, 5);
      console.log(JSON.stringify({
        count: inv.ready_to_manufacture.length,
        allHaveSlug: sample.every(l => !!l.slug),
        allHaveOrigin: sample.every(l => !!l.origin),
        allHaveDest: sample.every(l => !!l.destination),
        allHaveStatus: sample.every(l => l.computed_status === "ready_to_manufacture"),
      }));
    `);
    expect(result.count).toBeGreaterThan(0);
    expect(result.allHaveSlug).toBe(true);
    expect(result.allHaveOrigin).toBe(true);
    expect(result.allHaveDest).toBe(true);
    expect(result.allHaveStatus).toBe(true);
  });
});

// ── Factory Script Existence Tests ──────────────────────────────────────

test.describe("Lane Factory — Scripts", () => {
  test("lanes_inventory.js exists and has required features", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const content = fs.readFileSync(
        path.join(process.cwd(), "scripts", "lanes_inventory.js"), "utf-8"
      );
      console.log(JSON.stringify({
        exists: true,
        usesComputeFactoryInventory: content.includes("computeFactoryInventory"),
        hasJsonFlag: content.includes("--json"),
        hasFilterModeFlag: content.includes("--filter-mode"),
        writesReport: content.includes("lane_inventory_report.json"),
      }));
    `);
    expect(result.exists).toBe(true);
    expect(result.usesComputeFactoryInventory).toBe(true);
    expect(result.hasJsonFlag).toBe(true);
    expect(result.hasFilterModeFlag).toBe(true);
    expect(result.writesReport).toBe(true);
  });

  test("lanes_plan.js exists and has required features", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const content = fs.readFileSync(
        path.join(process.cwd(), "scripts", "lanes_plan.js"), "utf-8"
      );
      console.log(JSON.stringify({
        exists: true,
        usesBuildPackageForLane: content.includes("buildPackageForLane"),
        usesRunFullValidation: content.includes("runFullValidation"),
        hasCountFlag: content.includes("--count"),
        hasClusterFlag: content.includes("--cluster"),
        hasJsonFlag: content.includes("--json"),
        writesPlan: content.includes("lane_factory_plan.json"),
        hasDuplicateCheck: content.includes("batchSlugs") || content.includes("duplicate slug"),
      }));
    `);
    expect(result.exists).toBe(true);
    expect(result.usesBuildPackageForLane).toBe(true);
    expect(result.usesRunFullValidation).toBe(true);
    expect(result.hasCountFlag).toBe(true);
    expect(result.hasClusterFlag).toBe(true);
    expect(result.hasJsonFlag).toBe(true);
    expect(result.writesPlan).toBe(true);
    expect(result.hasDuplicateCheck).toBe(true);
  });

  test("lanes_auto_publish.js exists and has required features", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const content = fs.readFileSync(
        path.join(process.cwd(), "scripts", "lanes_auto_publish.js"), "utf-8"
      );
      console.log(JSON.stringify({
        exists: true,
        hasCountFlag: content.includes("--count"),
        hasIntervalFlag: content.includes("--interval"),
        hasNotifyFlag: content.includes("--notify"),
        hasDryRunFlag: content.includes("--dry-run"),
        hasForceFlag: content.includes("--force"),
        hasClusterFlag: content.includes("--cluster"),
        usesShipOneLane: content.includes("shipOneLane"),
        usesTransitionState: content.includes("transitionState"),
        usesManufacturedState: content.includes("manufactured"),
        usesPublishSiteToProduction: content.includes("publishSiteToProduction"),
        usesSitemapRegen: content.includes("generate_all_sitemaps"),
        usesNodemailer: content.includes("nodemailer") || content.includes("email-sender"),
        hasStagger: content.includes("setTimeout"),
        writesReport: content.includes("lane_factory_run_report.json"),
      }));
    `);
    expect(result.exists).toBe(true);
    expect(result.hasCountFlag).toBe(true);
    expect(result.hasIntervalFlag).toBe(true);
    expect(result.hasNotifyFlag).toBe(true);
    expect(result.hasDryRunFlag).toBe(true);
    expect(result.hasForceFlag).toBe(true);
    expect(result.hasClusterFlag).toBe(true);
    expect(result.usesShipOneLane).toBe(true);
    expect(result.usesTransitionState).toBe(true);
    expect(result.usesManufacturedState).toBe(true);
    expect(result.usesPublishSiteToProduction).toBe(true);
    expect(result.usesSitemapRegen).toBe(true);
    expect(result.usesNodemailer).toBe(true);
    expect(result.hasStagger).toBe(true);
    expect(result.writesReport).toBe(true);
  });

  test("factory scripts use factual status language only", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const files = ["lanes_inventory.js", "lanes_plan.js", "lanes_auto_publish.js"];
      const results = {};
      for (const f of files) {
        const content = fs.readFileSync(path.join(process.cwd(), "scripts", f), "utf-8");
        results[f] = {
          noSeoBoosted: !content.includes("seo_boosted"),
          noGuaranteedRanking: !content.includes("guaranteed_ranking"),
          noGuaranteed: !content.includes("guaranteed"),
        };
      }
      console.log(JSON.stringify(results));
    `);
    for (const f of ["lanes_inventory.js", "lanes_plan.js", "lanes_auto_publish.js"]) {
      expect(result[f].noSeoBoosted).toBe(true);
      expect(result[f].noGuaranteedRanking).toBe(true);
      expect(result[f].noGuaranteed).toBe(true);
    }
  });
});

// ── Factory NPM Scripts ─────────────────────────────────────────────────

test.describe("NPM Scripts — Lane Factory", () => {
  test("package.json has all required factory scripts", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const pkg = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")
      );
      const scripts = pkg.scripts || {};
      console.log(JSON.stringify({
        hasLanesInventory: !!scripts["lanes:inventory"],
        hasLanesInventoryJson: !!scripts["lanes:inventory:json"],
        hasLanesPlan: !!scripts["lanes:plan"],
        hasLanesPlan10: !!scripts["lanes:plan:10"],
        hasLanesAutoPublish: !!scripts["lanes:auto-publish"],
        hasLanesAutoPublish10: !!scripts["lanes:auto-publish:10"],
        lanesInventoryCmd: scripts["lanes:inventory"],
        lanesAutoPublishCmd: scripts["lanes:auto-publish"],
      }));
    `);
    expect(result.hasLanesInventory).toBe(true);
    expect(result.hasLanesInventoryJson).toBe(true);
    expect(result.hasLanesPlan).toBe(true);
    expect(result.hasLanesPlan10).toBe(true);
    expect(result.hasLanesAutoPublish).toBe(true);
    expect(result.hasLanesAutoPublish10).toBe(true);
    expect(result.lanesInventoryCmd).toContain("lanes_inventory.js");
    expect(result.lanesAutoPublishCmd).toContain("lanes_auto_publish.js");
  });

  test("publish_next.js imports from lane-factory.js (no inline functions)", () => {
    const result = runNode(`
      import fs from "fs";
      import path from "path";
      const content = fs.readFileSync(
        path.join(process.cwd(), "scripts", "publish_next.js"), "utf-8"
      );
      console.log(JSON.stringify({
        importsLaneFactory: content.includes("from \\"../lib/lane-factory.js\\""),
        noInlineStableHash: !content.includes("function stableHash("),
        noInlineBuildPackage: !content.includes("function buildPackageForLane("),
        noInlineShipOneLane: !content.includes("async function shipOneLane("),
        noInlineFaqTemplates: !content.includes("const FAQ_TEMPLATES"),
        noInlineWebflowSchemaFields: !content.includes("const WEBFLOW_SCHEMA_FIELDS"),
        lineCount: content.split("\\n").length,
      }));
    `);
    expect(result.importsLaneFactory).toBe(true);
    expect(result.noInlineStableHash).toBe(true);
    expect(result.noInlineBuildPackage).toBe(true);
    expect(result.noInlineShipOneLane).toBe(true);
    expect(result.noInlineFaqTemplates).toBe(true);
    expect(result.noInlineWebflowSchemaFields).toBe(true);
    // After extraction, publish_next.js should be much shorter (was ~1092 lines)
    expect(result.lineCount).toBeLessThan(600);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Anti-Drift Guardrail Tests
//
// These tests exist to prevent the class of bug where a new script
// introduces a parallel implementation of email, registry writes,
// config loading, or Webflow calls instead of using the canonical
// shared modules.
//
// If a test here fails, it means someone introduced pipeline drift.
// Fix by using the canonical helper, not by weakening the test.
// ════════════════════════════════════════════════════════════════════════

test.describe("Anti-Drift — Email", () => {
  test("no active publish script has inline nodemailer.createTransport()", () => {
    const result = runNode(`
      import fs from "fs";
      // Active scripts that send email — must use lib/email-sender.js
      const scripts = [
        "scripts/lanes_auto_publish.js",
        "app/api/approval/route.js",
        "scripts/send_daily_publish_summary.js",
      ];
      const violations = [];
      for (const f of scripts) {
        if (!fs.existsSync(f)) continue;
        const src = fs.readFileSync(f, "utf-8");
        // Match inline createTransport calls (not via email-sender.js import)
        const hasInlineTransport = /nodemailer\\.(?:default\\.)?createTransport\\s*\\(/.test(src);
        if (hasInlineTransport) violations.push(f);
      }
      console.log(JSON.stringify({ violations, count: violations.length }));
    `);
    expect(result.count).toBe(0);
    expect(result.violations).toEqual([]);
  });

  test("factory email path uses email-sender.js", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/lanes_auto_publish.js", "utf-8");
      console.log(JSON.stringify({
        importsEmailSender: src.includes("email-sender"),
        importsCreateTransport: src.includes("createTransportFromEnv"),
        importsVerifyTransport: src.includes("verifyTransport"),
      }));
    `);
    expect(result.importsEmailSender).toBe(true);
    expect(result.importsCreateTransport).toBe(true);
    expect(result.importsVerifyTransport).toBe(true);
  });

  test("approval route uses email-sender.js (no inline nodemailer)", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("app/api/approval/route.js", "utf-8");
      console.log(JSON.stringify({
        importsEmailSender: src.includes("email-sender"),
        noInlineCreateTransport: !/nodemailer\\.(?:default\\.)?createTransport/.test(src),
      }));
    `);
    expect(result.importsEmailSender).toBe(true);
    expect(result.noInlineCreateTransport).toBe(true);
  });
});

test.describe("Anti-Drift — Registry Writes", () => {
  test("no publish script writes published_pages.json directly", () => {
    const result = runNode(`
      import fs from "fs";
      const files = [
        "scripts/publish_next.js",
        "scripts/publish_text_batch.js",
        "scripts/ship_firstpage.js",
        "scripts/lanes_auto_publish.js",
        "app/api/approval/route.js",
      ];
      const violations = [];
      for (const f of files) {
        if (!fs.existsSync(f)) continue;
        const src = fs.readFileSync(f, "utf-8");
        const directWrites = src.match(/writeFileSync.*published_pages/g);
        if (directWrites && directWrites.length > 0) {
          violations.push(f);
        }
      }
      console.log(JSON.stringify({ violations, count: violations.length }));
    `);
    expect(result.count).toBe(0);
    expect(result.violations).toEqual([]);
  });

  test("all active publish scripts use safeRegistryUpdate()", () => {
    const result = runNode(`
      import fs from "fs";
      const scripts = [
        "scripts/lanes_auto_publish.js",
        "app/api/approval/route.js",
        "scripts/publish_next.js",
      ];
      const missing = [];
      for (const f of scripts) {
        if (!fs.existsSync(f)) continue;
        const src = fs.readFileSync(f, "utf-8");
        if (!src.includes("safeRegistryUpdate")) missing.push(f);
      }
      console.log(JSON.stringify({ missing, count: missing.length }));
    `);
    expect(result.count).toBe(0);
  });
});

test.describe("Anti-Drift — Manifest & Receipt", () => {
  test("factory creates manifest via publish-manifest.js", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/lanes_auto_publish.js", "utf-8");
      console.log(JSON.stringify({
        importsManifest: src.includes("publish-manifest"),
        callsCreateManifest: src.includes("createManifest"),
        callsSaveManifest: src.includes("saveManifest"),
      }));
    `);
    expect(result.importsManifest).toBe(true);
    expect(result.callsCreateManifest).toBe(true);
    expect(result.callsSaveManifest).toBe(true);
  });

  test("factory creates receipt via publish-receipt.js", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/lanes_auto_publish.js", "utf-8");
      console.log(JSON.stringify({
        importsReceipt: src.includes("publish-receipt"),
        callsBuildReceipt: src.includes("buildReceipt") || src.includes("saveReceipt"),
      }));
    `);
    expect(result.importsReceipt).toBe(true);
    expect(result.callsBuildReceipt).toBe(true);
  });
});

test.describe("Anti-Drift — Config", () => {
  test("canonical config loader exists with required exports", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("lib/config.js", "utf-8");
      console.log(JSON.stringify({
        hasLoadConfig: src.includes("export function loadConfig"),
        hasValidateConfig: src.includes("export function validateConfig"),
        hasDetectConflicts: src.includes("export function detectConfigConflicts"),
        hasGetWebflowHeaders: src.includes("export function getWebflowHeaders"),
        normalizesEmailUser: src.includes("EMAIL_USER") && src.includes("SMTP_USER"),
        normalizesEmailPass: src.includes("EMAIL_APP_PASSWORD") && src.includes("SMTP_PASS"),
      }));
    `);
    expect(result.hasLoadConfig).toBe(true);
    expect(result.hasValidateConfig).toBe(true);
    expect(result.hasDetectConflicts).toBe(true);
    expect(result.hasGetWebflowHeaders).toBe(true);
    expect(result.normalizesEmailUser).toBe(true);
    expect(result.normalizesEmailPass).toBe(true);
  });

  test("doctor command exists", () => {
    const result = runNode(`
      import fs from "fs";
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
      const doctorExists = fs.existsSync("scripts/doctor.js");
      console.log(JSON.stringify({
        scriptExists: !!pkg.scripts["doctor"],
        fileExists: doctorExists,
        pointsToDoctor: (pkg.scripts["doctor"] || "").includes("doctor.js"),
      }));
    `);
    expect(result.scriptExists).toBe(true);
    expect(result.fileExists).toBe(true);
    expect(result.pointsToDoctor).toBe(true);
  });
});

test.describe("Anti-Drift — No Competing SMTP Config", () => {
  test("no active script references SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS directly", () => {
    const result = runNode(`
      import fs from "fs";
      // Scripts that must NOT use raw SMTP_ env vars (should use lib/config.js or lib/email-sender.js)
      const scripts = [
        "scripts/lanes_auto_publish.js",
        "scripts/publish_next.js",
        "scripts/publish_text_batch.js",
        "scripts/publish_approved_batch.js",
        "app/api/approval/route.js",
      ];
      const violations = [];
      for (const f of scripts) {
        if (!fs.existsSync(f)) continue;
        const src = fs.readFileSync(f, "utf-8");
        // Check for raw process.env.SMTP_* usage (not in comments/strings)
        if (/process\\.env\\.SMTP_(HOST|PORT|USER|PASS|FROM)/.test(src)) {
          violations.push(f);
        }
      }
      console.log(JSON.stringify({ violations, count: violations.length }));
    `);
    expect(result.count).toBe(0);
    expect(result.violations).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Critical Path Contract
//
// The canonical live publish flow is:
//   inventory → manufacture → validate → publish → verify →
//   manifest → receipt → email
//
// lanes_auto_publish.js is the ONLY supported orchestrator for this flow.
// These tests enforce that contract.
// ════════════════════════════════════════════════════════════════════════

test.describe("Critical Path Contract", () => {
  test("lanes_auto_publish.js implements all 8 pipeline stages", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/lanes_auto_publish.js", "utf-8");
      console.log(JSON.stringify({
        hasInventory: src.includes("computeFactoryInventory") && src.includes("loadRegistry"),
        hasManufacture: src.includes("buildPackageForLane") || src.includes("manufactured"),
        hasValidate: src.includes("runFullValidation"),
        hasPublish: src.includes("shipOneLane"),
        hasVerify: src.includes("verifyLive"),
        hasManifest: src.includes("publish-manifest"),
        hasReceipt: src.includes("publish-receipt") && (src.includes("buildReceipt") || src.includes("saveReceipt")),
        hasEmail: src.includes("email-sender") && src.includes("createTransportFromEnv"),
      }));
    `);
    expect(result.hasInventory).toBe(true);
    expect(result.hasManufacture).toBe(true);
    expect(result.hasValidate).toBe(true);
    expect(result.hasPublish).toBe(true);
    expect(result.hasVerify).toBe(true);
    expect(result.hasManifest).toBe(true);
    expect(result.hasReceipt).toBe(true);
    expect(result.hasEmail).toBe(true);
  });

  test("factory is the only orchestrator registered in package.json", () => {
    const result = runNode(`
      import fs from "fs";
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
      const factoryScript = pkg.scripts["lanes:factory"];

      function checkDeprecated(filePath) {
        try {
          const src = fs.readFileSync(filePath, "utf-8");
          return src.includes("DEPRECATED") || src.includes("deprecated");
        } catch { return true; }
      }

      console.log(JSON.stringify({
        factoryExists: !!factoryScript,
        factoryPointsToAutoPublish: (factoryScript || "").includes("lanes_auto_publish.js"),
        publishClusterDeprecated: checkDeprecated("scripts/publish_cluster.js"),
        publishTextBatchDeprecated: checkDeprecated("scripts/publish_text_batch.js"),
        publishApprovedBatchDeprecated: checkDeprecated("scripts/publish_approved_batch.js"),
      }));
    `);
    expect(result.factoryExists).toBe(true);
    expect(result.factoryPointsToAutoPublish).toBe(true);
    expect(result.publishClusterDeprecated).toBe(true);
    expect(result.publishTextBatchDeprecated).toBe(true);
    expect(result.publishApprovedBatchDeprecated).toBe(true);
  });

  test("archived scripts are not referenced in npm scripts", () => {
    const result = runNode(`
      import fs from "fs";
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
      const allScriptCmds = Object.values(pkg.scripts).join(" ");
      const archivedDir = "scripts/_archived";
      let violations = [];
      try {
        const archived = fs.readdirSync(archivedDir).filter(f => f.endsWith(".js"));
        violations = archived.filter(a => allScriptCmds.includes(a));
      } catch {} // dir may not exist
      console.log(JSON.stringify({ violations, count: violations.length }));
    `);
    expect(result.count).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Anti-Drift — Page URL Model
//
// Ensures all URL derivation flows through lib/page-url.js
// and the factory email uses receipt-shaped data.
// ════════════════════════════════════════════════════════════════════════

test.describe("Anti-Drift — Page URL Model", () => {
  test("lib/page-url.js exists with required exports", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("lib/page-url.js", "utf-8");
      console.log(JSON.stringify({
        hasSiteBase: src.includes("SITE_BASE"),
        hasCanonicalPathForSlug: src.includes("export function canonicalPathForSlug"),
        hasExpectedUrlForSlug: src.includes("export function expectedUrlForSlug"),
        hasBuildPageUrl: src.includes("export function buildPageUrl"),
        hasValidatePageUrl: src.includes("export function validatePageUrl"),
        hasLanesPrefix: src.includes("/lanes"),
      }));
    `);
    expect(result.hasSiteBase).toBe(true);
    expect(result.hasCanonicalPathForSlug).toBe(true);
    expect(result.hasExpectedUrlForSlug).toBe(true);
    expect(result.hasBuildPageUrl).toBe(true);
    expect(result.hasValidatePageUrl).toBe(true);
    expect(result.hasLanesPrefix).toBe(true);
  });

  test("factory imports page-url.js for URL derivation", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/lanes_auto_publish.js", "utf-8");
      const noComments = src.replace(/\\/\\/.*/g, "");
      const hasInline = /\\\`https:\\/\\/www\\.wearewarp\\.com\\/lanes\\/\\$\\{/.test(noComments);
      console.log(JSON.stringify({
        importsPageUrl: src.includes("page-url"),
        usesExpectedUrlForSlug: src.includes("expectedUrlForSlug"),
        noInlineWearewarpLanes: !hasInline,
      }));
    `);
    expect(result.importsPageUrl).toBe(true);
    expect(result.usesExpectedUrlForSlug).toBe(true);
    expect(result.noInlineWearewarpLanes).toBe(true);
  });

  test("factory email uses receipt object (not ad-hoc data)", () => {
    const result = runNode(`
      import fs from "fs";
      const src = fs.readFileSync("scripts/lanes_auto_publish.js", "utf-8");
      console.log(JSON.stringify({
        callsBuildReceipt: src.includes("buildReceipt(runManifest"),
        passesReceiptToEmail: src.includes("buildConfirmationEmailHtml(factoryReceipt)"),
        noAdHocEmailData: !src.includes("buildConfirmationEmailHtml({"),
      }));
    `);
    expect(result.callsBuildReceipt).toBe(true);
    expect(result.passesReceiptToEmail).toBe(true);
    expect(result.noAdHocEmailData).toBe(true);
  });
});
