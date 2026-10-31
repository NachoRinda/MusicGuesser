import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";
import type { HealthResponse } from "@mg/shared";

/** Builds the HTTP + Socket.IO server without listening, so tests can start it on a random port. */
export function createAppServer() {
  const app = express();

  app.get("/health", (_req, res) => {
    const body: HealthResponse = { status: "ok" };
    res.json(body);
  });

  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: "*" } });

  return { app, httpServer, io };
}
