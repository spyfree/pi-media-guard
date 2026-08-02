import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createMediaGuard } from "../src/media-guard.js";

const budget = {
  maxMediaBlocks: 0,
  maxSerializedMediaBytes: 0,
  maxDecodedMediaBytes: 0,
  maxSerializedBytesPerImage: 100,
};

test("observe mode reports pressure without changing media", async () => {
  const image = Buffer.from("pixels").toString("base64");
  const messages = [
    {
      role: "user",
      content: [{ type: "image", data: image, mimeType: "image/png" }],
      timestamp: 1,
    },
  ] satisfies AgentMessage[];

  const result = await createMediaGuard().project(messages, { budget, mode: "observe" });

  assert.equal(result.report.pressure, "red");
  assert.equal(result.report.externalized, 0);
  assert.deepEqual(result.messages, messages);
});

test("request projection replaces only rejected image leaves and does not mutate session messages", async () => {
  const image = Buffer.from("pixels").toString("base64");
  const messages = [
    { role: "user", content: "inspect", timestamp: 1 },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "opaque", thinkingSignature: "signed" },
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: "shot.png" } },
      ],
      api: "openai-responses",
      provider: "openai",
      model: "model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 2,
    },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [
        { type: "text", text: "shot.png" },
        { type: "image", data: image, mimeType: "image/png" },
      ],
      isError: false,
      timestamp: 3,
    },
  ] satisfies AgentMessage[];
  const original = structuredClone(messages);

  const result = await createMediaGuard().project(messages, { budget });

  assert.deepEqual(messages, original);
  assert.deepEqual(result.messages.slice(0, 2), messages.slice(0, 2));
  assert.equal(result.messages[2]?.role, "toolResult");
  if (result.messages[2]?.role !== "toolResult") assert.fail("expected tool result");
  assert.deepEqual(result.messages[2].content[0], { type: "text", text: "shot.png" });
  assert.match(result.messages[2].content[1]?.type === "text" ? result.messages[2].content[1].text : "", /^\[Current image externalized by pi-media-guard\]/);
  assert.match(result.messages[2].content[1]?.type === "text" ? result.messages[2].content[1].text : "", /Reason: aggregate budget/);
  assert.deepEqual(result.report.after, { blocks: 0, serializedBytes: 0, decodedBytes: 0 });
  assert.equal(result.report.externalized, 1);
});
