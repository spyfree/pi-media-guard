import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { deepFreeze, markAgentLoopRequest } from "@deepseek-ai/dsh-llm";
import { resolveGuardConfig } from "../src/config.js";
import type { GuardReport } from "../src/domain.js";
import { apply, createLlmStreamListener, type GuardContext } from "../src/index.js";
import { createMediaGuard } from "../src/media-guard.js";
import { decodedFor, image, ref, text, user } from "./helpers.js";

const FINISH: StreamChunk = { type: "finish", reason: { kind: "stop" } };

interface FakeContext extends GuardContext {
  listeners: Map<string, unknown>;
  reports: GuardReport[];
  dispatched: GenerateOptions[];
  nextCalls: number;
  next(): AsyncIterable<StreamChunk>;
}

function fakeContext(): FakeContext {
  const ctx: FakeContext = {
    listeners: new Map(),
    reports: [],
    dispatched: [],
    nextCalls: 0,
    llm: {
      stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        ctx.dispatched.push(options);
        return (async function* () {
          yield FINISH;
        })();
      },
    },
    emit(_event: "media-guard/report", report: GuardReport): void {
      ctx.reports.push(report);
    },
    next(): AsyncIterable<StreamChunk> {
      ctx.nextCalls += 1;
      return (async function* () {
        yield FINISH;
      })();
    },
  };
  return ctx;
}

function loopRequest(messages: GenerateOptions["messages"]): GenerateOptions {
  return markAgentLoopRequest(
    deepFreeze({ provider: "test-provider", model: "test-model", messages }),
  );
}

