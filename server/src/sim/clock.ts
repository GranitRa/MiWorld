// Drift-free clock. World time is anchored to real wall-clock: at any instant the
// desired world time is (now - foundedRealMs) * WORLD_SECONDS_PER_REAL_SECOND. Ticks
// fire at ABSOLUTE deadlines (foundedRealMs + n * REAL_MS_PER_TICK), never accumulated
// from setInterval — so there is zero cumulative drift.
//
// Because world time is a function of the real clock, downtime is automatically "caught
// up" on boot: a restart re-anchors to now by fast-forwarding the sim. planBoot() is a
// pure function so this recovery logic is unit-testable without a database.

import {
  REAL_MS_PER_TICK,
  TICK_WORLD_SECONDS,
  WORLD_SECONDS_PER_REAL_SECOND,
} from "@miworld/shared";

export interface BootMeta {
  foundedRealMs: number;
  worldTimeSec: number;
}

export interface BootPlan {
  /** Tick index to fast-forward the sim to before going live. */
  startTickIndex: number;
  /** World time at that tick boundary. */
  startWorldTimeSec: number;
  /** Possibly re-anchored founding instant (moved forward only when catch-up is capped). */
  foundedRealMs: number;
  /** World-seconds skipped because catch-up hit the cap (0 in the normal case). */
  skippedWorldSec: number;
}

/**
 * Decide where to resume after a (re)boot. Normally fast-forwards to real "now". If the
 * gap exceeds `capWorldSec`, only `capWorldSec` is simulated and founding is re-anchored
 * so ongoing time still tracks real "now"; the remainder is reported as skipped.
 */
export function planBoot(
  meta: BootMeta,
  nowMs: number,
  capWorldSec: number,
): BootPlan {
  const desiredWorldSec =
    ((nowMs - meta.foundedRealMs) / 1000) * WORLD_SECONDS_PER_REAL_SECOND;
  const maxTarget = meta.worldTimeSec + capWorldSec;

  let foundedRealMs = meta.foundedRealMs;
  let skippedWorldSec = 0;
  let target = desiredWorldSec;

  if (desiredWorldSec > maxTarget) {
    target = maxTarget;
    skippedWorldSec = desiredWorldSec - maxTarget;
    // Re-anchor founding so that "now" maps to the capped target going forward. Round to a
    // whole millisecond — foundedRealMs is persisted to a bigint column, and sub-ms precision
    // is meaningless for a sim that ticks every ~8.5 s.
    foundedRealMs = Math.round(nowMs - (target / WORLD_SECONDS_PER_REAL_SECOND) * 1000);
  }

  // Never go backwards (clock skew / restored-from-old-snapshot safety).
  target = Math.max(target, meta.worldTimeSec);

  const startTickIndex = Math.floor(target / TICK_WORLD_SECONDS);
  return {
    startTickIndex,
    startWorldTimeSec: startTickIndex * TICK_WORLD_SECONDS,
    foundedRealMs,
    skippedWorldSec,
  };
}

/** Absolute wall-clock deadline (ms) for a given tick index. */
export function deadlineForTick(foundedRealMs: number, tickIndex: number): number {
  return foundedRealMs + tickIndex * REAL_MS_PER_TICK;
}

/**
 * The live heartbeat: schedules each tick at its absolute deadline via setTimeout,
 * self-correcting so it never drifts even if a tick runs late.
 */
export class Heartbeat {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private foundedRealMs: number,
    private tickIndex: number,
    private readonly onTick: (worldTimeSec: number, tickIndex: number) => void,
  ) {}

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get currentTickIndex(): number {
    return this.tickIndex;
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const next = this.tickIndex + 1;
    const delay = Math.max(0, deadlineForTick(this.foundedRealMs, next) - Date.now());
    this.timer = setTimeout(() => {
      this.tickIndex = next;
      this.onTick(next * TICK_WORLD_SECONDS, next);
      this.scheduleNext();
    }, delay);
  }
}
