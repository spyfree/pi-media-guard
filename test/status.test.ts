import assert from "node:assert/strict";
import test from "node:test";
import type { GuardReport } from "../src/domain.js";
import { formatMediaStatus } from "../src/status.js";

const report: GuardReport = {
  mode: "protect",
  pressure: "red",
  budget: {
    maxMediaBlocks: 8,
    maxSerializedMediaBytes: 2_097_152,
    maxDecodedMediaBytes: 1_572_864,
    maxSerializedBytesPerImage: 524_288,
  },
  budgetProfile: "openai-codex",
  before: { blocks: 4, serializedBytes: 6_567_972, decodedBytes: 4_925_977 },
  after: { blocks: 4, serializedBytes: 1_600_000, decodedBytes: 1_200_000 },
  kept: 4,
  compressed: 4,
  externalized: 0,
  externalizedCurrent: 0,
  deduplicated: 0,
};

test("media status explains the resolved profile and projection actions", () => {
  assert.equal(
    formatMediaStatus(report),
    [
      "Media Guard: red (protect)",
      "Profile: openai-codex",
      "Before: 4 blocks, 6.26 MiB serialized",
      "After: 4 blocks, 1.53 MiB / 2.00 MiB",
      "Last projection: compressed 4, externalized 0, deduplicated 0",
    ].join("\n"),
  );
});
