# GTM + Clarity Tracking Spec

## GTM events required
Per page slug, collect:
- `sessions`
- `cta_book_clicks`
- `cta_quote_clicks`
- `quote_starts`
- `book_starts`
- `form_submits`

Store export JSON at:
`data/analytics/gtm_metrics.json`

## Clarity metrics required
Per page slug, collect CSV columns:
- `slug`
- `rage_click_rate`
- `dead_click_rate`
- `quick_back_rate`
- `avg_scroll_depth`
- `session_recordings`

Store export CSV at:
`data/analytics/clarity_metrics.csv`

## Safe optimization policy
Allowed edit fields:
- `seo_title`, `meta_description`, `h1`, `executive_summary`
- `intro`, `problem_section`, `solution_section`, `proof_section`
- `comparison_table_markdown`, `faq`, `llm_answer_snippets`, `visual_cards`

Blocked edit fields:
- layout structure, CSS, fonts, spacing system, Webflow interactions, component hierarchy
