import type { GuardReport } from "./domain.js";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${bytes}B`;
}

/**
 * One-line report summary, e.g.
 * `media safe now · 4/4 images kept · 1.5M/2.0M · 2 compressed · input over limit`.
 * Distinguishes the original input pressure from the projected request's.
 */
export function formatReportSummary(report: GuardReport): string {
  const parts: string[] = [];
  parts.push(
    report.currentPressure === "red"
      ? "media over limit"
      : report.currentPressure === "yellow"
        ? "media near limit"
        : "media safe now",
  );
  parts.push(`${report.kept}/${report.before.blocks} images kept`);
  parts.push(
    `${formatBytes(report.after.serializedBytes)}/${formatBytes(report.budget.maxSerializedMediaBytes)}`,
  );
  if (report.compressed > 0) parts.push(`${report.compressed} compressed`);
  if (report.externalized > 0) parts.push(`${report.externalized} externalized`);
  if (report.deduplicated > 0) parts.push(`${report.deduplicated} deduplicated`);
  if (report.pressure !== report.currentPressure && report.pressure === "red") {
    parts.push("input over limit");
  }
  return parts.join(" · ");
}
