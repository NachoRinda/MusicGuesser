import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";
import type { HealthResponse, NetworkInfo } from "@mg/shared";
import type { Extractor } from "./extraction/Extractor.js";
import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOTS_PER_UPLOAD } from "@mg/shared";
import { FakeExtractor } from "./extraction/FakeExtractor.js";
import { createExtractorFromEnv } from "./extraction/fromEnv.js";
import { detectLanHost } from "./network.js";
import { RoomStore } from "./rooms/RoomStore.js";
import { registerRoomHandlers, type AppIo } from "./rooms/socketHandlers.js";

export interface AppServerOptions {
  store?: RoomStore;
  /** How often expired rooms are swept. */
  sweepIntervalMs?: number;
  /** Reads screenshots; defaults to the one chosen by env vars (see `createExtractorFromEnv`). */
  extractor?: Extractor;
  extractionTimeoutMs?: number;
}

/** Builds the HTTP + Socket.IO server without listening, so tests can start it on a random port. */
export function createAppServer({
  store = new RoomStore(),
  sweepIntervalMs = 60_000,
  extractor = createExtractorFromEnv(),
  extractionTimeoutMs = 60_000,
}: AppServerOptions = {}) {
  const app = express();

  app.get("/health", (_req, res) => {
    const body: HealthResponse = { status: "ok", extractor: extractor instanceof FakeExtractor ? "fake" : "claude" };
    res.json(body);
  });

  app.get("/api/network", (_req, res) => {
    const body: NetworkInfo = { lanHost: detectLanHost() };
    res.json(body);
  });

  const httpServer = createServer(app);
  const io: AppIo = new Server(httpServer, {
    cors: { origin: "*" },
    // Room for a full upload (2 screenshots) plus framing overhead.
    maxHttpBufferSize: MAX_SCREENSHOTS_PER_UPLOAD * MAX_SCREENSHOT_BYTES + 1024 * 1024,
  });
  registerRoomHandlers(io, store, { extractor, extractionTimeoutMs });

  const sweeper = setInterval(() => store.sweep(), sweepIntervalMs);
  sweeper.unref();
  httpServer.on("close", () => clearInterval(sweeper));

  return { app, httpServer, io, store };
}
