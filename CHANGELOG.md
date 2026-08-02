# Changelog

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
