// Wire protocol between the authoritative server and pure-viewer clients.
//
// Golden rule: the server NEVER reads client input into simulation state. The only
// message a client may send is a keepalive ping. Everything else is a one-way stream
// of authoritative world state from server → client.

import type { ChronicleEvent, World } from "./types";

/** Per-entity patch: entity id + a shallow set of changed fields. */
export interface EntityDelta {
  id: string;
  changes: Record<string, unknown>;
}

/** Sent once on connect: the full current world snapshot. */
export interface HelloMessage {
  type: "hello";
  snapshot: World;
  worldTimeSec: number;
  tickWorldSeconds: number;
}

/** Sent every tick: new chronicle events + changed entities since last tick. */
export interface TickMessage {
  type: "tick";
  worldTimeSec: number;
  events: ChronicleEvent[];
  deltas: EntityDelta[];
}

/** Server → client. */
export type ServerMessage = HelloMessage | TickMessage;

/** Client → server. The ONLY permitted inbound message. */
export interface PingMessage {
  type: "ping";
}

export type ClientMessage = PingMessage;

/** Narrowing guard used by the server to reject any non-ping inbound traffic. */
export function isClientMessage(value: unknown): value is ClientMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "ping"
  );
}
