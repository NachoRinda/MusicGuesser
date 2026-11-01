import type { Track } from "@mg/shared";
import { trackKey } from "../extraction/evaluate.js";

export interface PlayerTrackList {
  id: string;
  tracks: Track[];
}

export interface PickedRound {
  /** As the first owner (in player order) has it written. */
  track: Track;
  /** Every player who has this track (same `trackKey`), in player order. */
  owners: string[];
}

/**
 * Chooses the tracks to play: walks the players in random order, round-robin, taking a random
 * unused track of each one, so every player shows up a similar number of times. No track repeats
 * and none is skipped (not even one that everybody has).
 */
export function pickRounds(players: PlayerTrackList[], count: number, random: () => number): PickedRound[] {
  const byKey = new Map<string, PickedRound>();
  const keysOf = new Map<string, string[]>();
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
    keysOf.set(player.id, shuffle(keys, random));
  }

  const order = shuffle(
    players.map((p) => p.id),
    random,
  );
  const used = new Set<string>();
  const picked: PickedRound[] = [];
  while (picked.length < count && used.size < byKey.size) {
    for (const id of order) {
      if (picked.length >= count) break;
      const keys = keysOf.get(id)!;
      let key: string | undefined;
      while ((key = keys.pop()) !== undefined && used.has(key));
      if (key === undefined) continue;
      used.add(key);
      picked.push(byKey.get(key)!);
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
