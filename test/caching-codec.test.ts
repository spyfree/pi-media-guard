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

function countingDelegate(data = "AAAA"): { codec: ImageCodec; calls: () => number } {
  let calls = 0;
  return {
    codec: {
      async constrain() {
        calls += 1;
        return { data, mimeType: "image/jpeg", width: 10, height: 10 };
      },
    },
    calls: () => calls,
  };
}

const target = { maxWidth: 1200, maxHeight: 1200, maxSerializedBytes: 512 };

function imageWithHash(hash: string) {
  return { data: "original", mimeType: "image/png", hash };
}

test("the entry bound evicts the least recently used image", async () => {
  const { codec: delegate, calls } = countingDelegate();
  const codec = new CachingImageCodec(delegate, { maxEntries: 2, maxSerializedBytes: 1024 });

  await codec.constrain(imageWithHash("sha256:a"), target);
  await codec.constrain(imageWithHash("sha256:b"), target);
  // Refresh "a" so "b" becomes the eviction candidate.
  await codec.constrain(imageWithHash("sha256:a"), target);
  await codec.constrain(imageWithHash("sha256:c"), target);
  assert.equal(calls(), 3);

  await codec.constrain(imageWithHash("sha256:a"), target);
  assert.equal(calls(), 3, "expected the refreshed entry to survive eviction");
  await codec.constrain(imageWithHash("sha256:b"), target);
  assert.equal(calls(), 4, "expected the least recently used entry to have been evicted");
});

test("the byte bound evicts oldest entries until the cache fits", async () => {
  const { codec: delegate, calls } = countingDelegate("A".repeat(400));
  const codec = new CachingImageCodec(delegate, { maxEntries: 10, maxSerializedBytes: 1000 });

  await codec.constrain(imageWithHash("sha256:a"), target);
  await codec.constrain(imageWithHash("sha256:b"), target);
  await codec.constrain(imageWithHash("sha256:c"), target);
  assert.equal(calls(), 3);

  // 3 × 400 bytes exceeds the 1000-byte bound, so "a" must have been evicted.
  await codec.constrain(imageWithHash("sha256:c"), target);
  assert.equal(calls(), 3);
  await codec.constrain(imageWithHash("sha256:a"), target);
  assert.equal(calls(), 4);
});
