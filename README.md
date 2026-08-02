# pi-media-guard

Deterministic aggregate media budgets and safe request projections for [Pi](https://github.com/earendil-works/pi-mono).

`pi-media-guard` keeps multimodal sessions usable when individually valid images become unsafe in aggregate. Before every model call it inventories canonical Pi image blocks, deduplicates them, constrains oversized images with Pi's Photon codec, and replaces media that still cannot fit with factual text Evidence Notes. Stored session JSONL is not modified.

> **Alpha:** This release implements the canonical image guard and OpenAI Codex payload audit. Provider payload surgery, media-safe compaction, PDF workflows, and semantic vision descriptions are not included yet.

## Install

From a local checkout:

```bash
npm install
npm run build
pi install /absolute/path/to/pi-media-guard
```

From GitHub:

```bash
pi install git:github.com/spyfree/pi-media-guard@v0.1.0-alpha.1
```

From npm (recommended):

```bash
pi install npm:pi-media-guard@0.1.0-alpha.1
```

Restart Pi after installation. Use `/media` or `/media status` after the first model request.

## Default behavior

- Runs in `protect` mode before every provider request.
- Uses provider-aware, user-overridable aggregate media budgets.
- Preserves current-turn media before older media.
- Compresses images to a dynamic fair-share target.
- Replaces remaining overflow media leaves with deterministic Evidence Notes.
- Preserves message order, roles, thinking/signatures, and tool call/result IDs.
- Does not modify persistent session JSONL or send telemetry.

The default/OpenAI Codex serialized-media budget is 2 MiB. This is a safety policy, not a claim about the provider's maximum HTTP body size.

## Configuration

Global:

```text
~/.pi/agent/pi-media-guard.json
```

Trusted project override:

```text
.pi/pi-media-guard.json
```

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

Modes:

- `observe`: inventory and report only;
- `optimize`: compress but do not externalize;
- `protect`: compress, then externalize overflow media.

See [docs/configuration.md](docs/configuration.md) for precedence and validation rules.

## Anonymous regression

The test suite reproduces the original four-image failure distribution:

```text
1.82 MB + 0.74 MB + 1.21 MB + 2.80 MB = 6,567,972 Base64 bytes
```

With a deterministic codec, all four visual inputs remain available at 1,600,000 serialized bytes, below the default 2 MiB aggregate budget.

## Development

```bash
npm test
npm run typecheck
npm run build
```

## Security and privacy

Extensions run with the user's full local permissions. Review code before installation. The extension does not log Base64 media, complete payloads, credentials, or image contents. See [SECURITY.md](SECURITY.md).

## License

MIT
