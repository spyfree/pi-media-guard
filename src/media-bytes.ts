/** Byte accounting shared by the ledger, payload audits, and status output. */

export function decodedBase64Bytes(data: string): number {
  if (data.length === 0) return 0;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

export function formatMiB(bytes: number, decimals = 2, unit = " MiB"): string {
  return `${(bytes / (1024 * 1024)).toFixed(decimals)}${unit}`;
}
