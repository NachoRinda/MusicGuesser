import {
  MAX_SCREENSHOT_BYTES,
  SCREENSHOT_MAX_SIDE_PX,
  SCREENSHOT_MEDIA_TYPES,
  type ScreenshotMediaType,
  type ScreenshotUpload,
} from "@mg/shared";

/**
 * Gets a screenshot ready to send: images that are already small and in a supported format go as-is;
 * the rest (long scroll captures, huge files, HEIC…) are scaled to fit SCREENSHOT_MAX_SIDE_PX and
 * re-encoded as JPEG. Everything happens in memory.
 */
export async function prepareScreenshot(file: File): Promise<ScreenshotUpload> {
  const supported = SCREENSHOT_MEDIA_TYPES.includes(file.type as ScreenshotMediaType);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Not decodable here: send supported types untouched and let the server decide.
    if (supported && file.size <= MAX_SCREENSHOT_BYTES) {
      return { mediaType: file.type as ScreenshotMediaType, data: await file.arrayBuffer() };
    }
    throw new Error("No pudimos abrir esa imagen");
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (supported && file.size <= MAX_SCREENSHOT_BYTES && longest <= SCREENSHOT_MAX_SIDE_PX) {
      return { mediaType: file.type as ScreenshotMediaType, data: await file.arrayBuffer() };
    }
    const scale = Math.min(1, SCREENSHOT_MAX_SIDE_PX / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.7, 0.5]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_SCREENSHOT_BYTES) return { mediaType: "image/jpeg", data: await blob.arrayBuffer() };
    }
    throw new Error("La imagen es demasiado grande");
  } finally {
    bitmap.close();
  }
}
