import { statusColor, severityColor } from "@/lib/utils";
import type { Severity, Status } from "@/lib/types";

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border capitalize ${statusColor(
        status as Status
      )}`}
    >
      {status}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border capitalize ${severityColor(
        severity as Severity
      )}`}
    >
      {severity}
    </span>
  );
}
