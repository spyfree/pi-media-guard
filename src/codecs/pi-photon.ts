import { resizeImage } from "@earendil-works/pi-coding-agent";
import type { EncodedImage, ImageCodec, ImageTarget, MediaImage } from "../domain.js";

type ResizeImage = typeof resizeImage;

export class PiPhotonCodec implements ImageCodec {
  constructor(private readonly resize: ResizeImage = resizeImage) {}

  async constrain(image: MediaImage, target: ImageTarget): Promise<EncodedImage | null> {
    const result = await this.resize(Buffer.from(image.data, "base64"), image.mimeType, {
      maxWidth: target.maxWidth,
      maxHeight: target.maxHeight,
      maxBytes: target.maxSerializedBytes,
      jpegQuality: 80,
    });
    if (!result) return null;
    return {
      data: result.data,
      mimeType: result.mimeType,
      width: result.width,
      height: result.height,
    };
  }
}
