#!/usr/bin/env node
/**
 * verify_deployment_routes.js — Deployment Route Verification
 *
 * Verifies benchmark lane routes against a deployed URL.
 * Can run against local dev server, Vercel preview, or production.
 *
 * Usage:
 *   node scripts/verify_deployment_routes.js                          # Local (http://localhost:3000)
 *   node scripts/verify_deployment_routes.js --base-url https://your-app.vercel.app
 *   node scripts/verify_deployment_routes.js --base-url https://your-app.vercel.app --json
 *
 * Checks per route:
 *   - HTTP 200 response
 *   - Single H1 tag
 *   - Title contains origin + destination + mode
 *   - Meta description present
 *   - Canonical URL correct
 *   - robots = index, follow
 *   - BreadcrumbList JSON-LD
 *   - FAQPage JSON-LD
 *   - Service JSON-LD
 *   - Organization JSON-LD
 *   - KPI panel present (once)
 *   - Execution flow present (once)
 *   - Comparison section present (once)
 *   - No duplicate structural sections
 *   - No orphaned commas in headline
 *   - Quality badge present
 */

const BENCHMARK_LANES = [
  { slug: "atlanta-to-orlando", origin: "Atlanta", destination: "Orlando", mode: "LTL" },
  { slug: "atlanta-to-miami", origin: "Atlanta", destination: "Miami", mode: "LTL" },
  { slug: "los-angeles-to-new-york", origin: "Los Angeles", destination: "New York", mode: "LTL" },
];

const args = process.argv.slice(2);
const baseUrlArg = args.find((a, i) => args[i - 1] === "--base-url") || "http://localhost:3000";
const jsonOutput = args.includes("--json");

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "WARP-Route-Verifier/1.0" },
    redirect: "follow",
  });
  return { status: res.status, html: await res.text() };
}

function countMatches(html, pattern) {
  return (html.match(pattern) || []).length;
}

function extractJsonLd(html) {
  const scripts = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      scripts.push(JSON.parse(m[1]));
    } catch { /* skip malformed */ }
  }
  return scripts;
}

async function verifyRoute(lane) {
  const url = `${baseUrlArg}/lanes/${lane.slug}`;
  const checks = [];
  let html = "";
  let status = 0;

  try {
    const res = await fetchPage(url);
    status = res.status;
    html = res.html;
  } catch (err) {
    return { lane: lane.slug, url, reachable: false, error: err.message, checks: [] };
  }

  // HTTP Status
  checks.push({ name: "HTTP 200", pass: status === 200, detail: `Status: ${status}` });

  if (status !== 200) {
    return { lane: lane.slug, url, reachable: true, status, checks };
  }

  // Single H1
  const h1Count = countMatches(html, /<h1[\s>]/gi);
  checks.push({ name: "Single H1", pass: h1Count === 1, detail: `Found ${h1Count} H1 tags` });

  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1] : "";
  checks.push({ name: "Title has origin", pass: title.includes(lane.origin), detail: title });
  checks.push({ name: "Title has destination", pass: title.includes(lane.destination.split(" ")[0]), detail: title });
  checks.push({ name: "Title has mode", pass: title.includes(lane.mode), detail: title });
  checks.push({ name: "Title has WARP", pass: title.includes("WARP"), detail: title });

  // Meta description
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) ||
                    html.match(/<meta\s+content="([^"]*)"\s+name="description"/i);
  const desc = descMatch ? descMatch[1] : "";
  checks.push({ name: "Meta description present", pass: desc.length > 50, detail: `${desc.length} chars` });

  // Canonical
  const canonMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i) ||
                     html.match(/<link\s+href="([^"]*)"\s+rel="canonical"/i);
  const canonical = canonMatch ? canonMatch[1] : "";
  checks.push({ name: "Canonical URL", pass: canonical.includes(lane.slug), detail: canonical });

  // Robots
  const robotsMatch = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i) ||
                      html.match(/<meta\s+content="([^"]*)"\s+name="robots"/i);
  const robots = robotsMatch ? robotsMatch[1] : "";
  checks.push({ name: "Robots index,follow", pass: robots.includes("index") && robots.includes("follow"), detail: robots });

  // JSON-LD
  const jsonLd = extractJsonLd(html);
  const types = jsonLd.map(s => s["@type"]);
  checks.push({ name: "BreadcrumbList schema", pass: types.includes("BreadcrumbList"), detail: `Types: ${types.join(", ")}` });
  checks.push({ name: "FAQPage schema", pass: types.includes("FAQPage"), detail: "" });
  checks.push({ name: "Service schema", pass: types.includes("Service"), detail: "" });
  checks.push({ name: "Organization schema", pass: types.includes("Organization"), detail: "" });

  // Structural sections — unique presence via CSS module class markers
  // CSS Modules produce class names like "kpiPanel_xxx" — check for the section wrappers
  const kpiPanelCount = countMatches(html, /class="[^"]*kpiPanel[^"]*"/gi);
  checks.push({ name: "KPI panel present once", pass: kpiPanelCount === 1, detail: `Found ${kpiPanelCount} section wrappers` });

  const execFlowCount = countMatches(html, /class="[^"]*executionFlow[^"]*"/gi);
  checks.push({ name: "Execution flow once", pass: execFlowCount === 1, detail: `Found ${execFlowCount} section wrappers` });

  const comparisonCount = countMatches(html, /class="[^"]*comparisonSection[^"]*"/gi);
  checks.push({ name: "Comparison section once", pass: comparisonCount === 1, detail: `Found ${comparisonCount} section wrappers` });

  // Headline format (no orphaned commas)
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const h1Text = h1Match ? h1Match[1] : "";
  checks.push({ name: "No orphaned commas", pass: !h1Text.includes(", to ") && !h1Text.includes(", LTL"), detail: h1Text });

  // Quality badge
  const qualityBadge = html.includes("data-grade=");
  checks.push({ name: "Quality badge present", pass: qualityBadge, detail: "" });

  const passed = checks.filter(c => c.pass).length;
  const total = checks.length;

  return { lane: lane.slug, url, reachable: true, status, checks, passed, total };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  DEPLOYMENT ROUTE VERIFICATION");
  console.log(`  Base URL: ${baseUrlArg}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const results = [];

  for (const lane of BENCHMARK_LANES) {
    const result = await verifyRoute(lane);
    results.push(result);

    if (!jsonOutput) {
      console.log(`── ${lane.slug} ──`);
      console.log(`  URL:    ${result.url}`);
      console.log(`  Status: ${result.status || "unreachable"}`);

      if (result.error) {
        console.log(`  Error:  ${result.error}`);
      } else {
        for (const check of result.checks) {
          const icon = check.pass ? "✓" : "✗";
          console.log(`  ${icon} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
        }
        console.log(`  Result: ${result.passed}/${result.total} checks passed`);
      }
      console.log("");
    }
  }

  const allPassed = results.every(r => r.passed === r.total);
  const totalChecks = results.reduce((s, r) => s + (r.total || 0), 0);
  const totalPassed = results.reduce((s, r) => s + (r.passed || 0), 0);

  if (jsonOutput) {
    console.log(JSON.stringify({ results, summary: { totalChecks, totalPassed, allPassed } }, null, 2));
  } else {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`  SUMMARY: ${totalPassed}/${totalChecks} checks passed across ${results.length} routes`);
    console.log(`  ${allPassed ? "✓ ALL ROUTES VERIFIED" : "✗ SOME CHECKS FAILED"}`);
    console.log("═══════════════════════════════════════════════════════════════");
  }

  if (!allPassed) process.exit(1);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
