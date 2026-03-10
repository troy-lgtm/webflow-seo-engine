import type { Severity, Status } from "./types";

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function severityColor(s: Severity): string {
  switch (s) {
    case "critical":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "warning":
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "info":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
  }
}

export function statusColor(s: Status): string {
  switch (s) {
    case "open":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "investigating":
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "patching":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "resolved":
      return "bg-green-500/15 text-green-400 border-green-500/30";
    case "dismissed":
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  }
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "..." : s;
}

export function safeJsonParse<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export function toIncidentFromDb(row: Record<string, unknown>) {
  return {
    ...row,
    parsedPayload: safeJsonParse(row.parsedPayload as string),
    affectedUrls: safeJsonParse<string[]>(row.affectedUrls as string) ?? [],
    scanSummary: safeJsonParse(row.scanSummary as string),
  };
}

const BASE = process.env.SCAN_BASE_URL || "https://www.wearewarp.com";

export function resolveUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}
