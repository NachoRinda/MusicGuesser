import type { Track } from "@mg/shared";
import { trackKey } from "../extraction/evaluate.js";
import type { TrackMedia } from "../music/MusicCatalog.js";

export interface PlayerTrackList {
  id: string;
  tracks: Track[];
}

export interface PickedRound {
  /** As the first owner (in player order) has it written. */
  track: Track;
  /** Every player who has this track (same `trackKey`), in player order. */
  owners: string[];
  /** Audio found when the game was prepared (absent: play without audio). */
  media?: TrackMedia;
}

/** Every distinct track with its owners, and per player a shuffled queue of their tracks' keys. */
export interface TrackPool {
  byKey: Map<string, PickedRound>;
  /** Player ids in random order: the round-robin turn order. */
  order: string[];
  /** Pops from the end. */
  queues: Map<string, string[]>;
}

export function buildPool(players: PlayerTrackList[], random: () => number): TrackPool {
  const byKey = new Map<string, PickedRound>();
  const queues = new Map<string, string[]>();
  for (const player of players) {
    const keys: string[] = [];
    for (const track of player.tracks) {
      const key = trackKey(track);
      let round = byKey.get(key);
      if (!round) {
        round = { track, owners: [] };
        byKey.set(key, round);
      }
      if (!round.owners.includes(player.id)) {
        round.owners.push(player.id);
        keys.push(key);
      }
    }
    queues.set(player.id, shuffle(keys, random));
  }
  const order = shuffle(
    players.map((p) => p.id),
    random,
  );
  return { byKey, order, queues };
}

/** Next key of this player's queue not used yet (and marks it used). */
export function takeKey(pool: TrackPool, playerId: string, used: Set<string>): string | undefined {
  const keys = pool.queues.get(playerId) ?? [];
  let key: string | undefined;
  while ((key = keys.pop()) !== undefined && used.has(key));
  if (key !== undefined) used.add(key);
  return key;
}

/**
 * Chooses the tracks to play: walks the players in random order, round-robin, taking a random
 * unused track of each one, so every player shows up a similar number of times. No track repeats
 * and none is skipped (not even one that everybody has).
 */
export function pickRounds(players: PlayerTrackList[], count: number, random: () => number): PickedRound[] {
  const pool = buildPool(players, random);
  const used = new Set<string>();
  const picked: PickedRound[] = [];
  while (picked.length < count && used.size < pool.byKey.size) {
    for (const id of pool.order) {
      if (picked.length >= count) break;
      const key = takeKey(pool, id, used);
      if (key !== undefined) picked.push(pool.byKey.get(key)!);
    }
  }
  return picked;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
