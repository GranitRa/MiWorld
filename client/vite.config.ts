import { defineConfig } from "vite";

// The client is served by the Node server in production (from client/dist). In dev,
// Vite proxies the WebSocket + API to the server so one origin serves everything.
export default defineConfig({
  server: {
    proxy: {
      "/healthz": "http://localhost:8080",
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
