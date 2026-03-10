interface PlaybookCardProps {
  title: string;
  description: string;
  issueFamily: string;
  normalizedCode: string;
  scanTargets: string[];
}

export function PlaybookCard({
  title,
  description,
  issueFamily,
  normalizedCode,
  scanTargets,
}: PlaybookCardProps) {
  return (
    <div className="bg-surface-1 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-semibold text-zinc-100 text-sm">{title}</h3>
        <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
          {issueFamily}
        </span>
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed mb-4">
        {description}
      </p>
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-600 font-mono">{normalizedCode}</span>
        <span className="text-xs text-zinc-500">
          {scanTargets.length} target{scanTargets.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
