#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GTM_FILE="${1:-${ROOT_DIR}/data/analytics/gtm_metrics.json}"
CLARITY_FILE="${2:-${ROOT_DIR}/data/analytics/clarity_metrics.csv}"
OUT_FILE="${3:-${ROOT_DIR}/data/analytics/learning_backlog.json}"

if [[ ! -f "$GTM_FILE" ]]; then
  echo "Missing GTM metrics file: $GTM_FILE" >&2
  exit 2
fi
if [[ ! -f "$CLARITY_FILE" ]]; then
  echo "Missing Clarity metrics file: $CLARITY_FILE" >&2
  exit 2
fi

tmp_clarity_json="$(mktemp)"
tmp_joined="$(mktemp)"
trap 'rm -f "$tmp_clarity_json" "$tmp_joined"' EXIT

# csv -> json array
awk -F',' '
NR==1 {next}
{
  printf "{\"slug\":\"%s\",\"rage_click_rate\":%s,\"dead_click_rate\":%s,\"quick_back_rate\":%s,\"avg_scroll_depth\":%s,\"session_recordings\":%s}\n",$1,$2,$3,$4,$5,$6
}
' "$CLARITY_FILE" | jq -s . > "$tmp_clarity_json"

# Join GTM + Clarity by slug and compute health signals.
jq -n --slurpfile gtm "$GTM_FILE" --slurpfile clarity "$tmp_clarity_json" '
  def n(x): (x // 0);
  [
    $gtm[0][] as $g
    | ($clarity[0][] | select(.slug == $g.slug)) as $c
    | {
        slug: $g.slug,
        sessions: n($g.sessions),
        cta_book_clicks: n($g.cta_book_clicks),
        cta_quote_clicks: n($g.cta_quote_clicks),
        quote_starts: n($g.quote_starts),
        book_starts: n($g.book_starts),
        form_submits: n($g.form_submits),
        rage_click_rate: n($c.rage_click_rate),
        dead_click_rate: n($c.dead_click_rate),
        quick_back_rate: n($c.quick_back_rate),
        avg_scroll_depth: n($c.avg_scroll_depth),
        session_recordings: n($c.session_recordings)
      }
    | .ctr = ((.cta_book_clicks + .cta_quote_clicks) / (if .sessions > 0 then .sessions else 1 end))
    | .start_rate = ((.quote_starts + .book_starts) / (if .sessions > 0 then .sessions else 1 end))
    | .submit_rate = (.form_submits / (if .sessions > 0 then .sessions else 1 end))
    | .friction_score = ((.rage_click_rate * 40) + (.dead_click_rate * 25) + (.quick_back_rate * 25) + ((1 - .avg_scroll_depth) * 10))
    | .conversion_score = ((.ctr * 35) + (.start_rate * 35) + (.submit_rate * 30)) * 100
    | .priority_score = (.friction_score - (.conversion_score / 3))
    | .safe_edit_scope = [
        "seo_title",
        "meta_description",
        "h1",
        "executive_summary",
        "intro",
        "problem_section",
        "solution_section",
        "proof_section",
        "comparison_table_markdown",
        "faq",
        "llm_answer_snippets",
        "visual_cards"
      ]
    | .blocked_edit_scope = [
        "layout_structure",
        "component_tree",
        "css",
        "colors",
        "fonts",
        "spacing_system",
        "webflow_interactions"
      ]
    | .hypotheses = (
      [
        (if .rage_click_rate > 0.06 then "clarify CTA copy and remove ambiguous action language above the fold" else empty end),
        (if .dead_click_rate > 0.05 then "reduce non-clickable visual affordances in copy blocks and tighten link cues" else empty end),
        (if .quick_back_rate > 0.10 then "front-load direct answer snippet and strengthen intent match in intro" else empty end),
        (if .avg_scroll_depth < 0.60 then "compress intro and move proof higher on page" else empty end),
        (if .submit_rate < 0.03 then "strengthen risk-reversal language near CTA and simplify value proposition" else empty end)
      ]
    )
  ]
  | sort_by(.priority_score) | reverse
' > "$tmp_joined"

jq '{
  generated_at_utc: (now | todateiso8601),
  policy: {
    objective: "maximize qualified conversion without breaking design system",
    edit_mode: "content-only",
    note: "No layout, CSS, typography, or component tree edits permitted."
  },
  pages: .
}' "$tmp_joined" > "$OUT_FILE"

echo "Wrote $OUT_FILE"
