import { describe, expect, it, vi } from "vitest";
import { DeezerCatalog } from "./DeezerCatalog.js";

type Hit = { title: string; artist: string; preview?: string; cover?: string };
const hit = ({ title, artist, preview = `https://cdn/${title}.mp3`, cover = `https://img/${title}.jpg` }: Hit) => ({
  title,
  preview,
  artist: { name: artist },
  album: { cover_medium: cover },
});

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
    expect(media).toEqual({ previewUrl: "https://cdn/live.mp3", coverUrl: "https://img/Titi me pregunto - Live.jpg" });
  });

  it("matches cut-off titles and multi-artist credits", async () => {
    const fetch = fetchReturning([hit({ title: "Bzrp Music Sessions, Vol. 53", artist: "Bizarrap" })]);
    const media = await new DeezerCatalog({ fetch }).lookup({
      title: "Bzrp Music Sessions, Vol…",
      artist: "Bizarrap, Shakira",
    });
    expect(media?.previewUrl).toBe("https://cdn/Bzrp Music Sessions, Vol. 53.mp3");
  });

  it("falls back to the first hit by the same artist", async () => {
    const fetch = fetchReturning([
      hit({ title: "Otra cosa", artist: "Nadie" }),
      hit({ title: "En vivo en Madrid", artist: "Bad Bunny" }),
    ]);
    const media = await new DeezerCatalog({ fetch }).lookup({ title: "Canción rara", artist: "Bad Bunny" });
    expect(media?.previewUrl).toBe("https://cdn/En vivo en Madrid.mp3");
  });

  it("null when the artist doesn't match, or the hit has no preview", async () => {
    const none = await new DeezerCatalog({ fetch: fetchReturning([hit({ title: "X", artist: "Otro" })]) }).lookup({
      title: "X",
      artist: "Bad Bunny",
    });
    expect(none).toBeNull();
    const noPreview = await new DeezerCatalog({
      fetch: fetchReturning([hit({ title: "X", artist: "Y", preview: "" })]),
    }).lookup({ title: "X", artist: "Y" });
    expect(noPreview).toBeNull();
  });

  it("null on HTTP errors, network errors, bad JSON and timeouts", async () => {
    const t = { title: "X", artist: "Y" };
    expect(await new DeezerCatalog({ fetch: fetchReturning([], 500) }).lookup(t)).toBeNull();
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await new DeezerCatalog({ fetch: failing }).lookup(t)).toBeNull();
    const badJson = vi.fn(async () => new Response("<html>"));
    expect(await new DeezerCatalog({ fetch: badJson }).lookup(t)).toBeNull();
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    expect(await new DeezerCatalog({ fetch: hanging, timeoutMs: 20 }).lookup(t)).toBeNull();
  });

  it("remembers tracks that were not found, but never caches preview URLs (they expire)", async () => {
    const empty = fetchReturning([]);
    const catalog = new DeezerCatalog({ fetch: empty });
    await catalog.lookup({ title: "X", artist: "Y" });
    await catalog.lookup({ title: "x", artist: "y" });
    expect(empty).toHaveBeenCalledTimes(1);

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
});
