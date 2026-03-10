import fs from "fs";
import { resolveFromRoot } from "@/lib/fs/project-root.js";

const SEED_PATH = resolveFromRoot("data", "warp_top_2000_lanes_seed.csv");

export async function GET() {
  try {
    if (!fs.existsSync(SEED_PATH)) {
      return new Response("Seed file not found", { status: 404 });
    }
    const csv = fs.readFileSync(SEED_PATH, "utf-8");
    return new Response(csv, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8" }
    });
  } catch {
    return new Response("Error reading seed file", { status: 500 });
  }
}
