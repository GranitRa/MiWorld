import type {
  EntityDelta,
  ChronicleEvent,
  HelloMessage,
  HudSummary,
  TickMessage,
  World,
} from "@miworld/shared";

export function buildHello(
  world: World,
  tickWorldSeconds: number,
  chronicle: ChronicleEvent[],
): HelloMessage {
  return {
    type: "hello",
    snapshot: world,
    worldTimeSec: world.worldTimeSec,
    tickWorldSeconds,
    chronicle,
  };
}

export function buildTick(
  worldTimeSec: number,
  events: ChronicleEvent[],
  deltas: EntityDelta[],
  hud: HudSummary,
): TickMessage {
  return { type: "tick", worldTimeSec, events, deltas, hud };
}

/** Merge multiple patches to the same entity within a tick into one delta. */
export function coalesceDeltas(deltas: EntityDelta[]): EntityDelta[] {
  const merged = new Map<string, Record<string, unknown>>();
  for (const d of deltas) {
    const cur = merged.get(d.id) ?? {};
    Object.assign(cur, d.changes);
    merged.set(d.id, cur);
  }
  return Array.from(merged, ([id, changes]) => ({ id, changes }));
}
