import fs from "fs";
import path from "path";
import { resolveFromRoot } from "./fs/project-root.js";

/**
 * Create a draft item in Webflow CMS or write artifacts in dry run mode.
 *
 * @param {object} opts
 * @param {string} opts.siteId
 * @param {string} opts.collectionId
 * @param {object} opts.fields - CMS fields to set
 * @param {boolean} opts.dryRun - if true, write to artifacts instead of calling API
 * @param {string} [opts.artifactsDir] - where to write dry run output
 */
export async function createDraftItem({ siteId, collectionId, fields, dryRun = true, artifactsDir }) {
  const dir = artifactsDir || resolveFromRoot("artifacts", "smoke");
  fs.mkdirSync(dir, { recursive: true });

  const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items`;

  if (dryRun) {
    const payload = {
      endpoint,
      method: "POST",
      site_id: siteId || "(dry run — no site ID)",
      collection_id: collectionId || "(dry run — no collection ID)",
      fields,
      is_draft: true,
      dry_run: true,
      generated_at: new Date().toISOString()
    };

    const outputPath = path.join(dir, "webflow_payload.json");
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    return { success: true, dryRun: true, outputPath };
  }

  // Real Webflow API call
  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) {
    throw new Error("Missing WEBFLOW_API_TOKEN environment variable.");
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      isArchived: false,
      isDraft: true,
      fieldData: fields
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webflow API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return { success: true, dryRun: false, itemId: data.id };
}

/**
 * Update an existing draft item in Webflow CMS.
 *
 * @param {object} opts
 * @param {string} opts.collectionId
 * @param {string} opts.itemId - Webflow CMS item ID to update
 * @param {object} opts.fields - CMS fields to update
 * @param {boolean} opts.dryRun
 * @param {string} [opts.artifactsDir]
 */
export async function updateDraftItem({ collectionId, itemId, fields, dryRun = true, artifactsDir }) {
  const dir = artifactsDir || resolveFromRoot("artifacts", "smoke");
  fs.mkdirSync(dir, { recursive: true });

  const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`;

  if (dryRun) {
    const payload = {
      endpoint,
      method: "PATCH",
      item_id: itemId,
      collection_id: collectionId || "(dry run)",
      fields,
      dry_run: true,
      generated_at: new Date().toISOString()
    };
    const outputPath = path.join(dir, "webflow_update_payload.json");
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    return { success: true, dryRun: true, outputPath };
  }

  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) {
    throw new Error("Missing WEBFLOW_API_TOKEN environment variable.");
  }

  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ isArchived: false, isDraft: true, fieldData: fields })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webflow API error ${res.status}: ${text}`);
  }

  return { success: true, dryRun: false, itemId };
}

/**
 * Publish a single CMS item (item-level publish, not site publish).
 *
 * @param {object} opts
 * @param {string} opts.collectionId
 * @param {string} opts.itemId
 * @param {boolean} opts.dryRun
 * @param {string} [opts.artifactsDir]
 */
export async function publishItem({ collectionId, itemId, dryRun = true, artifactsDir }) {
  const dir = artifactsDir || resolveFromRoot("artifacts", "smoke");
  fs.mkdirSync(dir, { recursive: true });

  const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/publish`;

  if (dryRun) {
    const payload = {
      endpoint,
      method: "POST",
      item_id: itemId,
      collection_id: collectionId || "(dry run)",
      dry_run: true,
      generated_at: new Date().toISOString()
    };
    const outputPath = path.join(dir, "webflow_publish_payload.json");
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    return { success: true, dryRun: true, outputPath };
  }

  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) {
    throw new Error("Missing WEBFLOW_API_TOKEN environment variable.");
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ itemIds: [itemId] })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webflow API error ${res.status}: ${text}`);
  }

  return { success: true, dryRun: false, itemId };
}

/**
 * Fetch a single CMS item by ID. Returns full item including isDraft, fieldData, etc.
 *
 * @param {object} opts
 * @param {string} opts.collectionId
 * @param {string} opts.itemId
 * @returns {Promise<object>} Raw Webflow item object
 */
export async function getItem({ collectionId, itemId }) {
  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) {
    throw new Error("Missing WEBFLOW_API_TOKEN environment variable.");
  }

  const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`;
  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      accept: "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webflow getItem error ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * List items from a Webflow CMS collection.
 *
 * @param {object} opts
 * @param {string} opts.collectionId
 * @param {number} [opts.limit=10]
 * @returns {Promise<object[]>} Array of Webflow item objects
 */
