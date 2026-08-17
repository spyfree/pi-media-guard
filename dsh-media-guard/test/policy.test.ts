import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMediaLedger } from "../src/ledger.js";
import { base64BytesForBinary } from "../src/media-bytes.js";
import { DEFAULT_MEDIA_BUDGET, planMediaBudget, resolveMediaBudget } from "../src/policy.js";
import { decodedFor, image, ref, user } from "./helpers.js";

test("without provider or overrides the default budget applies", () => {
  const resolved = resolveMediaBudget({});
  assert.deepEqual(resolved.budget, DEFAULT_MEDIA_BUDGET);
  assert.equal(resolved.profile, "default");
});

test("a configured profile overrides the default for its fields only", () => {
  const resolved = resolveMediaBudget({
    provider: "my-gateway",
    profiles: { "my-gateway": { maxSerializedMediaBytes: 8_000_000 } },
  });
  assert.equal(resolved.budget.maxSerializedMediaBytes, 8_000_000);
  assert.equal(resolved.budget.maxMediaBlocks, DEFAULT_MEDIA_BUDGET.maxMediaBlocks);
  assert.equal(resolved.profile, "my-gateway");
});

test("an explicit budget override outranks the provider profile", () => {
  const resolved = resolveMediaBudget({
    provider: "my-gateway",
    profiles: { "my-gateway": { maxSerializedMediaBytes: 8_000_000 } },
    budget: { maxSerializedMediaBytes: 1_000_000 },
  });
  assert.equal(resolved.budget.maxSerializedMediaBytes, 1_000_000);
});

test("an unknown provider keeps the default budget and profile name", () => {
  const resolved = resolveMediaBudget({ provider: "never-seen" });
  assert.deepEqual(resolved.budget, DEFAULT_MEDIA_BUDGET);
  assert.equal(resolved.profile, "default");
});

test("duplicates are externalized as duplicates, keeping the higher-priority copy", () => {
  const duplicated = ref(30_000, "twin");
  const messages = [user(image(duplicated)), user(image(duplicated))];
  const plan = planMediaBudget(buildMediaLedger(messages), DEFAULT_MEDIA_BUDGET);
  assert.deepEqual(
    plan.decisions.map((decision) => decision.action),
    ["externalize", "keep"],
  );
  assert.equal(plan.decisions[0]?.reason, "duplicate");
});

test("a single image over the per-image ceiling is rejected as per-image", () => {
  const oversized = ref(decodedFor(600_000), "big");
  const plan = planMediaBudget(buildMediaLedger([user(image(oversized))]), DEFAULT_MEDIA_BUDGET);
  assert.equal(plan.decisions[0]?.action, "externalize");
  assert.equal(plan.decisions[0]?.reason, "per-image-budget");
});

test("aggregate ceilings keep the highest-priority images that still fit", () => {
  const budget = {
    maxMediaBlocks: 2,
    maxSerializedMediaBytes: 10_000_000,
    maxDecodedMediaBytes: 10_000_000,
    maxSerializedBytesPerImage: 10_000_000,
  };
  const messages = [
    user(image(ref(1_000, "one"))),
    user(image(ref(1_000, "two"))),
    user(image(ref(1_000, "three"))),
  ];
  const plan = planMediaBudget(buildMediaLedger(messages), budget);
  // The current-turn image (last user message) and the newest historical one fit.
  assert.deepEqual(
    plan.decisions.map((decision) => decision.action),
    ["externalize", "keep", "keep"],
  );
  assert.equal(plan.decisions[0]?.reason, "aggregate-budget");
});

test("zero budgets reject every image", () => {
  const budget = {
    maxMediaBlocks: 0,
    maxSerializedMediaBytes: 0,
    maxDecodedMediaBytes: 0,
    maxSerializedBytesPerImage: 0,
  };
  const plan = planMediaBudget(buildMediaLedger([user(image(ref(1, "tiny")))]), budget);
  assert.equal(plan.decisions[0]?.action, "externalize");
});

test("pressure grades utilization of the tightest dimension", () => {
  const greenPlan = planMediaBudget(
    buildMediaLedger([user(image(ref(1_000, "small")))]),
    DEFAULT_MEDIA_BUDGET,
  );
  assert.equal(greenPlan.pressure, "green");
  const yellowPlan = planMediaBudget(
    buildMediaLedger([user(image(ref(decodedFor(400_000), "medium")))]),
    DEFAULT_MEDIA_BUDGET,
  );
  assert.equal(yellowPlan.pressure, "yellow");
  const redPlan = planMediaBudget(
    buildMediaLedger([user(image(ref(decodedFor(600_000), "large")))]),
    DEFAULT_MEDIA_BUDGET,
  );
  assert.equal(redPlan.pressure, "red");
  assert.equal(base64BytesForBinary(decodedFor(600_000)), 600_000);
});
