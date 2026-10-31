import type { ClientToServerEvents, Result, ServerToClientEvents } from "@mg/shared";
import type { Server, Socket } from "socket.io";
import { evaluateExtraction } from "../extraction/evaluate.js";
import type { Extractor } from "../extraction/Extractor.js";
import { validateUpload, type ImageInput } from "../extraction/upload.js";
import type { ExtractionResult, RoomStore } from "./RoomStore.js";

/** Who a socket is, once it created/joined/resumed a room. */
export type SocketData = { code?: string; role?: "host" | "player"; playerId?: string };

export type AppIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface RoomHandlerOptions {
  extractor: Extractor;
  /** An extraction that takes longer than this counts as failed. */
  extractionTimeoutMs: number;
}

/** Socket.IO room holding every socket of one player, for private messages. */
const playerChannel = (playerId: string) => `player:${playerId}`;

/** Wires room events to the store and broadcasts `room:state` after every change. */
export function registerRoomHandlers(io: AppIo, store: RoomStore, options: RoomHandlerOptions): void {
  const broadcast = (code: string) => {
    const state = store.getState(code);
    if (state) io.to(state.code).emit("room:state", state);
  };

  const sendTracks = (code: string, playerId: string) => {
    const tracks = store.getPlayerTracks(code, playerId);
    if (tracks) io.to(playerChannel(playerId)).emit("player:tracks", tracks);
  };

  /**
   * Reads the screenshots and stores the outcome. The images only live in this closure: they are
   * never written anywhere nor logged, and are dropped when it returns.
   */
  const runExtraction = async (code: string, playerId: string, images: ImageInput[]) => {
    let result: ExtractionResult;
    try {
      const readings = await withTimeout(options.extractor.extract(images), options.extractionTimeoutMs);
      result = evaluateExtraction(readings);
    } catch (err) {
      // Only the error's name/message: never the request (which carries the images).
      console.error(`Extracción fallida en sala ${code}: ${describeError(err)}`);
      result = { status: "error" };
    }
    if (store.finishExtraction(code, playerId, result)) {
      broadcast(code);
      sendTracks(code, playerId);
    }
  };

  /** Removes whatever role the socket had (a socket holds one role at a time). */
  const detach = (socket: AppSocket) => {
    const { code, role, playerId } = socket.data;
    if (!code) return;
    if (role === "host") store.hostDisconnected(code);
    if (role === "player" && playerId) {
      store.playerDisconnected(code, playerId);
      void socket.leave(playerChannel(playerId));
    }
    void socket.leave(code);
    socket.data = {};
    broadcast(code);
  };

  const attach = (socket: AppSocket, data: Required<Pick<SocketData, "code" | "role">> & SocketData) => {
    detach(socket);
    socket.data = data;
    if (data.role === "host") store.hostConnected(data.code);
    void socket.join(data.code);
    if (data.role === "player" && data.playerId) {
      store.playerConnected(data.code, data.playerId);
      void socket.join(playerChannel(data.playerId));
      const tracks = store.getPlayerTracks(data.code, data.playerId);
      if (tracks) socket.emit("player:tracks", tracks);
    }
    broadcast(data.code);
  };

  io.on("connection", (socket) => {
    socket.on("host:create", (ack) => {
      if (typeof ack !== "function") return;
      const session = store.createRoom();
      attach(socket, { code: session.code, role: "host" });
      ack({ ok: true, ...session });
    });

    socket.on("host:resume", (req, ack) => {
      if (typeof ack !== "function") return;
      const res = store.resumeHost(String(req?.hostToken));
      if (res.ok) attach(socket, { code: res.code, role: "host" });
      ack(res);
    });

    socket.on("host:start", (ack) => {
      if (typeof ack !== "function") return;
      const { code, role } = socket.data;
      if (!code || role !== "host") return ack(notAuthorized);
      const res = store.start(code);
      if (res.ok) broadcast(code);
      ack(res);
    });

    socket.on("player:join", (req, ack) => {
      if (typeof ack !== "function") return;
      const res = store.join(String(req?.code), String(req?.name ?? ""));
      if (res.ok) attach(socket, { code: res.code, role: "player", playerId: res.playerId });
      ack(res);
    });

    socket.on("player:resume", (req, ack) => {
      if (typeof ack !== "function") return;
      const res = store.resumePlayer(String(req?.code), String(req?.playerToken));
      if (res.ok) attach(socket, { code: res.code, role: "player", playerId: res.playerId });
      ack(res);
    });

    socket.on("player:uploadScreenshots", (req, ack) => {
      if (typeof ack !== "function") return;
      const { code, role, playerId } = socket.data;
      if (!code || role !== "player" || !playerId) return ack(notAuthorized);
      const upload = validateUpload(req);
      if (!upload.ok) return ack(upload);
      const begun = store.beginExtraction(code, playerId);
      if (!begun.ok) return ack(begun);
      ack({ ok: true });
      broadcast(code);
      sendTracks(code, playerId);
      void runExtraction(code, playerId, upload.images);
    });

    socket.on("disconnect", () => detach(socket));
  });
}

const notAuthorized: Result<object> = { ok: false, error: "NOT_AUTHORIZED" };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { status?: unknown }).status;
    return `${err.name}${typeof status === "number" ? ` ${status}` : ""}: ${err.message}`;
  }
  return "error desconocido";
}
