import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_MEDIA_PROFILES,
  DEFAULT_MEDIA_BUDGET,
  resolveMediaBudget,
} from "../src/policy.js";

test("budget resolution detects the Pi provider and applies user overrides last", () => {
  const resolved = resolveMediaBudget({
    provider: "amazon-bedrock",
    profiles: {
      "amazon-bedrock": { maxSerializedMediaBytes: 12 * 1024 * 1024 },
    },
    budget: { maxMediaBlocks: 6 },
  });

  assert.equal(resolved.profile, "amazon-bedrock");
  assert.equal(resolved.budget.maxSerializedMediaBytes, 12 * 1024 * 1024);
  assert.equal(resolved.budget.maxDecodedMediaBytes, BUILTIN_MEDIA_PROFILES["amazon-bedrock"]?.maxDecodedMediaBytes);
  assert.equal(resolved.budget.maxMediaBlocks, 6);
  assert.equal(resolved.budget.maxSerializedBytesPerImage, BUILTIN_MEDIA_PROFILES["amazon-bedrock"]?.maxSerializedBytesPerImage);
});

test("unknown providers retain the conservative default budget", () => {
  const resolved = resolveMediaBudget({ provider: "private-gateway" });

  assert.equal(resolved.profile, "default");
  assert.deepEqual(resolved.budget, DEFAULT_MEDIA_BUDGET);
});
