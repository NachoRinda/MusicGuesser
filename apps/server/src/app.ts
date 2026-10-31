import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";
import type { HealthResponse, NetworkInfo } from "@mg/shared";
import { detectLanHost } from "./network.js";
import { RoomStore } from "./rooms/RoomStore.js";
import { registerRoomHandlers, type AppIo } from "./rooms/socketHandlers.js";

export interface AppServerOptions {
  store?: RoomStore;
  /** How often expired rooms are swept. */
  sweepIntervalMs?: number;
}

/** Builds the HTTP + Socket.IO server without listening, so tests can start it on a random port. */
export function createAppServer({ store = new RoomStore(), sweepIntervalMs = 60_000 }: AppServerOptions = {}) {
  const app = express();

  app.get("/health", (_req, res) => {
    const body: HealthResponse = { status: "ok" };
    res.json(body);
  });

  app.get("/api/network", (_req, res) => {
    const body: NetworkInfo = { lanHost: detectLanHost() };
    res.json(body);
  });

  const httpServer = createServer(app);
  const io: AppIo = new Server(httpServer, { cors: { origin: "*" } });
  registerRoomHandlers(io, store);

  const sweeper = setInterval(() => store.sweep(), sweepIntervalMs);
  sweeper.unref();
  httpServer.on("close", () => clearInterval(sweeper));

  return { app, httpServer, io, store };
}
