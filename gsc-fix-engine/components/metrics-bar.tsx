interface MetricCardProps {
  label: string;
  value: number | string;
  accent?: boolean;
}

function MetricCard({ label, value, accent }: MetricCardProps) {
  return (
    <div className="bg-surface-1 border border-zinc-800 rounded-xl p-5">
      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
        {label}
      </div>
      <div
        className={`text-2xl font-bold tabular-nums ${
          accent ? "text-accent" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

interface MetricsBarProps {
  total: number;
  open: number;
  investigating: number;
  resolved: number;
}

export function MetricsBar({
  total,
  open,
  investigating,
  resolved,
}: MetricsBarProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <MetricCard label="Total Incidents" value={total} />
      <MetricCard label="Open" value={open} accent={open > 0} />
      <MetricCard label="Investigating" value={investigating} />
      <MetricCard label="Resolved" value={resolved} />
    </div>
  );
}
