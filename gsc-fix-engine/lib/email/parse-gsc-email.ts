import { simpleParser, type ParsedMail } from "mailparser";

export interface RawParsedEmail {
  subject: string;
  from: string;
  to: string;
  date: string;
  bodyText: string;
  bodyHtml: string | null;
}

/**
 * Parse a raw .eml / RFC 822 email string into structured fields.
 */
export async function parseRawEmail(raw: string): Promise<RawParsedEmail> {
  const parsed: ParsedMail = await simpleParser(raw);

  return {
    subject: parsed.subject || "",
    from: parsed.from?.text || "",
    to: parsed.to
      ? Array.isArray(parsed.to)
        ? parsed.to.map((a) => a.text).join(", ")
        : parsed.to.text
      : "",
    date: parsed.date?.toISOString() || new Date().toISOString(),
    bodyText: parsed.text || "",
    bodyHtml: parsed.html || null,
  };
}
