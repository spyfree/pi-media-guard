import assert from "node:assert/strict";
import test from "node:test";
import {
  emergencyProjectOpenAIResponsesPayload,
  inspectOpenAIResponsesPayload,
} from "../src/providers/openai-responses.js";

test("OpenAI Responses audit counts data-URL media without exposing or changing payload", () => {
  const payload = {
    model: "gpt-test",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "inspect" },
          { type: "input_image", image_url: "data:image/png;base64,QUJDRA==" },
        ],
      },
      { type: "reasoning", encrypted_content: "opaque-signed-value" },
    ],
  };
  const original = structuredClone(payload);

  const footprint = inspectOpenAIResponsesPayload(payload);

  assert.deepEqual(payload, original);
  assert.equal(footprint.mediaBlocks, 1);
  assert.equal(footprint.serializedMediaBytes, 8);
  assert.equal(footprint.decodedMediaBytes, 4);
  assert.equal(footprint.totalSerializedBytes, Buffer.byteLength(JSON.stringify(payload)));
});

test("OpenAI Responses emergency projection replaces only image leaves", () => {
  const payload = {
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "inspect" },
          { type: "input_image", image_url: "data:image/png;base64,QUJDRA==" },
        ],
      },
      { type: "reasoning", encrypted_content: "opaque-signed-value" },
    ],
  };
  const original = structuredClone(payload);

  const projected = emergencyProjectOpenAIResponsesPayload(payload);

  assert.deepEqual(payload, original);
  assert.equal(inspectOpenAIResponsesPayload(projected).mediaBlocks, 0);
  const projectedPayload = projected as {
    input: Array<{
      type?: string;
      encrypted_content?: string;
      content?: Array<Record<string, unknown>>;
    }>;
  };
  assert.deepEqual(projectedPayload.input[1], payload.input[1]);
  assert.deepEqual(projectedPayload.input[0]?.content?.[0], {
    type: "input_text",
    text: "inspect",
  });
  assert.match(
    String(projectedPayload.input[0]?.content?.[1]?.text),
    /externalized by pi-media-guard final payload guard/,
  );
});
