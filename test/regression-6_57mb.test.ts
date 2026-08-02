import assert from "node:assert/strict";
import test from "node:test";
import type {
  EncodedImage,
  ImageCodec,
  ImageTarget,
  MediaImage,
} from "../src/domain.js";
import { createMediaGuard } from "../src/media-guard.js";
import { DEFAULT_MEDIA_BUDGET } from "../src/policy.js";
import {
  ANONYMOUS_BASE64_LENGTHS,
  fourImageFailureMessages,
} from "./fixtures/four-image-failure.js";

const TWO_MIB = 2 * 1024 * 1024;

class DeterministicCodec implements ImageCodec {
  async constrain(image: MediaImage, target: ImageTarget): Promise<EncodedImage> {
    const size = Math.min(400_000, target.maxSerializedBytes);
    const marker = `${image.hash.at(-1) ?? "A"}AAA`;
    return {
      data: `${"A".repeat(size - (size % 4) - marker.length)}${marker}`,
      mimeType: "image/jpeg",
      width: 1200,
      height: 700,
    };
  }
}

test("anonymous 6.57 MB multi-image failure is projected below the aggregate request budget", async () => {
  const result = await createMediaGuard({ codec: new DeterministicCodec() }).project(
    fourImageFailureMessages(),
    { budget: DEFAULT_MEDIA_BUDGET },
  );

  assert.equal(
    result.report.before.serializedBytes,
    ANONYMOUS_BASE64_LENGTHS.reduce((sum, length) => sum + length, 0),
  );
  assert.equal(result.report.before.serializedBytes, 6_567_972);
  assert.equal(result.report.pressure, "red");
  assert.ok(result.report.after.serializedBytes <= TWO_MIB);
  assert.equal(result.report.after.serializedBytes, 1_600_000);
  assert.equal(result.report.compressed, 4);
  assert.equal(result.report.kept, 4);
  assert.equal(result.report.externalized, 0);

  const notes = result.messages.flatMap((message) =>
    "content" in message && Array.isArray(message.content)
      ? message.content.filter((block) => block.type === "text" && block.text.includes("externalized by pi-media-guard"))
      : [],
  );
  assert.equal(notes.length, 0);
});
