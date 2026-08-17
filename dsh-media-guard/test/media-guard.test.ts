import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import type { ImageBlock, Message, ToolResultBlock } from "@deepseek-ai/dsh-llm";
import type { ImageCodec } from "../src/domain.js";
import { createMediaGuard } from "../src/media-guard.js";
import { decodedFor, image, ref, text, toolResult, user } from "./helpers.js";

function truncatingCodec(producedBytes: number): ImageCodec {
  return {
    constrain(original, target) {
      const bytes = Math.min(producedBytes, Math.floor((target.maxSerializedBytes / 4) * 3));
      return Promise.resolve({
        ...original,
        attachmentId: AttachmentId(`${original.attachmentId}-constrained`),
        bytes,
      } as ImageAttachmentRef);
    },
  };
}

test("observe mode reports without touching the messages", async () => {
  const guard = createMediaGuard();
  const messages = [user(image(ref(decodedFor(3_000_000), "huge")))];
  const result = await guard.project(messages, { mode: "observe" });
  assert.equal(result.messages, messages);
  assert.equal(result.report.pressure, "red");
  assert.equal(result.report.currentPressure, "red");
  assert.equal(result.report.externalized, 0);
  // Diagnostics still show what protect would have decided.
  assert.equal(result.decisions[0]?.action, "externalize");
});

test("protect externalizes overflow into evidence notes and preserves everything else", async () => {
  const guard = createMediaGuard();
  const oversized = ref(decodedFor(2_800_000), "way-too-big");
  const untouched = user(text("hello"));
  const messages = [untouched, user(text("look:"), image(oversized))];
  const result = await guard.project(messages, { mode: "protect" });

  assert.notEqual(result.messages, messages);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0], untouched);
  const projected = result.messages[1];
  assert.ok(projected);
  assert.equal(projected.id, messages[1]?.id);
  assert.equal(projected.role, "user");
  assert.deepEqual(projected.content[0], { type: "text", text: "look:" });
  const note = projected.content[1];
  assert.ok(note && note.type === "text");
  assert.match(note.text, /externalized by dsh-media-guard/);
  assert.match(note.text, new RegExp(oversized.attachmentId));
  assert.equal(result.report.externalized, 1);
  assert.equal(result.report.externalizedCurrent, 1);
  assert.equal(result.report.after.blocks, 0);
  // The original message array was not mutated.
  const originalBlock = messages[1]?.content[1] as ImageBlock | undefined;
  assert.ok(originalBlock);
  assert.deepEqual(originalBlock.attachment, oversized);
});

test("nested tool-result images are replaced in place, preserving the block shape", async () => {
  const guard = createMediaGuard();
  const messages = [
    user(text("prompt")),
    toolResult("call-9", text("captured"), image(ref(decodedFor(1_000_000), "nested"))),
  ];
  const result = await guard.project(messages, { mode: "protect" });
  const projectedToolResult = result.messages[1]?.content[0] as ToolResultBlock;
  assert.equal(projectedToolResult.type, "tool-result");
  assert.equal(projectedToolResult.toolCallId, "call-9");
  assert.deepEqual(projectedToolResult.content[0], { type: "text", text: "captured" });
  assert.equal(projectedToolResult.content[1]?.type, "text");
  assert.equal(result.report.externalized, 1);
});

test("duplicates collapse to one kept copy plus duplicate notes", async () => {
  const guard = createMediaGuard();
  const duplicated = ref(30_000, "seen-twice");
  const messages = [user(image(duplicated)), user(image(duplicated))];
  const result = await guard.project(messages, { mode: "protect" });
  assert.equal(result.report.deduplicated, 1);
  assert.equal(result.report.kept, 1);
  const first = result.messages[0]?.content[0];
  assert.ok(first && first.type === "text");
  assert.match(first.text, /duplicate media/);
  const second = result.messages[1]?.content[0];
  assert.ok(second && second.type === "image");
});

test("a codec brings oversized images under budget and they stay kept", async () => {
  const guard = createMediaGuard({ codec: truncatingCodec(300_000) });
  const messages = [user(image(ref(decodedFor(2_800_000), "compressible")))];
  const result = await guard.project(messages, { mode: "protect" });
  assert.equal(result.report.compressed, 1);
  assert.equal(result.report.externalized, 0);
  const kept = result.messages[0]?.content[0];
  assert.ok(kept && kept.type === "image");
  assert.equal(kept.attachment.bytes, 300_000);
});

test("optimize compresses but never externalizes", async () => {
  const guard = createMediaGuard({ codec: truncatingCodec(300_000) });
  const messages = [
    user(image(ref(decodedFor(2_800_000), "opt-a")), image(ref(decodedFor(2_800_000), "opt-b"))),
  ];
  const result = await guard.project(messages, { mode: "optimize" });
  assert.equal(result.report.compressed, 2);
  assert.equal(result.report.externalized, 0);
  for (const block of result.messages[0]?.content ?? []) {
    assert.equal(block.type, "image");
  }
});

test("a hanging codec times out and the image is externalized instead", async () => {
  const hangingCodec: ImageCodec = {
    constrain: () => new Promise(() => {}),
  };
  const guard = createMediaGuard({ codec: hangingCodec, compressionTimeoutMs: 25 });
  const messages = [user(image(ref(decodedFor(2_800_000), "hangs")))];
  const result = await guard.project(messages, { mode: "protect" });
  assert.equal(result.report.compressed, 0);
  assert.equal(result.report.externalized, 1);
});

test("a codec that overshoots its target is rejected", async () => {
  const overshootingCodec: ImageCodec = {
    constrain: (original) => Promise.resolve({ ...original, bytes: 5_000_000 }),
  };
  const guard = createMediaGuard({ codec: overshootingCodec });
  const messages = [user(image(ref(decodedFor(2_800_000), "overshoot")))];
  const result = await guard.project(messages, { mode: "protect" });
  assert.equal(result.report.compressed, 0);
  assert.equal(result.report.externalized, 1);
});

test("projection is idempotent: a projected request projects to itself", async () => {
  const guard = createMediaGuard();
  const messages = [
    user(image(ref(decodedFor(2_800_000), "idem-a")), image(ref(10_000, "idem-b"))),
  ];
  const first = await guard.project(messages, { mode: "protect" });
  const second = await guard.project(first.messages, { mode: "protect" });
  assert.equal(second.messages, first.messages);
  assert.equal(second.report.externalized, 0);
});

test("a request without images is returned by reference with an empty report", async () => {
  const guard = createMediaGuard();
  const messages: Message[] = [user(text("plain"))];
  const result = await guard.project(messages, { mode: "protect" });
  assert.equal(result.messages, messages);
  assert.deepEqual(result.report.before, { blocks: 0, serializedBytes: 0, decodedBytes: 0 });
  assert.equal(result.report.pressure, "green");
});
