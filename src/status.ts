import type { BudgetDecision, GuardMode, GuardReport } from "./domain.js";
import { REASON_LABELS } from "./evidence-note.js";
import { formatMiB } from "./media-bytes.js";

export function formatMediaStatus(report: GuardReport): string {
  if (report.disabled) {
    return "Media Guard: disabled (`enabled: false`) — requests pass through unchanged";
  }
  return [
    `Media Guard: ${report.pressure} (${report.mode})`,
    `Profile: ${report.budgetProfile}`,
    `Before: ${report.before.blocks} blocks, ${formatMiB(report.before.serializedBytes)} serialized`,
    `After: ${report.after.blocks} blocks, ${formatMiB(report.after.serializedBytes)} / ${formatMiB(report.budget.maxSerializedMediaBytes)}`,
    `Last projection: compressed ${report.compressed}, externalized ${report.externalized}, deduplicated ${report.deduplicated}`,
  ].join("\n");
}

/**
 * Per-image breakdown of the last projection, answering "why did my image
 * disappear". In non-protect modes the decisions are what `protect` would do.
 */
export function formatMediaLedger(decisions: BudgetDecision[], mode: GuardMode): string {
  if (decisions.length === 0) {
    return "Media Guard ledger: the last projected request contained no media";
  }
  const header =
    mode === "protect"
      ? `Media Guard ledger (${decisions.length} image${decisions.length === 1 ? "" : "s"}):`
      : `Media Guard ledger (${decisions.length} image${decisions.length === 1 ? "" : "s"}; mode ${mode} does not externalize — showing what protect would decide):`;
  const lines = decisions.map((decision) => {
    const item = decision.item;
    const action =
      decision.action === "keep"
        ? "keep"
        : `externalize (${decision.reason ? REASON_LABELS[decision.reason] : "budget"})`;
    const shortHash = item.hash.replace(/^sha256:/, "").slice(0, 12);
    const scope = item.currentWorkingSet ? "current" : "history";
    return `  ${item.messageIndex}:${item.contentIndex} ${action} — ${shortHash} ${formatMiB(item.serializedBytes)} ${item.mimeType} ${scope} — ${item.origin}`;
  });
  return [header, ...lines].join("\n");
}
