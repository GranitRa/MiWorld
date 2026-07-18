import { describe, it, expect } from "vitest";
import {
  MARS_SOL_SECONDS,
  REAL_MS_PER_TICK,
  TICK_WORLD_SECONDS,
  WORLD_SECONDS_PER_REAL_SECOND,
  CATCHUP_CAP_WORLD_SEC,
} from "@miworld/shared";
import { deadlineForTick, planBoot } from "../src/sim/clock";

describe("drift-free clock", () => {
  it("deadlines are absolute — zero cumulative drift over 1000 ticks", () => {
    const founded = 1_000_000;
    for (let n = 0; n <= 1000; n++) {
      // Absolute formula must equal founded + n*interval exactly, never an accumulated sum.
      expect(deadlineForTick(founded, n)).toBeCloseTo(founded + n * REAL_MS_PER_TICK, 6);
    }
  });

  it("world time maps to real time at exactly 7x", () => {
    const founded = 0;
    const oneRealHourMs = 3_600_000;
    const tickAtOneHour = Math.floor(
      (oneRealHourMs - founded) / REAL_MS_PER_TICK,
    );
    const worldSec = tickAtOneHour * TICK_WORLD_SECONDS;
    expect(worldSec / (oneRealHourMs / 1000)).toBeCloseTo(
      WORLD_SECONDS_PER_REAL_SECOND,
      2,
    );
  });
});

describe("boot catch-up (planBoot)", () => {
  it("fast-forwards to real now after a short downtime", () => {
    // Founded 1 real hour ago, last saved at world t=0. Should catch up ~7 world-hours.
    const founded = 0;
    const now = 3_600_000; // 1h real later
    const plan = planBoot({ foundedRealMs: founded, worldTimeSec: 0 }, now, CATCHUP_CAP_WORLD_SEC);
    const expectedWorldSec = (now / 1000) * WORLD_SECONDS_PER_REAL_SECOND;
    expect(plan.startWorldTimeSec).toBeCloseTo(expectedWorldSec, -2);
    expect(plan.skippedWorldSec).toBe(0);
    expect(plan.foundedRealMs).toBe(founded); // not re-anchored
  });

  it("caps catch-up and re-anchors after a very long outage", () => {
    const founded = 0;
    // 400 real days down → desired world time far exceeds the 30-sol cap.
    const now = 400 * 24 * 3_600_000;
    const plan = planBoot({ foundedRealMs: founded, worldTimeSec: 0 }, now, CATCHUP_CAP_WORLD_SEC);
    expect(plan.startWorldTimeSec).toBeLessThanOrEqual(CATCHUP_CAP_WORLD_SEC + TICK_WORLD_SECONDS);
    expect(plan.skippedWorldSec).toBeGreaterThan(0);
    // The re-anchored founding is persisted to a bigint column — it MUST be a whole integer,
    // or the first snapshot save fails with a 22P02 boot error (regression guard).
    expect(Number.isInteger(plan.foundedRealMs)).toBe(true);
    // Re-anchored so ongoing time tracks "now" from the capped target.
    const desiredFromReanchor =
      ((now - plan.foundedRealMs) / 1000) * WORLD_SECONDS_PER_REAL_SECOND;
    expect(desiredFromReanchor).toBeCloseTo(plan.startWorldTimeSec, -2);
  });

  it("never rewinds world time on clock skew", () => {
    const plan = planBoot(
      { foundedRealMs: 10_000_000, worldTimeSec: 5 * MARS_SOL_SECONDS },
      9_000_000, // "now" earlier than founded (skew)
      CATCHUP_CAP_WORLD_SEC,
    );
    expect(plan.startWorldTimeSec).toBeGreaterThanOrEqual(5 * MARS_SOL_SECONDS - TICK_WORLD_SECONDS);
  });
});
