import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import fc from "fast-check";
import { buildMediaLedger, mediaFootprint } from "../src/ledger.js";
import { createMediaGuard } from "../src/media-guard.js";

const imageData = fc.uint8Array({ minLength: 0, maxLength: 256 }).map((bytes) =>
  Buffer.from(bytes).toString("base64"),
);

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
