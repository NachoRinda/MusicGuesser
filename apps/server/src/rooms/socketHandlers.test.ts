import type { AddressInfo } from "node:net";
import type { ClientToServerEvents, HostSession, PlayerSession, Result, RoomState, ServerToClientEvents } from "@mg/shared";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createAppServer } from "../app.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

describe("room sockets", () => {
  const { httpServer, io } = createAppServer();
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

  async function client(): Promise<Client & { states: RoomState[] }> {
    const c = connect(url, { transports: ["websocket"], forceNew: true }) as Client & { states: RoomState[] };
    c.states = [];
    c.on("room:state", (s) => c.states.push(s));
    clients.push(c);
    await new Promise<void>((resolve) => c.once("connect", () => resolve()));
    return c;
  }

  /** Resolves with the first broadcast state (past or future) matching the predicate. */
  function waitForState(c: Client & { states: RoomState[] }, pred: (s: RoomState) => boolean): Promise<RoomState> {
    const seen = c.states.find(pred);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve) => {
      const onState = (s: RoomState) => {
        if (!pred(s)) return;
        c.off("room:state", onState);
        resolve(s);
      };
      c.on("room:state", onState);
    });
  }

  function ok<T>(res: Result<T>): T {
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    return res;
  }

  async function hostRoom() {
    const tv = await client();
    const session: HostSession = ok(await tv.emitWithAck("host:create"));
    return { tv, session };
  }

  async function joinPlayer(code: string, name: string) {
    const phone = await client();
    const session: PlayerSession = ok(await phone.emitWithAck("player:join", { code, name }));
    return { phone, session };
  }

  const connectedNames = (s: RoomState) => s.players.filter((p) => p.connected).map((p) => p.name);

  it("host + 3 players: the TV sees them all in under 1 s, then everyone moves to playing", async () => {
    const { tv, session } = await hostRoom();
    const t0 = Date.now();
    const phones = await Promise.all(["Ana", "Beto", "Caro"].map((n) => joinPlayer(session.code, n)));
    await waitForState(tv, (s) => connectedNames(s).length === 3);
    expect(Date.now() - t0).toBeLessThan(1000);

    expect(await tv.emitWithAck("host:start")).toEqual({ ok: true });
    for (const c of [tv, ...phones.map((p) => p.phone)]) {
      await waitForState(c, (s) => s.phase === "playing");
    }
  });

  it("rejects start with fewer than 3 connected players", async () => {
    const { tv, session } = await hostRoom();
    await joinPlayer(session.code, "Ana");
    await joinPlayer(session.code, "Beto");
    expect(await tv.emitWithAck("host:start")).toEqual({ ok: false, error: "NOT_ENOUGH_PLAYERS" });
  });

  it("only the host can start", async () => {
    const { session } = await hostRoom();
    const { phone } = await joinPlayer(session.code, "Ana");
    expect(await phone.emitWithAck("host:start")).toEqual({ ok: false, error: "NOT_AUTHORIZED" });
  });

  it("reports duplicate names and unknown rooms", async () => {
    const { session } = await hostRoom();
    await joinPlayer(session.code, "Ana");
    const phone = await client();
    expect(await phone.emitWithAck("player:join", { code: session.code, name: "ana" })).toEqual({
      ok: false,
      error: "NAME_TAKEN",
    });
    expect(await phone.emitWithAck("player:join", { code: "ZZZZ", name: "Ana" })).toEqual({
      ok: false,
      error: "ROOM_NOT_FOUND",
    });
  });

  it("a player who disconnects shows as disconnected and resumes as the same player", async () => {
    const { tv, session } = await hostRoom();
    const { phone, session: ana } = await joinPlayer(session.code, "Ana");
    await waitForState(tv, (s) => connectedNames(s).includes("Ana"));

    phone.disconnect();
    await waitForState(tv, (s) => s.players.some((p) => p.name === "Ana" && !p.connected));

    const again = await client();
    const resumed = ok(await again.emitWithAck("player:resume", { code: session.code, playerToken: ana.playerToken }));
    expect(resumed.playerId).toBe(ana.playerId);
    const state = await waitForState(tv, (s) => connectedNames(s).includes("Ana"));
    expect(state.players).toHaveLength(1);
  });

  it("the host resumes the same room with the same players after reloading", async () => {
    const { tv, session } = await hostRoom();
    await joinPlayer(session.code, "Ana");
    tv.disconnect();

    const tv2 = await client();
    expect(await tv2.emitWithAck("host:resume", { hostToken: session.hostToken })).toEqual({ ok: true, ...session });
    const state = await waitForState(tv2, () => true);
    expect(state.code).toBe(session.code);
    expect(state.players.map((p) => p.name)).toEqual(["Ana"]);
  });

  it("rejects new names during playing but lets existing players back in", async () => {
    const { tv, session } = await hostRoom();
    const players = await Promise.all(["A", "B", "C"].map((n) => joinPlayer(session.code, n)));
    ok(await tv.emitWithAck("host:start"));

    const late = await client();
    expect(await late.emitWithAck("player:join", { code: session.code, name: "D" })).toEqual({
      ok: false,
      error: "GAME_ALREADY_STARTED",
    });
    const a = players[0]!;
    a.phone.disconnect();
    expect((await late.emitWithAck("player:resume", { code: session.code, playerToken: a.session.playerToken })).ok).toBe(
      true,
    );
  });

  it("an invalid token is rejected so the client can join as new", async () => {
    const { session } = await hostRoom();
    const phone = await client();
    expect(await phone.emitWithAck("player:resume", { code: session.code, playerToken: "nope" })).toEqual({
      ok: false,
      error: "INVALID_TOKEN",
    });
    expect(await phone.emitWithAck("host:resume", { hostToken: "nope" })).toEqual({ ok: false, error: "INVALID_TOKEN" });
  });

  it("broadcast states never contain tokens", async () => {
    const { tv, session } = await hostRoom();
    const { phone, session: ana } = await joinPlayer(session.code, "Ana");
    await waitForState(tv, (s) => s.players.length === 1);
    const all = JSON.stringify([...tv.states, ...phone.states]);
    expect(all).not.toContain(session.hostToken);
    expect(all).not.toContain(ana.playerToken);
  });
});
