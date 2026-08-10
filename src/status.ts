import type { BudgetDecision, GuardMode, GuardReport, PressureLevel } from "./domain.js";
import { REASON_LABELS } from "./evidence-note.js";
import { formatMiB } from "./media-bytes.js";

const PRESSURE_LABELS: Readonly<Record<PressureLevel, string>> = Object.freeze({
  green: "safe",
  yellow: "near limit",
  red: "over limit",
});

function imageLabel(count: number): string {
  return `${count} image${count === 1 ? "" : "s"}`;
}

function compactProcessingSummary(report: GuardReport): string {
  if (report.mode === "observe") return "observe only";
  const actions = [
    report.compressed > 0 ? `${report.compressed} compressed` : undefined,
    report.externalized > 0 ? `${report.externalized} externalized` : undefined,
    report.deduplicated > 0 ? `${report.deduplicated} deduplicated` : undefined,
  ].filter((action): action is string => action !== undefined);
  return actions.length > 0 ? actions.join(", ") : "unchanged";
}

export function formatMediaFooterStatus(report: GuardReport): string {
  if (report.disabled) return "media guard off";
  const current = PRESSURE_LABELS[report.currentPressure];
  const inputTransition =
    report.pressure === report.currentPressure
      ? ""
      : ` · input ${PRESSURE_LABELS[report.pressure]}`;
  return (
    [
      `media ${current} now`,
      `${report.after.blocks}/${report.before.blocks} ${report.before.blocks === 1 ? "image" : "images"} kept`,
      `${formatMiB(report.after.serializedBytes, 1, "M")}/${formatMiB(report.budget.maxSerializedMediaBytes, 1, "M")}`,
      compactProcessingSummary(report),
    ].join(" · ") + inputTransition
  );
}

export function formatMediaStatus(report: GuardReport): string {
  if (report.disabled) {
    return "Media Guard: disabled (`enabled: false`) — requests pass through unchanged";
  }
  return [
    `Media Guard: ${PRESSURE_LABELS[report.currentPressure]} now (${report.mode})`,
    `Profile: ${report.budgetProfile}`,
    `Input: ${PRESSURE_LABELS[report.pressure]} (${report.pressure}) — ${imageLabel(report.before.blocks)}, ${formatMiB(report.before.serializedBytes)} serialized`,
    `Current: ${PRESSURE_LABELS[report.currentPressure]} (${report.currentPressure}) — ${report.after.blocks}/${report.before.blocks} ${report.before.blocks === 1 ? "image" : "images"} kept, ${formatMiB(report.after.serializedBytes)} / ${formatMiB(report.budget.maxSerializedMediaBytes)}`,
    `Processing: compressed ${report.compressed}, externalized ${report.externalized}, deduplicated ${report.deduplicated}`,
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
