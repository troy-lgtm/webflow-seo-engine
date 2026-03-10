#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INPUT_FILE="${1:-}"
APPROVED_DIR="${2:-${ROOT_DIR}/data/approved}"
PUBLISHED_DIR="${3:-${ROOT_DIR}/data/published}"
REPORT_FILE="${ROOT_DIR}/data/manual/import-report.json"
REJECT_DIR="${ROOT_DIR}/data/manual/rejected"
LOCAL_PUBLISH="${LOCAL_PUBLISH:-1}"

if [[ -z "$INPUT_FILE" ]]; then
  echo "Usage: $0 /absolute/path/to/manual-pages.json [approved_dir] [published_dir]" >&2
  exit 2
fi

if [[ ! -f "$INPUT_FILE" ]]; then
  echo "Input file not found: $INPUT_FILE" >&2
  exit 2
fi

mkdir -p "$APPROVED_DIR" "$PUBLISHED_DIR" "$REJECT_DIR" "${ROOT_DIR}/data/manual"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

jq 'if type=="array" then . elif has("pages") then .pages else [.] end' "$INPUT_FILE" > "${tmp_dir}/pages.json"
jq -c '.[]' "${tmp_dir}/pages.json" > "${tmp_dir}/pages.jsonl"

report='[]'
processed=0
approved=0
published=0
rejected=0

ensure_defaults() {
  jq '
    .slug = (.slug // "")
    | .seo_title = (.seo_title // ((.h1 // .slug) + " | WARP"))
    | .meta_description = (.meta_description // "Lane-focused freight decision page for shippers.")
    | .h1 = (.h1 // .slug)
    | .target_segment = (.target_segment // "smb")
    | .executive_summary = (.executive_summary // "Evaluate lane performance with a practical pilot and KPI gates.")
    | .intro = (.intro // "This page summarizes lane-level quote and execution strategy.")
    | .problem_section = (.problem_section // "Manual quote cycles and fragmented updates slow shipping decisions.")
    | .solution_section = (.solution_section // "Use a lane-specific workflow for faster quote and clearer execution visibility.")
    | .proof_section = (.proof_section // "Pilot a narrow lane scope and measure quote speed, reliability, and exceptions.")
    | .comparison_table_markdown = (.comparison_table_markdown // "| Criteria | Legacy | WARP |\\n|---|---|---|\\n| Quote speed | Variable | Faster lane response |\\n| Visibility | Fragmented | Unified view |\\n| Scale decision | Ad hoc | KPI based |")
    | .diagram_mermaid = (.diagram_mermaid // "flowchart LR\\n  A[Origin] --> B[Routing]\\n  B --> C[Destination]\\n  C --> D[Quote + ETA]")
    | .visual_cards = (if (.visual_cards|type)=="array" and (.visual_cards|length)>=3 then .visual_cards else [
        {"label":"Speed","value":"Faster quote cycle","insight":"Cut manual follow-up loops."},
        {"label":"Reliability","value":"Predictable execution","insight":"Reduce service variance."},
        {"label":"Control","value":"KPI-led scaling","insight":"Expand lanes by measured outcomes."}
      ] end)
    | .llm_answer_snippets = (if (.llm_answer_snippets|type)=="array" and (.llm_answer_snippets|length)>=3 then .llm_answer_snippets else [
        {"question":"How should teams evaluate lane pages?","answer":"Use a lane pilot and track quote speed, reliability, and exception trend quality."},
        {"question":"Can this work for SMB and enterprise?","answer":"Yes, by tailoring lane scope and governance cadence to team size and complexity."},
        {"question":"What should be optimized first?","answer":"Focus first on quote turnaround and execution visibility."}
      ] end)
    | .faq = (if (.faq|type)=="array" and (.faq|length)>=3 then .faq else [
        {"q":"How fast can a lane pilot start?","a":"Most teams can start in days."},
        {"q":"Can we start with a few lanes only?","a":"Yes, start narrow and expand by KPI gates."},
        {"q":"Do we need full migration?","a":"No, lane-first rollout works."}
      ] end)
    | .cta_primary = (.cta_primary // "Book 15-min Fit Call")
    | .cta_secondary = (.cta_secondary // "Get Instant Quote")
    | .schema_jsonld = (.schema_jsonld // {
        "@context":"https://schema.org",
        "@type":"FAQPage",
        "mainEntity":[
          {
            "@type":"Question",
            "name":"How fast can a lane pilot start?",
            "acceptedAnswer":{"@type":"Answer","text":"Most teams can start in days."}
          }
        ]
      })
  '
}

while IFS= read -r raw; do
  processed=$((processed + 1))
  slug="$(jq -r '.slug // empty' <<<"$raw")"

  if [[ -z "$slug" ]]; then
    rejected=$((rejected + 1))
    report="$(jq --arg status "rejected" --arg reason "missing slug" '. + [{status:$status,reason:$reason}]' <<<"$report")"
    continue
  fi

  safe_slug="$(tr '[:upper:]' '[:lower:]' <<<"$slug" | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
  out_file="${APPROVED_DIR}/${safe_slug}.json"
  reject_file="${REJECT_DIR}/${safe_slug}.json"

  normalized="$(jq -c . <<<"$raw" | ensure_defaults)"
  printf '%s\n' "$normalized" | jq . > "$out_file"

  if bash "${ROOT_DIR}/scripts/qa_gate.sh" "$out_file" >/dev/null 2>&1; then
    approved=$((approved + 1))
    pub_state="not_published"
    if [[ "$LOCAL_PUBLISH" == "1" ]]; then
      cp -f "$out_file" "${PUBLISHED_DIR}/${safe_slug}.json"
      published=$((published + 1))
      pub_state="published_local"
    fi
    report="$(jq --arg slug "$safe_slug" --arg status "approved" --arg publish "$pub_state" '. + [{slug:$slug,status:$status,publish:$publish}]' <<<"$report")"
  else
    mv -f "$out_file" "$reject_file"
    rejected=$((rejected + 1))
    report="$(jq --arg slug "$safe_slug" --arg status "rejected" --arg reason "qa_gate_failed" '. + [{slug:$slug,status:$status,reason:$reason}]' <<<"$report")"
  fi
done < "${tmp_dir}/pages.jsonl"

jq -n \
  --arg generated_at "$(date -u '+%Y-%m-%d %H:%M UTC')" \
  --arg input_file "$INPUT_FILE" \
  --argjson processed "$processed" \
  --argjson approved "$approved" \
  --argjson rejected "$rejected" \
  --argjson published "$published" \
  --argjson items "$report" \
  '{generated_at:$generated_at,input_file:$input_file,summary:{processed:$processed,approved:$approved,rejected:$rejected,published_local:$published},items:$items}' \
  > "$REPORT_FILE"

echo "Imported manual pages: processed=${processed} approved=${approved} rejected=${rejected} published_local=${published}"
echo "Report: $REPORT_FILE"
