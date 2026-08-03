import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import fc from "fast-check";
import type { ImageCodec } from "../src/domain.js";
import { buildMediaLedger, mediaFootprint } from "../src/ledger.js";
import { createMediaGuard } from "../src/media-guard.js";

const imageData = fc
  .uint8Array({ minLength: 0, maxLength: 256 })
  .map((bytes) => Buffer.from(bytes).toString("base64"));

/** Shrinks any image to the requested byte target, deterministically per image. */
const truncatingCodec: ImageCodec = {
  async constrain(image, target) {
    const size = Math.min(
      Buffer.byteLength(image.data, "utf8"),
      Math.max(0, target.maxSerializedBytes),
    );
    const seed = image.hash.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
    return {
      data: (seed + "A".repeat(size)).slice(0, size),
      mimeType: "image/jpeg",
      width: 1,
      height: 1,
    };
  },
};

test("protect projection preserves protocol structure and always satisfies arbitrary budgets", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(imageData, { maxLength: 12 }),
      fc.integer({ min: 0, max: 8 }),
      fc.integer({ min: 0, max: 1024 }),
      async (images, maxMediaBlocks, maxSerializedMediaBytes) => {
        const messages: AgentMessage[] = [
          { role: "user", content: "inspect", timestamp: 1 },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "opaque", thinkingSignature: "signed" },
              { type: "toolCall", id: "call-1", name: "read", arguments: {} },
            ],
            api: "openai-responses",
            provider: "openai",
            model: "test",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "toolUse",
            timestamp: 2,
          },
          {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read",
            content: images.map((data) => ({ type: "image", data, mimeType: "image/png" })),
            isError: false,
            timestamp: 3,
          },
        ];
        const original = structuredClone(messages);
        const budget = {
          maxMediaBlocks,
          maxSerializedMediaBytes,
          maxDecodedMediaBytes: Math.floor((maxSerializedMediaBytes * 3) / 4),
          maxSerializedBytesPerImage: maxSerializedMediaBytes,
        };

        const result = await createMediaGuard().project(messages, { budget });
        const footprint = mediaFootprint(buildMediaLedger(result.messages));

        assert.ok(footprint.blocks <= budget.maxMediaBlocks);
        assert.ok(footprint.serializedBytes <= budget.maxSerializedMediaBytes);
        assert.ok(footprint.decodedBytes <= budget.maxDecodedMediaBytes);
        assert.deepEqual(messages, original);
        assert.deepEqual(
          result.messages.map((message) => message.role),
          messages.map((message) => message.role),
        );
        assert.deepEqual(result.messages[1], messages[1]);
        assert.equal(result.messages[2]?.role, "toolResult");
        if (result.messages[2]?.role === "toolResult") {
          assert.equal(result.messages[2].toolCallId, "call-1");
          assert.equal(result.messages[2].toolName, "read");
        }
        const second = await createMediaGuard().project(result.messages, { budget });
        assert.deepEqual(second.messages, result.messages);
      },
    ),
    { numRuns: 100 },
  );
});

test("protect projection through a compressing codec still satisfies arbitrary budgets", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(imageData, { maxLength: 12 }),
      fc.integer({ min: 0, max: 8 }),
      fc.integer({ min: 0, max: 1024 }),
      async (images, maxMediaBlocks, maxSerializedMediaBytes) => {
        const messages: AgentMessage[] = [
          {
            role: "user",
            content: [
              { type: "text", text: "inspect" },
              ...images.map((data) => ({ type: "image" as const, data, mimeType: "image/png" })),
            ],
            timestamp: 1,
          },
        ];
        const original = structuredClone(messages);
        const budget = {
          maxMediaBlocks,
          maxSerializedMediaBytes,
          maxDecodedMediaBytes: Math.floor((maxSerializedMediaBytes * 3) / 4),
          maxSerializedBytesPerImage: maxSerializedMediaBytes,
        };

        const guard = createMediaGuard({ codec: truncatingCodec });
        const result = await guard.project(messages, { budget });
        const footprint = mediaFootprint(buildMediaLedger(result.messages));

        assert.ok(footprint.blocks <= budget.maxMediaBlocks);
        assert.ok(footprint.serializedBytes <= budget.maxSerializedMediaBytes);
        assert.ok(footprint.decodedBytes <= budget.maxDecodedMediaBytes);
        assert.deepEqual(messages, original);
        assert.equal(result.messages[0]?.role, "user");
        if (result.messages[0]?.role === "user" && Array.isArray(result.messages[0].content)) {
          assert.deepEqual(result.messages[0].content[0], { type: "text", text: "inspect" });
          assert.equal(result.messages[0].content.length, images.length + 1);
        }

        // Projection is deterministic per input. It is intentionally NOT
        // asserted to be idempotent with a codec: the fair-share target
        // depends on the ledger's composition, which externalization changes,
        // and production always projects the original session messages.
        const repeat = await guard.project(messages, { budget });
        assert.deepEqual(repeat.messages, result.messages);

        // Re-projecting a projection must still satisfy every budget.
        const second = await guard.project(result.messages, { budget });
        const secondFootprint = mediaFootprint(buildMediaLedger(second.messages));
        assert.ok(secondFootprint.blocks <= budget.maxMediaBlocks);
        assert.ok(secondFootprint.serializedBytes <= budget.maxSerializedMediaBytes);
        assert.ok(secondFootprint.decodedBytes <= budget.maxDecodedMediaBytes);
      },
    ),
    { numRuns: 100 },
  );
});
