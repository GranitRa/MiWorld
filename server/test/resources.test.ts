import { describe, it, expect } from "vitest";
import { MARS_SOL_SECONDS, TICK_WORLD_SECONDS, type Building, type Colonist } from "@miworld/shared";
import { createWorld, seedColony } from "../src/sim/world";
import { resourcesSystem } from "../src/sim/systems/resources";
import { environmentSystem } from "../src/sim/systems/environment";
import { RngGateway } from "../src/sim/rng";
import type { EmittedEvent, SimContext } from "../src/sim/engine";

function ctxWith(events: EmittedEvent[]): SimContext {
  return { rng: new RngGateway(1), emit: (e) => events.push(e), patch: () => {}, coarse: false };
}

function bld(id: string, kind: Building["kind"], tier: Building["tier"]): Building {
  return { id, kind, tier, pos: { x: 0, z: 0 }, rot: 0, progress: 1 };
}

function crew(n: number): Colonist[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`, name: "x", role: "r", sex: "m" as const, ageDays: 0, traits: [], bonds: {}, alive: true,
  }));
}

describe("resource cascade", () => {
  it("dust storm → power falls → power shortage precedes oxygen shortage", () => {
    const world = createWorld(1);
    world.buildings = [
      bld("s", "solar_field", "printed"),
      bld("i", "isru_plant", "printed"),
      bld("h1", "habitat", "inflatable"),
      bld("h2", "habitat", "inflatable"),
    ];
    world.colonists = crew(16);
    world.dust = 0.8; // heavy storm — solar crippled
    world.treasury.power.amount = 15;
    world.treasury.oxygen.amount = 45;

    const events: EmittedEvent[] = [];
    const ctx = ctxWith(events);
    const ticks = Math.floor((3 * MARS_SOL_SECONDS) / TICK_WORLD_SECONDS);
    for (let i = 0; i < ticks; i++) {
      world.worldTimeSec += TICK_WORLD_SECONDS;
      resourcesSystem(world, TICK_WORLD_SECONDS, ctx);
    }

    const powerIdx = events.findIndex((e) => e.title === "Power shortage");
    const oxyIdx = events.findIndex((e) => e.title === "Oxygen shortage");
    expect(powerIdx).toBeGreaterThanOrEqual(0); // power gave out
    expect(world.treasury.power.amount).toBeLessThan(15); // stockpile fell
    if (oxyIdx >= 0) expect(powerIdx).toBeLessThan(oxyIdx); // cause precedes effect
  });

  it("a seeded starter colony stays supplied over several sols (hopeful tone)", () => {
    const world = createWorld(2);
    seedColony(world, { x: 0, z: 0 }, new RngGateway(2));
    const events: EmittedEvent[] = [];
    const ctx = ctxWith(events);
    const ticks = Math.floor((5 * MARS_SOL_SECONDS) / TICK_WORLD_SECONDS);
    for (let i = 0; i < ticks; i++) {
      world.worldTimeSec += TICK_WORLD_SECONDS;
      environmentSystem(world, TICK_WORLD_SECONDS, ctx);
      resourcesSystem(world, TICK_WORLD_SECONDS, ctx);
    }
    // No life-critical stockpile ever hit rock bottom; power breathes but survives; no NaN.
    for (const g of ["power", "oxygen", "water", "food"] as const) {
      expect(Number.isNaN(world.treasury[g].amount)).toBe(false);
      expect(world.treasury[g].amount).toBeGreaterThan(0);
    }
    expect(world.colonists.every((c) => c.alive)).toBe(true);
  });
});
