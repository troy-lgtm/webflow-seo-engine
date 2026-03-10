const CODE_LABELS: Record<string, string> = {
  faq_duplicate_field: "FAQ Duplicate",
  sitemap_invalid_url: "Sitemap Invalid",
  canonical_conflict: "Canonical Conflict",
  structured_data_generic: "Structured Data",
  indexing_generic: "Indexing",
  noindex_conflict: "Noindex",
  mobile_usability_generic: "Mobile Usability",
  security_generic: "Security",
  unknown: "Unknown",
};

const CODE_COLORS: Record<string, string> = {
  faq_duplicate_field: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  sitemap_invalid_url: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  canonical_conflict: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
};

export function IssueBadge({ code }: { code: string }) {
  const label = CODE_LABELS[code] || code;
  const color =
    CODE_COLORS[code] || "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${color}`}
    >
      {label}
    </span>
  );
}
