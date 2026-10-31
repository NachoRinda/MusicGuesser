import type { ScreenshotReading } from "./evaluate.js";
import type { ImageInput } from "./upload.js";

/** Reads tracks from 1–2 screenshots, returning one reading per image in the same order. Throws on technical failure. */
export interface Extractor {
  extract(images: ImageInput[]): Promise<ScreenshotReading[]>;
}
