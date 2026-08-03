import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const ANONYMOUS_BASE64_LENGTHS = [1_820_000, 740_000, 1_210_000, 2_797_972] as const;

function anonymousBase64(length: number, marker: string): string {
  return `${"A".repeat(length - 4)}${marker}`;
}

export function fourImageFailureMessages(): AgentMessage[] {
  const messages: AgentMessage[] = [
    { role: "user", content: "Inspect these four anonymous screenshots", timestamp: 1 },
  ];
  const markers = ["AAAA", "AAAB", "AAAC", "AAAD"];
  ANONYMOUS_BASE64_LENGTHS.forEach((length, index) => {
    messages.push({
      role: "toolResult",
      toolCallId: `anonymous-call-${index + 1}`,
      toolName: "read",
      content: [
        {
          type: "image",
          data: anonymousBase64(length, markers[index] ?? "AAAA"),
          mimeType: "image/png",
        },
      ],
      isError: false,
      timestamp: index + 2,
    });
  });
  return messages;
}
