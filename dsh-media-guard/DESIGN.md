# dsh-media-guard design

Source-verified design notes for porting pi-media-guard's aggregate media
budgets to DeepSeek Harness. The full ecosystem research (competitors,
distribution channels, claim-by-claim verification against the DSH source)
lives in [docs/research/dsh-plugin-ecosystem.md](docs/research/dsh-plugin-ecosystem.md);
this file records the decisions the code implements. DSH references are
against `deepseek-ai/deepseek-harness` @ 47f94385 (0.1.0-rc, 2026-08-13).

## 1. The problem in DSH terms

- Admission is per message only: `ImageAttachmentLimits` caps bytes/pixels
  per image and images/bytes per submitted message
  (`packages/attachment/attachment-local/src/index.ts`), and rejection is the
  only enforcement — nothing compresses.
- Every historical image re-enters every request: the loop sends the full
  derived history, and the pi-ai adapter's `toPiContextWithImages`
  (`packages/llm/llm-pi-ai/src/context.ts:143`) re-reads and re-encodes each
  image attachment per call, with no cache and no eviction.
- The escape hatches are image-blind: compaction throws on image content and
  the spill seam is text-only.

So a multi-turn session accumulates media until the provider rejects the
request, and nothing in core or the plugin ecosystem sheds that weight.

## 2. Hook choice: `llm/stream` short-circuit, no upstream PR

The `llm/stream` waterfall receives the full `GenerateOptions` before the
adapter resolves attachment bytes. Loop-built requests arrive deep-frozen and
carry a process-local identity (`isAgentLoopRequest`); listeners must not
rewrite them. The guard therefore:

1. acts only when `isAgentLoopRequest(options)` is true;
2. computes a projection over the messages (never mutating them);
3. when anything changed, **short-circuits by dispatching a fresh projected
   request** through `ctx.llm.stream(...)` — the same pattern DSH's own
   `dsh-llm-replay` test middleware uses to answer requests without reaching
   the adapter.

The projected request is hand-built, so on re-entry the listener passes it
straight through: recursion terminates structurally, not by flags. Acting
only on loop requests also keeps the guard out of other plugins' internal
calls (vision bridges' VLM traffic, compaction summaries, replay fixtures).

Two honest caveats, tracked for the M2 milestone:

- the `llm/stream` doc comment says listeners "read it, never rewrite it"
  (reconstructability). A short-circuit dispatch does not rewrite the frozen
  request, but a sanctioned projection seam upstream (in the adapter
  conversion or `buildRequest`) would be architecture-consistent — worth a
  PR once the plugin has usage evidence;
- a re-dispatched request loses `PreparedLlmCall` binding and re-runs
  earlier waterfall listeners; the coexistence matrix with popular
  vision-bridge plugins needs explicit testing.

## 3. Zero-byte accounting

DSH image blocks are `{ type: "image", attachment: ImageAttachmentRef }`
where the ref carries `attachmentId` (`sha256:<hex>` content address),
`bytes`, `width`, `height`, `mediaType`. Consequences the code leans on:

- identity is free: `hash = ref.attachmentId` — no reading, no digesting
  (the Pi original had to decode and hash Base64 payloads);
- sizes are free: `decodedBytes = ref.bytes`,
  `serializedBytes = 4 * ceil(bytes / 3)` (what a Base64-embedding adapter
  will spend);
- the whole observe/plan path allocates nothing per byte of media.

## 4. What is ported unchanged from pi-media-guard

- the planner: priority ranking (current-turn user 700 → historical other
  300), dedup by hash keeping the first-ranked copy, per-image then
  aggregate ceilings, deterministic reasons (`duplicate`,
  `per-image-budget`, `aggregate-budget`);
- fair-share compression targets divided by keepable **unique** images
  (min(unique, maxMediaBlocks)), duplicates compressed too so dedup keeps
  collapsing, bounded concurrency 2, 10 s per-image timeout;
- evidence notes: factual fields only, no invented descriptions, no
  operative directives;
- the failure policy: projection failure → strip all image leaves via a
  deliberately simpler second path; a second failure passes the request
  through as the lesser evil; never silently send the oversized original;
- modes observe/optimize/protect; per-field strict config that degrades
  toward defaults, never toward "off";
- the four-image regression fixture (6,567,972 Base64 bytes) and the
  property-test invariants.

## 5. What is intentionally different

- **No built-in provider profiles.** DSH provider routes are
  deployment-defined strings; shipping a table of guessed names would be
  wrong the day it lands. The default budget applies until the user declares
  `profiles.<route-id>`.
- **The codec returns refs, not bytes.** `ImageCodec.constrain(ref, target)`
  → new `ImageAttachmentRef`. The M1 implementation will wrap
  `ctx.attachments` (readImage → sharp → saveImage), caching variants by the
  original's content address; the pipeline stays byte-free either way. sharp
  must be this package's own dependency — core's copy belongs to
  `dsh-attachment-local` and pnpm does not expose it to plugins.
- **Reporting is an event, not a UI.** `media-guard/report` carries the full
  `GuardReport`; a `/media`-style surface can subscribe later without
  touching the guard.
- **Message rebuilding is path-aware.** DSH nests images inside tool-result
  blocks (recursively, per `contentHasImage`), so ledger locations are index
  paths and rebuilds preserve tool-result structure; changed messages are
  re-frozen with their identity kept (`freezeMessage({ ...message, content })`).

## 6. Milestones

- **M0 (this line):** ledger, planner, evidence notes, config,
  `llm/stream` wiring, emergency path; 53 tests including the regression
  and fast-check invariants. No codec.
- **M1:** sharp codec behind the ref interface (`ctx.attachments`
  integration, variant cache keyed by source content address), `optimize`
  becomes real, live-profile smoke test against a real DSH install.
- **M2:** upstream sanctioned-seam PR; vision-bridge coexistence matrix;
  optional DeepSeek-wire payload audit equivalent of the Pi Codex audit.
- **M3:** report surface (web UI or command), npm publish with provenance,
  `dsh-plugin` topic + awesome-dsh-plugin / marketplace listing (repo ≥ 1
  day old, ≥ 10 commits, bundle manifest — all satisfied by then).

## 7. Compatibility risk

DSH is a 0.1.0-rc developer preview and announces breaking changes. The
whole host contact surface is: `Context.on/emit`, `ctx.llm.stream`,
`isAgentLoopRequest`, `freezeMessage`, the `Message`/`ContentBlock` shapes,
and `ImageAttachmentRef` — one adapter file's worth. Peer ranges pin to the
verified rc line; widening them is a release decision, not a default.
