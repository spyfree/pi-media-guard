import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import type { ContentBlock, ImageBlock, Message, ToolResultBlock } from "@deepseek-ai/dsh-llm";
import type { MediaFootprint, MediaLedgerItem } from "./domain.js";
import { base64BytesForBinary } from "./media-bytes.js";

function isImageRef(value: unknown): value is ImageAttachmentRef {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Partial<ImageAttachmentRef>;
  return (
    typeof ref.attachmentId === "string" &&
    typeof ref.mediaType === "string" &&
    typeof ref.bytes === "number" &&
    Number.isFinite(ref.bytes) &&
    ref.bytes >= 0 &&
    typeof ref.width === "number" &&
    typeof ref.height === "number"
  );
}

function isImageBlock(value: unknown): value is ImageBlock {
  if (typeof value !== "object" || value === null) return false;
  const block = value as Partial<ImageBlock>;
  return block.type === "image" && isImageRef(block.attachment);
}

function isToolResultBlock(value: unknown): value is ToolResultBlock {
  if (typeof value !== "object" || value === null) return false;
  const block = value as Partial<ToolResultBlock>;
  return block.type === "tool-result" && Array.isArray(block.content);
}

type ImageVisitor = (
  block: ImageBlock,
  path: readonly number[],
  toolCallId: string | undefined,
) => void;

/**
 * Visit every image leaf, walking nested tool-result content the same way
 * dsh-llm's `contentHasImage` does, so the ledger and the harness's own image
 * policies agree on nesting depth.
 */
export function walkImages(
  content: readonly unknown[],
  path: readonly number[],
  toolCallId: string | undefined,
  visit: ImageVisitor,
): void {
  content.forEach((block, index) => {
    if (isImageBlock(block)) {
      visit(block, [...path, index], toolCallId);
      return;
    }
    if (isToolResultBlock(block)) {
      const nestedCallId = typeof block.toolCallId === "string" ? block.toolCallId : toolCallId;
      walkImages(block.content, [...path, index], nestedCallId, visit);
    }
  });
}

function contentOf(message: Message): readonly unknown[] {
  return Array.isArray(message.content) ? message.content : [];
}

function sourceKind(message: Message): string | undefined {
  const source = message.source as { kind?: unknown } | undefined;
  return typeof source?.kind === "string" ? source.kind : undefined;
}

type ItemClass = "user" | "tool" | "other";

function classify(message: Message, insideToolResult: boolean): ItemClass {
  if (insideToolResult || sourceKind(message) === "tool") return "tool";
  if (message.role === "user" && sourceKind(message) === "user") return "user";
  return "other";
}

function priorityFor(itemClass: ItemClass, currentWorkingSet: boolean): number {
  if (itemClass === "user") return currentWorkingSet ? 700 : 500;
  if (itemClass === "tool") return currentWorkingSet ? 600 : 400;
  return currentWorkingSet ? 550 : 300;
}

const MAX_ORIGIN_LENGTH = 160;

function formatToolCall(name: string, rawArguments: string): string {
  const origin = `tool ${name}(${rawArguments})`;
  return origin.length > MAX_ORIGIN_LENGTH ? `${origin.slice(0, MAX_ORIGIN_LENGTH - 1)}…` : origin;
}

function describeToolCalls(messages: Message[]): Map<string, string> {
  const calls = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of contentOf(message)) {
      if (typeof block !== "object" || block === null) continue;
      const call = block as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
      if (call.type !== "tool-call" || typeof call.id !== "string" || typeof call.name !== "string")
        continue;
      calls.set(call.id, formatToolCall(call.name, typeof call.arguments === "string" ? call.arguments : ""));
    }
  }
  return calls;
}

function originFor(
  message: Message,
  toolCallId: string | undefined,
  toolCalls: ReadonlyMap<string, string>,
): string {
  if (toolCallId !== undefined) return toolCalls.get(toolCallId) ?? "tool result";
  const kind = sourceKind(message);
  if (kind === "user") return "user message";
  if (kind === "plugin") {
    const plugin = (message.source as { plugin?: unknown }).plugin;
    return typeof plugin === "string" ? `plugin ${plugin} message` : "plugin message";
  }
  if (kind === "model") return "assistant message";
  return `${message.role} message`;
}

/**
 * Inventory every image in the outgoing request as zero-byte-cost metadata:
 * identity is the attachment service's content address, sizes come from the
 * reference, and no image data is ever read or hashed here.
 */
export function buildMediaLedger(messages: Message[]): MediaLedgerItem[] {
  let currentTurnStart = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message !== undefined && message.role === "user" && sourceKind(message) === "user") {
      currentTurnStart = index;
      break;
    }
  }

  const toolCalls = describeToolCalls(messages);
  const ledger: MediaLedgerItem[] = [];
  messages.forEach((message, messageIndex) => {
    walkImages(contentOf(message), [], undefined, (block, path, toolCallId) => {
      const currentWorkingSet = currentTurnStart >= 0 && messageIndex >= currentTurnStart;
      const itemClass = classify(message, toolCallId !== undefined);
      const ref = block.attachment;
      ledger.push({
        messageIndex,
        path,
        kind: "image",
        mediaType: ref.mediaType,
        hash: ref.attachmentId,
        serializedBytes: base64BytesForBinary(ref.bytes),
        decodedBytes: ref.bytes,
        width: ref.width,
        height: ref.height,
        age: messages.length - 1 - messageIndex,
        currentWorkingSet,
        priority: priorityFor(itemClass, currentWorkingSet),
        origin: originFor(message, toolCallId, toolCalls),
        ref,
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
