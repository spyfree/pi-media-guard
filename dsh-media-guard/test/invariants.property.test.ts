import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@deepseek-ai/dsh-llm";
import fc from "fast-check";
import type { MediaBudget } from "../src/domain.js";
import { buildMediaLedger } from "../src/ledger.js";
import { createMediaGuard } from "../src/media-guard.js";
import { image, ref, text, toolResult, user } from "./helpers.js";

const imageSpec = fc.record({
  bytes: fc.integer({ min: 0, max: 4_000_000 }),
  // A small seed pool forces duplicate content addresses.
  seed: fc.integer({ min: 0, max: 5 }),
  inToolResult: fc.boolean(),
});

const budgetArbitrary: fc.Arbitrary<MediaBudget> = fc.record({
  maxMediaBlocks: fc.integer({ min: 0, max: 10 }),
  maxSerializedMediaBytes: fc.integer({ min: 0, max: 6_000_000 }),
  maxDecodedMediaBytes: fc.integer({ min: 0, max: 5_000_000 }),
  maxSerializedBytesPerImage: fc.integer({ min: 0, max: 3_000_000 }),
});

function messagesFrom(specs: { bytes: number; seed: number; inToolResult: boolean }[]): Message[] {
  const messages: Message[] = [user(text("prompt"))];
  specs.forEach((spec, index) => {
    // Seeded bytes keep identical seeds identical in content (a real content
    // address never maps one hash to two sizes).
    const attachment = ref(spec.seed === 0 ? 1_000 : spec.seed * 700_001, `seed-${spec.seed}`);
    if (spec.inToolResult) {
      messages.push(toolResult(`call-${index}`, image(attachment)));
    } else {
      messages.push(user(image(attachment), text(`caption ${index}`)));
    }
  });
  return messages;
}

test("protect projections never exceed any budget dimension", async () => {
  const guard = createMediaGuard();
  await fc.assert(
    fc.asyncProperty(
      fc.array(imageSpec, { maxLength: 12 }),
      budgetArbitrary,
      async (specs, budget) => {
        const messages = messagesFrom(specs);
        const result = await guard.project(messages, { mode: "protect", budget });
        const after = buildMediaLedger(result.messages);
        const serialized = after.reduce((sum, item) => sum + item.serializedBytes, 0);
        const decoded = after.reduce((sum, item) => sum + item.decodedBytes, 0);
        assert.ok(after.length <= budget.maxMediaBlocks);
        assert.ok(serialized <= budget.maxSerializedMediaBytes);
        assert.ok(decoded <= budget.maxDecodedMediaBytes);
        for (const item of after) {
          assert.ok(item.serializedBytes <= budget.maxSerializedBytesPerImage);
        }
      },
    ),
    { numRuns: 150 },
  );
});

test("projections preserve message count, order, roles, and identities", async () => {
  const guard = createMediaGuard();
  await fc.assert(
    fc.asyncProperty(fc.array(imageSpec, { maxLength: 12 }), async (specs) => {
      const messages = messagesFrom(specs);
      const result = await guard.project(messages, { mode: "protect" });
      assert.equal(result.messages.length, messages.length);
      messages.forEach((original, index) => {
        const projected = result.messages[index];
        assert.ok(projected);
        assert.equal(projected.id, original.id);
        assert.equal(projected.role, original.role);
        assert.equal(projected.content.length, original.content.length);
        assert.deepEqual(projected.source, original.source);
      });
    }),
    { numRuns: 100 },
  );
});

test("projection is idempotent for arbitrary inputs", async () => {
  const guard = createMediaGuard();
  await fc.assert(
    fc.asyncProperty(
      fc.array(imageSpec, { maxLength: 12 }),
      budgetArbitrary,
      async (specs, budget) => {
        const messages = messagesFrom(specs);
        const first = await guard.project(messages, { mode: "protect", budget });
        const second = await guard.project(first.messages, { mode: "protect", budget });
        assert.equal(second.messages, first.messages);
      },
    ),
    { numRuns: 100 },
  );
});
