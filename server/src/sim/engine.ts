// The tick engine. Systems are pure-ish functions over the world, run in a fixed order
// each tick. WP-2 registers none — the loop just advances world time and survives
// restarts. Later work packages register environment, resources, construction,
// population, earth, crises and milestones (in that order).

import { TICK_WORLD_SECONDS, type World } from "@miworld/shared";
import type { RngGateway } from "./rng";

export interface EmittedEvent {
  category: string;
  priority: number;
  title: string;
  body: string;
  subjectRefs: string[];
  cameraHint: { x: number; z: number } | null;
}

export interface SimContext {
  rng: RngGateway;
  /** Systems push chronicle-worthy beats here; the runtime flushes them each tick. */
  emit: (event: EmittedEvent) => void;
  /**
   * Systems mark an entity changed this tick with a shallow patch. The runtime coalesces
   * these into the tick's delta stream — this is the per-entity dirty-flag discipline
   * that keeps deltas cheap (never deep-compare the whole world).
   */
  patch: (entityId: string, changes: Record<string, unknown>) => void;
  /** True during boot catch-up: systems should run cheaply and mute non-milestone beats. */
  coarse: boolean;
}

export type System = (world: World, dtWorldSec: number, ctx: SimContext) => void;

const systems: System[] = [];

export function registerSystem(system: System): void {
  systems.push(system);
}

/** Advance exactly one tick. */
export function stepTick(world: World, ctx: SimContext): void {
  world.worldTimeSec += TICK_WORLD_SECONDS;
  for (const system of systems) system(world, TICK_WORLD_SECONDS, ctx);
}

/**
 * Fast-forward the world to a target tick boundary (used on boot catch-up). Runs in
 * coarse mode so systems can cheap out and suppress event spam.
 */
export function fastForwardTo(
  world: World,
  targetWorldTimeSec: number,
  rng: RngGateway,
  onEvent: (event: EmittedEvent) => void,
): void {
  // During catch-up we discard deltas (no client is watching the fast-forward).
  const ctx: SimContext = { rng, emit: onEvent, patch: () => {}, coarse: true };
  // Guard against pathological loops; the caller already caps the span.
  let guard = 0;
  while (world.worldTimeSec + TICK_WORLD_SECONDS <= targetWorldTimeSec + 1e-6) {
    stepTick(world, ctx);
    if (++guard > 5_000_000) break;
  }
  world.worldTimeSec = targetWorldTimeSec;
}
