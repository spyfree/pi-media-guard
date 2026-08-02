import assert from "node:assert/strict";
import test from "node:test";
import type { ResizedImage } from "@earendil-works/pi-coding-agent";
import { PiPhotonCodec } from "../src/codecs/pi-photon.js";

test("Pi codec forwards the dynamic serialized-byte target", async () => {
  let receivedMaxBytes: number | undefined;
  const resized: ResizedImage = {
    data: "AAAA",
    mimeType: "image/jpeg",
    originalWidth: 2400,
    originalHeight: 1400,
    width: 1200,
    height: 700,
    wasResized: true,
  };
  const codec = new PiPhotonCodec(async (_bytes, _mimeType, options) => {
    receivedMaxBytes = options?.maxBytes;
    return resized;
  });

  const result = await codec.constrain(
    { data: "AAAA", mimeType: "image/png", hash: "sha256:test" },
    { maxWidth: 1200, maxHeight: 1200, maxSerializedBytes: 524_288 },
  );

  assert.equal(receivedMaxBytes, 524_288);
  assert.deepEqual(result, {
    data: "AAAA",
    mimeType: "image/jpeg",
    width: 1200,
    height: 700,
  });
});
