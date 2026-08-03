import type { AgentMessage } from "@earendil-works/pi-agent-core";

const EMERGENCY_NOTE_TEXT =
  "[Image externalized by pi-media-guard emergency projection: the primary projection failed]";

/**
 * Last-resort projection used when the primary guard throws. Deliberately does
 * no hashing, no ledger building, and no budget math — only a structural
 * image-to-text substitution — so a failure in the primary pipeline cannot
 * recur here. A message that cannot even be inspected is passed through as-is.
 */
export function stripImageLeaves(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    try {
      if (!("content" in message) || !Array.isArray(message.content)) return message;
      let changed = false;
      const content = message.content.map((block) => {
        if (
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "image"
        ) {
          changed = true;
          return { type: "text" as const, text: EMERGENCY_NOTE_TEXT };
        }
        return block;
      });
      return changed ? ({ ...message, content } as AgentMessage) : message;
    } catch {
      return message;
    }
  });
}
