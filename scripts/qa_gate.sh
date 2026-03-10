#!/bin/bash
set -euo pipefail

FILE="${1:-}"
if [[ -z "${FILE}" ]]; then
  echo "Usage: $0 data/approved/page.json" >&2
  exit 2
fi

required=(slug seo_title meta_description h1 target_segment executive_summary intro problem_section solution_section proof_section diagram_mermaid comparison_table_markdown cta_primary cta_secondary schema_jsonld)
for f in "${required[@]}"; do
  if [[ "$(jq -r --arg f "$f" '.[$f] // empty' "$FILE")" == "" ]]; then
    echo "FAIL: missing field '$f' in $FILE" >&2
    exit 1
  fi
done

faq_len="$(jq '.faq | length' "$FILE")"
if (( faq_len < 3 )); then
  echo "FAIL: faq must have at least 3 entries" >&2
  exit 1
fi

llm_snippet_len="$(jq '.llm_answer_snippets | length' "$FILE")"
if (( llm_snippet_len < 3 )); then
  echo "FAIL: llm_answer_snippets must have at least 3 entries" >&2
  exit 1
fi

visual_cards_len="$(jq '.visual_cards | length' "$FILE")"
if (( visual_cards_len < 3 )); then
  echo "FAIL: visual_cards must have at least 3 cards" >&2
  exit 1
fi

if ! grep -q '^flowchart ' <<<"$(jq -r '.diagram_mermaid' "$FILE")"; then
  echo "FAIL: diagram_mermaid must start with 'flowchart '" >&2
  exit 1
fi

full_text="$(jq -r '[.seo_title,.meta_description,.h1,.executive_summary,.intro,.problem_section,.solution_section,.proof_section,.comparison_table_markdown] | join(" ") | ascii_downcase' "$FILE")"

if grep -Eq "(best in world|guaranteed savings|zero risk|always cheaper)" <<<"$full_text"; then
  echo "FAIL: contains risky unverifiable claims" >&2
  exit 1
fi

if ! grep -qi "book" <<<"$full_text"; then
  echo "WARN: page body does not mention booking call language" >&2
fi

if ! grep -qi "quote" <<<"$full_text"; then
  echo "WARN: page body does not mention quote language" >&2
fi

echo "PASS: $FILE"
