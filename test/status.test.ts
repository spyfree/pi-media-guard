import assert from "node:assert/strict";
import test from "node:test";
import type { GuardReport } from "../src/domain.js";
import { formatMediaFooterStatus, formatMediaStatus } from "../src/status.js";

const report: GuardReport = {
  mode: "protect",
  pressure: "red",
  currentPressure: "yellow",
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

test("media status distinguishes input pressure from the current projected request", () => {
  assert.equal(
    formatMediaStatus(report),
    [
      "Media Guard: near limit now (protect)",
      "Profile: openai-codex",
      "Input: over limit (red) — 4 images, 6.26 MiB serialized",
      "Current: near limit (yellow) — 4/4 images kept, 1.53 MiB / 2.00 MiB",
      "Processing: compressed 4, externalized 0, deduplicated 0",
    ].join("\n"),
  );
});

test("footer status summarizes current safety, image count, actions, and prior pressure", () => {
  assert.equal(
    formatMediaFooterStatus(report),
    "media near limit now · 4/4 images kept · 1.5M/2.0M · 4 compressed · input over limit",
  );
});
