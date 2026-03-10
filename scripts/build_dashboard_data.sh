#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_JS="${ROOT_DIR}/dashboard/data.js"

count_json_files() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    find "$dir" -type f -name '*.json' | wc -l | tr -d ' '
  else
    echo 0
  fi
}

keywords_count=0
if [[ -f "${ROOT_DIR}/data/keywords/targets.jsonl" ]]; then
  keywords_count="$(grep -c '.' "${ROOT_DIR}/data/keywords/targets.jsonl" || true)"
fi

generated_count="$(count_json_files "${ROOT_DIR}/data/drafts")"
approved_count="$(count_json_files "${ROOT_DIR}/data/approved")"
optimized_count="$(count_json_files "${ROOT_DIR}/data/optimized")"
published_count="$(count_json_files "${ROOT_DIR}/data/published")"

top_backlog='[]'
if [[ -f "${ROOT_DIR}/data/analytics/learning_backlog.json" ]]; then
  top_backlog="$(jq '.pages[:8]' "${ROOT_DIR}/data/analytics/learning_backlog.json")"
elif [[ -f "${ROOT_DIR}/data/analytics/learning_backlog.sample.json" ]]; then
  top_backlog="$(jq '.pages[:8]' "${ROOT_DIR}/data/analytics/learning_backlog.sample.json")"
fi

recent_pages='[]'
if [[ -d "${ROOT_DIR}/data/approved" ]]; then
  recent_pages="$(find "${ROOT_DIR}/data/approved" -type f -name '*.json' -print0 \
    | xargs -0 ls -t 2>/dev/null \
    | head -n 8 \
    | while IFS= read -r f; do
        jq -c --arg file "$(basename "$f")" '{slug:.slug,seo_title:.seo_title,target_segment:.target_segment,file:$file}' "$f"
      done \
    | jq -s '.')"
fi

generated_at="$(date -u '+%Y-%m-%d %H:%M UTC')"

payload="$(jq -n \
  --arg generated_at "$generated_at" \
  --argjson keywords_count "${keywords_count:-0}" \
  --argjson generated_count "${generated_count:-0}" \
  --argjson approved_count "${approved_count:-0}" \
  --argjson optimized_count "${optimized_count:-0}" \
  --argjson published_count "${published_count:-0}" \
  --argjson top_backlog "$top_backlog" \
  --argjson recent_pages "$recent_pages" \
  '{
    generated_at: $generated_at,
    goals: {
      north_star: "Maximize qualified quote starts and enterprise fit calls from SEO.",
      primary_kpis: [
        "CTA CTR",
        "Quote/Book start rate",
        "Form submit rate",
        "Qualified pipeline from SEO"
      ],
      guardrail: "Content-only optimization; no design system drift."
    },
    pipeline: {
      keywords: $keywords_count,
      generated: $generated_count,
      approved: $approved_count,
      optimized: $optimized_count,
      published: $published_count
    },
    top_backlog: $top_backlog,
    recent_pages: $recent_pages
  }')"

mkdir -p "$(dirname "$OUT_JS")"
printf 'window.DASHBOARD_DATA = %s;\n' "$payload" > "$OUT_JS"
echo "Wrote ${OUT_JS}"
