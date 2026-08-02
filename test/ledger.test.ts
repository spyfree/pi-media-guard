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
    },
  ]);
});
