import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { isClientMessage, type ServerMessage, type World } from "@miworld/shared";
import { buildHello } from "./serializer";

// A pure-viewer never needs to send more than a tiny ping; cap inbound frames hard so a
// hostile client can't make us JSON.parse a huge blob before the whitelist rejects it.
const MAX_INBOUND_BYTES = 1024;
// Drop a client whose outbound buffer backs up past this — a stalled reader must not grow
// our memory without bound as every tick's JSON accumulates.
const MAX_BUFFERED_BYTES = 1_000_000;
const LIVENESS_SWEEP_MS = 30_000;

/**
 * One-way authoritative broadcaster. On connect a client gets the full world snapshot
 * (hello); thereafter one tick batch per sim tick. The ONLY inbound message accepted is a
 * keepalive ping — anything else closes the socket, so no client can feed the simulation.
 */
export class Broadcaster {
  private readonly wss: WebSocketServer;
  private readonly sweep: ReturnType<typeof setInterval>;

  constructor(
    server: Server,
    private readonly getWorld: () => World,
    private readonly tickWorldSeconds: number,
  ) {
    this.wss = new WebSocketServer({ server, maxPayload: MAX_INBOUND_BYTES });

    this.wss.on("connection", (socket: WebSocket & { isAlive?: boolean }) => {
      socket.isAlive = true;
      socket.on("pong", () => {
        socket.isAlive = true;
      });
      socket.send(JSON.stringify(buildHello(this.getWorld(), this.tickWorldSeconds)));
      socket.on("message", (raw) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(raw));
        } catch {
          socket.close(1003, "invalid");
          return;
        }
        if (!isClientMessage(parsed)) socket.close(1008, "only ping permitted");
      });
    });

    // Terminate sockets that stop answering pings (half-open connections).
    this.sweep = setInterval(() => {
      for (const client of this.wss.clients) {
        const s = client as WebSocket & { isAlive?: boolean };
        if (s.isAlive === false) {
          s.terminate();
          continue;
        }
        s.isAlive = false;
        if (s.readyState === WebSocket.OPEN) s.ping();
      }
    }, LIVENESS_SWEEP_MS);
    this.sweep.unref?.();
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }

  /**
   * Push a fresh hello (full snapshot) to every connected client. Used when the world
   * they were told about is replaced (activation after the lock) or when they may have
   * missed deltas (exiting a coarse catch-up burst), so viewers re-sync instead of
   * rendering against a stale baseline.
   */
  resyncAll(): void {
    const data = JSON.stringify(buildHello(this.getWorld(), this.tickWorldSeconds));
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
        client.terminate(); // slow reader — drop rather than grow memory unbounded
        continue;
      }
      client.send(data);
    }
  }

  stop(): void {
    clearInterval(this.sweep);
  }
}
