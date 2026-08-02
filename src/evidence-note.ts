import type { MediaLedgerItem, ProjectionReason } from "./domain.js";

const REASON_LABELS: Record<ProjectionReason, string> = {
  duplicate: "duplicate media",
  "per-image-budget": "per-image budget",
  "aggregate-budget": "aggregate budget",
};

export function createEvidenceNote(item: MediaLedgerItem, reason: ProjectionReason): string {
  const scope = item.currentWorkingSet ? "Current" : "Historical";
  return [
    `[${scope} image externalized by pi-media-guard]`,
    `Media hash: ${item.hash}`,
    `Original: ${item.mimeType}, ${item.serializedBytes} Base64 bytes`,
    `Reason: ${REASON_LABELS[reason]}`,
    "Known description: unavailable",
    "Re-read the source artifact if exact pixels or small labels are needed.",
  ].join("\n");
}
