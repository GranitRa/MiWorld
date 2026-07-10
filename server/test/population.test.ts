import { describe, it, expect } from "vitest";
import { MARS_SOL_SECONDS, TICK_WORLD_SECONDS, generatePlanet } from "@miworld/shared";
import { createWorld, seedColony } from "../src/sim/world";
import { environmentSystem } from "../src/sim/systems/environment";
import { resourcesSystem } from "../src/sim/systems/resources";
import { constructionSystem } from "../src/sim/systems/construction";
import { populationSystem } from "../src/sim/systems/population";
import { RngGateway } from "../src/sim/rng";
import type { SimContext } from "../src/sim/engine";

describe("population", () => {
  it(
    "colonists pair, walk, and the colony grows via Mars-born children",
    () => {
      const world = createWorld(5);
      seedColony(world, generatePlanet(5).landingSite, new RngGateway(5));
      const start = world.colonists.length;
      const ctx: SimContext = {
        rng: new RngGateway(5),
        emit: () => {},
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
      }
      const living = world.colonists.filter((c) => c.alive);
      expect(living.length).toBeGreaterThan(start); // grew via births
      expect(world.colonists.some((c) => c.partner)).toBe(true); // pairing happened
      expect(world.colonists.some((c) => c.role === "child")).toBe(true); // Mars-born
      expect(living.every((c) => c.dest !== null)).toBe(true); // everyone got a walk leg
    },
    30000,
  );
});
