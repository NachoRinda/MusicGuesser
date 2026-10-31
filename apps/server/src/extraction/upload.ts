import {
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS_PER_UPLOAD,
  SCREENSHOT_MEDIA_TYPES,
  type Result,
  type ScreenshotMediaType,
} from "@mg/shared";

/** A validated screenshot, held only in memory. */
export interface ImageInput {
  mediaType: ScreenshotMediaType;
  data: Buffer;
}

/** Checks an untrusted `player:uploadScreenshots` payload. */
export function validateUpload(req: unknown): Result<{ images: ImageInput[] }> {
  const invalid = { ok: false, error: "INVALID_UPLOAD" } as const;
  const raw = (req as { images?: unknown } | undefined)?.images;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_SCREENSHOTS_PER_UPLOAD) return invalid;

  const images: ImageInput[] = [];
  for (const item of raw as { mediaType?: unknown; data?: unknown }[]) {
    if (!SCREENSHOT_MEDIA_TYPES.includes(item?.mediaType as ScreenshotMediaType)) return invalid;
    const data = toBuffer(item.data);
    if (!data || data.length === 0 || data.length > MAX_SCREENSHOT_BYTES) return invalid;
    images.push({ mediaType: item.mediaType as ScreenshotMediaType, data });
  }
  return { ok: true, images };
}

function toBuffer(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return null;
}
