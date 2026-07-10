import { describe, it, expect } from "vitest";
import { MARS_SOL_SECONDS, TICK_WORLD_SECONDS, generatePlanet } from "@miworld/shared";
import { createWorld, seedColony } from "../src/sim/world";
import { environmentSystem } from "../src/sim/systems/environment";
import { resourcesSystem } from "../src/sim/systems/resources";
import { constructionSystem } from "../src/sim/systems/construction";
import { RngGateway } from "../src/sim/rng";
import type { EmittedEvent, SimContext } from "../src/sim/engine";

describe("construction", () => {
  it("the colony builds new modules over time and finishes them", () => {
    const world = createWorld(3);
    seedColony(world, generatePlanet(3).landingSite, new RngGateway(3));
    const startCount = world.buildings.length;
    world.treasury.feedstock.amount = 240; // plenty to break ground

    const events: EmittedEvent[] = [];
    const ctx: SimContext = {
      rng: new RngGateway(3),
      emit: (e) => events.push(e),
      patch: () => {},
      coarse: false,
    };

    const ticks = Math.floor((20 * MARS_SOL_SECONDS) / TICK_WORLD_SECONDS);
    for (let i = 0; i < ticks; i++) {
      world.worldTimeSec += TICK_WORLD_SECONDS;
      environmentSystem(world, TICK_WORLD_SECONDS, ctx);
      resourcesSystem(world, TICK_WORLD_SECONDS, ctx);
      constructionSystem(world, TICK_WORLD_SECONDS, ctx);
    }

    expect(world.buildings.length).toBeGreaterThan(startCount);
    // Never exceeds the soft cap (no runaway growth without population).
    expect(world.buildings.length).toBeLessThanOrEqual(10 + world.colonists.length + 1);
    // At least one module was both begun and finished.
    expect(events.some((e) => e.title === "Construction begins")).toBe(true);
    expect(events.some((e) => e.title.includes("online"))).toBe(true);
    // Placed modules are spaced apart (no two on top of each other).
    for (let a = 0; a < world.buildings.length; a++) {
      for (let b = a + 1; b < world.buildings.length; b++) {
        const dx = world.buildings[a]!.pos.x - world.buildings[b]!.pos.x;
        const dz = world.buildings[a]!.pos.z - world.buildings[b]!.pos.z;
        expect(dx * dx + dz * dz).toBeGreaterThan(10 * 10);
      }
    }
  });
});
