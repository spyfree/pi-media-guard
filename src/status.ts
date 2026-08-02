import type { GuardReport } from "./domain.js";

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function formatMediaStatus(report: GuardReport): string {
  return [
    `Media Guard: ${report.pressure} (${report.mode})`,
    `Profile: ${report.budgetProfile}`,
    `Before: ${report.before.blocks} blocks, ${formatMiB(report.before.serializedBytes)} serialized`,
    `After: ${report.after.blocks} blocks, ${formatMiB(report.after.serializedBytes)} / ${formatMiB(report.budget.maxSerializedMediaBytes)}`,
    `Last projection: compressed ${report.compressed}, externalized ${report.externalized}, deduplicated ${report.deduplicated}`,
  ].join("\n");
}