export async function listCollectionItems({ collectionId, limit = 10 }) {
  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) {
    throw new Error("Missing WEBFLOW_API_TOKEN environment variable.");
  }

  const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items?limit=${limit}`;
  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      accept: "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webflow listCollectionItems error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.items || [];
}

/**
 * List all pages for a Webflow site.
 * Used to detect the CMS Collection Template page for a given collection.
 *
 * @param {object} opts
 * @param {string} opts.siteId
 * @returns {Promise<object[]>} Array of page objects with id, title, slug, collectionId, publishedPath, etc.
 */
export async function listSitePages({ siteId }) {
  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) {
    throw new Error("Missing WEBFLOW_API_TOKEN environment variable.");
  }

  const pages = [];
  let offset = 0;
  const limit = 100;

  // Paginate through all pages
  while (true) {
    const endpoint = `https://api.webflow.com/v2/sites/${siteId}/pages?limit=${limit}&offset=${offset}`;
    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
        accept: "application/json"
      }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Webflow listSitePages error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const batch = data.pages || [];
    pages.push(...batch);

    // Check pagination
    const pagination = data.pagination || {};
    if (pages.length >= (pagination.total || 0) || batch.length < limit) {
      break;
    }
    offset += limit;
  }

  return pages;
}

/**
 * Find the CMS Collection Template page for a given collection ID.
 * Returns the page whose collectionId matches, or null if not found.
 *
 * @param {object} opts
 * @param {string} opts.siteId
 * @param {string} opts.collectionId - The collection to find the template for
 * @returns {Promise<{ templatePath: string, pageId: string, title: string } | null>}
 */
export async function findCmsTemplatePage({ siteId, collectionId }) {
  const pages = await listSitePages({ siteId });
  const templatePage = pages.find((p) => p.collectionId === collectionId);

  if (!templatePage) {
    return null;
  }

  // publishedPath is the full path (e.g. "/self-service-lanes")
  // slug is just the page slug (e.g. "self-service-lanes")
  // We need the path prefix that comes before /{itemSlug}
  const templatePath = templatePage.publishedPath || `/${templatePage.slug}`;

  return {
    templatePath: templatePath.replace(/\/+$/, ""), // strip trailing slashes
    pageId: templatePage.id,
    title: templatePage.title || templatePage.slug,
  };
}

/**
 * Publish a single CMS item explicitly. This is the step that transitions
 * an item from "draft" to "staged" / published in Webflow CMS.
 *
 * @param {object} opts
 * @param {string} opts.collectionId
 * @param {string} opts.itemId
 * @returns {Promise<{ success: boolean, itemId: string }>}
 */
export async function publishCollectionItem({ collectionId, itemId }) {
  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) {
    throw new Error("Missing WEBFLOW_API_TOKEN environment variable.");
  }

  const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/publish`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ itemIds: [itemId] })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webflow publishCollectionItem error ${res.status}: ${text}`);
  }

  return { success: true, itemId };
}

/**
 * Publish a CMS item so it becomes visible on staging (item-level publish).
 * This makes the item live in the CMS but does NOT publish the site.
 *
 * @param {object} opts
 * @param {string} opts.collectionId
 * @param {string} opts.itemId
 */
export async function publishItemToStaging({ collectionId, itemId }) {
  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) {
    throw new Error("Missing WEBFLOW_API_TOKEN environment variable.");
  }

  const endpoint = `https://api.webflow.com/v2/collections/${collectionId}/items/publish`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ itemIds: [itemId] })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Webflow item staging publish error ${res.status}: ${text}`);
  }

  return { success: true, itemId };
}

/**
 * Publish the Webflow site to the staging subdomain ONLY.
 * Uses publishToWebflowSubdomain: true and does NOT include custom domains,
 * so wearewarp.com is never touched.
 *
 * @param {object} opts
 * @param {string} opts.siteId
 * @returns {{ success: boolean, stagingDomain: string }}
 */
export async function publishSiteToStaging({ siteId }) {
  const { WEBFLOW_API_TOKEN } = process.env;
  if (!WEBFLOW_API_TOKEN) {
    throw new Error("Missing WEBFLOW_API_TOKEN environment variable.");
  }

  // Publish to Webflow subdomain only — never to custom domains
  const pubEndpoint = `https://api.webflow.com/v2/sites/${siteId}/publish`;
  const pubRes = await fetch(pubEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ publishToWebflowSubdomain: true })
  });

  if (!pubRes.ok) {
    const text = await pubRes.text();
    throw new Error(`Webflow site staging publish error ${pubRes.status}: ${text}`);
  }

  // Fetch site info to get the staging subdomain
  const siteRes = await fetch(`https://api.webflow.com/v2/sites/${siteId}`, {
    headers: {
      Authorization: `Bearer ${WEBFLOW_API_TOKEN}`,
      accept: "application/json"
    }
  });

  if (!siteRes.ok) {
    throw new Error(`Failed to fetch site info: ${siteRes.status}`);
  }

  const siteData = await siteRes.json();
  const shortName = siteData.shortName || siteId;
  const stagingDomain = `${shortName}.webflow.io`;

  return { success: true, stagingDomain };
}
