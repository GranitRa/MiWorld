import { defineConfig } from "vite";

// The client is served by the Node server in production (from client/dist). In dev,
// Vite proxies the WebSocket + API to the server so one origin serves everything.
export default defineConfig({
  server: {
    // Fixed, LAN-reachable port: the capture tool and anyone watching over a tunnel need a
    // stable URL, and a silent port bump would send them to a page that isn't the world.
    host: true,
    port: 5173,
    strictPort: true,
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
