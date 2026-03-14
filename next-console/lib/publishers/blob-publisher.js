/**
 * blob-publisher.js — Vercel Blob Publisher for Lane Artifacts
 *
 * Publishes lane artifacts to Vercel Blob storage so the main WARP site
 * (on the Mac laptop) can consume them at build time.
 *
 * Two paths are written per publish:
 *   1. lane-artifacts/versions/<timestamp>.json — immutable versioned artifact
 *   2. lane-artifacts/current.json — stable pointer (overwritten each publish)
 *
 * Requires BLOB_READ_WRITE_TOKEN in environment (from .env.local or Vercel project).
 *
 * @module blob-publisher
 */

import { put, list, head } from "@vercel/blob";
import { validateLaneArtifact } from "./lane-artifact-contract.js";

const BLOB_PREFIX = "lane-artifacts";

/**
 * Publish a lane artifact to Vercel Blob.
 *
 * Writes both a versioned immutable copy and a stable current.json pointer.
 * Validates the artifact before publishing. Fails loudly on any error.
 *
 * @param {object} artifact — validated lane artifact from buildLaneArtifact()
 * @returns {Promise<{ versionedUrl: string, currentUrl: string, versionPath: string }>}
 * @throws {Error} on validation failure or upload failure
 */
export async function publishArtifact(artifact) {
  // ── Validate before publishing ─────────────────────────────────────
  const validation = validateLaneArtifact(artifact);
  if (!validation.valid) {
    throw new Error(`Artifact validation failed:\n  ${validation.errors.join("\n  ")}`);
  }

  const body = JSON.stringify(artifact, null, 2);
  const timestamp = artifact.generatedAt.replace(/[:.]/g, "-");
  const versionPath = `${BLOB_PREFIX}/versions/${timestamp}.json`;
  const currentPath = `${BLOB_PREFIX}/current.json`;

  // ── Upload versioned immutable artifact ────────────────────────────
  const versionedResult = await put(versionPath, body, {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  // ── Upload/overwrite current.json stable pointer ───────────────────
  const currentResult = await put(currentPath, body, {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return {
    versionedUrl: versionedResult.url,
    currentUrl: currentResult.url,
    versionPath,
  };
}

/**
 * Verify a published artifact by fetching and validating it.
 *
 * For private stores, uses head() to confirm existence then fetches
 * with the BLOB_READ_WRITE_TOKEN for content verification.
 *
 * @param {string} url — Blob URL to verify
 * @returns {Promise<{ valid: boolean, artifact: object|null, errors: string[] }>}
 */
export async function verifyPublishedArtifact(url) {
  try {
    // Use head() from SDK — it authenticates via BLOB_READ_WRITE_TOKEN env var
    const metadata = await head(url);
    if (!metadata) {
      return { valid: false, artifact: null, errors: ["Blob not found (head returned null)"] };
    }

    // Fetch content with auth token for private store
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      return { valid: false, artifact: null, errors: [`HTTP ${response.status}: ${response.statusText}`] };
    }
    const artifact = await response.json();
    const validation = validateLaneArtifact(artifact);
    return { valid: validation.valid, artifact, errors: validation.errors };
  } catch (err) {
    return { valid: false, artifact: null, errors: [err.message] };
  }
}

/**
 * List all versioned artifacts in Blob storage.
 *
 * @returns {Promise<Array<{ url: string, pathname: string, uploadedAt: Date }>>}
 */
export async function listVersions() {
  const result = await list({ prefix: `${BLOB_PREFIX}/versions/` });
  return result.blobs.map((b) => ({
    url: b.url,
    pathname: b.pathname,
    uploadedAt: b.uploadedAt,
  }));
}

/**
 * Get metadata for a specific Blob path.
 *
 * @param {string} url — Blob URL
 * @returns {Promise<object>}
 */
export async function getArtifactHead(url) {
  return head(url);
}
