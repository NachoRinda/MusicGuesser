import type { Track } from "@mg/shared";

export interface TrackMedia {
  /** Catalog id, to fetch a fresh preview URL later (Deezer's expire after ~15 min). */
  ref: string;
  previewUrl: string;
  coverUrl: string | null;
}

/** `notFound`: the catalog has no playable version. `error`: couldn't ask (network, timeout…). */
export type LookupResult = { status: "found"; media: TrackMedia } | { status: "notFound" } | { status: "error" };

/** Finds a playable preview for a track. Never throws. */
export interface MusicCatalog {
  readonly kind: "fake" | "deezer";
  lookup(track: Track): Promise<LookupResult>;
  /** A fresh preview URL for a track found before; null if it can't be had right now. */
  preview(ref: string): Promise<string | null>;
}
