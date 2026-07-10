import type { HelloMessage, ServerMessage, TickMessage } from "@miworld/shared";

export interface ConnectionHandlers {
  onHello: (msg: HelloMessage) => void;
  onTick: (msg: TickMessage) => void;
  onStatus?: (connected: boolean) => void;
}

/**
 * WebSocket client to the authoritative server. Reconnects with capped exponential
 * backoff. Each (re)connection starts with a fresh hello — the client never sends
 * anything except a periodic keepalive ping.
 */
export class Connection {
  private socket: WebSocket | null = null;
  private backoffMs = 500;
  private readonly maxBackoffMs = 10_000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly handlers: ConnectionHandlers,
  ) {}

  connect(): void {
    this.closed = false;
    this.open();
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.socket?.close();
  }

  private open(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.backoffMs = 500;
      this.handlers.onStatus?.(true);
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping" }));
        }
      }, 25_000);
    };

    socket.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "hello") this.handlers.onHello(msg);
      else if (msg.type === "tick") this.handlers.onTick(msg);
    };

    socket.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.handlers.onStatus?.(false);
      if (!this.closed) this.scheduleReconnect();
    };

    socket.onerror = () => socket.close();
  }

  private scheduleReconnect(): void {
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
    setTimeout(() => {
      if (!this.closed) this.open();
    }, wait);
  }
}

/** Same-origin WebSocket URL (works behind the Vite dev proxy and in production). */
export function defaultWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}
