import type { Track } from "@mg/shared";

export interface TrackMedia {
  previewUrl: string;
  coverUrl: string | null;
}

/** Finds a playable preview for a track. Never throws: not found or failure → null. */
export interface MusicCatalog {
  readonly kind: "fake" | "deezer";
  lookup(track: Track): Promise<TrackMedia | null>;
}
