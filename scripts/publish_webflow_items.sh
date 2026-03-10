#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi

: "${WEBFLOW_TOKEN:?Missing WEBFLOW_TOKEN}"
: "${WEBFLOW_COLLECTION_ID:?Missing WEBFLOW_COLLECTION_ID}"
BASE_URL="${WEBFLOW_BASE_URL:-https://api.webflow.com/v2}"

if [[ "$#" -lt 1 ]]; then
  echo "Usage: $0 <item_id> [item_id ...]" >&2
  exit 2
fi

ids_json="$(printf '%s\n' "$@" | jq -R . | jq -s .)"
payload="$(jq -n --argjson ids "$ids_json" '{itemIds:$ids}')"

resp="$(curl -sS -X POST "${BASE_URL}/collections/${WEBFLOW_COLLECTION_ID}/items/publish" \
  -H "Authorization: Bearer ${WEBFLOW_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$payload")"

if [[ "$(jq -r '.publishedItemIds // empty' <<<"$resp")" == "" ]]; then
  echo "Webflow publish failed:" >&2
  echo "$resp" | jq . >&2
  exit 1
fi

echo "$resp" | jq .
