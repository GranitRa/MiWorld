import { describe, it, expect } from "vitest";
import { MARS_SOL_SECONDS, TICK_WORLD_SECONDS, generatePlanet } from "@miworld/shared";
import { createWorld, seedColony } from "../src/sim/world";
import { environmentSystem } from "../src/sim/systems/environment";
import { resourcesSystem } from "../src/sim/systems/resources";
import { constructionSystem } from "../src/sim/systems/construction";
import { populationSystem } from "../src/sim/systems/population";
import { RngGateway } from "../src/sim/rng";
import type { SimContext } from "../src/sim/engine";

// The hopeful-tone guardrail (per Fable's max-effort review, which found that a "default
// habitat" filler drove 75% of unattended runs into permanent power brownout). Run the whole
// sim unattended for many sols across seeds and assert the colony stays healthy — no chronic
// life-critical shortage, no runaway, no NaN.
function soak(seed: number, sols: number) {
  const world = createWorld(seed);
  seedColony(world, generatePlanet(seed).landingSite, new RngGateway(seed));
  const ctx: SimContext = { rng: new RngGateway(seed), emit: () => {}, patch: () => {}, coarse: false };
  const ticks = Math.floor((sols * MARS_SOL_SECONDS) / TICK_WORLD_SECONDS);
  const tailStart = ticks - Math.floor((60 * MARS_SOL_SECONDS) / TICK_WORLD_SECONDS);
  let powerShortTicks = 0;
  let tailTicks = 0;
  for (let i = 0; i < ticks; i++) {
    world.worldTimeSec += TICK_WORLD_SECONDS;
    environmentSystem(world, TICK_WORLD_SECONDS, ctx);
    resourcesSystem(world, TICK_WORLD_SECONDS, ctx);
    constructionSystem(world, TICK_WORLD_SECONDS, ctx);
    populationSystem(world, TICK_WORLD_SECONDS, ctx);
    if (i >= tailStart) {
      tailTicks++;
      if ((world.shortages.power ?? 0) >= 0.5) powerShortTicks++;
    }
  }
  const pop = world.colonists.filter((c) => c.alive).length;
  return { world, pop, chronicPower: powerShortTicks / Math.max(1, tailTicks) };
}

describe("colony soak (hopeful-tone invariant)", () => {
  for (const seed of [1, 7, 42, 2024]) {
    it(
      `seed ${seed}: 250 sols unattended stays supplied and is not chronically power-starved`,
      () => {
        const { world, pop, chronicPower } = soak(seed, 250);
        for (const g of ["power", "oxygen", "water", "food"] as const) {
          expect(Number.isNaN(world.treasury[g].amount)).toBe(false);
          expect(world.treasury[g].amount).toBeGreaterThan(0);
        }
        // Fable measured 5–38% chronic on the buggy planner; healthy must be near-zero.
        expect(chronicPower).toBeLessThan(0.1);
        // Population grows (births > deaths) but stays bounded — hopeful, not runaway.
        expect(pop).toBeGreaterThan(16);
        expect(pop).toBeLessThan(250);
      },
      30000,
    );
  }
});
