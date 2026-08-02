import assert from "node:assert/strict";
import test from "node:test";
import { CachingImageCodec } from "../src/codecs/cache.js";
import type { ImageCodec } from "../src/domain.js";

test("codec cache reuses a constrained image by hash and target", async () => {
  let calls = 0;
  const delegate: ImageCodec = {
    async constrain() {
      calls += 1;
      return { data: "AAAA", mimeType: "image/jpeg", width: 10, height: 10 };
    },
  };
  const codec = new CachingImageCodec(delegate, { maxEntries: 2, maxSerializedBytes: 1024 });
  const image = { data: "original", mimeType: "image/png", hash: "sha256:same" };
  const target = { maxWidth: 1200, maxHeight: 1200, maxSerializedBytes: 512 };

  assert.deepEqual(await codec.constrain(image, target), await codec.constrain(image, target));
  assert.equal(calls, 1);
});
