import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { MediaFootprint, MediaLedgerItem } from "./domain.js";
import { decodedBase64Bytes } from "./media-bytes.js";

function isImageContent(value: unknown): value is ImageContent {
  if (typeof value !== "object" || value === null) return false;
  const block = value as Partial<ImageContent>;
  return (
    block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string"
  );
}

// The ledger is rebuilt several times per request and session images are
// re-sent on every model call, so the same Base64 payloads are hashed over and
// over. Content-keyed memoization is safe across sessions; the bound keeps the
// memo from retaining large Base64 strings after their session is gone.
const HASH_MEMO_MAX_ENTRIES = 256;
const hashMemo = new Map<string, string>();

function hashOfBase64(data: string): string {
  const cached = hashMemo.get(data);
  if (cached !== undefined) {
    hashMemo.delete(data);
    hashMemo.set(data, cached);
    return cached;
  }
  const hash = `sha256:${createHash("sha256").update(Buffer.from(data, "base64")).digest("hex")}`;
  hashMemo.set(data, hash);
  if (hashMemo.size > HASH_MEMO_MAX_ENTRIES) {
    const oldest = hashMemo.keys().next().value;
    if (oldest !== undefined) hashMemo.delete(oldest);
  }
  return hash;
}

function contentOf(message: AgentMessage): unknown[] {
  if (!("content" in message) || !Array.isArray(message.content)) return [];
  return message.content;
}

function priorityFor(message: AgentMessage, currentWorkingSet: boolean): number {
  if (currentWorkingSet && message.role === "user") return 700;
  if (currentWorkingSet && message.role === "toolResult") return 600;
  if (currentWorkingSet) return 550;
  if (message.role === "user") return 500;
  if (message.role === "toolResult") return 400;
  return 300;
}

const MAX_ORIGIN_LENGTH = 160;

function formatToolCall(name: string, args: unknown): string {
  let serialized = "";
  try {
    serialized = args === undefined ? "" : (JSON.stringify(args) ?? "");
  } catch {
    serialized = "";
  }
  const origin = `tool ${name}(${serialized})`;
  return origin.length > MAX_ORIGIN_LENGTH ? `${origin.slice(0, MAX_ORIGIN_LENGTH - 1)}…` : origin;
}

function describeToolCalls(messages: AgentMessage[]): Map<string, string> {
  const calls = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of contentOf(message)) {
      if (typeof block !== "object" || block === null) continue;
      const call = block as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
      if (
        call.type !== "toolCall" ||
        typeof call.id !== "string" ||
        typeof call.name !== "string"
      ) {
        continue;
      }
      calls.set(call.id, formatToolCall(call.name, call.arguments));
    }
  }
  return calls;
}

function originFor(message: AgentMessage, toolCalls: ReadonlyMap<string, string>): string {
  if (message.role === "toolResult") {
    return toolCalls.get(message.toolCallId) ?? `tool ${message.toolName}`;
  }
  return `${message.role} message`;
}

export function buildMediaLedger(messages: AgentMessage[]): MediaLedgerItem[] {
  let currentTurnStart = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      currentTurnStart = index;
      break;
    }
  }

  const toolCalls = describeToolCalls(messages);
  const ledger: MediaLedgerItem[] = [];
  messages.forEach((message, messageIndex) => {
    contentOf(message).forEach((block, contentIndex) => {
      if (!isImageContent(block)) return;
      const currentWorkingSet = currentTurnStart >= 0 && messageIndex >= currentTurnStart;
      ledger.push({
        messageIndex,
        contentIndex,
        kind: "image",
        mimeType: block.mimeType,
        hash: hashOfBase64(block.data),
        serializedBytes: Buffer.byteLength(block.data, "utf8"),
        decodedBytes: decodedBase64Bytes(block.data),
        age: messages.length - 1 - messageIndex,
        currentWorkingSet,
        priority: priorityFor(message, currentWorkingSet),
        origin: originFor(message, toolCalls),
      });
    });
  });
  return ledger;
}

export function mediaFootprint(items: MediaLedgerItem[]): MediaFootprint {
  return items.reduce<MediaFootprint>(
    (total, item) => ({
      blocks: total.blocks + 1,
      serializedBytes: total.serializedBytes + item.serializedBytes,
      decodedBytes: total.decodedBytes + item.decodedBytes,
    }),
    { blocks: 0, serializedBytes: 0, decodedBytes: 0 },
  );
}
