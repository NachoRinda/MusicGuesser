import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Same PORT as the server (`npm run dev` passes it to both), so a second instance can run alongside.
const api = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // reachable from phones on the same network
    proxy: {
      "/health": api,
      "/api": api,
      "/socket.io": { target: api, ws: true },
    },
  },
});
