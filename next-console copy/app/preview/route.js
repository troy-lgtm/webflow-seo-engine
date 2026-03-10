import fs from "fs";
import { NextResponse } from "next/server";
import { resolveFromRoot } from "@/lib/fs/project-root.js";

export async function GET() {
  const previewPath = resolveFromRoot("artifacts", "smoke", "preview.html");
  try {
    const html = fs.readFileSync(previewPath, "utf-8");
    return new NextResponse(html, {
      headers: { "Content-Type": "text/html" }
    });
  } catch {
    return new NextResponse("<h1>No preview available</h1><p>Run npm run smoke:firstpage first.</p>", {
      status: 404,
      headers: { "Content-Type": "text/html" }
    });
  }
}
