import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import type { ContentBlock, ImageBlock, Message } from "@deepseek-ai/dsh-llm";
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from "@deepseek-ai/dsh-llm";

/** Deterministic content-addressed ref: the seed fixes the attachment id. */
export function ref(
  bytes: number,
  seed: string,
  overrides: Partial<ImageAttachmentRef> = {},
): ImageAttachmentRef {
  const hex = Buffer.from(seed, "utf8").toString("hex").padEnd(64, "0").slice(0, 64);
  return {
    attachmentId: AttachmentId(`sha256:${hex}`),
    mediaType: "image/png",
    bytes,
    width: 1200,
    height: 800,
    ...overrides,
  };
}

export function image(attachment: ImageAttachmentRef): ImageBlock {
  return { type: "image", attachment };
}

export function text(value: string): ContentBlock {
  return { type: "text", text: value };
}

export function user(...content: ContentBlock[]): Message {
  return createUserMessage({ content, source: { kind: "user" } });
}

export function pluginMessage(plugin: string, ...content: ContentBlock[]): Message {
  return createUserMessage({ content, source: { kind: "plugin", plugin } });
}

/** A subagent coordinator relay: user role, merge-extended source kind. */
export function coordinatorMessage(...content: ContentBlock[]): Message {
  return createUserMessage({
    content,
    source: { kind: "coordinator" } as unknown as Message["source"],
  });
}

export function assistantText(value: string): Message {
  return createAssistantMessage({
    content: [text(value)],
    source: { provider: "test-provider", model: "test-model" },
  });
}

export function assistantToolCall(callId: string, name: string, rawArguments: string): Message {
  return createAssistantMessage({
    content: [{ type: "tool-call", id: CallId(callId), name, arguments: rawArguments }],
    source: { provider: "test-provider", model: "test-model" },
  });
}

export function toolResult(callId: string, ...content: ContentBlock[]): Message {
  return createToolResultMessage({ callId: CallId(callId), content, isError: false });
}

/** Serialized Base64 size for a decoded byte length divisible by 3. */
export function decodedFor(serializedBytes: number): number {
  if (serializedBytes % 4 !== 0) throw new Error("serialized size must be divisible by 4");
  return (serializedBytes / 4) * 3;
}
