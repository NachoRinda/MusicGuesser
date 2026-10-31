import { FAKE_TRACK_POOL } from "@mg/shared";
import type { ScreenshotReading } from "./evaluate.js";
import type { Extractor } from "./Extractor.js";
import type { ImageInput } from "./upload.js";

const TRACKS_PER_IMAGE = 12;
const FEW_TRACKS = 5;

/**
 * Deterministic stand-in for the vision model (tests, playtest, dev without an API key).
 * Markers in the image bytes pick the outcome: `MG-INVALID` → not a playlist, `MG-FEW` → 5 tracks,
 * `MG-ERROR` → throws. Otherwise 12 consecutive tracks from the fake pool, starting at an offset
 * derived from the bytes, so different images overlap partially.
 */
export class FakeExtractor implements Extractor {
  constructor(private readonly delayMs = 0) {}

  async extract(images: ImageInput[]): Promise<ScreenshotReading[]> {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return images.map((image) => {
      if (image.data.includes("MG-ERROR")) throw new Error("FakeExtractor: simulated failure");
      if (image.data.includes("MG-INVALID")) return { isPlaylist: false, platform: null, tracks: [] };
      const count = image.data.includes("MG-FEW") ? FEW_TRACKS : TRACKS_PER_IMAGE;
      const offset = hash(image.data) % FAKE_TRACK_POOL.length;
      const tracks = Array.from({ length: count }, (_, i) => FAKE_TRACK_POOL[(offset + i) % FAKE_TRACK_POOL.length]!);
      return { isPlaylist: true, platform: "spotify", tracks };
    });
  }
}

/** FNV-1a over the bytes. */
function hash(data: Buffer): number {
  let h = 0x811c9dc5;
  for (const byte of data) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h;
}
