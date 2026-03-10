#!/usr/bin/env node

/**
 * dev-seo — Start the Next.js dev server with conflict-proof port selection
 *
 * Behavior:
 *   1. Resolves the project root (never relies on cwd)
 *   2. Preflight: verifies app/ or pages/ directory exists
 *   3. Scans ports 3000–3010 for the first available port
 *   4. Spawns `next dev -p <port>` with cwd set to project root
 *   5. Prints dashboard + health URLs
 *   6. Exits with the same code as next
 *
 * Usage:
 *   node scripts/dev-seo.js
 *   npm run dev:seo
 */

import { spawn } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Resolve project root ──

function findProjectRoot(startDir) {
  let dir = startDir;
  const root = path.parse(dir).root;
  while (dir !== root) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const nameMatch = (pkg.name || "").toLowerCase().includes("warp");
        const hasNext = Boolean(pkg.dependencies?.next || pkg.devDependencies?.next);
        if (nameMatch || hasNext) return dir;
      } catch { /* skip */ }
    }
    const hasArtifacts = fs.existsSync(path.join(dir, "artifacts"));
    const hasData = fs.existsSync(path.join(dir, "data"));
    if (hasArtifacts && hasData) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

const PROJECT_ROOT = findProjectRoot(__dirname);
if (!PROJECT_ROOT) {
  console.error("✗ Could not locate project root. Searched upward from:", __dirname);
  process.exit(1);
}

// ── Preflight: verify app/ or pages/ exists ──

const hasApp = fs.existsSync(path.join(PROJECT_ROOT, "app"));
const hasPages = fs.existsSync(path.join(PROJECT_ROOT, "pages"));

if (!hasApp && !hasPages) {
  console.error(
    `✗ Neither app/ nor pages/ found in project root: ${PROJECT_ROOT}\n` +
    `  This doesn't look like a Next.js project. Aborting.`
  );
  process.exit(1);
}

// ── Port scanning ──

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findFreePort(start = 3000, end = 3010) {
  for (let port = start; port <= end; port++) {
    if (await isPortFree(port)) return port;
  }
  return null;
}

// ── Main ──

async function main() {
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`App directory: ${hasApp ? "app/" : "pages/"}`);
  console.log(`process.cwd(): ${process.cwd()}`);
  console.log();

  const port = await findFreePort();
  if (!port) {
    console.error("✗ No free port found in range 3000–3010. Free a port and try again.");
    process.exit(1);
  }

  console.log(`  Port ${port} is free.\n`);

  // Find next binary
  const nextBin = path.join(PROJECT_ROOT, "node_modules", ".bin", "next");
  if (!fs.existsSync(nextBin)) {
    console.error(`✗ next binary not found at: ${nextBin}\n  Run 'npm install' first.`);
    process.exit(1);
  }

  console.log("─────────────────────────────────────────────────────");
  console.log(`  SEO Control Panel: http://localhost:${port}/internal/seo-control`);
  console.log(`  Health:            http://localhost:${port}/api/seo/health`);
  console.log("─────────────────────────────────────────────────────\n");

  const child = spawn(nextBin, ["dev", "-p", String(port)], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: { ...process.env },
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });

  // Forward signals
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }
}

main();
