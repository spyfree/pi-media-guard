import assert from "node:assert/strict";
import test from "node:test";
import type { MediaBudget, MediaLedgerItem } from "../src/domain.js";
import { planMediaBudget } from "../src/policy.js";

const budget: MediaBudget = {
  maxMediaBlocks: 2,
  maxSerializedMediaBytes: 200,
  maxDecodedMediaBytes: 150,
  maxSerializedBytesPerImage: 150,
};

function item(overrides: Partial<MediaLedgerItem>): MediaLedgerItem {
  return {
    messageIndex: 0,
    contentIndex: 0,
    kind: "image",
    mimeType: "image/png",
    hash: "sha256:default",
    serializedBytes: 100,
    decodedBytes: 75,
    age: 10,
    currentWorkingSet: false,
    priority: 400,
    ...overrides,
  };
}

test("budget plan externalizes an image that exceeds the per-image limit", () => {
  const oversized = item({ serializedBytes: 151, decodedBytes: 100 });

  const plan = planMediaBudget([oversized], budget);

  assert.equal(plan.decisions[0]?.action, "externalize");
  assert.equal(plan.decisions[0]?.reason, "per-image-budget");
});

test("budget plan keeps only the highest-priority copy of duplicate media", () => {
  const oldCopy = item({ hash: "sha256:same", messageIndex: 0, priority: 400, age: 2 });
  const currentCopy = item({ hash: "sha256:same", messageIndex: 1, priority: 600, age: 0 });

  const plan = planMediaBudget([oldCopy, currentCopy], budget);

  assert.deepEqual(
    plan.decisions.map(({ action, reason }) => ({ action, reason })),
    [
      { action: "externalize", reason: "duplicate" },
      { action: "keep", reason: undefined },
    ],
  );
});

test("budget plan keeps current media before older media when aggregate capacity is exhausted", () => {
  const historical = item({ hash: "sha256:old", messageIndex: 0, priority: 400, age: 2 });
  const current = item({ hash: "sha256:new", messageIndex: 1, priority: 600, age: 0 });
  const overflow = item({ hash: "sha256:older", messageIndex: 2, priority: 400, age: 3 });

  const plan = planMediaBudget([historical, current, overflow], budget);

  assert.equal(plan.pressure, "red");
  assert.deepEqual(
    plan.decisions.map(({ item: media, action, reason }) => ({ hash: media.hash, action, reason })),
    [
      { hash: "sha256:old", action: "keep", reason: undefined },
      { hash: "sha256:new", action: "keep", reason: undefined },
      { hash: "sha256:older", action: "externalize", reason: "aggregate-budget" },
    ],
  );
});
