import { describe, expect, it, vi } from "vitest";
import { DeezerCatalog } from "./DeezerCatalog.js";
import type { LookupResult } from "./MusicCatalog.js";

type Hit = { title: string; artist: string; preview?: string; cover?: string };
const hit = ({ title, artist, preview = `https://cdn/${title}.mp3`, cover = `https://img/${title}.jpg` }: Hit) => ({
  id: title.length,
  title,
  preview,
  artist: { name: artist },
  album: { cover_medium: cover },
});

const found = (r: LookupResult | undefined) => (r?.status === "found" ? r.media.previewUrl : null);

function fetchReturning(data: unknown[], status = 200) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify({ data }), { status }),
  );
}

describe("DeezerCatalog", () => {
  it("searches by artist + title (without the ellipsis of cut-off text)", async () => {
    const fetch = fetchReturning([]);
    await new DeezerCatalog({ fetch }).lookup({ title: "Bzrp Music Sessions, Vol…", artist: "Bizarrap" });
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.origin + url.pathname).toBe("https://api.deezer.com/search");
    expect(url.searchParams.get("q")).toBe("Bizarrap Bzrp Music Sessions, Vol");
  });

  it("picks the first hit whose title and artist match, ignoring case, accents and suffixes", async () => {
    const fetch = fetchReturning([
      hit({ title: "Tití Me Preguntó (Remix)", artist: "Otro" }),
      hit({ title: "Titi me pregunto - Live", artist: "Bad Bunny", preview: "https://cdn/live.mp3" }),
      hit({ title: "Tití Me Preguntó", artist: "Bad Bunny", preview: "https://cdn/ok.mp3" }),
    ]);
    const media = await new DeezerCatalog({ fetch }).lookup({ title: "Tití Me Preguntó", artist: "Bad Bunny" });
    // "- Live" is a suffix: the first matching hit wins.
    expect(media).toEqual({
      status: "found",
      media: { ref: "23", previewUrl: "https://cdn/live.mp3", coverUrl: "https://img/Titi me pregunto - Live.jpg" },
    });
  });

  it("matches cut-off titles and multi-artist credits", async () => {
    const fetch = fetchReturning([hit({ title: "Bzrp Music Sessions, Vol. 53", artist: "Bizarrap" })]);
    const media = await new DeezerCatalog({ fetch }).lookup({
      title: "Bzrp Music Sessions, Vol…",
      artist: "Bizarrap, Shakira",
    });
    expect(found(media)).toBe("https://cdn/Bzrp Music Sessions, Vol. 53.mp3");
  });

  it("falls back to the first hit by the same artist", async () => {
    const fetch = fetchReturning([
      hit({ title: "Otra cosa", artist: "Nadie" }),
      hit({ title: "En vivo en Madrid", artist: "Bad Bunny" }),
    ]);
    const media = await new DeezerCatalog({ fetch }).lookup({ title: "Canción rara", artist: "Bad Bunny" });
    expect(found(media)).toBe("https://cdn/En vivo en Madrid.mp3");
  });

  it("notFound when the artist doesn't match, or the hit has no preview", async () => {
    const none = await new DeezerCatalog({ fetch: fetchReturning([hit({ title: "X", artist: "Otro" })]) }).lookup({
      title: "X",
      artist: "Bad Bunny",
    });
    expect(none).toEqual({ status: "notFound" });
    const noPreview = await new DeezerCatalog({
      fetch: fetchReturning([hit({ title: "X", artist: "Y", preview: "" })]),
    }).lookup({ title: "X", artist: "Y" });
    expect(noPreview).toEqual({ status: "notFound" });
  });

  it("error on HTTP errors, network errors, bad JSON (e.g. Deezer's quota error) and timeouts", async () => {
    const t = { title: "X", artist: "Y" };
    expect(await new DeezerCatalog({ fetch: fetchReturning([], 500) }).lookup(t)).toEqual({ status: "error" });
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await new DeezerCatalog({ fetch: failing }).lookup(t)).toEqual({ status: "error" });
    const badJson = vi.fn(async () => new Response("<html>"));
    const quota = vi.fn(async () => new Response(JSON.stringify({ error: { code: 4, message: "Quota limit exceeded" } })));
    expect(await new DeezerCatalog({ fetch: quota }).lookup(t)).toEqual({ status: "error" });
    expect(await new DeezerCatalog({ fetch: badJson }).lookup(t)).toEqual({ status: "error" });
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    expect(await new DeezerCatalog({ fetch: hanging, timeoutMs: 20 }).lookup(t)).toEqual({ status: "error" });
  });

  it("remembers tracks that were not found, but never caches preview URLs (they expire)", async () => {
    const empty = fetchReturning([]);
    const catalog = new DeezerCatalog({ fetch: empty });
    await catalog.lookup({ title: "X", artist: "Y" });
    const calls = empty.mock.calls.length;
    await catalog.lookup({ title: "x", artist: "y" });
    expect(empty).toHaveBeenCalledTimes(calls);

    const found = fetchReturning([hit({ title: "X", artist: "Y" })]);
    const c2 = new DeezerCatalog({ fetch: found });
    await c2.lookup({ title: "X", artist: "Y" });
    await c2.lookup({ title: "X", artist: "Y" });
    expect(found).toHaveBeenCalledTimes(2);
  });

  it("does not remember failures (they may be temporary)", async () => {
    const fetch = fetchReturning([], 503);
    const catalog = new DeezerCatalog({ fetch });
    await catalog.lookup({ title: "X", artist: "Y" });
    await catalog.lookup({ title: "X", artist: "Y" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to simpler queries when the full one finds nothing (Deezer needs every word to match)", async () => {
    const queries: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      const q = new URL(url).searchParams.get("q")!;
      queries.push(q);
      const data = q === "Santaferia Haciendo Nada" ? [hit({ title: "Haciendo Nada", artist: "Santaferia" })] : [];
      return new Response(JSON.stringify({ data }));
    });
    const media = await new DeezerCatalog({ fetch }).lookup({ title: "Haciendo Nada", artist: "Santaferia, Chico Trujillo" });
    expect(found(media)).toBe("https://cdn/Haciendo Nada.mp3");
    expect(queries).toEqual(["Santaferia, Chico Trujillo Haciendo Nada", "Santaferia Haciendo Nada"]);
  });

  it("last resort: searches the bare title and keeps a hit by the same artist", async () => {
    const queries: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      const q = new URL(url).searchParams.get("q")!;
      queries.push(q);
      const data = q === "Nothing on You" ? [hit({ title: "Nothing on You", artist: "Otro" }), hit({ title: "Nothin' on You", artist: "B.o.B" })] : [];
      return new Response(JSON.stringify({ data }));
    });
    const media = await new DeezerCatalog({ fetch }).lookup({ title: "Nothing on You (feat. Bruno Mars)", artist: "BoB" });
    // "BoB" doesn't match "B.o.B" textually unless punctuation is ignored inside words.
    expect(queries).toEqual([
      "BoB Nothing on You (feat. Bruno Mars)",
      "BoB Nothing on You",
      "Nothing on You",
    ]);
    expect(found(media)).toBe("https://cdn/Nothin' on You.mp3");
  });

  it("logs a miss with the track text and the queries tried (no secrets, no images)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await new DeezerCatalog({ fetch: fetchReturning([]) }).lookup({ title: "Haciendo Nada", artist: "Santaferia" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"Haciendo Nada" — "Santaferia"'));
    warn.mockRestore();
  });

  it("preview(ref) asks /track/{id} for a fresh URL; null on any failure", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.deezer.com/track/123");
      return new Response(JSON.stringify({ id: 123, preview: "https://cdn/fresh.mp3" }));
    });
    expect(await new DeezerCatalog({ fetch }).preview("123")).toBe("https://cdn/fresh.mp3");
    expect(await new DeezerCatalog({ fetch: fetchReturning([], 500) }).preview("1")).toBeNull();
    const noPreview = vi.fn(async () => new Response(JSON.stringify({ id: 1, preview: "" })));
    expect(await new DeezerCatalog({ fetch: noPreview }).preview("1")).toBeNull();
    expect(await new DeezerCatalog().preview("../etc")).toBeNull(); // only numeric ids
  });
});
