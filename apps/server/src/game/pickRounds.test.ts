import type { Track } from "@mg/shared";
import { describe, expect, it } from "vitest";
import { pickRounds } from "./pickRounds.js";

const t = (title: string, artist = "Artista"): Track => ({ title, artist });
const songs = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => t(`${prefix} ${i + 1}`));

/** Deterministic pseudo-random sequence (LCG) so tests are stable. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

describe("pickRounds", () => {
  const players = [
    { id: "a", tracks: songs("A", 10) },
    { id: "b", tracks: songs("B", 10) },
    { id: "c", tracks: songs("C", 10) },
  ];

  it("returns the requested number of rounds, with no repeated track", () => {
    const rounds = pickRounds(players, 10, seeded(1));
    expect(rounds).toHaveLength(10);
    expect(new Set(rounds.map((r) => r.track.title)).size).toBe(10);
  });

  it("spreads rounds evenly across players", () => {
    const rounds = pickRounds(players, 9, seeded(2));
    const perOwner = (id: string) => rounds.filter((r) => r.owners.includes(id)).length;
    expect([perOwner("a"), perOwner("b"), perOwner("c")]).toEqual([3, 3, 3]);
  });

  it("caps at the number of distinct tracks", () => {
    const few = [
      { id: "a", tracks: songs("X", 3) },
      { id: "b", tracks: songs("X", 3) },
      { id: "c", tracks: [t("Y 1")] },
    ];
    expect(pickRounds(few, 10, seeded(3))).toHaveLength(4);
  });

  it("a track belongs to every player who has it, comparing without case, accents nor extra spaces", () => {
    const shared = [
      { id: "a", tracks: [t("Tití Me Preguntó", "Bad Bunny")] },
      { id: "b", tracks: [t("titi me  pregunto", "BAD BUNNY")] },
      { id: "c", tracks: [t("Otra")] },
    ];
    const rounds = pickRounds(shared, 10, seeded(4));
    expect(rounds).toHaveLength(2);
    const titi = rounds.find((r) => r.track.artist === "Bad Bunny");
    expect(titi?.owners.sort()).toEqual(["a", "b"]);
    expect(titi?.track.title).toBe("Tití Me Preguntó");
  });

  it("does not skip tracks that every player has", () => {
    const all = [
      { id: "a", tracks: [t("Todos")] },
      { id: "b", tracks: [t("Todos")] },
      { id: "c", tracks: [t("Todos")] },
    ];
    expect(pickRounds(all, 5, seeded(5))).toEqual([{ track: t("Todos"), owners: ["a", "b", "c"] }]);
  });

  it("is deterministic for the same random source, and varies with another", () => {
    const a = pickRounds(players, 10, seeded(7)).map((r) => r.track.title);
    expect(pickRounds(players, 10, seeded(7)).map((r) => r.track.title)).toEqual(a);
    expect(pickRounds(players, 10, seeded(8)).map((r) => r.track.title)).not.toEqual(a);
  });

  it("keeps going with the players who still have unused tracks", () => {
    const uneven = [
      { id: "a", tracks: songs("A", 1) },
      { id: "b", tracks: songs("B", 5) },
      { id: "c", tracks: songs("C", 1) },
    ];
    const rounds = pickRounds(uneven, 7, seeded(9));
    expect(rounds).toHaveLength(7);
  });
});
