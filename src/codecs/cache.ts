import type { EncodedImage, ImageCodec, ImageTarget, MediaImage } from "../domain.js";

export interface CodecCacheOptions {
  maxEntries: number;
  maxSerializedBytes: number;
}

interface CacheEntry {
  value: EncodedImage | null;
  bytes: number;
}

export class CachingImageCodec implements ImageCodec {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<EncodedImage | null>>();
  private bytes = 0;

  constructor(
    private readonly delegate: ImageCodec,
    private readonly options: CodecCacheOptions = {
      maxEntries: 128,
      maxSerializedBytes: 256 * 1024 * 1024,
    },
  ) {}

  async constrain(image: MediaImage, target: ImageTarget): Promise<EncodedImage | null> {
    const key = [
      image.hash,
      image.mimeType,
      target.maxWidth,
      target.maxHeight,
      target.maxSerializedBytes,
    ].join(":");
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.value;
    }

    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const operation = this.delegate.constrain(image, target);
    this.inFlight.set(key, operation);
    let value: EncodedImage | null;
    try {
      value = await operation;
    } finally {
      this.inFlight.delete(key);
    }
    const bytes = value ? Buffer.byteLength(value.data, "utf8") : 0;
    if (bytes <= this.options.maxSerializedBytes && this.options.maxEntries > 0) {
      this.entries.set(key, { value, bytes });
      this.bytes += bytes;
      this.evict();
    }
    return value;
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
    this.bytes = 0;
  }

  private evict(): void {
    while (
      this.entries.size > this.options.maxEntries ||
      this.bytes > this.options.maxSerializedBytes
    ) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.bytes -= oldest?.bytes ?? 0;
    }
  }
}
