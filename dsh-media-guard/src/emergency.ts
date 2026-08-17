import { freezeMessage } from "@deepseek-ai/dsh-llm";
import type { ContentBlock, Message } from "@deepseek-ai/dsh-llm";

const EMERGENCY_NOTE =
  "[Image removed by dsh-media-guard emergency projection; the original attachment remains in the session log]";

interface StripOutcome {
  content: ContentBlock[];
  stripped: number;
}

function stripContent(content: ContentBlock[]): StripOutcome {
  let stripped = 0;
  const next = content.map((block): ContentBlock => {
    if (typeof block !== "object" || block === null) return block;
    if (block.type === "image") {
      stripped += 1;
      return { type: "text", text: EMERGENCY_NOTE };
    }
    if (block.type === "tool-result") {
      const inner = stripContent(block.content);
      if (inner.stripped === 0) return block;
      stripped += inner.stripped;
      return { ...block, content: inner.content };
    }
    return block;
  });
  return { content: stripped > 0 ? next : content, stripped };
}

/**
 * The deliberately simpler second path used when the primary projection
 * throws: replace every image leaf with a fixed note, with no hashing and no
 * budget math, so this fallback cannot share failure modes with the primary
 * pipeline. Returns the original array unchanged when nothing was stripped.
 */
export function stripImageLeaves(messages: Message[]): { messages: Message[]; stripped: number } {
  let stripped = 0;
  const next = messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const outcome = stripContent(message.content);
    if (outcome.stripped === 0) return message;
    stripped += outcome.stripped;
    return freezeMessage({ ...message, content: outcome.content });
  });
  return stripped > 0 ? { messages: next, stripped } : { messages, stripped: 0 };
}
