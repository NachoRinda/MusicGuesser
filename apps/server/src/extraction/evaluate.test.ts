import { MIN_TRACKS_TO_BE_READY, type Track } from "@mg/shared";
import { describe, expect, it } from "vitest";
import { evaluateExtraction, trackKey, type ScreenshotReading } from "./evaluate.js";

const tracks = (n: number, prefix = "Song"): Track[] =>
  Array.from({ length: n }, (_, i) => ({ title: `${prefix} ${i + 1}`, artist: `Artist ${i + 1}` }));
const playlist = (t: Track[]): ScreenshotReading => ({ isPlaylist: true, platform: "spotify", tracks: t });
const notPlaylist: ScreenshotReading = { isPlaylist: false, platform: null, tracks: [] };

describe("trackKey", () => {
  it("ignores case, accents and extra whitespace", () => {
    expect(trackKey({ title: "  Despechá ", artist: "ROSALÍA" })).toBe(trackKey({ title: "despecha", artist: "Rosalia" }));
    expect(trackKey({ title: "De  Música Ligera", artist: "Soda Stereo" })).toBe(
      trackKey({ title: "de música ligera", artist: "soda   stereo" }),
    );
  });

  it("tells apart the same title by different artists", () => {
    expect(trackKey({ title: "Hello", artist: "Adele" })).not.toBe(trackKey({ title: "Hello", artist: "Lionel Richie" }));
  });
});

describe("evaluateExtraction", () => {
  it(`is ready with at least ${MIN_TRACKS_TO_BE_READY} tracks`, () => {
    const out = evaluateExtraction([playlist(tracks(MIN_TRACKS_TO_BE_READY))]);
    expect(out).toEqual({ status: "ready", tracks: tracks(MIN_TRACKS_TO_BE_READY) });
  });

  it("is invalid (tooFew) below the minimum, and still returns what was read", () => {
    const out = evaluateExtraction([playlist(tracks(MIN_TRACKS_TO_BE_READY - 1))]);
    expect(out).toEqual({ status: "invalid", problem: "tooFew", tracks: tracks(MIN_TRACKS_TO_BE_READY - 1) });
  });

  it("joins two screenshots, dropping the overlap and keeping the order of appearance", () => {
    const first = tracks(7);
    const second = [...tracks(7).slice(4), ...tracks(5, "Other")]; // 3 overlapping + 5 new
    const out = evaluateExtraction([playlist(first), playlist(second)]);
    expect(out.status).toBe("ready");
    expect(out.tracks).toEqual([...first, ...tracks(5, "Other")]);
  });

  it("drops duplicates that differ only in case/accents, keeping the first spelling", () => {
    const t = [...tracks(10), { title: "SONG 1", artist: "ártist 1" }];
    expect(evaluateExtraction([playlist(t)]).tracks).toEqual(tracks(10));
  });

  it("drops entries with an empty title or artist", () => {
    const t = [...tracks(9), { title: "  ", artist: "Nadie" }, { title: "Sin artista", artist: "" }];
    expect(evaluateExtraction([playlist(t)])).toMatchObject({ status: "invalid", problem: "tooFew" });
  });

  it("trims whitespace in what it keeps", () => {
    const out = evaluateExtraction([playlist([{ title: "  Tusa ", artist: " Karol G " }, ...tracks(9)])]);
    expect(out.tracks[0]).toEqual({ title: "Tusa", artist: "Karol G" });
  });

  it("rejects something that is not a playlist", () => {
    expect(evaluateExtraction([notPlaylist])).toEqual({ status: "invalid", problem: "notPlaylist", tracks: [] });
  });

  it("rejects the whole upload when one of two screenshots is not a playlist", () => {
    expect(evaluateExtraction([playlist(tracks(12)), notPlaylist])).toEqual({
      status: "invalid",
      problem: "notPlaylist",
      tracks: [],
    });
  });

  it("accepts any playlist platform, including unknown ones", () => {
    const out = evaluateExtraction([{ isPlaylist: true, platform: "other", tracks: tracks(10) }]);
    expect(out.status).toBe("ready");
  });
});
