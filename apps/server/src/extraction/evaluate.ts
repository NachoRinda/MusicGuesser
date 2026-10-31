import { MIN_TRACKS_TO_BE_READY, type ExtractionProblem, type Track } from "@mg/shared";

export type Platform = "spotify" | "youtube_music" | "apple_music" | "other";

/** What the vision model read from one screenshot. */
export interface ScreenshotReading {
  isPlaylist: boolean;
  platform: Platform | null;
  tracks: Track[];
}

export type ExtractionOutcome =
  | { status: "ready"; tracks: Track[] }
  | { status: "invalid"; problem: Exclude<ExtractionProblem, "failed">; tracks: Track[] };

/** Comparison key for a track: case-, accent- and whitespace-insensitive. */
export function trackKey(track: Track): string {
  return `${normalize(track.title)}\u0000${normalize(track.artist)}`;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Decides whether an upload (1–2 screenshots, read together) makes the player ready. */
export function evaluateExtraction(readings: ScreenshotReading[]): ExtractionOutcome {
  // A mixed upload is rejected whole, so a dubious image can't sneak tracks in.
  if (readings.length === 0 || readings.some((r) => !r.isPlaylist)) {
    return { status: "invalid", problem: "notPlaylist", tracks: [] };
  }

  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const reading of readings) {
    for (const raw of reading.tracks) {
      const track = { title: raw.title.trim(), artist: raw.artist.trim() };
      if (!track.title || !track.artist) continue;
      const key = trackKey(track);
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(track);
    }
  }

  if (tracks.length < MIN_TRACKS_TO_BE_READY) return { status: "invalid", problem: "tooFew", tracks };
  return { status: "ready", tracks };
}
