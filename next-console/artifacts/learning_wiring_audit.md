# Learning Wiring Audit

**Date:** 2026-03-05
**Verdict:** DECORATIVE → HARDENED (after fixes applied)

## Problem Found

The learning system computed and stored 7 weight dimensions, but **none of them changed any output**:

1. `archetype_weights` — stored in learning_state.json, but `publish_next.js` never called `computeLearnedPriorityBoost()`. Publish ordering was 100% hub priority.
2. `faq_weights` — stored in learning_state.json, but `getArchetypeFaq()` in lane-archetypes.js used fixed modular offset rotation. Weights were ignored.
3. `title_pattern_weights` — stored, but only one title template exists. No pool to select from.
4. `meta_pattern_weights` — stored, but only one meta template exists. No pool to select from.
5. `cta_weights` — stored, but only one CTA per page. No variant pool.
6. `intro_pattern_weights` — stored, but one intro per archetype. No variant pool.
7. `link_pattern_weights` — stored, but link selection is deterministic by page relationships.

## Fixes Applied

### Active Dimensions (2 — actually wired)

| Dimension | Where Consumed | How |
|-----------|---------------|-----|
| `archetype_weights` | `publish_next.js` → `computeHubPriority()` | Adds 0-20 priority boost from learned archetype performance |
| `faq_weights` | `lane-archetypes.js` → `getArchetypeFaq()` | Uses `weightedDeterministicSelect` for FAQ pool selection when weights exist |

### Inactive Dimensions (5 — marked, not faked)

| Dimension | Reason | Status |
|-----------|--------|--------|
| `title_pattern_weights` | No title variant pool exists | Updater skips, state preserves for future |
| `meta_pattern_weights` | No meta variant pool exists | Updater skips, state preserves for future |
| `cta_weights` | No CTA variant pool exists | Updater skips, state preserves for future |
| `intro_pattern_weights` | No intro variant pool exists | Updater skips, state preserves for future |
| `link_pattern_weights` | Deterministic link selection | Updater skips, state preserves for future |

### Signal Confidence

Each postmortem now includes `signal_confidence`:
- `"high"` — has real GSC data (impressions > 0)
- `"medium"` — has GA4 data but no GSC
- `"low"` — internal signals only (publish success, AI score)

Only `high` and `medium` confidence signals drive weight changes. `low` confidence is logged but does not update weights.

### Hard Gate Immutability

8 immutable keys are defined in `learning-store.js`. If the learning updater ever sets one of these keys in learning state:
1. The key is deleted from state
2. A recommendation is written with `requires_human_approval: true`
3. The change is blocked

### Proof Scripts

- `scripts/prove_learning_influence.js` — Proves FAQ selection changes when weights change
- `scripts/prove_hard_gate_immutability.js` — Proves immutable keys cannot be set by learning
- `scripts/prove_publish_priority_learning.js` — Proves publish ordering changes when archetype weights change

## Constraints

- Learning is narrow: 2 active dimensions
- Learning is deterministic: same slug + same weights = same output
- Learning is safe: 8 immutable keys, all proven locked
- Learning is real: driven by GSC/GA4 external signals, not circular internal scores
- Learning is constrained: signal_confidence filter prevents garbage-in updates
