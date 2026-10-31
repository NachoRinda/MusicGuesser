import type { AddressInfo } from "node:net";
import type {
  ClientToServerEvents,
  HostSession,
  PlayerSession,
  PlayerTracks,
  Result,
  RoomState,
  ServerToClientEvents,
} from "@mg/shared";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAppServer } from "../app.js";
import type { Extractor } from "../extraction/Extractor.js";
import { FakeExtractor } from "../extraction/FakeExtractor.js";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Lets a test swap the extractor's behaviour (e.g. hang forever) without a new server. */
const extractor: Extractor & { impl: Extractor } = {
  impl: new FakeExtractor(),
  extract(images) {
    return this.impl.extract(images);
  },
};

type TestClient = Client & { states: RoomState[]; tracks: PlayerTracks[] };

const png = (content = "screenshot") => ({ mediaType: "image/png" as const, data: new TextEncoder().encode(content) });

describe("room sockets", () => {
  const { httpServer, io } = createAppServer({ extractor, extractionTimeoutMs: 300 });
  let url = "";
  const clients: Client[] = [];

  beforeAll(async () => {
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    for (const c of clients.splice(0)) c.disconnect();
    extractor.impl = new FakeExtractor();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await io.close();
  });

  async function client(): Promise<TestClient> {
    const c = connect(url, { transports: ["websocket"], forceNew: true }) as TestClient;
    c.states = [];
    c.tracks = [];
    c.on("room:state", (s) => c.states.push(s));
    c.on("player:tracks", (t) => c.tracks.push(t));
    clients.push(c);
    await new Promise<void>((resolve) => c.once("connect", () => resolve()));
    return c;
  }

  /** Resolves with the first broadcast state (past or future) matching the predicate. */
  function waitForState(c: TestClient, pred: (s: RoomState) => boolean): Promise<RoomState> {
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

  /** Resolves with the first `player:tracks` (past or future) matching the predicate. */
  function waitForTracks(c: TestClient, pred: (t: PlayerTracks) => boolean): Promise<PlayerTracks> {
    const seen = c.tracks.find(pred);
    if (seen) return Promise.resolve(seen);
    return new Promise((resolve) => {
      const onTracks = (t: PlayerTracks) => {
        if (!pred(t)) return;
        c.off("player:tracks", onTracks);
        resolve(t);
      };
      c.on("player:tracks", onTracks);
    });
  }

  /** Joins and uploads a screenshot that reads fine; resolves once the player is ready. */
  async function readyPlayer(code: string, name: string) {
    const p = await joinPlayer(code, name);
    ok(await p.phone.emitWithAck("player:uploadScreenshots", { images: [png(name)] }));
    await waitForTracks(p.phone, (t) => t.status === "ready");
    return p;
  }

  const connectedNames = (s: RoomState) => s.players.filter((p) => p.connected).map((p) => p.name);
  const statusOf = (s: RoomState, name: string) => s.players.find((p) => p.name === name)?.status;

  it("host + 3 players: the TV sees them all in under 1 s, then everyone moves to playing", async () => {
    const { tv, session } = await hostRoom();
    const t0 = Date.now();
    const phones = await Promise.all(["Ana", "Beto", "Caro"].map((n) => joinPlayer(session.code, n)));
    await waitForState(tv, (s) => connectedNames(s).length === 3);
    expect(Date.now() - t0).toBeLessThan(1000);
    for (const p of phones) ok(await p.phone.emitWithAck("player:uploadScreenshots", { images: [png(p.session.playerId)] }));
    await waitForState(tv, (s) => s.players.every((p) => p.status === "ready"));

    expect(await tv.emitWithAck("host:start")).toEqual({ ok: true });
    for (const c of [tv, ...phones.map((p) => p.phone)]) {
      await waitForState(c, (s) => s.phase === "playing");
    }
  });

  it("rejects start with fewer than 3 ready players", async () => {
    const { tv, session } = await hostRoom();
    await readyPlayer(session.code, "Ana");
    await readyPlayer(session.code, "Beto");
    await joinPlayer(session.code, "Caro");
    expect(await tv.emitWithAck("host:start")).toEqual({ ok: false, error: "NOT_ENOUGH_READY_PLAYERS" });
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
    const players = await Promise.all(["A", "B", "C"].map((n) => readyPlayer(session.code, n)));
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

  describe("screenshots", () => {
    it("upload → extracting → ready: the TV sees status and count, only the owner gets the tracks", async () => {
      const { tv, session } = await hostRoom();
      const ana = await joinPlayer(session.code, "Ana");
      const beto = await joinPlayer(session.code, "Beto");

      expect(await ana.phone.emitWithAck("player:uploadScreenshots", { images: [png(), png("second")] })).toEqual({
        ok: true,
      });
      await waitForState(tv, (s) => statusOf(s, "Ana") === "extracting");
      const ready = await waitForState(tv, (s) => statusOf(s, "Ana") === "ready");
      expect(ready.players.find((p) => p.name === "Ana")!.trackCount).toBeGreaterThanOrEqual(12);

      const mine = await waitForTracks(ana.phone, (t) => t.status === "ready");
      expect(mine.tracks.length).toBeGreaterThanOrEqual(12);
      expect(beto.phone.tracks.every((t) => t.status === "noTracks")).toBe(true);
      expect(tv.tracks).toEqual([]);
    });

    it("tells the player why an upload was rejected", async () => {
      const { session } = await hostRoom();
      const ana = await joinPlayer(session.code, "Ana");
      ok(await ana.phone.emitWithAck("player:uploadScreenshots", { images: [png("MG-FEW")] }));
      const few = await waitForTracks(ana.phone, (t) => t.status === "invalid");
      expect(few).toMatchObject({ problem: "tooFew" });
      expect(few.tracks).toHaveLength(5);

      ok(await ana.phone.emitWithAck("player:uploadScreenshots", { images: [png("MG-INVALID")] }));
      await waitForTracks(ana.phone, (t) => t.problem === "notPlaylist");
    });

    it("reports a failing or hanging extraction as error", async () => {
      const { tv, session } = await hostRoom();
      const ana = await joinPlayer(session.code, "Ana");
      vi.spyOn(console, "error").mockImplementation(() => {});
      ok(await ana.phone.emitWithAck("player:uploadScreenshots", { images: [png("MG-ERROR")] }));
      expect(await waitForTracks(ana.phone, (t) => t.status === "error")).toEqual({
        status: "error",
        problem: "failed",
        tracks: [],
      });

      extractor.impl = { extract: () => new Promise(() => {}) }; // never answers → timeout (300 ms here)
      const beto = await joinPlayer(session.code, "Beto");
      ok(await beto.phone.emitWithAck("player:uploadScreenshots", { images: [png()] }));
      await waitForState(tv, (s) => statusOf(s, "Beto") === "error");
    });

    it("rejects a second upload while the first is being read", async () => {
      const { session } = await hostRoom();
      extractor.impl = new FakeExtractor(100);
      const ana = await joinPlayer(session.code, "Ana");
      ok(await ana.phone.emitWithAck("player:uploadScreenshots", { images: [png()] }));
      expect(await ana.phone.emitWithAck("player:uploadScreenshots", { images: [png()] })).toEqual({
        ok: false,
        error: "EXTRACTION_IN_PROGRESS",
      });
    });

    it("validates uploads and who sends them", async () => {
      const { tv, session } = await hostRoom();
      const ana = await joinPlayer(session.code, "Ana");
      expect(await ana.phone.emitWithAck("player:uploadScreenshots", { images: [png(), png(), png()] })).toEqual({
        ok: false,
        error: "INVALID_UPLOAD",
      });
      expect(await tv.emitWithAck("player:uploadScreenshots", { images: [png()] })).toEqual({
        ok: false,
        error: "NOT_AUTHORIZED",
      });
    });

    it("a player who comes back gets their tracks again", async () => {
      const { session } = await hostRoom();
      const ana = await readyPlayer(session.code, "Ana");
      ana.phone.disconnect();
      const again = await client();
      ok(await again.emitWithAck("player:resume", { code: session.code, playerToken: ana.session.playerToken }));
      const t = await waitForTracks(again, (x) => x.status === "ready");
      expect(t.tracks.length).toBeGreaterThanOrEqual(12);
    });

    it("broadcast states never contain track titles", async () => {
      const { tv, session } = await hostRoom();
      const ana = await readyPlayer(session.code, "Ana");
      const titles = ana.phone.tracks.flatMap((t) => t.tracks.map((x) => x.title));
      expect(titles.length).toBeGreaterThan(0);
      const all = JSON.stringify([...tv.states, ...ana.phone.states]);
      for (const title of titles) expect(all).not.toContain(title);
    });

    it("never logs image contents", async () => {
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation(() => {}),
      );
      const secret = "PRIVATE-PIXELS-1234 MG-ERROR";
      const { session } = await hostRoom();
      const ana = await joinPlayer(session.code, "Ana");
      ok(await ana.phone.emitWithAck("player:uploadScreenshots", { images: [png(secret)] }));
      await waitForTracks(ana.phone, (t) => t.status === "error");
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls), (_k, v: unknown) =>
        typeof v === "object" && v instanceof Error ? `${v.name}: ${v.message} ${v.stack}` : v,
      );
      expect(logged).not.toContain("PRIVATE-PIXELS");
      expect(logged).not.toContain(Buffer.from(secret).toString("base64").slice(0, 16));
    });
  });
});
