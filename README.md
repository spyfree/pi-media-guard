# pi-media-guard

Deterministic aggregate media budgets and safe request projections for [Pi](https://github.com/earendil-works/pi-mono).

`pi-media-guard` keeps multimodal sessions usable when individually valid images become unsafe in aggregate. Before every model call it inventories canonical Pi image blocks, deduplicates them, constrains oversized images with Pi's Photon codec, and replaces media that still cannot fit with factual text Evidence Notes. Stored session JSONL is not modified.

> **Beta:** This release implements the canonical image guard and the OpenAI Codex final-payload audit. Provider payload surgery for other providers, media-safe compaction, PDF workflows, and semantic vision descriptions are not included yet.

## Install

From npm (recommended):

```bash
pi install npm:pi-media-guard
```

From a local checkout:

```bash
npm install
npm run build
pi install /absolute/path/to/pi-media-guard
```

> **Do not use `pi install git:...` for this package.** Pi installs git packages by cloning the repository and running `npm install --omit=dev`, which never runs the TypeScript build. Because `dist/` is not committed to git, the extension entry point `dist/extension.js` would be missing and the extension would fail to load. The npm tarball ships prebuilt `dist/`, and the local-checkout flow builds it explicitly.

Restart Pi after installation. The footer summarizes current request safety, images kept, media size, and processing actions while distinguishing the original input pressure. Use `/media` or `/media status` after the first model request for the full before/current breakdown, and `/media ledger` for per-image decisions (what was kept, compressed, externalized, and why).

## Default behavior

- Runs in `protect` mode before every provider request.
- Uses provider-aware, user-overridable aggregate media budgets.
- Preserves current-turn media before older media.
- Compresses images to a dynamic fair-share target.
- Replaces remaining overflow media leaves with deterministic Evidence Notes.
- Preserves message order, roles, thinking/signatures, and tool call/result IDs.
- Does not modify persistent session JSONL or send telemetry.

The default/OpenAI Codex serialized-media budget is 2 MiB. This is a safety policy, not a claim about the provider's maximum HTTP body size. Provider caps differ widely (per image, per request, and per API path), so the built-in profiles stay deliberately conservative and leave headroom for text, tools, and JSON framing; raise them per provider with a `profiles` entry when your provider allows more.

## Configuration

Global:

```text
~/.pi/agent/pi-media-guard.json
```

Trusted project override:

```text
.pi/pi-media-guard.json
```

Both files are read at session start. After editing one, run `/media reload` to apply it to the current session.

Example:

```json
{
  "version": 1,
  "mode": "protect",
  "budget": {
    "maxMediaBlocks": 8,
    "maxSerializedMediaBytes": 2097152,
    "maxDecodedMediaBytes": 1572864,
    "maxSerializedBytesPerImage": 524288
  },
  "profiles": {
    "amazon-bedrock": {
      "maxSerializedMediaBytes": 12582912,
      "maxDecodedMediaBytes": 9437184
    }
  }
}
```

The top-level `budget` is the default for providers without a matching profile. A provider profile is more specific and overrides the top-level `budget` for the fields it declares: with the config above, `amazon-bedrock` requests get the wider 12 MiB serialized budget while every other provider keeps 2 MiB.

Modes:

- `observe`: inventory and report only;
- `optimize`: compress but do not externalize;
- `protect`: compress, then externalize overflow media.

Setting `enabled: false` bypasses the guard entirely — no inventory, no hashing, no projection. Use `mode: "observe"` if you want reporting without transformation.

See [docs/configuration.md](docs/configuration.md) for precedence and validation rules.

## Anonymous regression

The test suite reproduces the original four-image failure distribution:

```text
1.82 MB + 0.74 MB + 1.21 MB + 2.80 MB = 6,567,972 Base64 bytes
```

With a deterministic codec, all four visual inputs remain available at 1,600,000 serialized bytes, below the default 2 MiB aggregate budget.

## Development

Requires Node.js 22.19 or newer, matching Pi's own engines requirement.

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Releasing

Releases are version-driven: bump `version` in `package.json` and merge to `main`. The release workflow tags that version (if `v<version>` does not exist yet), runs lint/typecheck/tests, and publishes to npm with [provenance](https://docs.npmjs.com/generating-provenance-statements). Pushing a matching `v*` tag directly or running the workflow manually are equivalent entry points. The repository needs an `NPM_TOKEN` secret with publish rights (or npm Trusted Publishing configured for this workflow).

## Security and privacy

Extensions run with the user's full local permissions. Review code before installation. The extension does not log Base64 media, complete payloads, credentials, or image contents. See [SECURITY.md](SECURITY.md).

## License

MIT
