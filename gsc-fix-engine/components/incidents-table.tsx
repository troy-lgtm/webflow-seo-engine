import Link from "next/link";
import { IssueBadge } from "./issue-badge";
import { StatusBadge, SeverityBadge } from "./status-badge";
import { relativeTime, truncate } from "@/lib/utils";
import type { Incident } from "@/lib/types";

interface IncidentsTableProps {
  incidents: Incident[];
}

export function IncidentsTable({ incidents }: IncidentsTableProps) {
  if (incidents.length === 0) {
    return (
      <div className="bg-surface-1 border border-zinc-800 rounded-xl p-12 text-center">
        <div className="text-zinc-500 text-sm">No incidents detected.</div>
        <div className="text-zinc-600 text-xs mt-1">
          Ingest a GSC alert email to create an incident.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-1 border border-zinc-800 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
            <th className="text-left px-5 py-3 font-medium">Issue</th>
            <th className="text-left px-5 py-3 font-medium">Type</th>
            <th className="text-left px-5 py-3 font-medium">Severity</th>
            <th className="text-left px-5 py-3 font-medium">Status</th>
            <th className="text-left px-5 py-3 font-medium">Detected</th>
            <th className="text-right px-5 py-3 font-medium">URLs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {incidents.map((incident) => (
            <tr
              key={incident.id}
              className="hover:bg-zinc-800/30 transition-colors"
            >
              <td className="px-5 py-3.5">
                <Link
                  href={`/incidents/${incident.id}`}
                  className="text-zinc-200 hover:text-accent transition-colors font-medium"
                >
                  {truncate(
                    incident.emailSubject || incident.issueType,
                    50
                  )}
                </Link>
              </td>
              <td className="px-5 py-3.5">
                <IssueBadge code={incident.normalizedCode} />
              </td>
              <td className="px-5 py-3.5">
                <SeverityBadge severity={incident.severity} />
              </td>
              <td className="px-5 py-3.5">
                <StatusBadge status={incident.status} />
              </td>
              <td className="px-5 py-3.5 text-zinc-400 text-xs">
                {relativeTime(incident.detectedAt)}
              </td>
              <td className="px-5 py-3.5 text-right text-zinc-400 tabular-nums">
                {incident.affectedUrls.length}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
