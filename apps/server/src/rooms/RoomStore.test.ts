import { FAKE_TRACK_POOL, FAKE_TRACKS_PER_PLAYER, ROOM_CODE_ALPHABET, type HostSession } from "@mg/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { HOST_TTL_MS, RoomStore } from "./RoomStore.js";

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
        players: [{ id: playerId, name: "Ana", connected: true }],
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
      joinConnected("A");
      joinConnected("B");
      joinConnected("C");
      ok(store.start(host.code));
      expect(store.join(host.code, "D")).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
    });

    it("gives each player 10 distinct fake tracks from the fixed pool", () => {
      const { playerId } = joinConnected("Ana");
      const tracks = store.getPlayer(host.code, playerId)!.tracks;
      expect(tracks).toHaveLength(FAKE_TRACKS_PER_PLAYER);
      expect(new Set(tracks.map((t) => t.title)).size).toBe(FAKE_TRACKS_PER_PLAYER);
      for (const t of tracks) expect(FAKE_TRACK_POOL).toContainEqual(t);
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
      expect(store.getState(host.code)!.players).toEqual([{ id: session.playerId, name: "Ana", connected: true }]);
    });

    it("lets an existing player back in after the game started", () => {
      const a = joinConnected("A");
      joinConnected("B");
      joinConnected("C");
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
    it("needs at least 3 connected players", () => {
      joinConnected("A");
      joinConnected("B");
      const c = joinConnected("C");
      store.playerDisconnected(host.code, c.playerId);
      expect(store.start(host.code)).toEqual({ ok: false, error: "NOT_ENOUGH_PLAYERS" });
      expect(store.getState(host.code)!.phase).toBe("lobby");

      store.playerConnected(host.code, c.playerId);
      expect(store.start(host.code)).toEqual({ ok: true });
      expect(store.getState(host.code)!.phase).toBe("playing");
    });

    it("rejects starting twice", () => {
      joinConnected("A");
      joinConnected("B");
      joinConnected("C");
      ok(store.start(host.code));
      expect(store.start(host.code)).toEqual({ ok: false, error: "GAME_ALREADY_STARTED" });
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
      const a = joinConnected("Ana");
      const json = JSON.stringify(store.getState(host.code));
      expect(json).not.toContain(a.playerToken);
      expect(json).not.toContain(host.hostToken);
      expect(json).not.toContain("tracks");
      expect(Object.keys(store.getState(host.code)!.players[0]!).sort()).toEqual(["connected", "id", "name"]);
    });
  });
});
