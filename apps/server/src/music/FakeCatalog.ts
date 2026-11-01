import type { Track } from "@mg/shared";
import type { LookupResult, MusicCatalog } from "./MusicCatalog.js";

/**
 * No network (tests, playtest). Answers `error` by default, so the game is played without audio
 * (as when Deezer is down); tests can pass a fixed answer or a function per track.
 */
export class FakeCatalog implements MusicCatalog {
  readonly kind = "fake";
  readonly lookups: Track[] = [];
  readonly previews: string[] = [];
  private readonly answer: (track: Track) => LookupResult;

  constructor(answer: LookupResult | ((track: Track) => LookupResult) = { status: "error" }) {
    this.answer = typeof answer === "function" ? answer : () => answer;
  }

  lookup(track: Track): Promise<LookupResult> {
    this.lookups.push(track);
    return Promise.resolve(this.answer(track));
  }

  preview(ref: string): Promise<string | null> {
    this.previews.push(ref);
    return Promise.resolve(`https://fresh.test/${ref}.mp3`);
  }
}
