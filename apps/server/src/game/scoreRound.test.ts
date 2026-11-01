import { describe, expect, it } from "vitest";
import { scoreRound } from "./scoreRound.js";

const DURATION = 45_000;
const base = { players: ["a", "b", "c", "d"], durationMs: DURATION };

describe("scoreRound", () => {
  it("a correct vote gets 100 plus a speed bonus of up to 50, linear with the time left", () => {
    const r = scoreRound({
      ...base,
      owners: ["a"],
      votes: [
        { voterId: "b", targetId: "a", remainingMs: DURATION },
        { voterId: "c", targetId: "a", remainingMs: DURATION / 2 },
        { voterId: "d", targetId: "a", remainingMs: 0 },
      ],
    });
    // One entry per player, in player order; the owner didn't vote.
    expect(r.votes.map((v) => v.points)).toEqual([0, 150, 125, 100]);
    expect(r.votes.map((v) => v.correct)).toEqual([false, true, true, true]);
  });

  it("wrong vote or no vote: 0, never negative", () => {
    const r = scoreRound({ ...base, owners: ["a"], votes: [{ voterId: "b", targetId: "c", remainingMs: 40_000 }] });
    const byVoter = Object.fromEntries(r.votes.map((v) => [v.voterId, v]));
    expect(byVoter.b).toMatchObject({ targetId: "c", correct: false, points: 0 });
    expect(byVoter.c).toMatchObject({ targetId: null, correct: false, points: 0 });
    expect(r.votes).toHaveLength(4);
  });

  it("owners get +100 when no non-owner found them out", () => {
    const r = scoreRound({ ...base, owners: ["a"], votes: [{ voterId: "b", targetId: "c", remainingMs: 1 }] });
    expect(r.ownerPoints).toBe(100);
    expect(r.points.find((p) => p.playerId === "a")?.points).toBe(100);
  });

  it("no owner bonus once someone found them out", () => {
    const r = scoreRound({ ...base, owners: ["a"], votes: [{ voterId: "b", targetId: "a", remainingMs: 0 }] });
    expect(r.ownerPoints).toBe(0);
    expect(r.points.find((p) => p.playerId === "a")?.points).toBe(0);
    expect(r.points.find((p) => p.playerId === "b")?.points).toBe(100);
  });

  it("a co-owner voting the other co-owner is right, but doesn't find anyone out", () => {
    const r = scoreRound({ ...base, owners: ["a", "b"], votes: [{ voterId: "a", targetId: "b", remainingMs: 0 }] });
    const points = Object.fromEntries(r.points.map((p) => [p.playerId, p.points]));
    expect(points).toEqual({ a: 200, b: 100, c: 0, d: 0 });
    expect(r.ownerPoints).toBe(100);
  });

  it("everyone owns it: correct votes score, but there is no owner bonus", () => {
    const r = scoreRound({
      players: ["a", "b", "c"],
      durationMs: DURATION,
      owners: ["a", "b", "c"],
      votes: [{ voterId: "a", targetId: "b", remainingMs: 0 }],
    });
    expect(r.ownerPoints).toBe(0);
    expect(Object.fromEntries(r.points.map((p) => [p.playerId, p.points]))).toEqual({ a: 100, b: 0, c: 0 });
  });

  it("rounds the speed bonus", () => {
    const r = scoreRound({ ...base, owners: ["a"], votes: [{ voterId: "b", targetId: "a", remainingMs: 10_000 }] });
    expect(r.votes[1]!.points).toBe(111); // 50 × 10/45 = 11.1
  });
});
