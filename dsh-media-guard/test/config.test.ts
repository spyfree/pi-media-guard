import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveGuardConfig } from "../src/config.js";

test("absent config resolves to protective defaults", () => {
  const { config, diagnostics } = resolveGuardConfig(undefined);
  assert.equal(config.enabled, true);
  assert.equal(config.mode, "protect");
  assert.deepEqual(config.profiles, {});
  assert.deepEqual(diagnostics, []);
});

test("valid fields are accepted", () => {
  const { config, diagnostics } = resolveGuardConfig({
    mode: "observe",
    budget: { maxSerializedMediaBytes: 4_194_304 },
    profiles: { "my-route": { maxMediaBlocks: 12 } },
    compressionTimeoutMs: 0,
    log: true,
  });
  assert.deepEqual(diagnostics, []);
  assert.equal(config.mode, "observe");
  assert.deepEqual(config.budget, { maxSerializedMediaBytes: 4_194_304 });
  assert.deepEqual(config.profiles, { "my-route": { maxMediaBlocks: 12 } });
  assert.equal(config.compressionTimeoutMs, 0);
  assert.equal(config.log, true);
});

test("each invalid field falls back alone and never widens protection", () => {
  const { config, diagnostics } = resolveGuardConfig({
    mode: "yolo",
    enabled: "yes",
    budget: { maxSerializedMediaBytes: -1, maxMediaBlocks: 4, bogus: 1 },
    profiles: { good: { maxMediaBlocks: 2 }, bad: "nope" },
    unknownField: 1,
  });
  assert.equal(config.enabled, true);
  assert.equal(config.mode, "protect");
  assert.deepEqual(config.budget, { maxMediaBlocks: 4 });
  assert.deepEqual(config.profiles, { good: { maxMediaBlocks: 2 } });
  // mode, enabled, budget.maxSerializedMediaBytes, budget.bogus, profiles.bad, unknownField
  assert.equal(diagnostics.length, 6);
});

test("non-object config keeps full defaults with one diagnostic", () => {
  const { config, diagnostics } = resolveGuardConfig("wat");
  assert.equal(config.enabled, true);
  assert.equal(config.mode, "protect");
  assert.equal(diagnostics.length, 1);
});

test("prototype-polluting profile names are rejected", () => {
  const { config, diagnostics } = resolveGuardConfig({
    profiles: { __proto__: { maxMediaBlocks: 1 }, constructor: { maxMediaBlocks: 1 } },
  });
  assert.deepEqual(config.profiles, {});
  assert.ok(diagnostics.length >= 1);
});

test("fractional and negative budget values are rejected per field", () => {
  const { config } = resolveGuardConfig({
    budget: { maxMediaBlocks: 2.5, maxDecodedMediaBytes: 1_000_000 },
  });
  assert.deepEqual(config.budget, { maxDecodedMediaBytes: 1_000_000 });
});

test("explicit enabled:false is the only way to bypass", () => {
  assert.equal(resolveGuardConfig({ enabled: false }).config.enabled, false);
  assert.equal(resolveGuardConfig({ enabled: 0 }).config.enabled, true);
});
