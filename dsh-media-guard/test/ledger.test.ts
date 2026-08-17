import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMediaLedger, mediaFootprint } from "../src/ledger.js";
import { base64BytesForBinary } from "../src/media-bytes.js";
import {
  assistantToolCall,
  coordinatorMessage,
  image,
  pluginMessage,
  ref,
  text,
  toolResult,
  user,
} from "./helpers.js";

test("identity, sizes, and dimensions come straight from the attachment ref", () => {
  const attachment = ref(300_000, "solo", { width: 640, height: 480, mediaType: "image/webp" });
  const ledger = buildMediaLedger([user(image(attachment))]);
  assert.equal(ledger.length, 1);
  const item = ledger[0];
  assert.ok(item);
  assert.equal(item.hash, attachment.attachmentId);
  assert.equal(item.decodedBytes, 300_000);
  assert.equal(item.serializedBytes, base64BytesForBinary(300_000));
  assert.equal(item.width, 640);
  assert.equal(item.height, 480);
  assert.equal(item.mediaType, "image/webp");
  // Message creation deep-clones content (freezeMessage), so the ref in the
  // ledger is the message's own frozen copy, equal by value.
  assert.deepEqual(item.ref, attachment);
});

test("nested tool-result images are inventoried with their path and origin", () => {
  const messages = [
    user(text("read it")),
    assistantToolCall("call-1", "read_image", '{"path":"shot.png"}'),
    toolResult("call-1", text("ok"), image(ref(90_000, "shot"))),
  ];
  const ledger = buildMediaLedger(messages);
  assert.equal(ledger.length, 1);
  const item = ledger[0];
  assert.ok(item);
  assert.equal(item.messageIndex, 2);
  // content[0] is the tool-result block, content[1] inside it is the image.
  assert.deepEqual(item.path, [0, 1]);
  assert.equal(item.origin, 'tool read_image({"path":"shot.png"})');
  assert.equal(item.currentWorkingSet, true);
});

test("priorities follow scope and producer class", () => {
  const messages = [
    user(image(ref(1_000, "old-user"))),
    assistantToolCall("call-1", "read_image", "{}"),
    toolResult("call-1", image(ref(2_000, "old-tool"))),
    pluginMessage("some-plugin", image(ref(3_000, "plugin-img"))),
    user(image(ref(4_000, "current-user"))),
  ];
  const ledger = buildMediaLedger(messages);
  const byHashSeed = (seed: string) =>
    ledger.find((item) => item.hash === ref(0, seed).attachmentId);
  assert.equal(byHashSeed("old-user")?.priority, 500);
  assert.equal(byHashSeed("old-tool")?.priority, 400);
  assert.equal(byHashSeed("plugin-img")?.priority, 300);
  assert.equal(byHashSeed("plugin-img")?.origin, "plugin some-plugin message");
  assert.equal(byHashSeed("current-user")?.priority, 700);
  assert.equal(byHashSeed("current-user")?.currentWorkingSet, true);
  assert.equal(byHashSeed("old-user")?.currentWorkingSet, false);
});

test("everything from the last real user message onward is the current working set", () => {
  const messages = [
    user(text("prompt")),
    assistantToolCall("call-1", "screenshot", "{}"),
    toolResult("call-1", image(ref(5_000, "current-tool"))),
  ];
  const ledger = buildMediaLedger(messages);
  assert.equal(ledger[0]?.currentWorkingSet, true);
  assert.equal(ledger[0]?.priority, 600);
});

test("a coordinator-opened session still gets a current working set", () => {
  // A subagent session driven entirely by coordinator relays has no
  // kind-'user' message; the last non-tool user-role message anchors instead.
  const messages = [
    coordinatorMessage(text("earlier relay"), image(ref(1_000, "relay-old"))),
    coordinatorMessage(text("inspect this"), image(ref(2_000, "relay-new"))),
    assistantToolCall("call-1", "screenshot", "{}"),
    toolResult("call-1", image(ref(3_000, "relay-shot"))),
  ];
  const ledger = buildMediaLedger(messages);
  const bySeed = (seed: string) => ledger.find((item) => item.hash === ref(0, seed).attachmentId);
  assert.equal(bySeed("relay-old")?.currentWorkingSet, false);
  assert.equal(bySeed("relay-new")?.currentWorkingSet, true);
  assert.equal(bySeed("relay-new")?.priority, 550);
  assert.equal(bySeed("relay-shot")?.currentWorkingSet, true);
  assert.equal(bySeed("relay-shot")?.priority, 600);
});

test("tool-call origins are truncated at 160 characters", () => {
  const longArguments = JSON.stringify({ path: "x".repeat(400) });
  const messages = [
    assistantToolCall("call-1", "read_image", longArguments),
    toolResult("call-1", image(ref(5_000, "long"))),
  ];
  const ledger = buildMediaLedger(messages);
  const origin = ledger[0]?.origin ?? "";
  assert.equal(origin.length, 160);
  assert.ok(origin.endsWith("…"));
});

test("unmatched tool results and duplicate refs still inventory cleanly", () => {
  const duplicated = ref(10_000, "dup");
  const messages = [toolResult("missing-call", image(duplicated)), user(image(duplicated))];
  const ledger = buildMediaLedger(messages);
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0]?.origin, "tool result");
  assert.equal(ledger[0]?.hash, ledger[1]?.hash);
});

test("footprint totals blocks and both size dimensions", () => {
  const messages = [user(image(ref(3_000, "a")), image(ref(6_000, "b")))];
  const footprint = mediaFootprint(buildMediaLedger(messages));
  assert.deepEqual(footprint, {
    blocks: 2,
    serializedBytes: base64BytesForBinary(3_000) + base64BytesForBinary(6_000),
    decodedBytes: 9_000,
  });
});
