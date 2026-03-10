#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PAGES_DIR="${1:-${ROOT_DIR}/data/approved}"
DRY_RUN="${DRY_RUN:-1}"

if [[ ! -d "$PAGES_DIR" ]]; then
  echo "Pages directory not found: $PAGES_DIR" >&2
  exit 2
fi

count=0
while IFS= read -r file; do
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "DRY_RUN create draft: $file"
  else
    bash "${ROOT_DIR}/scripts/create_webflow_draft.sh" "$file"
  fi
  count=$((count + 1))
done < <(find "$PAGES_DIR" -type f -name '*.json' | sort)

echo "Processed ${count} page files from ${PAGES_DIR}"
if [[ "$DRY_RUN" == "1" ]]; then
  echo "Set DRY_RUN=0 to actually create Webflow drafts."
fi
