import type { Track } from "@mg/shared";
import type { LookupResult } from "../music/MusicCatalog.js";
import { buildPool, takeKey, type PickedRound, type PlayerTrackList } from "./pickRounds.js";

/**
 * Like `pickRounds`, but checks each track's audio: a track the catalog doesn't have is swapped for
 * another of the same player (or, if they ran out, of anyone). A track whose lookup failed (network)
 * is kept without audio. Each round's turn keeps the even round-robin order. At most `concurrency`
 * lookups run at once (Deezer allows 50 requests per 5 s; one lookup may make up to 3).
 */
export async function pickPlayableRounds(
  players: PlayerTrackList[],
  count: number,
  random: () => number,
  check: (track: Track) => Promise<LookupResult>,
  concurrency = 4,
): Promise<PickedRound[]> {
  const pool = buildPool(players, random);
  const used = new Set<string>();
  const turns = Array.from({ length: Math.min(count, pool.byKey.size) }, (_, i) => pool.order[i % pool.order.length]!);
  let fallback = 0;

  const anyKey = (): string | undefined => {
    for (let n = 0; n < pool.order.length; n++) {
      const id = pool.order[fallback++ % pool.order.length]!;
      const key = takeKey(pool, id, used);
      if (key !== undefined) return key;
    }
    return undefined;
  };

  const fillTurn = async (playerId: string): Promise<PickedRound | undefined> => {
    for (;;) {
      const key = takeKey(pool, playerId, used) ?? anyKey();
      if (key === undefined) return undefined;
      const round = pool.byKey.get(key)!;
      const result = await check(round.track);
      if (result.status === "found") return { ...round, media: result.media };
      if (result.status === "error") return { ...round };
    }
  };

  const results: (PickedRound | undefined)[] = new Array(turns.length);
  let next = 0;
  const worker = async () => {
    while (next < turns.length) {
      const i = next++;
      results[i] = await fillTurn(turns[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, turns.length) }, worker));
  return results.filter((r): r is PickedRound => r !== undefined);
}
