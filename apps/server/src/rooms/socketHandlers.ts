import type { ClientToServerEvents, Result, ServerToClientEvents } from "@mg/shared";
import type { Server, Socket } from "socket.io";
import type { RoomStore } from "./RoomStore.js";

/** Who a socket is, once it created/joined/resumed a room. */
export type SocketData = { code?: string; role?: "host" | "player"; playerId?: string };

export type AppIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Wires room events to the store and broadcasts `room:state` after every change. */
export function registerRoomHandlers(io: AppIo, store: RoomStore): void {
  const broadcast = (code: string) => {
    const state = store.getState(code);
    if (state) io.to(state.code).emit("room:state", state);
  };

  /** Removes whatever role the socket had (a socket holds one role at a time). */
  const detach = (socket: AppSocket) => {
    const { code, role, playerId } = socket.data;
    if (!code) return;
    if (role === "host") store.hostDisconnected(code);
    if (role === "player" && playerId) store.playerDisconnected(code, playerId);
    void socket.leave(code);
    socket.data = {};
    broadcast(code);
  };

  const attach = (socket: AppSocket, data: Required<Pick<SocketData, "code" | "role">> & SocketData) => {
    detach(socket);
    socket.data = data;
    if (data.role === "host") store.hostConnected(data.code);
    if (data.role === "player" && data.playerId) store.playerConnected(data.code, data.playerId);
    void socket.join(data.code);
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

    socket.on("disconnect", () => detach(socket));
  });
}

const notAuthorized: Result<object> = { ok: false, error: "NOT_AUTHORIZED" };
