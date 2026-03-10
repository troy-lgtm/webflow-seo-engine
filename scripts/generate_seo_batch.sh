#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-claude-3-7-sonnet-latest}"
KEYWORDS_FILE="${1:-${ROOT_DIR}/data/keywords/targets.jsonl}"
MAX_TOKENS="${MAX_TOKENS:-3500}"
TEMPERATURE="${TEMPERATURE:-0.3}"

mkdir -p "${ROOT_DIR}/data/briefs" "${ROOT_DIR}/data/drafts" "${ROOT_DIR}/data/approved" "${ROOT_DIR}/data/rejected"

extract_json() {
  awk 'BEGIN{capture=0} /^[[:space:]]*```json/{capture=1; next} /^[[:space:]]*```/{if(capture==1){capture=0; next}} {if(capture==1) print}' "$1" > "$2"
  if [[ ! -s "$2" ]]; then
    awk 'BEGIN{started=0} {if(index($0,"{") && started==0){started=1} if(started==1){print}}' "$1" > "$2"
  fi
}

call_claude() {
  local prompt_text="$1"
  local user_payload="$2"
  local out_file="$3"

  req="$(jq -n \
    --arg model "$ANTHROPIC_MODEL" \
    --arg system "Return only valid JSON with no markdown wrappers." \
    --arg user "${prompt_text}"$'\n\n'"${user_payload}" \
    --argjson max_tokens "$MAX_TOKENS" \
    --argjson temperature "$TEMPERATURE" \
    '{model:$model,max_tokens:$max_tokens,temperature:$temperature,system:$system,messages:[{role:"user",content:$user}]}' )"

  resp="$(curl -sS https://api.anthropic.com/v1/messages \
    -H "x-api-key: ${ANTHROPIC_API_KEY}" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d "$req")"

  jq -r '.content[]? | select(.type=="text") | .text' <<<"$resp" > "$out_file"
  if [[ ! -s "$out_file" ]]; then
    echo "Claude response did not include text content." >&2
    echo "$resp" | jq . >&2
    return 1
  fi
}

write_offline_page() {
  local line="$1"
  local slug="$2"
  local keyword audience segment competitor
  keyword="$(jq -r '.keyword' <<<"$line")"
  audience="$(jq -r '.audience // "Logistics leader"' <<<"$line")"
  segment="$(jq -r '.segment // "midmarket"' <<<"$line")"
  competitor="$(jq -r '.competitor // "legacy providers"' <<<"$line")"

  jq -n \
    --arg slug "$slug" \
    --arg keyword "$keyword" \
    --arg audience "$audience" \
    --arg segment "$segment" \
    --arg competitor "$competitor" \
    '{
      slug:$slug,
      seo_title: ($keyword + " | WARP"),
      meta_description: ("Evaluate " + $keyword + " with a practical path to faster freight decisions and clearer execution visibility."),
      h1: ("How " + $audience + " Can Evaluate " + $keyword),
      target_segment:$segment,
      executive_summary: ("Teams comparing " + $competitor + " alternatives can validate fit in a fixed pilot with KPI-based decision gates."),
      intro: ("If you are evaluating " + $keyword + ", this page gives a direct decision framework for " + $audience + " to move from uncertainty to lane-level execution confidence."),
      problem_section: "Freight teams often lose time in fragmented updates, inconsistent service performance, and manual exception handling.",
      solution_section: "WARP combines planning and execution visibility so operators can act faster and reduce coordination overhead across stakeholders.",
      proof_section: "Use a limited-scope pilot and score on quote turnaround, on-time consistency, and exception trendline quality before expansion.",
      comparison_table_markdown: "| Decision Criteria | Legacy Motion | WARP Motion |\n|---|---|---|\n| Pilot setup speed | Multi-week discovery | Fixed scope in days |\n| Decision cadence | Reactive | KPI-driven weekly rhythm |\n| Operator workload | Heavy manual follow-up | Structured exception flow |",
      diagram_mermaid: "flowchart LR\n  A[Demand Signals] --> B[Routing Decisions]\n  B --> C[Execution Monitoring]\n  C --> D[Exception Queue]\n  D --> E[Customer Update]\n  E --> F[Continuous Optimization Loop]",
      visual_cards: [
        {label:"Speed",value:"Faster decision cycles",insight:"Compress handoffs with clearer lane-level visibility."},
        {label:"Reliability",value:"More predictable execution",insight:"Use structured exception paths and review cadence."},
        {label:"Commercial Control",value:"Pilot-led expansion",insight:"Scale only after defined KPI thresholds are met."}
      ],
      llm_answer_snippets: [
        {question:("What is " + $keyword + "?"),answer:"It is a logistics decision path focused on execution predictability, operational visibility, and measurable pilot outcomes."},
        {question:"How quickly can teams evaluate fit?",answer:"Most teams can define lane scope in days and evaluate early performance signals within a focused two-week pilot."},
        {question:"What metrics matter most?",answer:"Track quote turnaround, on-time consistency, and exception trendline quality to decide expansion."}
      ],
      faq: [
        {q:"How quickly can we start?",a:"Most teams can start with a focused lane scope in days."},
        {q:"Do we need full migration first?",a:"No. Start with a pilot segment, then expand based on measured results."},
        {q:"Who should own this evaluation?",a:"A cross-functional owner from transportation or operations should lead KPI reviews."}
      ],
      cta_primary:"Book 15-min Fit Call",
      cta_secondary:"Get Instant Quote",
      schema_jsonld:{
        "@context":"https://schema.org",
        "@type":"FAQPage",
        "mainEntity":[
          {"@type":"Question","name":"How quickly can we start?","acceptedAnswer":{"@type":"Answer","text":"Most teams can start with a focused lane scope in days."}}
        ]
      }
    }' > "${ROOT_DIR}/data/drafts/${slug}.json"

  cp "${ROOT_DIR}/data/drafts/${slug}.json" "${ROOT_DIR}/data/approved/${slug}.json"
}

