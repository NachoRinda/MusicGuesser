/** Screenshot upload + extraction contract (phase 3). */
import type { Track } from "./types.js";

export const MIN_TRACKS_TO_BE_READY = 10;
export const MAX_SCREENSHOTS_PER_UPLOAD = 2;
/**
 * Max bytes per image as received by the server. The Claude API caps images at 5 MB of base64,
 * and base64 inflates by 4/3, so 3.75 MB of raw bytes is the most that always fits.
 */
export const MAX_SCREENSHOT_BYTES = 3.75 * 1024 * 1024;
/** The client shrinks images whose longest side exceeds this, or whose size exceeds MAX_SCREENSHOT_BYTES. */
export const SCREENSHOT_MAX_SIDE_PX = 2000;
export const SCREENSHOT_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ScreenshotMediaType = (typeof SCREENSHOT_MEDIA_TYPES)[number];

/** One image sent by a phone. `data` is an ArrayBuffer on the client and arrives as a Buffer on the server. */
export interface ScreenshotUpload {
  mediaType: ScreenshotMediaType;
  data: ArrayBuffer | Uint8Array;
}

export type PlayerStatus = "noTracks" | "extracting" | "ready" | "invalid" | "error";

/** Why an upload didn't make the player ready. */
export type ExtractionProblem = "notPlaylist" | "tooFew" | "failed";

/** Private message to a player's own sockets: what was read from their screenshots. */
export interface PlayerTracks {
  status: PlayerStatus;
  tracks: Track[];
  problem?: ExtractionProblem;
}

export function extractionProblemMessage(problem: ExtractionProblem, trackCount: number): string {
  switch (problem) {
    case "notPlaylist":
      return "Esa captura no parece una playlist. Buscá tu playlist de más escuchadas y sacale captura.";
    case "tooFew":
      return `Leímos ${trackCount} ${trackCount === 1 ? "canción" : "canciones"}, necesitamos al menos ${MIN_TRACKS_TO_BE_READY}. Subí una captura que muestre más (podés mandar 2).`;
    case "failed":
      return "No pudimos leer la captura, probá de nuevo.";
  }
}
