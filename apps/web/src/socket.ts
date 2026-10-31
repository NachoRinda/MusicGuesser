import type { ClientToServerEvents, ServerToClientEvents } from "@mg/shared";
import { io, type Socket } from "socket.io-client";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Same-origin socket: Vite proxies `/socket.io` to the server in dev. */
export function createSocket(): AppSocket {
  return io();
}
