# Budget configuration

Phase 0 supports declarative media budgets at two locations:

```text
~/.pi/agent/pi-media-guard.json
<project>/.pi/pi-media-guard.json
```

The project file is read only when Pi reports the project as trusted.

## Schema

```json
{
  "version": 1,
  "enabled": true,
  "mode": "protect",
  "budget": {
    "maxMediaBlocks": 8,
    "maxSerializedMediaBytes": 2097152,
    "maxDecodedMediaBytes": 1572864,
    "maxSerializedBytesPerImage": 524288
  },
  "profiles": {
    "amazon-bedrock": {
      "maxMediaBlocks": 12,
      "maxSerializedMediaBytes": 12582912,
      "maxDecodedMediaBytes": 9437184,
      "maxSerializedBytesPerImage": 2097152
    },
    "company-private-gateway": {
      "maxSerializedMediaBytes": 6291456
    }
  }
}
```

Every budget field is optional and is measured in bytes except `maxMediaBlocks`. Values must be non-negative safe integers. A value of zero deliberately permits no media for that dimension.

`mode` is `observe`, `optimize`, or `protect`. Setting `enabled` to `false` selects non-transforming observe behavior.

Profile names match Pi's exact `ctx.model.provider` value. They are open-ended: users can declare private gateways and providers unknown to pi-media-guard.

## Precedence

From lowest to highest:

1. conservative built-in default;
2. built-in provider profile;
3. global top-level budget;
4. global provider profile;
5. project top-level budget;
6. project provider profile;
7. an explicit runtime/request override supplied by the extension adapter.

Within one file, a provider profile is more specific than the top-level `budget` and therefore overrides it for the fields the profile declares. The top-level `budget` acts as that scope's default for providers without a matching profile. Across scopes, project declarations override global declarations, and fields merge rather than replace: a project profile that sets only `maxSerializedMediaBytes` inherits every other field from the layers below.

> Changed in 0.1.0-alpha.2: earlier alphas resolved the top-level `budget` *above* provider profiles in the same file, which silently disabled profile fields that the budget also declared. A config that pairs a conservative default `budget` with a wider provider profile now behaves as written.

## Failure behavior

Parsing is strict. Unknown fields, unsupported versions, negative/fractional values, and invalid profile values reject that file layer. A rejected project file does not disable protection or erase a valid global layer. Diagnostics contain no media or Base64 data.

Provider limit probing is not performed. Provider metadata selects a profile; declared configuration controls the policy.

## Overflow behavior

The extension applies the resolved budget in Pi's `context` event before every model call. Rejected image leaves are replaced in the request-only projection with a deterministic text Evidence Note. The stored session JSONL is not modified.

Historical overflow uses a `Historical image externalized` note. If the current working set itself cannot fit, it uses a `Current image externalized` note and emits a UI warning. Existing text in the same user/tool-result message—such as an artifact path—is preserved. The default note does not invent a semantic image description; it records MIME type, byte size, hash, reason, and a re-read instruction. Semantic descriptions remain an optional future describer.
