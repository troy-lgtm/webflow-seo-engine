#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
MODEL="${ANTHROPIC_MODEL:-claude-3-7-sonnet-latest}"
LEARNING_FILE="${1:-${ROOT_DIR}/data/analytics/learning_backlog.json}"
PAGES_DIR="${2:-${ROOT_DIR}/data/approved}"
OUT_DIR="${3:-${ROOT_DIR}/data/optimized}"
MAX_PAGES="${MAX_PAGES:-10}"

mkdir -p "$OUT_DIR"

if [[ ! -f "$LEARNING_FILE" ]]; then
  echo "Missing learning backlog: $LEARNING_FILE" >&2
  exit 2
fi

prompt="$(cat "${ROOT_DIR}/prompts/04_conversion_optimizer.md")"

count=0
jq -c '.pages[]' "$LEARNING_FILE" | while IFS= read -r rec; do
  slug="$(jq -r '.slug' <<<"$rec")"
  page_file="${PAGES_DIR}/${slug}.json"
  [[ -f "$page_file" ]] || continue

  if (( count >= MAX_PAGES )); then
    break
  fi

  page_json="$(cat "$page_file")"
  if [[ -z "$ANTHROPIC_API_KEY" ]]; then
    jq \
      --arg intro_append " Book a 15-min Fit Call or get an Instant Quote to validate fit quickly." \
      --arg proof_append " This page is optimized via GTM + Clarity signals without changing design layout." \
      '.intro = ((.intro // "") + $intro_append)
       | .proof_section = ((.proof_section // "") + $proof_append)
       | .llm_answer_snippets = (.llm_answer_snippets // [])
       | if (.llm_answer_snippets | length) < 3 then
           .llm_answer_snippets += [{"question":"How do we evaluate this quickly?","answer":"Start with a focused pilot scope and measure early operational KPIs before scaling."}]
         else . end' \
      "$page_file" > "${OUT_DIR}/${slug}.json"

    bash "${ROOT_DIR}/scripts/qa_gate.sh" "${OUT_DIR}/${slug}.json" >/dev/null || {
      echo "Offline optimized page failed QA: $slug" >&2
      rm -f "${OUT_DIR}/${slug}.json"
      continue
    }
    echo "OPTIMIZED_OFFLINE: ${slug} -> ${OUT_DIR}/${slug}.json"
    count=$((count + 1))
    continue
  fi

  payload="$(jq -n --arg model "$MODEL" --arg prompt "$prompt" --arg page "$page_json" --arg rec "$rec" '{model:$model,max_tokens:3000,temperature:0.2,system:"Return only valid JSON.",messages:[{role:"user",content:($prompt + "\n\nPage JSON:\n" + $page + "\n\nLearning record JSON:\n" + $rec)}]}')"

  resp="$(curl -sS https://api.anthropic.com/v1/messages \
    -H "x-api-key: ${ANTHROPIC_API_KEY}" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d "$payload")"

  text="$(jq -r '.content[]? | select(.type=="text") | .text' <<<"$resp")"
  if [[ -z "$text" ]]; then
    echo "No optimizer output for $slug" >&2
    continue
  fi

  tmp_raw="$(mktemp)"
  tmp_json="$(mktemp)"
  trap 'rm -f "$tmp_raw" "$tmp_json"' EXIT
  printf "%s\n" "$text" > "$tmp_raw"

  awk 'BEGIN{capture=0} /^[[:space:]]*```json/{capture=1; next} /^[[:space:]]*```/{if(capture==1){capture=0; next}} {if(capture==1) print}' "$tmp_raw" > "$tmp_json"
  if [[ ! -s "$tmp_json" ]]; then
    awk 'BEGIN{started=0} {if(index($0,"{") && started==0){started=1} if(started==1){print}}' "$tmp_raw" > "$tmp_json"
  fi

  # Merge only safe editable keys; preserve all structural/design fields.
  jq -s '
    .[0] as $orig |
    .[1].edits as $e |
    $orig
    | .seo_title = ($e.seo_title // .seo_title)
    | .meta_description = ($e.meta_description // .meta_description)
    | .h1 = ($e.h1 // .h1)
    | .executive_summary = ($e.executive_summary // .executive_summary)
    | .intro = ($e.intro // .intro)
    | .problem_section = ($e.problem_section // .problem_section)
    | .solution_section = ($e.solution_section // .solution_section)
    | .proof_section = ($e.proof_section // .proof_section)
    | .comparison_table_markdown = ($e.comparison_table_markdown // .comparison_table_markdown)
    | .faq = ($e.faq // .faq)
    | .llm_answer_snippets = ($e.llm_answer_snippets // .llm_answer_snippets)
    | .visual_cards = ($e.visual_cards // .visual_cards)
  ' "$page_file" "$tmp_json" > "${OUT_DIR}/${slug}.json"

  bash "${ROOT_DIR}/scripts/qa_gate.sh" "${OUT_DIR}/${slug}.json" >/dev/null || {
    echo "Optimized page failed QA: $slug" >&2
    rm -f "${OUT_DIR}/${slug}.json"
    continue
  }

  echo "OPTIMIZED: ${slug} -> ${OUT_DIR}/${slug}.json"
  count=$((count + 1))
done
