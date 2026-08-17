/**
 * Bytes a standard padded Base64 encoding spends on a binary payload. DSH
 * carries images as attachment references until the provider adapter embeds
 * them, so serialized cost is derived from `ref.bytes` without reading data.
 */
export function base64BytesForBinary(byteLength: number): number {
  if (byteLength <= 0) return 0;
  return 4 * Math.ceil(byteLength / 3);
}
