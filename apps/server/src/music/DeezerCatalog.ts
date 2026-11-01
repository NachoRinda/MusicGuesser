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
    let hits: DeezerHit[];
    try {
      hits = await this.search(`${stripEllipsis(track.artist)} ${stripEllipsis(track.title)}`);
    } catch {
      return null; // network, HTTP or timeout: maybe temporary, try again next time
    }
    const hit = pickHit(hits, track);
    if (!hit) {
      this.notFound.add(key);
      return null;
    }
    return { previewUrl: hit.preview!, coverUrl: hit.album?.cover_medium || null };
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

/** Our credit may list several artists ("Bizarrap, Shakira"); Deezer's main artist must be one. */
function artistMatches(ours: string, theirs: string): boolean {
  const name = simplify(theirs);
  if (!name) return false;
  const parts = stripEllipsis(ours)
    .split(/,|&|\/|\bfeat\.?|\bft\.?|\bx\b|\by\b/i)
    .map(simplify)
    .filter(Boolean);
  return parts.includes(name) || simplify(ours).startsWith(name);
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
