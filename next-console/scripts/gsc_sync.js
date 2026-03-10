#!/usr/bin/env node
/**
 * GSC Sync Script
 *
 * Usage:
 *   node scripts/gsc_sync.js                          # Sync yesterday
 *   node scripts/gsc_sync.js --backfill 7             # Backfill last 7 days
 *   node scripts/gsc_sync.js --backfill 30            # Backfill last 30 days
 *   node scripts/gsc_sync.js --start 2026-01-01 --end 2026-03-01  # Custom range
 *   node scripts/gsc_sync.js --refresh                # Rolling 3-day refresh
 *   node scripts/gsc_sync.js --skip-page-query        # Skip page-query (fastest)
 *   node scripts/gsc_sync.js --dry-run                # Show what would run
 *   node scripts/gsc_sync.js --list-sites             # List available GSC properties
 *
 * Requires env vars:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GSC_SITE_URL
 */

import "dotenv/config";
import {
  ingestYesterday,
  ingestAll,
  backfill,
  daysAgo,
  yesterday,
} from "../lib/gsc/ingest.js";
import { listSites, getSiteUrl } from "../lib/gsc/client.js";
import { getTableStats } from "../lib/gsc/store.js";
import { loadGscConfig } from "../lib/gsc/config.js";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isRefresh = args.includes("--refresh");
const isListSites = args.includes("--list-sites");
const skipPageQuery = args.includes("--skip-page-query");

function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const backfillDays = getArg("--backfill");
const startDate = getArg("--start");
const endDate = getArg("--end");

async function main() {
  console.log("[gsc-sync] Starting...\n");

  // List sites mode
  if (isListSites) {
    console.log("[gsc-sync] Listing available Search Console properties...\n");
    const result = await listSites();
    const entries = result.siteEntry || [];
    if (entries.length === 0) {
      console.log("  No properties found. Check OAuth credentials.\n");
    } else {
      for (const entry of entries) {
        console.log(`  ${entry.siteUrl} (${entry.permissionLevel})`);
      }
      console.log(`\n  Total: ${entries.length} properties`);
    }
    return;
  }

  const siteUrl = getSiteUrl();
  const config = loadGscConfig();
  console.log(`  Site: ${siteUrl}`);

  // Show current stats
  const statsBefore = getTableStats();
  console.log(`  Current rows: site=${statsBefore.site}, page=${statsBefore.page}, query=${statsBefore.query}, page_query=${statsBefore.page_query}\n`);

  // Determine mode
  let mode = "yesterday";
  let syncStart, syncEnd;

  if (startDate && endDate) {
    mode = "custom";
    syncStart = startDate;
    syncEnd = endDate;
  } else if (backfillDays) {
    mode = "backfill";
    syncStart = daysAgo(parseInt(backfillDays, 10));
    syncEnd = yesterday();
  } else if (isRefresh) {
    mode = "refresh";
    syncStart = daysAgo(config.ingestion.daily_refresh_days);
    syncEnd = yesterday();
  } else {
    mode = "yesterday";
    syncStart = yesterday();
    syncEnd = yesterday();
  }

  console.log(`  Mode: ${mode}`);
  console.log(`  Range: ${syncStart} → ${syncEnd}`);
  console.log(`  Skip page-query: ${skipPageQuery}`);
  console.log(`  Dry run: ${isDryRun}\n`);

  if (isDryRun) {
    console.log("[gsc-sync] Dry run — no data will be fetched or stored.");
    return;
  }

  // Run ingestion
  const startTime = Date.now();

  if (mode === "yesterday") {
    await ingestYesterday({ skipPageQuery });
  } else if (mode === "backfill") {
    await backfill(parseInt(backfillDays, 10), { skipPageQuery });
  } else {
    await ingestAll({ startDate: syncStart, endDate: syncEnd, skipPageQuery });
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Show after stats
  const statsAfter = getTableStats();
  console.log(`\n[gsc-sync] Complete in ${elapsed}s`);
  console.log(`  Rows after: site=${statsAfter.site}, page=${statsAfter.page}, query=${statsAfter.query}, page_query=${statsAfter.page_query}`);
  console.log(`  Delta: site=+${statsAfter.site - statsBefore.site}, page=+${statsAfter.page - statsBefore.page}, query=+${statsAfter.query - statsBefore.query}, page_query=+${statsAfter.page_query - statsBefore.page_query}`);
}

main().catch(err => {
  console.error("[gsc-sync] Fatal error:", err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
