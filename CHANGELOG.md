# Changelog

## 0.1.0-beta.1

- **Breaking (config):** `enabled: false` now bypasses the guard entirely — no
  media ledger, no hashing, no projection, and the footer shows
  `media guard off`. It previously behaved like `mode: "observe"`, which still
  paid the full inventory cost on every request. Use `mode: "observe"` for
  non-transforming reporting.
- **Breaking (API):** `GuardResult` gains a required `decisions` field with
  the per-image budget decisions; `MediaLedgerItem.kind` narrows to `"image"`
  (the unimplemented `"document"` variant is removed); `resolveGuardMode` no
  longer consults `enabled` (use the new `resolveGuardEnabled`).
- Add `/media ledger`: a per-image breakdown of the last projection — hash,
  size, origin, current/history scope, and keep/externalize decision with its
  reason — answering "why did my image disappear" without guesswork.
- Cache image hashing across requests and ledger rebuilds. The ledger is built
  up to three times per request and session images are re-sent on every model
  call; a bounded content-keyed memo removes the repeated SHA-256 work.
- Bound each image's compression attempt with a timeout (default 10 s,
  `compressionTimeoutMs` in `createMediaGuard`). A hung or slow codec can no
  longer stall the request; the image falls through to externalization.
- Harden the emergency path: when the primary projection throws, the extension
  now falls back to a structural image-strip that does no hashing or budget
  math, so the failure cannot recur inside the fallback itself.
- Route final-payload audits through a provider adapter registry
  (`PROVIDER_PAYLOAD_ADAPTERS`); adding a provider no longer touches the
  extension wiring.
- Extend the property suite through the compression path with a deterministic
  codec, and cover cache eviction (entry and byte bounds), compression
  timeouts, config-reload effectiveness, and the emergency fallback.
- Add Biome linting/formatting (`npm run lint`), a Node 20/22/24 CI matrix, a
  packed-tarball smoke test that imports both entry points, a tag-driven
  release workflow publishing to npm with provenance, and an `engines` field
  (Node >= 20).
- Deduplicate `formatMiB` and Base64 byte accounting into a shared module.

## 0.1.0-alpha.2

- **Breaking (config):** provider profiles now override the top-level `budget`
  declared in the same file. Earlier alphas resolved the top-level `budget`
  above same-file provider profiles, which silently disabled profile fields the
  budget also declared — the README example itself resolved to the conservative
  default on Amazon Bedrock instead of the wider profile it declared. Cross-scope
  precedence is unchanged: project declarations still override global ones.
- Fix the compression fair-share target: divide the aggregate budget by the
  images that can actually be kept (unique hashes capped at `maxMediaBlocks`)
  instead of the full session ledger. Previously the per-image target shrank as
  history and duplicates accumulated, degrading current-turn image quality even
  though the planner keeps at most `maxMediaBlocks` images.
- Remove the `pi install git:...` instructions. Pi installs git packages with
  `git clone` plus `npm install --omit=dev`, which never runs the TypeScript
  build, so the compiled `dist/extension.js` entry point was missing. Install
  from npm or a local checkout instead.
- Evidence Notes now carry a `Source:` line recording where the image entered
  the session (the originating tool call with its arguments, or the user
  message), making the re-read instruction actionable. `MediaLedgerItem` gains
  a required `origin` field.
- Harden the OpenAI Codex final payload guard: the emergency projection now
  tolerates cyclic and shared references, and the audit counts only structural
  `input_image` blocks — the shapes the projection can rewrite — so a data URL
  pasted into ordinary text can no longer raise an unfixable budget error.
- Add `/media reload` to re-read global and project configuration mid-session.
- Declare supported Pi peer versions (`>=0.83.0 <1.0.0`) instead of `*`.
- Add extension wiring tests covering projection, status, warning
  deduplication, payload surgery, `/media`, and shutdown cleanup.

## 0.1.0-alpha.1

- Add deterministic Media Ledger and aggregate media budgeting.
- Add provider profiles plus strict global and trusted-project configuration.
- Add request-only compression and Evidence Note externalization.
- Add Pi Photon codec with bounded in-memory LRU cache.
- Add `observe`, `optimize`, and `protect` modes.
- Add `/media status` and footer status.
- Add OpenAI Codex/Responses final payload audit.
- Add anonymous 6.57 MB four-image regression and invariant property tests.
