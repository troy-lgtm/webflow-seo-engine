import { NextRequest, NextResponse } from "next/server";
import { parseRawEmail } from "@/lib/email/parse-gsc-email";
import { normalizeGscIssue } from "@/lib/email/normalize-gsc-issue";
import { createIncidentFromEmail } from "@/lib/incident/create-incident";

/**
 * POST /api/ingest-email
 *
 * Accepts either:
 * A. Raw .eml text (Content-Type: text/plain)
 * B. Pre-parsed JSON payload (Content-Type: application/json)
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      // Pre-parsed JSON payload
      const body = await req.json();
      const parsed = normalizeGscIssue({
        subject: body.subject || "",
        from: body.from || "",
        to: body.to || "",
        date: body.date || new Date().toISOString(),
        bodyText: body.bodyText || body.body || "",
        bodyHtml: body.bodyHtml || null,
      });

      const incident = await createIncidentFromEmail(parsed);
      return NextResponse.json({ ok: true, incident }, { status: 201 });
    }

    // Raw email text
    const rawText = await req.text();
    if (!rawText.trim()) {
      return NextResponse.json({ ok: false, error: "Empty email body" }, { status: 400 });
    }

    const rawParsed = await parseRawEmail(rawText);
    const normalized = normalizeGscIssue(rawParsed);
    const incident = await createIncidentFromEmail(normalized);

    return NextResponse.json({ ok: true, incident }, { status: 201 });
  } catch (err) {
    console.error("Ingest email error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
