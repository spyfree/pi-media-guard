import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildMediaLedger } from "../src/ledger.js";

const PNG_BYTE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test("inventory records a canonical image without decoding it for byte accounting", () => {
  const data = PNG_BYTE.toString("base64");
  const messages = [
    { role: "user", content: "inspect the result", timestamp: 1 },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "image", data, mimeType: "image/png" }],
      isError: false,
      timestamp: 2,
    },
  ] satisfies AgentMessage[];

  assert.deepEqual(buildMediaLedger(messages), [
    {
      messageIndex: 1,
      contentIndex: 0,
      kind: "image",
      mimeType: "image/png",
      hash: `sha256:${createHash("sha256").update(PNG_BYTE).digest("hex")}`,
      serializedBytes: data.length,
      decodedBytes: 4,
      age: 0,
      currentWorkingSet: true,
      priority: 600,
      origin: "tool read",
    },
  ]);
});

test("inventory records the originating tool call so evidence notes stay actionable", () => {
  const data = PNG_BYTE.toString("base64");
  const messages = [
    { role: "user", content: "inspect the result", timestamp: 1 },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "shot.png" } }],
      api: "openai-responses",
      provider: "openai",
      model: "model",
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
      content: [{ type: "image", data, mimeType: "image/png" }],
      isError: false,
      timestamp: 3,
    },
  ] satisfies AgentMessage[];

  const [item] = buildMediaLedger(messages);

  assert.equal(item?.origin, 'tool read({"path":"shot.png"})');
});

test("user-provided media records the user message as its origin", () => {
  const data = PNG_BYTE.toString("base64");
  const messages = [
    {
      role: "user",
      content: [{ type: "image", data, mimeType: "image/png" }],
      timestamp: 1,
    },
  ] satisfies AgentMessage[];

  const [item] = buildMediaLedger(messages);

  assert.equal(item?.origin, "user message");
});
