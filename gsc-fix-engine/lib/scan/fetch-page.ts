import { resolveUrl } from "@/lib/utils";

export interface FetchedPage {
  url: string;
  status: number;
  html: string;
  error?: string;
}

/**
 * Fetch a single page, returning its HTML content.
 * Handles timeouts and errors gracefully.
 */
export async function fetchPage(urlOrPath: string): Promise<FetchedPage> {
  const url = resolveUrl(urlOrPath);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "WarpGSCFixEngine/1.0 (internal-scan)",
        Accept: "text/html",
      },
    });
    clearTimeout(timeout);

    const html = await res.text();
    return { url, status: res.status, html };
  } catch (err) {
    return {
      url,
      status: 0,
      html: "",
      error: err instanceof Error ? err.message : "fetch failed",
    };
  }
}
