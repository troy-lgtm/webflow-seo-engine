/**
 * /api/seo/health — Debugging endpoint for artifact loading
 *
 * Returns project root, cwd, and artifact file status.
 * No secrets are exposed — only paths and file existence.
 */

import { NextResponse } from "next/server";
import { getProjectRoot } from "@/lib/fs/project-root.js";
import { probeArtifact } from "@/lib/artifacts/load-artifact.js";

export async function GET() {
  let projectRoot;
  let rootError = null;

  try {
    projectRoot = getProjectRoot();
  } catch (err) {
    projectRoot = null;
    rootError = err.message;
  }

  const artifacts = {
    publishDecision: probeArtifact("artifacts/publish_decision.json"),
    laneRegistry: probeArtifact("artifacts/lane_registry_snapshot.json"),
    corridorSnapshot: probeArtifact("artifacts/corridor_snapshot.json"),
    seoConfig: probeArtifact("config/seo-engine.json"),
  };

  const allExist = Object.values(artifacts).every(a => a.exists);
  const allParsed = Object.values(artifacts).every(a => a.parsed);

  return NextResponse.json({
    ok: projectRoot !== null && allExist && allParsed,
    projectRoot: projectRoot || "(not found)",
    cwd: process.cwd(),
    rootError,
    artifacts,
  });
}
