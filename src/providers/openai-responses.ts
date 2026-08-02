export interface PayloadFootprint {
  totalSerializedBytes: number;
  mediaBlocks: number;
  serializedMediaBytes: number;
  decodedMediaBytes: number;
}

function decodedBase64Bytes(data: string): number {
  if (data.length === 0) return 0;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

function base64ImageData(value: string): string | undefined {
  if (!value.startsWith("data:image/")) return undefined;
  const marker = ";base64,";
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) return undefined;
  return value.slice(markerIndex + marker.length);
}

export function emergencyProjectOpenAIResponsesPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map((value) => emergencyProjectOpenAIResponsesPayload(value));
  }
  if (typeof payload !== "object" || payload === null) return payload;
  const record = payload as Record<string, unknown>;
  if (
    record.type === "input_image" &&
    typeof record.image_url === "string" &&
    base64ImageData(record.image_url) !== undefined
  ) {
    return {
      type: "input_text",
      text: "[Image externalized by pi-media-guard final payload guard: declared media budget exceeded]",
    };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      emergencyProjectOpenAIResponsesPayload(value),
    ]),
  );
}

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
    if (typeof value === "string") {
      const data = base64ImageData(value);
      if (data !== undefined) {
        mediaBlocks += 1;
        serializedMediaBytes += Buffer.byteLength(data, "utf8");
        decodedMediaBytes += decodedBase64Bytes(data);
      }
      continue;
    }
    if (typeof value !== "object" || value === null || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) pending.push(...value);
    else pending.push(...Object.values(value));
  }

  return { totalSerializedBytes, mediaBlocks, serializedMediaBytes, decodedMediaBytes };
}
