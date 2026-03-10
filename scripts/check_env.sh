#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
MODE="${1:-full}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

missing=0

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "MISSING: ${name}" >&2
    missing=1
  fi
}

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "MISSING COMMAND: ${name}" >&2
    missing=1
  fi
}

require_cmd jq
require_cmd curl

if [[ "$MODE" == "generate" || "$MODE" == "full" || "$MODE" == "optimize" ]]; then
  if [[ -z "${SITE_URL:-}" ]]; then
    echo "WARN: SITE_URL not set; defaulting to https://www.wearewarp.com" >&2
  fi
  if [[ -z "${PRIMARY_CTA_URL:-}" ]]; then
    echo "WARN: PRIMARY_CTA_URL not set; defaulting to /book path" >&2
  fi
  if [[ -z "${SECONDARY_CTA_URL:-}" ]]; then
    echo "WARN: SECONDARY_CTA_URL not set; defaulting to /quote path" >&2
  fi
fi

if [[ "$MODE" == "publish" ]]; then
  require_var WEBFLOW_TOKEN
  require_var WEBFLOW_COLLECTION_ID
fi

if [[ "$missing" -ne 0 ]]; then
  echo "Environment check failed. Fill ${ENV_FILE} (copy from .env.example)." >&2
  exit 1
fi

echo "Environment check passed."
