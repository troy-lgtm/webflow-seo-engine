export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="bg-surface-1 border border-zinc-800 border-dashed rounded-xl p-12 text-center">
      <div className="text-zinc-400 text-sm font-medium">{title}</div>
      {description && (
        <div className="text-zinc-600 text-xs mt-1.5">{description}</div>
      )}
    </div>
  );
}
