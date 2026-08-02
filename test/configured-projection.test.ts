import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { LoadedMediaGuardConfig } from "../src/config.js";
import { projectConfiguredRequest } from "../src/configured-projection.js";

const loaded: LoadedMediaGuardConfig = {
  config: { version: 1, budget: { maxSerializedMediaBytes: 0 } },
  globalConfig: { version: 1, budget: { maxSerializedMediaBytes: 0 } },
  diagnostics: [],
  globalPath: "/global/pi-media-guard.json",
  projectPath: "/project/.pi/pi-media-guard.json",
};

test("declared budget automatically replaces overflow media with text", async () => {
  const messages = [
    { role: "user", content: "inspect", timestamp: 1 },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [
        { type: "text", text: "image source: anonymous.png" },
        { type: "image", data: Buffer.from("pixels").toString("base64"), mimeType: "image/png" },
      ],
      isError: false,
      timestamp: 2,
    },
  ] satisfies AgentMessage[];

  const result = await projectConfiguredRequest(messages, {
    provider: "company-private-gateway",
    loadedConfig: loaded,
  });

  assert.equal(result.report.after.blocks, 0);
  assert.equal(result.report.externalized, 1);
  assert.equal(result.report.externalizedCurrent, 1);
  assert.equal(result.messages[1]?.role, "toolResult");
  if (result.messages[1]?.role !== "toolResult") assert.fail("expected tool result");
  assert.deepEqual(result.messages[1].content[0], {
    type: "text",
    text: "image source: anonymous.png",
  });
  assert.match(
    result.messages[1].content[1]?.type === "text" ? result.messages[1].content[1].text : "",
    /Current image externalized by pi-media-guard/,
  );
});
