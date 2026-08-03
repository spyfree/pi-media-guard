import { decodedBase64Bytes } from "../media-bytes.js";

export interface PayloadFootprint {
  totalSerializedBytes: number;
  mediaBlocks: number;
  serializedMediaBytes: number;
  decodedMediaBytes: number;
}

function base64ImageData(value: string): string | undefined {
  if (!value.startsWith("data:image/")) return undefined;
  const marker = ";base64,";
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) return undefined;
  return value.slice(markerIndex + marker.length);
}

function base64ImageBlockData(value: object): string | undefined {
  const record = value as Record<string, unknown>;
  if (record.type !== "input_image" || typeof record.image_url !== "string") return undefined;
  return base64ImageData(record.image_url);
}

const EMERGENCY_NOTE_TEXT =
  "[Image externalized by pi-media-guard final payload guard: declared media budget exceeded]";

function projectValue(value: unknown, memo: WeakMap<object, unknown>): unknown {
  if (typeof value !== "object" || value === null) return value;
  // Shared references and cycles resolve to the clone already being built, so
  // the emergency path cannot recurse forever on a malformed payload.
  const existing = memo.get(value);
  if (existing !== undefined) return existing;
  if (Array.isArray(value)) {
    const projected: unknown[] = [];
    memo.set(value, projected);
    for (const entry of value) projected.push(projectValue(entry, memo));
    return projected;
  }
  if (base64ImageBlockData(value) !== undefined) {
    return { type: "input_text", text: EMERGENCY_NOTE_TEXT };
  }
  const record = value as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  memo.set(value, projected);
  for (const [key, entry] of Object.entries(record)) {
    projected[key] = projectValue(entry, memo);
  }
  return projected;
}

export function emergencyProjectOpenAIResponsesPayload(payload: unknown): unknown {
  return projectValue(payload, new WeakMap());
}

/**
 * Counts only structural `input_image` blocks carrying Base64 data URLs — the
 * same shapes the emergency projection can rewrite. A data URL pasted into
 * ordinary text is token payload the provider never decodes as an image, and
 * counting it would raise a budget error that no surgery could resolve.
 */
export function inspectOpenAIResponsesPayload(payload: unknown): PayloadFootprint {
  let totalSerializedBytes = 0;
  try {
    totalSerializedBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    // A provider payload must be serializable, but audit remains diagnostic-only.
  }

  let mediaBlocks = 0;
  let serializedMediaBytes = 0;
  let decodedMediaBytes = 0;
  const pending: unknown[] = [payload];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== "object" || value === null || visited.has(value)) continue;
    visited.add(value);
    const data = base64ImageBlockData(value);
    if (data !== undefined) {
      mediaBlocks += 1;
      serializedMediaBytes += Buffer.byteLength(data, "utf8");
      decodedMediaBytes += decodedBase64Bytes(data);
      continue;
    }
    if (Array.isArray(value)) pending.push(...value);
    else pending.push(...Object.values(value));
  }

  return { totalSerializedBytes, mediaBlocks, serializedMediaBytes, decodedMediaBytes };
}
