#!/usr/bin/env node

/**
 * Check if the first lane (Chicago → Dallas LTL) already exists in published_pages.json.
 * Exits nonzero if duplicates are found.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectRoot } from "../lib/fs/project-root.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = getProjectRoot();

const publishedPath = path.join(ROOT, "data", "published_pages.json");

function loadPublished() {
  try {
    const raw = fs.readFileSync(publishedPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function findDuplicates(candidate, published) {
  const dupes = [];
  const slug = candidate.slug || "";
  const canonical = candidate.canonical_path || "";
  const title = (candidate.seo_title || "").toLowerCase().trim();
  const h1 = (candidate.h1 || "").toLowerCase().trim();
  const intro = (candidate.intro || "").slice(0, 200).toLowerCase().trim();

  for (const existing of published) {
    if (existing.slug && existing.slug === slug) {
      dupes.push({ reason: "slug match", existing_canonical: existing.canonical_path });
    }
    if (existing.canonical_path && existing.canonical_path === canonical) {
      dupes.push({ reason: "canonical match", existing_canonical: existing.canonical_path });
    }
    if (title && existing.seo_title && existing.seo_title.toLowerCase().trim() === title) {
      dupes.push({ reason: "seo_title match", existing_canonical: existing.canonical_path });
    }
    if (h1 && existing.h1 && existing.h1.toLowerCase().trim() === h1) {
      dupes.push({ reason: "h1 match", existing_canonical: existing.canonical_path });
    }
    if (intro && existing.intro && existing.intro.slice(0, 200).toLowerCase().trim() === intro) {
      dupes.push({ reason: "intro prefix match", existing_canonical: existing.canonical_path });
    }
  }
  return dupes;
}

const candidate = {
  slug: "chicago-to-dallas",
  canonical_path: "/chicago-to-dallas",
  seo_title: "Chicago, IL to Dallas, TX LTL Freight Quotes | WARP",
  h1: "Chicago, IL to Dallas, TX LTL freight quotes",
  intro: "Small and mid-size shipping teams moving LTL freight from Chicago, IL to Dallas, TX can use this lane-specific workflow to compare options, reduce manual quote cycles, and book faster with stronger service visibility."
};

const published = loadPublished();
const dupes = findDuplicates(candidate, published);

if (dupes.length > 0) {
  console.error("DUPLICATE DETECTED — cannot publish.");
  dupes.forEach((d) => {
    console.error(`  Reason: ${d.reason} → ${d.existing_canonical}`);
  });
  process.exit(1);
} else {
  console.log("No duplicates found. Safe to publish.");
  console.log(`  Checked against ${published.length} published pages.`);
  process.exit(0);
}
