import type { Track } from "@mg/shared";
import type { MusicCatalog, TrackMedia } from "./MusicCatalog.js";

/** No network: finds nothing unless given a fixed answer (tests, playtest). */
export class FakeCatalog implements MusicCatalog {
  readonly kind = "fake";
  readonly lookups: Track[] = [];

  constructor(private readonly answer: TrackMedia | null = null) {}

  lookup(track: Track): Promise<TrackMedia | null> {
    this.lookups.push(track);
    return Promise.resolve(this.answer);
  }
}
