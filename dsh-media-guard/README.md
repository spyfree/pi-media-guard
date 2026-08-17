# dsh-media-guard

Deterministic aggregate media budgets and safe request projections for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

`dsh-media-guard` keeps multimodal sessions usable when individually valid images become unsafe in aggregate. DSH admits images per message, then re-sends every historical image on every model call with no aggregate ceiling, no compression, and no image-capable compaction — so multi-turn image sessions accumulate until the provider rejects the request. Before every agent-loop model call this plugin inventories the request's image attachment references, deduplicates them by content address, and replaces media that cannot fit the budget with factual text Evidence Notes. The durable session log and attachment store are never modified.

This is the DSH port of [pi-media-guard](https://github.com/spyfree/pi-media-guard); the planner, fair-share math, evidence notes, and failure policy are shared line for line where the hosts allow.

> **Alpha:** this line implements the ledger, planner, budget-driven externalization, and the `llm/stream` projection. The sharp-backed compression codec, report UI, and marketplace listing are next (see [DESIGN.md](DESIGN.md)). Validated against `@deepseek-ai/dsh-*` 0.1.0-rc.6 — DSH itself is a developer preview and its APIs may still move.

## How it works

- Registers on the `llm/stream` waterfall and acts **only on agent-loop-built requests** (`isAgentLoopRequest`). Hand-built calls — vision bridges' VLM traffic, compaction, replay — pass through untouched, and so does the plugin's own projected re-dispatch, which terminates recursion.
- Accounting is **zero-byte-cost**: DSH image blocks carry content-addressed attachment references (`sha256:…`) with exact byte sizes and dimensions, so the ledger, dedup, and budget math never read image data.
- When the projection changes anything, a fresh request is dispatched via `ctx.llm.stream(...)` — the frozen loop-built request and the stored session are untouched; only the provider-bound view changes.
- If the projection itself fails, an intentionally simpler emergency path strips every image leaf. The guard never silently falls back to sending the oversized original.

## Install

```bash
dsh plugin --profile <name> add dsh-media-guard
```

Restart the profile afterwards. The bundle inserts a `media-guard` row; no configuration is required for the defaults.

Installing straight from a git host (`dsh plugin --profile <name> add github:spyfree/dsh-media-guard`) builds `dist/` via the package's self-contained `prepare` script; pnpm ≥ 10 will ask you to allowlist that build in the profile's `pnpm-workspace.yaml` on first install, exactly as DSH's packaging guide describes.

## Default behavior

- Runs in `protect` mode before every agent-loop provider request.
- Applies a conservative default budget: 8 media blocks, 2 MiB serialized (Base64) / 1.5 MiB decoded aggregate, 512 KiB serialized per image.
- Preserves current-turn media before older media; user media before tool media.
- Deduplicates identical images by their content address; later copies become duplicate notes.
- Replaces overflow media leaves with deterministic Evidence Notes (hash, size, dimensions, origin, reason — no invented descriptions, no directives).
- Preserves message count, order, roles, ids, sources, and tool-call/result pairing.
- Emits a `media-guard/report` event after each guarded call; never logs or emits image bytes.

The default budget is a safety policy, not a claim about any provider's maximum body size. Raise it per provider route with a `profiles` entry when your provider allows more.

## Configuration

Override the plugin row from your profile's `cordis.patch.yml` with a flat
patch entry targeting the row id (the same form DSH's own bundles use):

```yaml
- id: media-guard
  config:
    mode: protect            # observe | optimize | protect
    log: false               # true prints a one-line summary per projection
    budget:
      maxMediaBlocks: 8
      maxSerializedMediaBytes: 2097152
      maxDecodedMediaBytes: 1572864
      maxSerializedBytesPerImage: 524288
    profiles:                # keyed by the request's provider route id
      my-vision-gateway:
        maxSerializedMediaBytes: 12582912
        maxDecodedMediaBytes: 9437184
```

A `profiles` entry is more specific than the top-level `budget`, so for the
fields it declares it wins on its route even when both are set.

Modes:

- `observe`: inventory and report only;
- `optimize`: compress but do not externalize (equivalent to `observe` until a codec ships);
- `protect`: compress, then externalize overflow media (default).

`enabled: false` bypasses the guard entirely. Every config field is validated individually; an invalid value falls back to its protective default and is reported — a broken config can never widen a budget or switch the guard off.

Unlike the Pi original there are no built-in provider profiles: DSH provider routes are deployment-defined, so every route gets the conservative default until you declare a profile for it.

## Anonymous regression

The test suite reproduces the original four-image failure distribution:

```text
1.82 MB + 0.74 MB + 1.21 MB + 2.80 MB = 6,567,972 Base64 bytes
```

Without a codec, `protect` brings the request under the default 2 MiB aggregate budget deterministically. With a deterministic codec, all four visual inputs remain available at 1,600,000 serialized bytes.

## Development

Requires Node.js 22.19 or newer, matching DSH's own engines requirement.

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
```

## Security and privacy

Plugins run with the user's full local permissions. Review code before installation. The plugin reads no image bytes, sends no telemetry, and never logs attachment contents, payloads, or credentials — reports and diagnostics carry metadata only.

## License

MIT
