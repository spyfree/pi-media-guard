import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { EncodedImage, ImageCodec } from "../src/domain.js";
import { createMediaGuard } from "../src/media-guard.js";
import { DEFAULT_MEDIA_BUDGET } from "../src/policy.js";

class HangingCodec implements ImageCodec {
  calls = 0;

  constrain(): Promise<EncodedImage | null> {
    this.calls += 1;
    return new Promise<never>(() => {});
  }
}

class SlowRejectingCodec implements ImageCodec {
  async constrain(): Promise<EncodedImage | null> {
    await new Promise((resolve) => setTimeout(resolve, 30));
    throw new Error("codec exploded after the timeout already won");
  }
}

function oversizedImageMessage(): AgentMessage[] {
  return [
    {
      role: "user",
      content: [{ type: "image", data: "B".repeat(600_000), mimeType: "image/png" }],
      timestamp: 1,
    },
  ];
}

test("a hung codec cannot stall the projection: timeout externalizes the image", async () => {
  const codec = new HangingCodec();
  const guard = createMediaGuard({ codec, compressionTimeoutMs: 20 });

  const result = await guard.project(oversizedImageMessage(), { budget: DEFAULT_MEDIA_BUDGET });

  assert.equal(codec.calls, 1);
  assert.equal(result.report.compressed, 0);
  assert.equal(result.report.externalized, 1);
  assert.equal(result.report.after.blocks, 0);
});

test("a rejection arriving after the timeout does not surface as an unhandled error", async () => {
  const guard = createMediaGuard({ codec: new SlowRejectingCodec(), compressionTimeoutMs: 5 });

  const result = await guard.project(oversizedImageMessage(), { budget: DEFAULT_MEDIA_BUDGET });
  assert.equal(result.report.externalized, 1);
  // Give the late rejection time to fire; an unhandled rejection would fail
  // the test process.
  await new Promise((resolve) => setTimeout(resolve, 60));
});
