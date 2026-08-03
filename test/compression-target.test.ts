import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { EncodedImage, ImageCodec, ImageTarget, MediaImage } from "../src/domain.js";
import { createMediaGuard } from "../src/media-guard.js";
import { DEFAULT_MEDIA_BUDGET } from "../src/policy.js";

class RecordingCodec implements ImageCodec {
  readonly targets: number[] = [];

  async constrain(_image: MediaImage, target: ImageTarget): Promise<EncodedImage> {
    this.targets.push(target.maxSerializedBytes);
    return { data: "QUJDRA==", mimeType: "image/jpeg", width: 10, height: 10 };
  }
}

function userMessageWithImages(images: string[]): AgentMessage[] {
  return [
    {
      role: "user",
      content: images.map((data) => ({ type: "image", data, mimeType: "image/png" })),
      timestamp: 1,
    },
  ];
}

// With maxMediaBlocks 8, the planner keeps at most 8 images, so the fair
// share divides the aggregate budget by 8 even when history holds 17 images.
test("fair-share target divides by keepable images, not full session history", async () => {
  const letters = "BCDEFGHIJKLMNOPQR";
  const images = [...letters].map((letter) => letter.repeat(600_000));
  const codec = new RecordingCodec();

  await createMediaGuard({ codec }).project(userMessageWithImages(images), {
    budget: DEFAULT_MEDIA_BUDGET,
  });

  const expectedTarget = Math.floor(DEFAULT_MEDIA_BUDGET.maxSerializedMediaBytes / 8);
  assert.equal(codec.targets.length, letters.length);
  assert.ok(codec.targets.every((target) => target === expectedTarget));
});

test("duplicate copies of one image do not shrink the fair-share target", async () => {
  const images = Array.from({ length: 10 }, () => "B".repeat(600_000));
  const codec = new RecordingCodec();

  const result = await createMediaGuard({ codec }).project(userMessageWithImages(images), {
    budget: DEFAULT_MEDIA_BUDGET,
  });

  assert.ok(
    codec.targets.every((target) => target === DEFAULT_MEDIA_BUDGET.maxSerializedBytesPerImage),
  );
  assert.equal(result.report.kept, 1);
  assert.equal(result.report.deduplicated, 9);
});

test("duplicates still collapse to one kept image after compression", async () => {
  const images = ["C".repeat(600_000), "C".repeat(600_000)];
  const codec = new RecordingCodec();

  const result = await createMediaGuard({ codec }).project(userMessageWithImages(images), {
    budget: DEFAULT_MEDIA_BUDGET,
  });

  assert.equal(result.report.kept, 1);
  assert.equal(result.report.deduplicated, 1);
  assert.equal(result.report.after.blocks, 1);
});
