import { MetricsBar } from "@/components/metrics-bar";
import { IncidentsTable } from "@/components/incidents-table";
import { PlaybookCard } from "@/components/playbook-card";
import { getAllIncidents, getIncidentStats } from "@/lib/incident/incident-store";
import { getPlaybookSummaries } from "@/lib/playbooks";
import type { Incident } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let incidents: Incident[] = [];
  let stats = { total: 0, open: 0, investigating: 0, resolved: 0, byType: {} as Record<string, number> };

  try {
    [incidents, stats] = await Promise.all([
      getAllIncidents(),
      getIncidentStats(),
    ]);
  } catch {
    // DB not initialized yet — show empty state
  }

  const playbooks = getPlaybookSummaries();

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight">
          Incident Dashboard
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Automated detection and remediation for wearewarp.com search issues.
        </p>
      </div>

      {/* Metrics */}
      <MetricsBar
        total={stats.total}
        open={stats.open}
        investigating={stats.investigating}
        resolved={stats.resolved}
      />

      {/* Incidents by Type */}
      {Object.keys(stats.byType).length > 0 && (
        <div className="bg-surface-1 border border-zinc-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-zinc-200 mb-3">
            Incidents by Type
          </h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.byType).map(([code, count]) => (
              <div
                key={code}
                className="bg-surface-2 border border-zinc-800 rounded-lg px-4 py-2.5 flex items-center gap-3"
              >
                <span className="text-xs text-zinc-400 font-mono">{code}</span>
                <span className="text-sm font-bold text-zinc-200 tabular-nums">
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest Incidents */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-200 mb-3">
          Latest Incidents
        </h2>
        <IncidentsTable incidents={incidents} />
      </div>

      {/* Playbooks */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-200 mb-3">
          Available Playbooks ({playbooks.length})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {playbooks.map((p) => (
            <PlaybookCard
              key={p.id}
              title={p.title}
              description={p.description}
              issueFamily={p.issueFamily}
              normalizedCode={p.normalizedCode}
              scanTargets={p.scanTargets}
            />
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-surface-1 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-zinc-200 mb-3">
          Quick Actions
        </h2>
        <div className="flex flex-wrap gap-3">
          <QuickAction
            label="Ingest Sample Email"
            command="curl -s -X POST http://localhost:3100/api/ingest-email -H 'Content-Type: text/plain' -d @public/sample-gsc-faq-email.eml"
          />
          <QuickAction
            label="List Playbooks"
            command="curl -s http://localhost:3100/api/playbooks | jq"
          />
          <QuickAction
            label="List Incidents"
            command="curl -s http://localhost:3100/api/incidents | jq"
          />
        </div>
      </div>
    </div>
  );
}

function QuickAction({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  return (
    <div className="bg-surface-2 border border-zinc-800 rounded-lg p-3 flex-1 min-w-[250px]">
      <div className="text-xs text-zinc-400 font-medium mb-1.5">{label}</div>
      <code className="text-xs text-zinc-500 block truncate">{command}</code>
    </div>
  );
}
