import { describe, it, expect } from "vitest";
import { MARS_SOL_SECONDS, TICK_WORLD_SECONDS, generatePlanet } from "@miworld/shared";
import { createWorld, seedColony } from "../src/sim/world";
import { environmentSystem } from "../src/sim/systems/environment";
import { resourcesSystem } from "../src/sim/systems/resources";
import { constructionSystem } from "../src/sim/systems/construction";
import { populationSystem } from "../src/sim/systems/population";
import { earthSystem } from "../src/sim/systems/earth";
import { RngGateway } from "../src/sim/rng";
import type { EmittedEvent, SimContext } from "../src/sim/engine";

describe("earth link", () => {
  it("ships fly from Earth and the colony grows (births + immigration)", () => {
    const world = createWorld(11);
    seedColony(world, generatePlanet(11).landingSite, new RngGateway(11));
    const events: EmittedEvent[] = [];
    const ctx: SimContext = {
      rng: new RngGateway(11),
      emit: (e) => events.push(e),
      patch: () => {},
      coarse: false,
    };
    const ticks = Math.floor((80 * MARS_SOL_SECONDS) / TICK_WORLD_SECONDS);
    for (let i = 0; i < ticks; i++) {
      world.worldTimeSec += TICK_WORLD_SECONDS;
      environmentSystem(world, TICK_WORLD_SECONDS, ctx);
      resourcesSystem(world, TICK_WORLD_SECONDS, ctx);
      constructionSystem(world, TICK_WORLD_SECONDS, ctx);
      populationSystem(world, TICK_WORLD_SECONDS, ctx);
      earthSystem(world, TICK_WORLD_SECONDS, ctx);
    }
    expect(world.colonists.filter((c) => c.alive).length).toBeGreaterThan(16); // grew
    expect(world.colonists.length).toBeGreaterThan(16); // arrivals/births minted colonists
    expect(events.some((e) => e.category === "earth")).toBe(true); // ships flew
  }, 30000);

  it("a collapsed colony reseeds — the world is unkillable", () => {
    const world = createWorld(3);
    seedColony(world, generatePlanet(3).landingSite, new RngGateway(3));
    const buildingsBefore = world.buildings.length;
    for (const c of world.colonists) c.alive = false; // catastrophe: everyone gone

    const events: EmittedEvent[] = [];
    const ctx: SimContext = {
      rng: new RngGateway(3),
      emit: (e) => events.push(e),
      patch: () => {},
      coarse: false,
    };

    world.worldTimeSec = 100 * MARS_SOL_SECONDS;
    earthSystem(world, TICK_WORLD_SECONDS, ctx);
    expect(world.status).toBe("fallen");
    expect(world.buildings.every((b) => b.tier === "ruin")).toBe(true);

    world.worldTimeSec += 6 * MARS_SOL_SECONDS; // past the reseed delay
    earthSystem(world, TICK_WORLD_SECONDS, ctx);
    expect(world.status).toBe("alive");
    expect(world.epoch).toBe(2);
    expect(world.colonists.filter((c) => c.alive).length).toBeGreaterThan(0); // fresh crew
    expect(world.buildings.some((b) => b.tier === "ruin")).toBe(true); // ruins persist as a monument
    expect(world.buildings.length).toBeGreaterThan(buildingsBefore); // a new cluster landed
    expect(events.some((e) => e.title.includes("fallen"))).toBe(true);
    expect(events.some((e) => e.title.includes("Expedition"))).toBe(true);

    // Fable F1 regression: recovery must be REAL, not cosmetic. Old ruins must NOT count against
    // the planner's soft cap — run epoch 2 for 60 sols and assert it actually builds and grows.
    const standingBefore = world.buildings.filter((b) => b.tier !== "ruin").length;
    const ticks = Math.floor((60 * MARS_SOL_SECONDS) / TICK_WORLD_SECONDS);
    for (let i = 0; i < ticks; i++) {
      world.worldTimeSec += TICK_WORLD_SECONDS;
      environmentSystem(world, TICK_WORLD_SECONDS, ctx);
      resourcesSystem(world, TICK_WORLD_SECONDS, ctx);
      constructionSystem(world, TICK_WORLD_SECONDS, ctx);
      populationSystem(world, TICK_WORLD_SECONDS, ctx);
      earthSystem(world, TICK_WORLD_SECONDS, ctx);
    }
    const standingAfter = world.buildings.filter((b) => b.tier !== "ruin").length;
    expect(standingAfter).toBeGreaterThan(standingBefore); // epoch 2 can still build
    expect(world.colonists.filter((c) => c.alive).length).toBeGreaterThan(16); // and can still grow
  }, 30000);
});
