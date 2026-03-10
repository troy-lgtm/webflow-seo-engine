import { notFound } from "next/navigation";
import { getIncidentById } from "@/lib/incident/incident-store";
import { IncidentDetail } from "@/components/incident-detail";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let incident;
  try {
    incident = await getIncidentById(id);
  } catch {
    notFound();
  }

  if (!incident) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <span>&larr;</span> Back to Dashboard
      </Link>
      <IncidentDetail incident={incident} />
    </div>
  );
}