async function drain(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function protectListener(ctx: FakeContext) {
  return createLlmStreamListener(ctx, createMediaGuard(), resolveGuardConfig({}).config);
}

test("hand-built requests pass through untouched", async () => {
  const ctx = fakeContext();
  const listener = protectListener(ctx);
  const options: GenerateOptions = {
    provider: "test-provider",
    model: "test-model",
    messages: [user(image(ref(decodedFor(2_800_000), "hand-built")))],
  };
  await drain(listener(options, () => ctx.next()));
  assert.equal(ctx.nextCalls, 1);
  assert.equal(ctx.dispatched.length, 0);
  assert.equal(ctx.reports.length, 0);
});

test("an over-budget loop request is re-dispatched as a projection", async () => {
  const ctx = fakeContext();
  const listener = protectListener(ctx);
  const messages = [user(text("look"), image(ref(decodedFor(2_800_000), "loop-big")))];
  const options = loopRequest(messages);
  const chunks = await drain(listener(options, () => ctx.next()));
  assert.deepEqual(chunks, [FINISH]);
  assert.equal(ctx.nextCalls, 0);
  assert.equal(ctx.dispatched.length, 1);
  const projected = ctx.dispatched[0];
  assert.ok(projected);
  assert.equal(projected.provider, "test-provider");
  assert.notEqual(projected.messages, messages);
  assert.equal(projected.messages[0]?.content[1]?.type, "text");
  // The frozen original was left alone.
  assert.equal(messages[0]?.content[1]?.type, "image");
  assert.equal(ctx.reports.length, 1);
  assert.equal(ctx.reports[0]?.externalized, 1);
});

test("the projected re-dispatch would pass through this listener unchanged", async () => {
  const ctx = fakeContext();
  const listener = protectListener(ctx);
  const options = loopRequest([user(image(ref(decodedFor(2_800_000), "reentry")))]);
  await drain(listener(options, () => ctx.next()));
  const projected = ctx.dispatched[0];
  assert.ok(projected);
  // Re-enter the listener with the projected request, as the waterfall would.
  await drain(listener(projected, () => ctx.next()));
  assert.equal(ctx.nextCalls, 1);
  assert.equal(ctx.dispatched.length, 1);
});

test("an under-budget loop request continues down the waterfall", async () => {
  const ctx = fakeContext();
  const listener = protectListener(ctx);
  const options = loopRequest([user(image(ref(10_000, "small-enough")))]);
  await drain(listener(options, () => ctx.next()));
  assert.equal(ctx.nextCalls, 1);
  assert.equal(ctx.dispatched.length, 0);
  assert.equal(ctx.reports.length, 1);
  assert.equal(ctx.reports[0]?.externalized, 0);
});

test("observe mode reports and continues even over budget", async () => {
  const ctx = fakeContext();
  const listener = createLlmStreamListener(
    ctx,
    createMediaGuard(),
    resolveGuardConfig({ mode: "observe" }).config,
  );
  const options = loopRequest([user(image(ref(decodedFor(2_800_000), "observed")))]);
  await drain(listener(options, () => ctx.next()));
  assert.equal(ctx.nextCalls, 1);
  assert.equal(ctx.dispatched.length, 0);
  assert.equal(ctx.reports[0]?.pressure, "red");
});

test("profiles keyed by the request provider widen the budget", async () => {
  const ctx = fakeContext();
  const listener = createLlmStreamListener(
    ctx,
    createMediaGuard(),
    resolveGuardConfig({
      profiles: {
        "test-provider": {
          maxSerializedMediaBytes: 8_000_000,
          maxDecodedMediaBytes: 8_000_000,
          maxSerializedBytesPerImage: 8_000_000,
        },
      },
    }).config,
  );
  const options = loopRequest([user(image(ref(decodedFor(2_800_000), "profiled")))]);
  await drain(listener(options, () => ctx.next()));
  assert.equal(ctx.nextCalls, 1);
  assert.equal(ctx.dispatched.length, 0);
  assert.equal(ctx.reports[0]?.budgetProfile, "test-provider");
});

test("a projection failure triggers the emergency strip, never the original", async () => {
  const warnMock = mock.method(console, "warn", () => {});
  try {
    const ctx = fakeContext();
    const failingGuard = { project: () => Promise.reject(new Error("boom")) };
    const listener = createLlmStreamListener(ctx, failingGuard, resolveGuardConfig({}).config);
    const options = loopRequest([user(text("keep me"), image(ref(50_000, "strip-me")))]);
    const chunks = await drain(listener(options, () => ctx.next()));
    assert.deepEqual(chunks, [FINISH]);
    assert.equal(ctx.nextCalls, 0);
    assert.equal(ctx.dispatched.length, 1);
    const stripped = ctx.dispatched[0];
    assert.ok(stripped);
    assert.deepEqual(stripped.messages[0]?.content[0], { type: "text", text: "keep me" });
    const strippedNote = stripped.messages[0]?.content[1];
    assert.ok(strippedNote && strippedNote.type === "text");
    assert.match(strippedNote.text, /emergency projection/);
  } finally {
    warnMock.mock.restore();
  }
});

test("a projection failure without images passes through", async () => {
  const warnMock = mock.method(console, "warn", () => {});
  try {
    const ctx = fakeContext();
    const failingGuard = { project: () => Promise.reject(new Error("boom")) };
    const listener = createLlmStreamListener(ctx, failingGuard, resolveGuardConfig({}).config);
    const options = loopRequest([user(text("no media"))]);
    await drain(listener(options, () => ctx.next()));
    assert.equal(ctx.nextCalls, 1);
    assert.equal(ctx.dispatched.length, 0);
  } finally {
    warnMock.mock.restore();
  }
});

test("apply registers the listener and enabled:false registers nothing", () => {
  const registrations: string[] = [];
  const applyContext = {
    on(event: string): () => void {
      registrations.push(event);
      return () => {};
    },
    emit() {},
    llm: { stream: () => (async function* () {})() },
  };
  apply(applyContext as never, {});
  assert.deepEqual(registrations, ["llm/stream"]);
  apply(applyContext as never, { enabled: false });
  assert.deepEqual(registrations, ["llm/stream"]);
});

test("apply surfaces config diagnostics but stays protective", () => {
  const warnMock = mock.method(console, "warn", () => {});
  try {
    const registrations: string[] = [];
    const applyContext = {
      on(event: string): () => void {
        registrations.push(event);
        return () => {};
      },
      emit() {},
      llm: { stream: () => (async function* () {})() },
    };
    apply(applyContext as never, { mode: "yolo" } as never);
    assert.deepEqual(registrations, ["llm/stream"]);
    assert.ok(warnMock.mock.callCount() >= 1);
  } finally {
    warnMock.mock.restore();
  }
});
