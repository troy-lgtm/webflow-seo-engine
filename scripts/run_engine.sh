#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-full}"

KEYWORDS_FILE="${KEYWORDS_FILE:-${ROOT_DIR}/data/keywords/targets.jsonl}"
GTM_FILE="${GTM_FILE:-${ROOT_DIR}/data/analytics/gtm_metrics.json}"
CLARITY_FILE="${CLARITY_FILE:-${ROOT_DIR}/data/analytics/clarity_metrics.csv}"
LEARNING_FILE="${LEARNING_FILE:-${ROOT_DIR}/data/analytics/learning_backlog.json}"
APPROVED_DIR="${APPROVED_DIR:-${ROOT_DIR}/data/approved}"
OPTIMIZED_DIR="${OPTIMIZED_DIR:-${ROOT_DIR}/data/optimized}"
PUBLISH_DIR="${PUBLISH_DIR:-${OPTIMIZED_DIR}}"

cd "$ROOT_DIR"
bash "${ROOT_DIR}/scripts/check_env.sh" "$MODE"

case "$MODE" in
  generate)
    bash "${ROOT_DIR}/scripts/generate_seo_batch.sh" "$KEYWORDS_FILE"
    bash "${ROOT_DIR}/scripts/build_dashboard_data.sh"
    ;;
  optimize)
    bash "${ROOT_DIR}/scripts/build_learning_backlog.sh" "$GTM_FILE" "$CLARITY_FILE" "$LEARNING_FILE"
    bash "${ROOT_DIR}/scripts/apply_learning_edits.sh" "$LEARNING_FILE" "$APPROVED_DIR" "$OPTIMIZED_DIR"
    bash "${ROOT_DIR}/scripts/build_dashboard_data.sh"
    ;;
  full)
    bash "${ROOT_DIR}/scripts/generate_seo_batch.sh" "$KEYWORDS_FILE"
    if [[ -f "$GTM_FILE" && -f "$CLARITY_FILE" ]]; then
      bash "${ROOT_DIR}/scripts/build_learning_backlog.sh" "$GTM_FILE" "$CLARITY_FILE" "$LEARNING_FILE"
      bash "${ROOT_DIR}/scripts/apply_learning_edits.sh" "$LEARNING_FILE" "$APPROVED_DIR" "$OPTIMIZED_DIR"
    elif [[ -f "${ROOT_DIR}/data/analytics/gtm_metrics.sample.json" && -f "${ROOT_DIR}/data/analytics/clarity_metrics.sample.csv" ]]; then
      bash "${ROOT_DIR}/scripts/build_learning_backlog.sh" "${ROOT_DIR}/data/analytics/gtm_metrics.sample.json" "${ROOT_DIR}/data/analytics/clarity_metrics.sample.csv" "$LEARNING_FILE"
      bash "${ROOT_DIR}/scripts/apply_learning_edits.sh" "$LEARNING_FILE" "$APPROVED_DIR" "$OPTIMIZED_DIR" || true
    fi
    bash "${ROOT_DIR}/scripts/build_dashboard_data.sh"
    ;;
  publish)
    bash "${ROOT_DIR}/scripts/publish_approved_batch.sh" "$PUBLISH_DIR"
    bash "${ROOT_DIR}/scripts/build_dashboard_data.sh"
    ;;
  *)
    echo "Usage: $0 [generate|optimize|full|publish]" >&2
    exit 2
    ;;
esac

echo "DONE: mode=${MODE}"
