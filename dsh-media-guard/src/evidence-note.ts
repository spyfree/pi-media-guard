import type { MediaLedgerItem, ProjectionReason } from "./domain.js";

export const REASON_LABELS: Record<ProjectionReason, string> = {
  duplicate: "duplicate media",
  "per-image-budget": "per-image budget",
  "aggregate-budget": "aggregate budget",
};

/**
 * A deterministic, purely factual replacement for an externalized image: no
 * invented semantic description and no operative directives, so the note can
 * never smuggle instructions into the request. The original image stays in
 * the durable session log and attachment store untouched.
 */
export function createEvidenceNote(item: MediaLedgerItem, reason: ProjectionReason): string {
  const scope = item.currentWorkingSet ? "Current" : "Historical";
  return [
    `[${scope} image externalized by dsh-media-guard]`,
    `Media hash: ${item.hash}`,
    `Original: ${item.mediaType}, ${item.decodedBytes} bytes (${item.serializedBytes} Base64 bytes), ${item.width}x${item.height}`,
    `Source: ${item.origin}`,
    `Reason: ${REASON_LABELS[reason]}`,
    "Known description: unavailable",
    "The original attachment remains in the session log; re-read the source artifact if exact pixels or small labels are needed.",
  ].join("\n");
}
