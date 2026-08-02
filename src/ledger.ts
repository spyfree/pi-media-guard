import { createHash } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { MediaFootprint, MediaLedgerItem } from "./domain.js";

function isImageContent(value: unknown): value is ImageContent {
  if (typeof value !== "object" || value === null) return false;
  const block = value as Partial<ImageContent>;
  return block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string";
}

function decodedBase64Bytes(data: string): number {
  if (data.length === 0) return 0;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
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

export function buildMediaLedger(messages: AgentMessage[]): MediaLedgerItem[] {
  let currentTurnStart = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      currentTurnStart = index;
      break;
    }
  }

  const ledger: MediaLedgerItem[] = [];
  messages.forEach((message, messageIndex) => {
    contentOf(message).forEach((block, contentIndex) => {
      if (!isImageContent(block)) return;
      const currentWorkingSet = currentTurnStart >= 0 && messageIndex >= currentTurnStart;
      const digest = createHash("sha256").update(Buffer.from(block.data, "base64")).digest("hex");
      ledger.push({
        messageIndex,
        contentIndex,
        kind: "image",
        mimeType: block.mimeType,
        hash: `sha256:${digest}`,
        serializedBytes: Buffer.byteLength(block.data, "utf8"),
        decodedBytes: decodedBase64Bytes(block.data),
        age: messages.length - 1 - messageIndex,
        currentWorkingSet,
        priority: priorityFor(message, currentWorkingSet),
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
