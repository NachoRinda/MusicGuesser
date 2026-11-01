import { FAKE_TRACK_POOL, ROOM_CODE_ALPHABET, type HostSession, type Track } from "@mg/shared";
import { beforeEach, describe, expect, it } from "vitest";
import type { LookupResult } from "../music/MusicCatalog.js";
import { HOST_TTL_MS, RoomStore } from "./RoomStore.js";

const QUESTION = 45_000;
const STAGE = 10_000;

function ok<T>(res: { ok: true } & T): T;
function ok<T>(res: ({ ok: true } & T) | { ok: false; error: string }): T;
function ok<T>(res: ({ ok: true } & T) | { ok: false; error: string }): T {
  if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
  return res;
}

describe("RoomStore", () => {
  let clock = 0;
  let store: RoomStore;
  let host: HostSession;

  beforeEach(() => {
    clock = 0;
    store = new RoomStore({ now: () => clock });
    host = store.createRoom();
    store.hostConnected(host.code);
  });

  /** Joins and marks the player connected, as the socket layer does. */
  function joinConnected(name: string, code = host.code) {
    const session = ok(store.join(code, name));
    store.playerConnected(code, session.playerId);
    return session;
  }

  const TEN_TRACKS: Track[] = FAKE_TRACK_POOL.slice(0, 10);

  /** Uploads a screenshot that reads fine, as the socket layer does after extraction. */
  function makeReady(playerId: string, tracks: Track[] = TEN_TRACKS, code = host.code) {
    ok(store.beginExtraction(code, playerId));
    store.finishExtraction(code, playerId, { status: "ready", tracks });
  }

  function joinReady(name: string) {
    const session = joinConnected(name);
    makeReady(session.playerId);
    return session;
  }

  const lobbyPlayer = { connected: true, status: "noTracks", trackCount: 0, inGame: false };

  describe("room codes", () => {
    it("are 4 letters from the unambiguous alphabet", () => {
      for (let i = 0; i < 200; i++) {
        const { code } = store.createRoom();
        expect(code).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{4}$`));
      }
      expect(ROOM_CODE_ALPHABET).not.toMatch(/[IO01]/);
    });

    it("are unique among active rooms even when the generator repeats", () => {
      // First two rooms draw the same sequence; the second must retry until it finds a free code.
      const sequence = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
      let i = 0;
      const s = new RoomStore({ random: () => sequence[i++ % sequence.length]! });
      const a = s.createRoom().code;
      const b = s.createRoom().code;
      expect(a).toBe("AAAA");
      expect(b).not.toBe(a);
    });

    it("are unique across many rooms", () => {
      const codes = new Set([host.code]);
      for (let i = 0; i < 1000; i++) codes.add(store.createRoom().code);
      expect(codes.size).toBe(1001);
    });
  });

  describe("join", () => {
    it("adds the player to the lobby state", () => {
      const { playerId } = joinConnected("Ana");
      expect(store.getState(host.code)).toEqual({
        code: host.code,
        phase: "lobby",
        settings: { rounds: 10 },
        players: [{ id: playerId, name: "Ana", ...lobbyPlayer }],
      });
    });

    it("accepts the code in lowercase", () => {
      expect(store.join(host.code.toLowerCase(), "Ana").ok).toBe(true);
    });

    it("trims the name", () => {
      joinConnected("  Ana  ");
      expect(store.getState(host.code)!.players[0]!.name).toBe("Ana");
    });

    it.each(["", "   ", "x".repeat(21)])("rejects invalid name %j", (name) => {
      expect(store.join(host.code, name)).toEqual({ ok: false, error: "INVALID_NAME" });
    });

    it("accepts a 20-character name", () => {
      expect(store.join(host.code, "x".repeat(20)).ok).toBe(true);
    });

    it("rejects a duplicate name ignoring case (only one of two simultaneous joins wins)", () => {
      expect(store.join(host.code, "Ana").ok).toBe(true);
      expect(store.join(host.code, "aNA ")).toEqual({ ok: false, error: "NAME_TAKEN" });
      expect(store.getState(host.code)!.players).toHaveLength(1);
    });

    it("rejects an unknown room", () => {
      expect(store.join("ZZZZ", "Ana")).toEqual({ ok: false, error: "ROOM_NOT_FOUND" });
    });

    it("rejects new players once the game started", () => {
      joinReady("A");
      joinReady("B");
      joinReady("C");
      ok(store.start(host.code));
      expect(store.join(host.code, "D")).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
    });

    it("starts with no tracks", () => {
      const { playerId } = joinConnected("Ana");
      expect(store.getPlayer(host.code, playerId)!.tracks).toEqual([]);
      expect(store.getPlayerTracks(host.code, playerId)).toEqual({ status: "noTracks", tracks: [] });
    });
  });

  describe("reconnection", () => {
    it("resumes a player by token, keeping identity", () => {
      const session = joinConnected("Ana");
      store.playerDisconnected(host.code, session.playerId);
      expect(store.getState(host.code)!.players[0]!.connected).toBe(false);

      const resumed = ok(store.resumePlayer(host.code, session.playerToken));
      expect(resumed).toEqual(session);
      store.playerConnected(host.code, resumed.playerId);
      expect(store.getState(host.code)!.players).toEqual([{ id: session.playerId, name: "Ana", ...lobbyPlayer }]);
    });

    it("lets an existing player back in after the game started", () => {
      const a = joinReady("A");
      joinReady("B");
      joinReady("C");
      ok(store.start(host.code));
      store.playerDisconnected(host.code, a.playerId);
      expect(store.resumePlayer(host.code, a.playerToken).ok).toBe(true);
    });

    it("rejects an unknown token or one from another room", () => {
      const other = store.createRoom();
      const session = ok(store.join(other.code, "Ana"));
      expect(store.resumePlayer(host.code, "nope")).toEqual({ ok: false, error: "INVALID_TOKEN" });
      expect(store.resumePlayer(host.code, session.playerToken)).toEqual({ ok: false, error: "INVALID_TOKEN" });
    });

    it("rejects resuming in an unknown room", () => {
      expect(store.resumePlayer("ZZZZ", "nope")).toEqual({ ok: false, error: "ROOM_NOT_FOUND" });
    });

    it("stays connected while any of the player's sockets is connected", () => {
      const { playerId } = joinConnected("Ana");
      store.playerConnected(host.code, playerId); // reloaded tab connects before the old socket drops
      store.playerDisconnected(host.code, playerId);
      expect(store.getState(host.code)!.players[0]!.connected).toBe(true);
      store.playerDisconnected(host.code, playerId);
      expect(store.getState(host.code)!.players[0]!.connected).toBe(false);
    });

    it("resumes the host by token with the same players", () => {
      joinConnected("Ana");
      store.hostDisconnected(host.code);
      expect(store.resumeHost(host.hostToken)).toEqual({ ok: true, ...host });
      expect(store.getState(host.code)!.players.map((p) => p.name)).toEqual(["Ana"]);
    });

    it("rejects an unknown host token", () => {
      expect(store.resumeHost("nope")).toEqual({ ok: false, error: "INVALID_TOKEN" });
    });
  });

  describe("start", () => {
    it("needs at least 3 connected and ready players", () => {
      joinReady("A");
      joinReady("B");
      const c = joinReady("C");
      store.playerDisconnected(host.code, c.playerId);
      expect(store.start(host.code)).toEqual({ ok: false, error: "NOT_ENOUGH_READY_PLAYERS" });
      expect(store.getState(host.code)!.phase).toBe("lobby");

      store.playerConnected(host.code, c.playerId);
      expect(store.start(host.code)).toEqual({ ok: true });
      expect(store.getState(host.code)!.phase).toBe("playing");
    });

    it("does not count connected players that are not ready", () => {
      joinReady("A");
      joinReady("B");
      joinConnected("C");
      const d = joinConnected("D");
      ok(store.beginExtraction(host.code, d.playerId));
      store.finishExtraction(host.code, d.playerId, { status: "invalid", problem: "tooFew", tracks: TEN_TRACKS.slice(0, 5) });
      expect(store.start(host.code)).toEqual({ ok: false, error: "NOT_ENOUGH_READY_PLAYERS" });
    });

    it("leaves players that are not ready out of the game (ready but disconnected ones stay in)", () => {
      joinReady("A");
      joinReady("B");
      joinReady("C");
      const late = joinReady("Late");
      store.playerDisconnected(host.code, late.playerId);
      joinConnected("NoTracks");
      ok(store.start(host.code));
      const inGame = Object.fromEntries(store.getState(host.code)!.players.map((p) => [p.name, p.inGame]));
      expect(inGame).toEqual({ A: true, B: true, C: true, Late: true, NoTracks: false });
    });

    it("rejects starting twice", () => {
      joinReady("A");
      joinReady("B");
      joinReady("C");
      ok(store.start(host.code));
      expect(store.start(host.code)).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
    });
  });

  describe("screenshots", () => {
    const status = (playerId: string) => store.getState(host.code)!.players.find((p) => p.id === playerId)!;

    it("goes noTracks → extracting → ready, with the track count public and the tracks private", () => {
      const { playerId } = joinConnected("Ana");
      expect(store.beginExtraction(host.code, playerId)).toEqual({ ok: true });
      expect(status(playerId)).toMatchObject({ status: "extracting", trackCount: 0 });

      store.finishExtraction(host.code, playerId, { status: "ready", tracks: TEN_TRACKS });
      expect(status(playerId)).toMatchObject({ status: "ready", trackCount: 10 });
      expect(store.getPlayerTracks(host.code, playerId)).toEqual({ status: "ready", tracks: TEN_TRACKS });
      expect(store.getPlayer(host.code, playerId)!.tracks).toEqual(TEN_TRACKS);
    });

    it("keeps what was read and the problem when invalid", () => {
      const { playerId } = joinConnected("Ana");
      ok(store.beginExtraction(host.code, playerId));
      store.finishExtraction(host.code, playerId, { status: "invalid", problem: "tooFew", tracks: TEN_TRACKS.slice(0, 4) });
      expect(status(playerId)).toMatchObject({ status: "invalid", trackCount: 4 });
      expect(store.getPlayerTracks(host.code, playerId)).toEqual({
        status: "invalid",
        problem: "tooFew",
        tracks: TEN_TRACKS.slice(0, 4),
      });
    });

    it("records a technical failure as error with no tracks", () => {
      const { playerId } = joinConnected("Ana");
      ok(store.beginExtraction(host.code, playerId));
      store.finishExtraction(host.code, playerId, { status: "error" });
      expect(store.getPlayerTracks(host.code, playerId)).toEqual({ status: "error", problem: "failed", tracks: [] });
    });

    it("replaces all tracks on retry (never mixes uploads)", () => {
      const { playerId } = joinConnected("Ana");
      makeReady(playerId);
      const other = FAKE_TRACK_POOL.slice(10, 22);
      ok(store.beginExtraction(host.code, playerId));
      expect(status(playerId)).toMatchObject({ status: "extracting", trackCount: 0 });
      store.finishExtraction(host.code, playerId, { status: "ready", tracks: other });
      expect(store.getPlayer(host.code, playerId)!.tracks).toEqual(other);
    });

    it("rejects a second upload while one is being read", () => {
      const { playerId } = joinConnected("Ana");
      ok(store.beginExtraction(host.code, playerId));
      expect(store.beginExtraction(host.code, playerId)).toEqual({ ok: false, error: "EXTRACTION_IN_PROGRESS" });
    });

    it("rejects uploads once the game started", () => {
      joinReady("A");
      joinReady("B");
      joinReady("C");
      const d = joinConnected("D");
      ok(store.start(host.code));
      expect(store.beginExtraction(host.code, d.playerId)).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
    });

    it("rejects uploads for unknown rooms or players", () => {
      expect(store.beginExtraction("ZZZZ", "x")).toEqual({ ok: false, error: "ROOM_NOT_FOUND" });
      expect(store.beginExtraction(host.code, "x")).toEqual({ ok: false, error: "NOT_AUTHORIZED" });
    });

    it("ignores a result for a player that is not extracting", () => {
      const { playerId } = joinConnected("Ana");
      expect(store.finishExtraction(host.code, playerId, { status: "ready", tracks: TEN_TRACKS })).toBe(false);
      expect(status(playerId).status).toBe("noTracks");
    });
  });

  describe("host TTL", () => {
    it("deletes a room 30 min after the host disconnects", () => {
      expect(HOST_TTL_MS).toBe(30 * 60 * 1000);
      const session = joinConnected("Ana");
      store.hostDisconnected(host.code);

      clock += HOST_TTL_MS - 1;
      expect(store.sweep()).toEqual([]);
      expect(store.getState(host.code)).toBeDefined();

      clock += 1;
      expect(store.sweep()).toEqual([host.code]);
      expect(store.getState(host.code)).toBeUndefined();
      expect(store.resumeHost(host.hostToken)).toEqual({ ok: false, error: "INVALID_TOKEN" });
      expect(store.resumePlayer(host.code, session.playerToken)).toEqual({ ok: false, error: "ROOM_NOT_FOUND" });
    });

    it("resets the countdown when the host comes back", () => {
      store.hostDisconnected(host.code);
      clock += HOST_TTL_MS - 1;
      store.hostConnected(host.code);
      clock += HOST_TTL_MS;
      expect(store.sweep()).toEqual([]);
    });

    it("deletes a room whose host never connected", () => {
      const orphan = store.createRoom();
      clock += HOST_TTL_MS;
      expect(store.sweep()).toEqual([orphan.code]);
    });
  });

  describe("broadcast state", () => {
    it("never includes tokens or tracks", () => {
      const a = joinReady("Ana");
      const json = JSON.stringify(store.getState(host.code));
      expect(json).not.toContain(a.playerToken);
      expect(json).not.toContain(host.hostToken);
      for (const t of TEN_TRACKS) expect(json).not.toContain(t.title);
      expect(Object.keys(store.getState(host.code)!.players[0]!).sort()).toEqual([
        "connected",
        "id",
        "inGame",
        "name",
        "status",
        "trackCount",
      ]);
    });
  });
  describe("game", () => {
    function startGame(rounds?: 5 | 10 | 15) {
      const players = ["Ana", "Beto", "Caro"].map((n) => joinReady(n));
      if (rounds) ok(store.setRounds(host.code, rounds));
      ok(store.start(host.code));
      return players;
    }
    const game = () => store.getState(host.code)!.game!;

    it("settings: 5/10/15 rounds, default 10, only in the lobby", () => {
      expect(store.getState(host.code)!.settings).toEqual({ rounds: 10 });
      expect(store.setRounds(host.code, 7 as 5)).toEqual({ ok: false, error: "INVALID_SETTINGS" });
      ok(store.setRounds(host.code, 5));
      expect(store.getState(host.code)!.settings).toEqual({ rounds: 5 });
      startGame();
      expect(store.setRounds(host.code, 10)).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
    });

    it("start creates a game with the chosen rounds, capped at the distinct tracks", () => {
      startGame(5);
      expect(game()).toMatchObject({ round: 1, totalRounds: 5, stage: "question", remainingMs: QUESTION });
      expect(store.getState(host.code)!.phase).toBe("playing");
    });

    it("plays only with tracks of players in the game", () => {
      const [a] = startGame(15);
      // Everyone has the same 10 tracks → only 10 rounds.
      expect(game().totalRounds).toBe(10);
      expect(store.getGame(host.code)!.players).toHaveLength(3);
      expect(store.getGame(host.code)!.players).toContain(a!.playerId);
    });

    it("votes go through the game; the question closes once every connected player voted", () => {
      const [a, b, c] = startGame();
      expect(store.vote(host.code, a!.playerId, a!.playerId)).toEqual({ ok: false, error: "INVALID_VOTE" });
      ok(store.vote(host.code, a!.playerId, b!.playerId));
      expect(store.getMyVote(host.code, a!.playerId)).toEqual({ round: 1, targetId: b!.playerId });
      ok(store.vote(host.code, b!.playerId, c!.playerId));
      expect(game().stage).toBe("question");
      ok(store.vote(host.code, c!.playerId, a!.playerId));
      expect(game().stage).toBe("owners");
    });

    it("a player who disconnects without voting doesn't block the close", () => {
      const [a, b, c] = startGame();
      ok(store.vote(host.code, a!.playerId, b!.playerId));
      ok(store.vote(host.code, b!.playerId, a!.playerId));
      store.playerDisconnected(host.code, c!.playerId);
      expect(game().stage).toBe("owners");
    });

    it("rejects votes from players out of the game and outside a game", () => {
      expect(store.vote(host.code, "x", "y")).toEqual({ ok: false, error: "NOT_PLAYING" });
      const d = joinConnected("Dani"); // not ready → out of the game
      startGame();
      expect(store.vote(host.code, d.playerId, "y")).toEqual({ ok: false, error: "NOT_IN_GAME" });
    });

    it("host next / timers advance through the stages; stale timers do nothing", () => {
      startGame(5);
      const { seq } = store.getGame(host.code)!.deadline()!;
      ok(store.next(host.code));
      expect(game().stage).toBe("owners");
      expect(store.advanceIf(host.code, store.getGame(host.code)!, seq)).toBe(false);
      clock += STAGE;
      expect(store.advanceIf(host.code, store.getGame(host.code)!, seq + 1)).toBe(true);
      expect(game().stage).toBe("votes");
    });

    it("finishes after the last round; play again goes back to the lobby keeping players and tracks", () => {
      const [a] = startGame(5);
      for (let i = 0; i < 5 * 4; i++) ok(store.next(host.code));
      const finished = store.getState(host.code)!;
      expect(finished.phase).toBe("finished");
      expect(finished.game?.scores).toHaveLength(3);
      expect(store.next(host.code)).toEqual({ ok: false, error: "NOT_PLAYING" });
      expect(store.join(host.code, "Tarde")).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });

      ok(store.playAgain(host.code));
      const lobby = store.getState(host.code)!;
      expect(lobby.phase).toBe("lobby");
      expect(lobby.game).toBeUndefined();
      expect(lobby.players.every((p) => p.status === "ready" && !p.inGame && p.trackCount === 10)).toBe(true);
      expect(store.getPlayerTracks(host.code, a!.playerId)?.tracks).toHaveLength(10);
      ok(store.join(host.code, "Tarde"));
      // A new game starts from zero.
      ok(store.start(host.code));
      expect(game().scores.every((s) => s.score === 0)).toBe(true);
    });

    it("play again only from finished", () => {
      expect(store.playAgain(host.code)).toEqual({ ok: false, error: "NOT_PLAYING" });
      startGame();
      expect(store.playAgain(host.code)).toEqual({ ok: false, error: "NOT_PLAYING" });
    });

    it("the question state never includes owners nor vote targets", () => {
      const [a, b] = startGame();
      ok(store.vote(host.code, a!.playerId, b!.playerId));
      const json = JSON.stringify(store.getState(host.code));
      expect(json).not.toContain("owners");
      expect(json).not.toContain("targetId");
    });
  });

  describe("start with audio check", () => {
    const found = (t: Track): LookupResult => ({
      status: "found",
      media: { ref: t.title, previewUrl: `https://p/${t.title}.mp3`, coverUrl: null },
    });

    it("beginStart flags the room as starting (state + blocks joins, uploads, settings and a second start)", () => {
      const [a] = ["Ana", "Beto", "Caro"].map((n) => joinReady(n));
      ok(store.beginStart(host.code));
      const s = store.getState(host.code)!;
      expect(s.starting).toBe(true);
      expect(s.phase).toBe("lobby");
      expect(store.join(host.code, "Dani")).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
      expect(store.beginExtraction(host.code, a!.playerId)).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
      expect(store.setRounds(host.code, 5)).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
      expect(store.beginStart(host.code)).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
    });

    it("beginStart validates like start", () => {
      joinReady("Ana");
      expect(store.beginStart(host.code)).toEqual({ ok: false, error: "NOT_ENOUGH_READY_PLAYERS" });
      expect(store.getState(host.code)!.starting).toBeUndefined();
    });

    it("completeStart plays only tracks found in the catalog, with their media", async () => {
      ["Ana", "Beto", "Caro"].map((n) => joinReady(n));
      ok(store.setRounds(host.code, 5));
      ok(store.beginStart(host.code));
      const missing = new Set(TEN_TRACKS.slice(0, 3).map((t) => t.title));
      ok(await store.completeStart(host.code, async (t) => (missing.has(t.title) ? { status: "notFound" } : found(t))));
      const s = store.getState(host.code)!;
      expect(s.starting).toBeUndefined();
      expect(s.phase).toBe("playing");
      expect(s.game?.totalRounds).toBe(5);
      expect(missing.has(s.game!.track.title)).toBe(false);
      expect(s.game?.track.previewUrl).toBe(`https://p/${s.game!.track.title}.mp3`);
    });

    it("NO_PLAYABLE_TRACKS when nothing is in the catalog: back to the lobby", async () => {
      ["Ana", "Beto", "Caro"].map((n) => joinReady(n));
      ok(store.beginStart(host.code));
      expect(await store.completeStart(host.code, async () => ({ status: "notFound" }))).toEqual({
        ok: false,
        error: "NO_PLAYABLE_TRACKS",
      });
      const s = store.getState(host.code)!;
      expect(s.phase).toBe("lobby");
      expect(s.starting).toBeUndefined();
      expect(s.players.every((p) => !p.inGame)).toBe(true);
    });

    it("network failures don't block the game: those tracks play without audio", async () => {
      ["Ana", "Beto", "Caro"].map((n) => joinReady(n));
      ok(store.beginStart(host.code));
      ok(await store.completeStart(host.code, async () => ({ status: "error" })));
      expect(store.getState(host.code)!.game?.track.previewUrl).toBeNull();
    });
  });
});