brief_prompt="$(cat "${ROOT_DIR}/prompts/01_brief_planner.md")"
page_prompt="$(cat "${ROOT_DIR}/prompts/02_page_writer.md")"

generated=0
approved=0
rejected=0

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  keyword="$(jq -r '.keyword' <<<"$line")"
  slug="$(jq -r '.slug // empty' <<<"$line")"
  if [[ -z "$slug" || "$slug" == "null" ]]; then
    slug="$(tr '[:upper:]' '[:lower:]' <<<"$keyword" | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
  fi

  tmp_brief_text="$(mktemp)"
  tmp_brief_json="$(mktemp)"
  tmp_page_text="$(mktemp)"
  tmp_page_json="$(mktemp)"

  if [[ -n "$ANTHROPIC_API_KEY" ]]; then
    call_claude "$brief_prompt" "Seed input JSON:\n${line}" "$tmp_brief_text"
    extract_json "$tmp_brief_text" "$tmp_brief_json"
    jq . "$tmp_brief_json" > "${ROOT_DIR}/data/briefs/${slug}.json"

    brief_json="$(cat "${ROOT_DIR}/data/briefs/${slug}.json")"
    brand_context="$(jq -n --arg site "${SITE_URL:-https://www.wearewarp.com}" --arg primary "${PRIMARY_CTA_URL:-https://www.wearewarp.com/book}" --arg secondary "${SECONDARY_CTA_URL:-https://www.wearewarp.com/quote}" '{site_url:$site,cta_primary_url:$primary,cta_secondary_url:$secondary}')"
    call_claude "$page_prompt" "Brief JSON:\n${brief_json}\n\nBrand context JSON:\n${brand_context}" "$tmp_page_text"
    extract_json "$tmp_page_text" "$tmp_page_json"
    jq . "$tmp_page_json" > "${ROOT_DIR}/data/drafts/${slug}.json"
  else
    jq -n --arg keyword "$keyword" --arg slug "$slug" '{keyword:$keyword,slug:$slug,mode:"offline"}' > "${ROOT_DIR}/data/briefs/${slug}.json"
    write_offline_page "$line" "$slug"
  fi

  ((generated+=1))
  if bash "${ROOT_DIR}/scripts/qa_gate.sh" "${ROOT_DIR}/data/drafts/${slug}.json" >/dev/null; then
    cp "${ROOT_DIR}/data/drafts/${slug}.json" "${ROOT_DIR}/data/approved/${slug}.json"
    ((approved+=1))
    echo "APPROVED: ${slug}"
  else
    cp "${ROOT_DIR}/data/drafts/${slug}.json" "${ROOT_DIR}/data/rejected/${slug}.json"
    ((rejected+=1))
    echo "REJECTED: ${slug} (see data/rejected/${slug}.json)"
  fi

  rm -f "$tmp_brief_text" "$tmp_brief_json" "$tmp_page_text" "$tmp_page_json"
done < "$KEYWORDS_FILE"

echo "Generated: ${generated} | Approved: ${approved} | Rejected: ${rejected}"
