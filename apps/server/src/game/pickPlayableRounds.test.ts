import type { Track } from "@mg/shared";
import { describe, expect, it } from "vitest";
import type { LookupResult } from "../music/MusicCatalog.js";
import { pickPlayableRounds } from "./pickPlayableRounds.js";

const songs = (prefix: string, n: number): Track[] =>
  Array.from({ length: n }, (_, i) => ({ title: `${prefix} ${i + 1}`, artist: prefix }));

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

const found = (t: Track): LookupResult => ({
  status: "found",
  media: { ref: t.title, previewUrl: `https://p/${t.title}.mp3`, coverUrl: null },
});

const players = [
  { id: "a", tracks: songs("A", 6) },
  { id: "b", tracks: songs("B", 6) },
  { id: "c", tracks: songs("C", 6) },
];

describe("pickPlayableRounds", () => {
  it("with everything found: same as an even pick, each round carrying its media", async () => {
    const rounds = await pickPlayableRounds(players, 6, seeded(1), async (t) => found(t));
    expect(rounds).toHaveLength(6);
    for (const id of ["a", "b", "c"]) expect(rounds.filter((r) => r.owners.includes(id))).toHaveLength(2);
    for (const r of rounds) expect(r.media?.previewUrl).toBe(`https://p/${r.track.title}.mp3`);
  });

  it("replaces a track not found with another of the same player, keeping the spread even", async () => {
    const missing = new Set(["A 1", "A 2", "A 3", "B 4"]);
    const rounds = await pickPlayableRounds(players, 6, seeded(2), async (t) =>
      missing.has(t.title) ? { status: "notFound" } : found(t),
    );
    expect(rounds).toHaveLength(6);
    expect(rounds.some((r) => missing.has(r.track.title))).toBe(false);
    for (const id of ["a", "b", "c"]) expect(rounds.filter((r) => r.owners.includes(id))).toHaveLength(2);
  });

  it("when a player runs out of playable tracks, others fill in", async () => {
    const rounds = await pickPlayableRounds(players, 6, seeded(3), async (t) =>
      t.artist === "A" ? { status: "notFound" } : found(t),
    );
    expect(rounds).toHaveLength(6);
    expect(rounds.filter((r) => r.owners.includes("a"))).toHaveLength(0);
  });

  it("plays fewer rounds if there aren't enough tracks with audio", async () => {
    const rounds = await pickPlayableRounds(players, 6, seeded(4), async (t) =>
      t.title.endsWith(" 1") ? found(t) : { status: "notFound" },
    );
    expect(rounds.map((r) => r.track.title).sort()).toEqual(["A 1", "B 1", "C 1"]);
  });

  it("a lookup that failed (network) keeps the track, without audio", async () => {
    const rounds = await pickPlayableRounds(players, 3, seeded(5), async () => ({ status: "error" }));
    expect(rounds).toHaveLength(3);
    expect(rounds.every((r) => r.media === undefined)).toBe(true);
  });

  it("never has more than `concurrency` lookups in flight, and checks each track at most once", async () => {
    let inFlight = 0;
    let peak = 0;
    const checked: string[] = [];
    await pickPlayableRounds(
      players,
      9,
      seeded(6),
      async (t) => {
        checked.push(t.title);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return t.title.endsWith(" 2") ? { status: "notFound" } : found(t);
      },
      4,
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(new Set(checked).size).toBe(checked.length);
  });

  it("keeps the round order of the even pick (no player twice in a row while others remain)", async () => {
    const rounds = await pickPlayableRounds(players, 6, seeded(7), async (t) => found(t));
    const owners = rounds.map((r) => r.owners[0]);
    expect(new Set(owners.slice(0, 3)).size).toBe(3);
    expect(new Set(owners.slice(3, 6)).size).toBe(3);
  });
});
