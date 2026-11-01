import type { AddressInfo } from "node:net";
import type {
  ClientToServerEvents,
  MyVote,
  PlayerSession,
  PlayerTracks,
  Result,
  RoomState,
  ServerToClientEvents,
} from "@mg/shared";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAppServer } from "../app.js";
import { FakeExtractor } from "../extraction/FakeExtractor.js";
import { FakeCatalog } from "../music/FakeCatalog.js";
import { RoomStore } from "./RoomStore.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents> & {
  states: RoomState[];
  votes: MyVote[];
  tracks: PlayerTracks[];
  /** Index of the first state `waitForState` hasn't consumed yet. */
  cursor: number;
};

// Short stages so timers can be exercised for real.
const QUESTION_MS = 400;
const STAGE_MS = 60;
const media = { previewUrl: "https://cdn.test/preview.mp3", coverUrl: "https://img.test/cover.jpg" };

describe("game sockets", () => {
  const catalog = new FakeCatalog(media);
  const { httpServer, io } = createAppServer({
    extractor: new FakeExtractor(),
    catalog,
    store: new RoomStore({ questionMs: QUESTION_MS, revealStageMs: STAGE_MS }),
  });
  let url = "";
  const clients: Client[] = [];

  beforeAll(async () => {
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    for (const c of clients.splice(0)) c.disconnect();
  });

  afterAll(async () => {
    await io.close();
  });

  async function client(): Promise<Client> {
    const c = connect(url, { transports: ["websocket"], forceNew: true }) as Client;
    c.states = [];
    c.votes = [];
    c.tracks = [];
    c.cursor = 0;
    c.on("room:state", (s) => c.states.push(s));
    c.on("player:myVote", (v) => c.votes.push(v));
    c.on("player:tracks", (t) => c.tracks.push(t));
    clients.push(c);
    await new Promise<void>((resolve) => c.once("connect", () => resolve()));
    return c;
  }

  function ok<T>(res: Result<T>): T {
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    return res;
  }

  /**
   * Resolves with the first state matching, among those received after the previous match (so
   * fast stages that arrive together aren't missed, and an old match isn't reused).
   */
  function waitForState(c: Client, pred: (s: RoomState) => boolean, timeoutMs = 3_000): Promise<RoomState> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const i = c.states.findIndex((s, idx) => idx >= c.cursor && pred(s));
        if (i < 0) return false;
        c.cursor = i + 1;
        clearTimeout(timer);
        c.off("room:state", check);
        resolve(c.states[i]!);
        return true;
      };
      const timer = setTimeout(() => {
        c.off("room:state", check);
        reject(new Error("state not reached"));
      }, timeoutMs);
      if (!check()) c.on("room:state", check);
    });
  }

  async function readyPlayer(code: string, name: string) {
    const phone = await client();
    const session: PlayerSession = ok(await phone.emitWithAck("player:join", { code, name }));
    ok(await phone.emitWithAck("player:uploadScreenshots", { images: [{ mediaType: "image/png", data: new TextEncoder().encode(name) }] }));
    await new Promise<void>((resolve) => {
      const check = () => phone.tracks.some((t) => t.status === "ready") && resolve();
      phone.on("player:tracks", check);
      check();
    });
    return { phone, session };
  }

  async function startedGame(rounds: 5 | 10 | 15 = 5) {
    const tv = await client();
    const { code } = ok(await tv.emitWithAck("host:create"));
    const players = [];
    for (const name of ["Ana", "Beto", "Caro"]) players.push(await readyPlayer(code, name));
    ok(await tv.emitWithAck("host:settings", { rounds }));
    ok(await tv.emitWithAck("host:start"));
    await waitForState(tv, (s) => s.phase === "playing");
    tv.cursor -= 1; // leave the first game state for the test to look at
    return { tv, code, players };
  }

  const stage = (s: RoomState) => s.game && `${s.game.round}:${s.game.stage}`;

  it("plays a full 5-round game: votes close each question early, reveal stages run on timers, play again", async () => {
    const { tv, players } = await startedGame(5);
    const ids = players.map((p) => p.session.playerId);
    for (let round = 1; round <= 5; round++) {
      await waitForState(tv, (s) => stage(s) === `${round}:question`);
      // Everyone votes the next player: the question closes before its timer.
      for (const [i, p] of players.entries()) {
        ok(await p.phone.emitWithAck("player:vote", { targetId: ids[(i + 1) % ids.length]! }));
      }
      const owners = await waitForState(tv, (s) => stage(s) === `${round}:owners`);
      expect(owners.game?.reveal?.owners.length).toBeGreaterThan(0);
      expect(owners.game?.reveal?.votes).toHaveLength(3);
      await waitForState(tv, (s) => stage(s) === `${round}:votes`);
      await waitForState(tv, (s) => stage(s) === `${round}:ranking`);
    }
    const final = await waitForState(tv, (s) => s.phase === "finished");
    expect(final.game?.scores).toHaveLength(3);

    ok(await tv.emitWithAck("host:playAgain"));
    const lobby = await waitForState(tv, (s) => s.phase === "lobby");
    expect(lobby.game).toBeUndefined();
    expect(lobby.players.every((p) => p.status === "ready")).toBe(true);
  });

  it("the question timer closes the round when nobody votes", async () => {
    const { tv } = await startedGame(5);
    const t0 = Date.now();
    await waitForState(tv, (s) => stage(s) === "1:owners");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(QUESTION_MS - 50);
  });

  it("question state never leaks owners nor vote targets; myVote goes only to the voter", async () => {
    const { tv, players } = await startedGame(5);
    const [ana, beto, caro] = players;
    ok(await ana!.phone.emitWithAck("player:vote", { targetId: beto!.session.playerId }));
    const s = await waitForState(caro!.phone, (st) => (st.game?.voted.length ?? 0) === 1);
    expect(s.game?.voted).toEqual([ana!.session.playerId]);
    for (const c of [tv, ana!.phone, beto!.phone, caro!.phone]) {
      const json = JSON.stringify(c.states.filter((st) => st.game?.stage === "question"));
      expect(json).not.toContain("owners");
      expect(json).not.toContain("targetId");
    }
    expect(ana!.phone.votes).toEqual([{ round: 1, targetId: beto!.session.playerId }]);
    expect(beto!.phone.votes).toEqual([]);
    expect(tv.votes).toEqual([]);
    expect(await ana!.phone.emitWithAck("player:vote", { targetId: caro!.session.playerId })).toEqual({
      ok: false,
      error: "ALREADY_VOTED",
    });
  });

  it("a player who reloads mid-round gets the state and their vote back", async () => {
    const { code, players } = await startedGame(5);
    const [ana, beto] = players;
    ok(await ana!.phone.emitWithAck("player:vote", { targetId: beto!.session.playerId }));
    const again = await client();
    const token = (ana!.session as PlayerSession).playerToken;
    ok(await again.emitWithAck("player:resume", { code, playerToken: token }));
    const s = await waitForState(again, (st) => st.phase === "playing");
    expect(s.game?.stage).toBe("question");
    expect(again.votes).toEqual([{ round: 1, targetId: beto!.session.playerId }]);
  });

  it("looks up the round's audio and shows it in the state", async () => {
    const before = catalog.lookups.length;
    const { tv } = await startedGame(5);
    const s = await waitForState(tv, (st) => st.game?.track.previewUrl === media.previewUrl);
    expect(s.game?.track.coverUrl).toBe(media.coverUrl);
    // This round and the next one are fetched ahead.
    expect(catalog.lookups.length - before).toBe(2);
  });

  it("host:next skips stages; only the host may drive the game", async () => {
    const { tv, players } = await startedGame(5);
    expect(await players[0]!.phone.emitWithAck("host:next")).toEqual({ ok: false, error: "NOT_AUTHORIZED" });
    ok(await tv.emitWithAck("host:next"));
    await waitForState(tv, (s) => stage(s) === "1:owners");
    ok(await tv.emitWithAck("host:next"));
    await waitForState(tv, (s) => stage(s) === "1:votes");
    expect(await tv.emitWithAck("host:playAgain")).toEqual({ ok: false, error: "NOT_PLAYING" });
  });

  it("rejects settings outside 5/10/15", async () => {
    const tv = await client();
    ok(await tv.emitWithAck("host:create"));
    expect(await tv.emitWithAck("host:settings", { rounds: 7 as 5 })).toEqual({ ok: false, error: "INVALID_SETTINGS" });
  });
});
