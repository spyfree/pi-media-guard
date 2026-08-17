# Changelog

## 0.1.0-alpha.0 (unreleased)

Initial port of pi-media-guard to DeepSeek Harness.

- Zero-byte-cost media ledger over content-addressed attachment references,
  including images nested in tool-result blocks.
- Deterministic keep/externalize planner with dedup, per-image and aggregate
  ceilings, and current-turn-first priorities.
- Evidence Notes for externalized media: factual fields only.
- `llm/stream` waterfall wiring: agent-loop requests only, projected
  re-dispatch, structural recursion termination, emergency image-strip on
  projection failure.
- observe/optimize/protect modes; per-field strict config with protective
  fallback; per-provider-route budget profiles.
- `media-guard/report` event after each guarded call.
- 53 tests: unit suites, the four-image 6,567,972-byte aggregate regression,
  and fast-check property invariants.
- No compression codec yet: without one the guard deduplicates and
  externalizes deterministically; the sharp-backed codec is the next
  milestone.
