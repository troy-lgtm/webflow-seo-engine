#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FILE="${1:-}"

if [[ -z "$FILE" ]]; then
  echo "Usage: $0 data/approved/page.json" >&2
  exit 2
fi

slug="$(jq -r '.slug' "$FILE")"
out_dir="${ROOT_DIR}/data/assets"
out_file="${out_dir}/${slug}-visual-embed.html"
mkdir -p "$out_dir"

cards_html="$(jq -r '.visual_cards[] | "<div class=\"mc-card\"><div class=\"mc-kicker\">\(.label)</div><div class=\"mc-value\">\(.value)</div><p>\(.insight)</p></div>"' "$FILE")"
diagram="$(jq -r '.diagram_mermaid' "$FILE")"

cat > "$out_file" <<EOF
<style>
.mc-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; margin:20px 0; }
.mc-card { border:1px solid #d6dde5; border-radius:14px; padding:16px; background:linear-gradient(180deg,#ffffff 0%,#f6f9fc 100%); }
.mc-kicker { font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:#4e5d71; }
.mc-value { margin-top:8px; font-size:20px; font-weight:700; color:#102136; }
.mc-card p { margin:10px 0 0; font-size:14px; line-height:1.5; color:#2c3f56; }
.workflow-shell { margin-top:22px; border:1px solid #d6dde5; border-radius:14px; padding:16px; background:#0d1726; color:#d9ecff; }
.workflow-title { margin:0 0 10px; font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:#9fc5f8; }
@media (max-width: 900px) { .mc-grid { grid-template-columns:1fr; } }
</style>

<div class="mc-grid">
${cards_html}
</div>

<div class="workflow-shell">
  <div class="workflow-title">Workflow Map (Game-Inspired Ops Loop)</div>
  <pre class="mermaid">${diagram}</pre>
</div>
EOF

echo "Wrote ${out_file}"
