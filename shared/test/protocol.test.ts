import { describe, it, expect } from "vitest";
import {
  isClientMessage,
  REAL_MS_PER_TICK,
  WORLD_SECONDS_PER_REAL_SECOND,
  TICK_WORLD_SECONDS,
  type ServerMessage,
} from "../src/index";

describe("protocol", () => {
  it("round-trips a hello message through JSON with type narrowing", () => {
    const msg: ServerMessage = {
      type: "hello",
      worldTimeSec: 123,
      tickWorldSeconds: TICK_WORLD_SECONDS,
      snapshot: {
        seed: 1,
        epoch: 1,
        worldTimeSec: 123,
        status: "alive",
        settlementName: null,
        landingSite: { x: 0, z: 0 },
        dust: 0.1,
        treasury: {} as never,
        shortages: {},
        buildings: [],
        colonists: [],
        pools: {},
      },
    };
    const parsed = JSON.parse(JSON.stringify(msg)) as ServerMessage;
    expect(parsed.type).toBe("hello");
    if (parsed.type === "hello") {
      expect(parsed.snapshot.status).toBe("alive");
    }
  });

  it("accepts only a ping as a client message", () => {
    expect(isClientMessage({ type: "ping" })).toBe(true);
    expect(isClientMessage({ type: "spawnDragon" })).toBe(false);
    expect(isClientMessage(null)).toBe(false);
    expect(isClientMessage("ping")).toBe(false);
  });
});

describe("tempo constants", () => {
  it("keeps world time at exactly 7x real time", () => {
    // world-seconds advanced per real-second = TICK_WORLD_SECONDS / (REAL_MS_PER_TICK/1000)
    const worldPerReal = TICK_WORLD_SECONDS / (REAL_MS_PER_TICK / 1000);
    expect(worldPerReal).toBeCloseTo(WORLD_SECONDS_PER_REAL_SECOND, 10);
  });
});
