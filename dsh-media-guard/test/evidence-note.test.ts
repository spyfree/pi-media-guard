import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvidenceNote } from "../src/evidence-note.js";
import { buildMediaLedger } from "../src/ledger.js";
import { image, ref, user } from "./helpers.js";

test("notes are deterministic and carry only factual fields", () => {
  const attachment = ref(90_000, "note-src", { width: 640, height: 480 });
  const item = buildMediaLedger([user(image(attachment))])[0];
  assert.ok(item);
  const note = createEvidenceNote(item, "aggregate-budget");
  assert.equal(note, createEvidenceNote(item, "aggregate-budget"));
  assert.match(note, /^\[Current image externalized by dsh-media-guard\]/);
  assert.match(note, new RegExp(`Media hash: ${attachment.attachmentId}`));
  assert.match(note, /Original: image\/png, 90000 bytes \(120000 Base64 bytes\), 640x480/);
  assert.match(note, /Source: user message/);
  assert.match(note, /Reason: aggregate budget/);
  assert.match(note, /Known description: unavailable/);
});

test("historical scope and every reason label render", () => {
  const historical = buildMediaLedger([
    user(image(ref(10_000, "old"))),
    user(image(ref(10_001, "new"))),
  ])[0];
  assert.ok(historical);
  assert.match(createEvidenceNote(historical, "duplicate"), /^\[Historical image/);
  assert.match(createEvidenceNote(historical, "duplicate"), /Reason: duplicate media/);
  assert.match(createEvidenceNote(historical, "per-image-budget"), /Reason: per-image budget/);
});
