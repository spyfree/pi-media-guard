# Phase 0 implementation plan

## Verified local Pi API

- Installed Pi: `@earendil-works/pi-coding-agent` 0.83.0.
- Canonical request seam: `context`, whose `event.messages` is a deep-copied `AgentMessage[]`; returning `{ messages }` changes only the request view.
- Final payload seam: `before_provider_request`, whose payload is `unknown` and may be replaced. It is intentionally out of Phase 0.
- Current canonical image block is flat: `{ type: "image", data: string, mimeType: string }`.
- `AgentMessage` is exported by `@earendil-works/pi-agent-core`, not by the coding-agent root package; image/text block types come from `@earendil-works/pi-ai`. Those packages and coding-agent are therefore peer dependencies.
- Pi exports `resizeImage(inputBytes, mimeType, options)` from the coding-agent root. Codec integration is deferred to Phase 1.
- Session format v3 and `context` projection allow Phase 0 to avoid modifying JSONL.

## Confirmed test seams

1. `buildMediaLedger(messages)` — deterministic canonical-media inventory.
2. `planMediaBudget(ledger, budget)` — pure keep/externalize decisions.
3. `resolveMediaBudget(environment)` — deterministic provider profile and override resolution.
4. `MediaGuard.project(messages, environment)` — public behavior seam and invariant checks.

Tests observe returned values only; no internal collaborators are mocked.

## Vertical TDD slices

1. Inventory one canonical image: location, MIME, Base64 bytes, decoded bytes, SHA-256, age, and current-working-set classification.
2. Apply aggregate/count/per-image budgets with deterministic priority: current work first, then recency; duplicates are externalized.
3. Build a non-persistent Request Projection by replacing rejected image leaves with deterministic Evidence Notes while preserving message roles/order and tool/thinking structure.
4. Add the anonymous four-image regression distribution (1.82 + 0.74 + 1.21 + 2.80 MB Base64) and prove the projected media is at most 2 MiB with explicit reasons for every externalized image.
5. Resolve budgets in this order: conservative default → built-in provider profile → global declaration → trusted project declaration → per-request override.
6. Strictly parse and load `~/.pi/agent/pi-media-guard.json` and trusted `.pi/pi-media-guard.json`; reject only the invalid layer and retain protection.
7. Run typecheck, tests, and build.

## Budget profile policy

The profile is selected from Pi's exact `ctx.model.provider` identifier. Pi 0.83.0 uses `amazon-bedrock` for AWS Bedrock. Built-in values are deliberately safe media budgets rather than declarations of provider HTTP limits:

| Profile | Serialized media | Decoded media | Per image | Blocks |
|---|---:|---:|---:|---:|
| default / openai-codex | 2 MiB | 1.5 MiB | 512 KiB | 8 |
| openai | 4 MiB | 3 MiB | 1 MiB | 8 |
| anthropic | 4 MiB | 3 MiB | 1 MiB | 8 |
| amazon-bedrock | 8 MiB | 6 MiB | 1 MiB | 12 |

The Bedrock profile leaves substantial room for text, tool schemas, reasoning, JSON framing, SigV4 transport, proxies, and endpoint-specific limits. Users may override it, for example to 12 MiB, without changing the policy algorithm.

Automatic detection means selecting a profile from Pi's provider metadata. The extension must not discover limits by sending progressively larger probe requests: providers generally do not expose a reliable request-body capability endpoint, gateways can impose lower limits, and probing is costly and unsafe. Phase 1 final-payload auditing can make the effective media allowance smaller when the non-media payload is already large.

## Explicit Phase 0 exclusions

- Image recompression and Pi Photon codec
- Input/tool-result ingest optimization
- Provider payload adapters/audit
- Hash/codec caches and `/media` command UI
- Compaction, PDF workflow, describers, property tests, and publishing

These remain in Phases 1–4 from the design specification.
