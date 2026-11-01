import type { Track } from "@mg/shared";
import { trackKey } from "../extraction/evaluate.js";
import type { MusicCatalog, TrackMedia } from "./MusicCatalog.js";

export interface DeezerCatalogOptions {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

interface DeezerHit {
  title?: string;
  preview?: string;
  artist?: { name?: string };
  album?: { cover_medium?: string };
}

const SEARCH_URL = "https://api.deezer.com/search";

/**
 * Public Deezer search (no auth). Preview URLs are signed and expire after ~15 min, so they are
 * looked up right before each round and never cached; only "not found" is remembered.
 */
export class DeezerCatalog implements MusicCatalog {
  readonly kind = "deezer";
  private readonly fetch: NonNullable<DeezerCatalogOptions["fetch"]>;
  private readonly timeoutMs: number;
  private readonly notFound = new Set<string>();

  constructor({ fetch = globalThis.fetch, timeoutMs = 4_000 }: DeezerCatalogOptions = {}) {
    this.fetch = fetch;
    this.timeoutMs = timeoutMs;
  }

  async lookup(track: Track): Promise<TrackMedia | null> {
    const key = trackKey(track);
    if (this.notFound.has(key)) return null;
    const queries = searchQueries(track);
    for (const q of queries) {
      let hits: DeezerHit[];
      try {
        hits = await this.search(q);
      } catch (err) {
        // Network, HTTP or timeout: maybe temporary, so not remembered; try again next time.
        console.warn(`Deezer: falló la búsqueda de "${track.title}" — "${track.artist}": ${(err as Error).message}`);
        return null;
      }
      const hit = pickHit(hits, track);
      if (hit) return { previewUrl: hit.preview!, coverUrl: hit.album?.cover_medium || null };
    }
    this.notFound.add(key);
    console.warn(
      `Deezer: sin preview para "${track.title}" — "${track.artist}" (búsquedas: ${queries.map((q) => `"${q}"`).join(", ")})`,
    );
    return null;
  }

  private async search(q: string): Promise<DeezerHit[]> {
    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "10");
    const res = await this.fetch(url.toString(), { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
    const body = (await res.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) throw new Error("Deezer: respuesta inesperada");
    return body.data as DeezerHit[];
  }
}

/**
 * Deezer only returns hits containing every word of the query, so one extra word (a second artist,
 * "feat. …", "(Remastered)") finds nothing. Try the full text, then main artist + bare title, then
 * the bare title alone (hits are still filtered by artist).
 */
function searchQueries(track: Track): string[] {
  const title = stripEllipsis(track.title);
  const bareTitle = title
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s-\s.*$/, "")
    .replace(/\b(feat|ft)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const mainArtist = splitArtists(track.artist)[0] ?? stripEllipsis(track.artist);
  const queries = [`${stripEllipsis(track.artist)} ${title}`, `${mainArtist} ${bareTitle}`, bareTitle];
  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
}

function splitArtists(artist: string): string[] {
  return stripEllipsis(artist)
    .split(/,|&|\/|\bfeat\.?|\bft\.?|\bx\b|\by\b/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

/** First hit with a preview whose title and artist match; else the first by the same artist. */
function pickHit(hits: DeezerHit[], track: Track): DeezerHit | undefined {
  const playable = hits.filter((h) => typeof h.preview === "string" && h.preview.length > 0);
  const byArtist = playable.filter((h) => artistMatches(track.artist, h.artist?.name ?? ""));
  return byArtist.find((h) => titleMatches(track.title, h.title ?? "")) ?? byArtist[0];
}

function titleMatches(ours: string, theirs: string): boolean {
  const a = simplify(ours);
  const b = simplify(theirs);
  return a.length > 0 && b.length > 0 && (a.startsWith(b) || b.startsWith(a));
}

/**
 * Our credit may list several artists ("Bizarrap, Shakira"); Deezer's main artist must be one.
 * Compared without spaces or punctuation, so "BoB" matches "B.o.B".
 */
function artistMatches(ours: string, theirs: string): boolean {
  const compact = (s: string) => simplify(s).replace(/ /g, "");
  const name = compact(theirs);
  if (!name) return false;
  return splitArtists(ours).map(compact).includes(name) || compact(ours).startsWith(name);
}

function stripEllipsis(s: string): string {
  return s.replace(/(…|\.\.\.)\s*$/u, "").trim();
}

/** Lowercase, no accents, no "(…)" / "[…]" / " - Remastered" / "feat." parts, only letters and digits. */
function simplify(s: string): string {
  return stripEllipsis(s)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s-\s.*$/, "")
    .replace(/\b(feat|ft)\b.*$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
