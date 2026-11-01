import { describe, expect, it } from "vitest";
import { Game } from "./Game.js";
import type { PickedRound } from "./pickRounds.js";

const QUESTION = 45_000;
const STAGE = 10_000;

const rounds: PickedRound[] = [
  { track: { title: "Uno", artist: "X" }, owners: ["a"] },
  { track: { title: "Dos", artist: "Y" }, owners: ["b", "c"] },
];

function setup() {
  let t = 1_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const game = new Game({ rounds, players: ["a", "b", "c"], now: clock.now, questionMs: QUESTION, revealStageMs: STAGE });
  return { game, clock };
}

const all = new Set(["a", "b", "c"]);

describe("Game", () => {
  it("starts on round 1's question with the full time and no reveal", () => {
    const { game } = setup();
    const v = game.view();
    expect(v).toMatchObject({ round: 1, totalRounds: 2, stage: "question", remainingMs: QUESTION, voted: [] });
    expect(v.track).toEqual({ title: "Uno", artist: "X", coverUrl: null, previewUrl: null });
    expect(v.reveal).toBeUndefined();
    expect(v.scores).toEqual([
      { playerId: "a", score: 0 },
      { playerId: "b", score: 0 },
      { playerId: "c", score: 0 },
    ]);
  });

  it("counts down remainingMs with the clock", () => {
    const { game, clock } = setup();
    clock.advance(5_000);
    expect(game.view().remainingMs).toBe(40_000);
    expect(game.deadline()).toEqual({ seq: 0, endsAt: 1_000 + QUESTION });
  });

  it("validates votes: not in game, for oneself, for an unknown player, twice", () => {
    const { game } = setup();
    expect(game.vote("z", "a")).toEqual({ ok: false, error: "NOT_IN_GAME" });
    expect(game.vote("a", "a")).toEqual({ ok: false, error: "INVALID_VOTE" });
    expect(game.vote("a", "z")).toEqual({ ok: false, error: "INVALID_VOTE" });
    expect(game.vote("a", "b")).toEqual({ ok: true });
    expect(game.vote("a", "c")).toEqual({ ok: false, error: "ALREADY_VOTED" });
    expect(game.myVote("a")).toEqual({ round: 1, targetId: "b" });
    expect(game.myVote("b")).toBeUndefined();
  });

  it("the question view shows who voted, never for whom nor the owners", () => {
    const { game } = setup();
    game.vote("b", "a");
    const v = game.view();
    expect(v.voted).toEqual(["b"]);
    expect(JSON.stringify(v)).not.toContain("owners");
    expect(JSON.stringify(v)).not.toContain("targetId");
  });

  it("rejects votes after the time is up (race with the timer)", () => {
    const { game, clock } = setup();
    clock.advance(QUESTION);
    expect(game.vote("b", "a")).toEqual({ ok: false, error: "INVALID_VOTE" });
  });

  it("allVoted: every connected player voted (disconnected ones don't block)", () => {
    const { game } = setup();
    game.vote("b", "a");
    expect(game.allVoted(all)).toBe(false);
    expect(game.allVoted(new Set(["b"]))).toBe(true);
    expect(game.allVoted(new Set())).toBe(false);
  });

  it("question → owners → votes → ranking → next round, scoring on closing the question", () => {
    const { game, clock } = setup();
    clock.advance(9_000);
    game.vote("b", "a"); // correct, 36 s left → 100 + 40
    game.vote("c", "b"); // wrong
    game.advance();
    let v = game.view();
    expect(v.stage).toBe("owners");
    expect(v.remainingMs).toBe(STAGE);
    expect(v.reveal).toEqual({
      owners: ["a"],
      ownerPoints: 0,
      votes: [
        { voterId: "a", targetId: null, correct: false, points: 0 },
        { voterId: "b", targetId: "a", correct: true, points: 140 },
        { voterId: "c", targetId: "b", correct: false, points: 0 },
      ],
      points: [
        { playerId: "a", points: 0 },
        { playerId: "b", points: 140 },
        { playerId: "c", points: 0 },
      ],
    });
    expect(v.scores[0]).toEqual({ playerId: "b", score: 140 });
    expect(game.vote("a", "b")).toEqual({ ok: false, error: "INVALID_VOTE" });

    game.advance();
    expect(game.view().stage).toBe("votes");
    game.advance();
    expect(game.view().stage).toBe("ranking");
    game.advance();
    v = game.view();
    expect(v).toMatchObject({ round: 2, stage: "question", voted: [], remainingMs: QUESTION });
    expect(v.reveal).toBeUndefined();
    expect(game.myVote("b")).toBeUndefined();
    expect(game.deadline()?.seq).toBe(4);
  });

  it("after the last round's ranking the game is finished, with final scores", () => {
    const { game } = setup();
    for (let i = 0; i < 4; i++) game.advance();
    game.vote("a", "b"); // correct for round 2 (owners b, c)
    for (let i = 0; i < 4; i++) game.advance();
    expect(game.finished).toBe(true);
    expect(game.deadline()).toBeNull();
    const v = game.view();
    expect(v.remainingMs).toBe(0);
    // Round 1: nobody voted → a hidden (+100). Round 2: a found b out → 150, no owner bonus.
    expect(v.scores).toEqual([
      { playerId: "a", score: 250 },
      { playerId: "b", score: 0 },
      { playerId: "c", score: 0 },
    ]);
    game.advance(); // no-op once finished
    expect(game.finished).toBe(true);
  });

  it("advanceIf only moves when the stage is still the one the timer was set for", () => {
    const { game } = setup();
    const { seq } = game.deadline()!;
    game.advance(); // host skipped / everybody voted
    expect(game.advanceIf(seq)).toBe(false);
    expect(game.view().stage).toBe("owners");
    expect(game.advanceIf(seq + 1)).toBe(true);
    expect(game.view().stage).toBe("votes");
  });

  it("starts with the media found when preparing, and can refresh a round's preview by its ref", () => {
    let t = 0;
    const game = new Game({
      rounds: [
        { ...rounds[0]!, media: { ref: "11", previewUrl: "https://p/old.mp3", coverUrl: "https://c/1.jpg" } },
        rounds[1]!,
      ],
      players: ["a", "b", "c"],
      now: () => t,
      questionMs: QUESTION,
      revealStageMs: STAGE,
    });
    expect(game.view().track).toMatchObject({ previewUrl: "https://p/old.mp3", coverUrl: "https://c/1.jpg" });
    expect(game.mediaRef(0)).toBe("11");
    expect(game.mediaRef(1)).toBeUndefined();
    game.setPreview(0, "https://p/fresh.mp3");
    expect(game.view().track).toMatchObject({ previewUrl: "https://p/fresh.mp3", coverUrl: "https://c/1.jpg" });
    game.setPreview(1, "https://p/none.mp3"); // a round without audio stays without
    for (let i = 0; i < 4; i++) game.advance();
    expect(game.view().track.previewUrl).toBeNull();
    t++;
  });
});
