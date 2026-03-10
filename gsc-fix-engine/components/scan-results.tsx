import type { ScanSummary } from "@/lib/types";

export function ScanResults({ summary }: { summary: ScanSummary }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Pages Scanned" value={summary.totalPages} />
        <MiniStat
          label="With Issues"
          value={summary.pagesWithIssues}
          warn={summary.pagesWithIssues > 0}
        />
        <MiniStat
          label="Total Findings"
          value={summary.totalFindings}
          warn={summary.totalFindings > 0}
        />
      </div>

      {summary.findings.length > 0 && (
        <div className="space-y-2">
          {summary.findings.map((page, i) => (
            <div
              key={i}
              className="bg-surface-2 border border-zinc-800 rounded-lg p-3"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    page.status === "ok"
                      ? "bg-green-500"
                      : page.status === "error"
                      ? "bg-red-500"
                      : "bg-yellow-500"
                  }`}
                />
                <span className="text-xs text-zinc-300 font-mono truncate">
                  {page.url}
                </span>
                {page.title && (
                  <span className="text-xs text-zinc-600 truncate hidden sm:inline">
                    — {page.title}
                  </span>
                )}
              </div>
              {page.findings.length > 0 && (
                <div className="mt-2 space-y-1 pl-4">
                  {page.findings.map((f, j) => (
                    <div key={j} className="text-xs text-zinc-400">
                      <span className="text-zinc-500 font-mono">
                        [{f.type}]
                      </span>{" "}
                      {f.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="bg-surface-2 border border-zinc-800 rounded-lg p-3 text-center">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div
        className={`text-lg font-bold tabular-nums ${
          warn ? "text-yellow-400" : "text-zinc-200"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
