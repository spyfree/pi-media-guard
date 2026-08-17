import assert from "node:assert/strict";
import { test } from "node:test";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import type { Message } from "@deepseek-ai/dsh-llm";
import type { ImageCodec } from "../src/domain.js";
import { buildMediaLedger, mediaFootprint } from "../src/ledger.js";
import { createMediaGuard } from "../src/media-guard.js";
import { DEFAULT_MEDIA_BUDGET } from "../src/policy.js";
import { assistantToolCall, decodedFor, image, ref, text, toolResult, user } from "./helpers.js";

/**
 * The founding incident, byte-for-byte: four individually valid screenshots
 * whose Base64 encodings sum to 6,567,972 bytes — fatal in aggregate under
 * the default 2 MiB serialized budget. Same distribution as pi-media-guard's
 * anonymous regression, expressed as attachment refs.
 */
const ANONYMOUS_BASE64_LENGTHS = [1_820_000, 740_000, 1_210_000, 2_797_972] as const;

function fourImageFailureMessages(): Message[] {
  const messages: Message[] = [user(text("Inspect these four anonymous screenshots"))];
  ANONYMOUS_BASE64_LENGTHS.forEach((serialized, index) => {
    const callId = `anonymous-call-${index + 1}`;
    messages.push(assistantToolCall(callId, "read", `{"path":"screenshot-${index + 1}.png"}`));
    messages.push(toolResult(callId, image(ref(decodedFor(serialized), `screenshot-${index}`))));
  });
  return messages;
}

test("the fixture reproduces the aggregate failure exactly", () => {
  const footprint = mediaFootprint(buildMediaLedger(fourImageFailureMessages()));
  assert.equal(footprint.blocks, 4);
  assert.equal(footprint.serializedBytes, 6_567_972);
  assert.ok(footprint.serializedBytes > DEFAULT_MEDIA_BUDGET.maxSerializedMediaBytes);
});

test("without a codec, protect brings the request under budget deterministically", async () => {
  const guard = createMediaGuard();
  const result = await guard.project(fourImageFailureMessages(), { mode: "protect" });
  const after = mediaFootprint(buildMediaLedger(result.messages));
  assert.ok(after.serializedBytes <= DEFAULT_MEDIA_BUDGET.maxSerializedMediaBytes);
  assert.equal(result.report.pressure, "red");
  assert.equal(result.report.currentPressure, "green");
  // Every image exceeds the 512 KiB per-image ceiling, so all four become notes.
  assert.equal(result.report.externalized, 4);
  const notes = result.messages
    .flatMap((message) => message.content)
    .filter((block) => block.type === "tool-result")
    .flatMap((block) => block.content)
    .filter((block) => block.type === "text");
  assert.equal(notes.length, 4);
  for (const note of notes) assert.match(note.text, /externalized by dsh-media-guard/);
});

test("with a deterministic codec, all four visual inputs remain available", async () => {
  // Mirrors pi-media-guard's acceptance line: all four images survive at
  // 1,600,000 serialized bytes, below the default 2 MiB aggregate budget.
  const codec: ImageCodec = {
    constrain: (original, target) => {
      const bytes = Math.min(300_000, Math.floor((target.maxSerializedBytes / 4) * 3));
      return Promise.resolve({
        ...original,
        attachmentId: AttachmentId(`${original.attachmentId}-constrained`),
        bytes,
      });
    },
  };
  const guard = createMediaGuard({ codec });
  const result = await guard.project(fourImageFailureMessages(), { mode: "protect" });
  assert.equal(result.report.compressed, 4);
  assert.equal(result.report.externalized, 0);
  assert.equal(result.report.kept, 4);
  const after = mediaFootprint(buildMediaLedger(result.messages));
  assert.equal(after.blocks, 4);
  assert.equal(after.serializedBytes, 1_600_000);
  // 1.6M of 2 MiB is ~76% utilization: safe but reported as near-limit.
  assert.notEqual(result.report.currentPressure, "red");
});
