#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

FILE="${1:-}"
if [[ -z "${FILE}" ]]; then
  echo "Usage: $0 data/approved/page.json" >&2
  exit 2
fi

: "${WEBFLOW_TOKEN:?Missing WEBFLOW_TOKEN}"
: "${WEBFLOW_COLLECTION_ID:?Missing WEBFLOW_COLLECTION_ID}"
BASE_URL="${WEBFLOW_BASE_URL:-https://api.webflow.com/v2}"

bash "${ROOT_DIR}/scripts/qa_gate.sh" "$FILE"

payload="$(jq '{isArchived:false,isDraft:true,fieldData:{slug:.slug,name:.h1,"seo-title":.seo_title,"seo-description":.meta_description,h1:.h1,target_segment:.target_segment,executive_summary:.executive_summary,intro:.intro,problem_section:.problem_section,solution_section:.solution_section,proof_section:.proof_section,comparison_table_markdown:.comparison_table_markdown,diagram_mermaid:.diagram_mermaid,visual_cards:(.visual_cards|tostring),llm_answer_snippets:(.llm_answer_snippets|tostring),faq:(.faq|tostring),cta_primary:.cta_primary,cta_secondary:.cta_secondary,schema_jsonld:(.schema_jsonld|tostring)}}' "$FILE")"

resp="$(curl -sS -X POST "${BASE_URL}/collections/${WEBFLOW_COLLECTION_ID}/items" \
  -H "Authorization: Bearer ${WEBFLOW_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$payload")"

if [[ "$(jq -r '.id // empty' <<<"$resp")" == "" ]]; then
  echo "Webflow create failed:" >&2
  echo "$resp" | jq . >&2
  exit 1
fi

item_id="$(jq -r '.id' <<<"$resp")"
out="${ROOT_DIR}/data/published/${item_id}.json"
echo "$resp" | jq . > "$out"
echo "CREATED_DRAFT: ${item_id}"
echo "Saved: $out"
