import assert from "node:assert/strict";
import { test } from "node:test";
import { base64BytesForBinary } from "../src/media-bytes.js";

test("base64 cost matches a real encode for every remainder class", () => {
  for (const length of [0, 1, 2, 3, 4, 5, 6, 300, 301, 302]) {
    const encoded = Buffer.alloc(length).toString("base64");
    assert.equal(base64BytesForBinary(length), Buffer.byteLength(encoded, "utf8"));
  }
});

test("non-positive lengths cost nothing", () => {
  assert.equal(base64BytesForBinary(0), 0);
  assert.equal(base64BytesForBinary(-5), 0);
});
