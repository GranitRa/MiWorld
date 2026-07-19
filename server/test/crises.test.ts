import { describe, it, expect } from "vitest";
import { MARS_SOL_SECONDS, TICK_WORLD_SECONDS, generatePlanet } from "@miworld/shared";
import { createWorld, seedColony } from "../src/sim/world";
import { environmentSystem } from "../src/sim/systems/environment";
import { crisesSystem } from "../src/sim/systems/crises";
import { resourcesSystem } from "../src/sim/systems/resources";
import { constructionSystem } from "../src/sim/systems/construction";
import { populationSystem } from "../src/sim/systems/population";
import { earthSystem } from "../src/sim/systems/earth";
import { RngGateway } from "../src/sim/rng";
import type { EmittedEvent, SimContext } from "../src/sim/engine";

function seededWorld(seed: number) {
  const world = createWorld(seed);
  seedColony(world, generatePlanet(seed).landingSite, new RngGateway(seed));
  return world;
}
function ctxFor(seed: number, events: EmittedEvent[]): SimContext {
  return { rng: new RngGateway(seed), emit: (e) => events.push(e), patch: () => {}, coarse: false };
}

const DUST_ARC = ["Dust on the horizon", "The dust storm hits", "The storm rages", "The skies clear"];

describe("crises", () => {
  it("a dust storm plays a full, ordered arc (>=4 beats); dust rises then clears", () => {
    const world = seededWorld(5);
    world.lastCrisisEndSec = -1e9; // eligible immediately
    const events: EmittedEvent[] = [];
    const ctx = ctxFor(5, events);
    let maxDust = 0;
    const cap = Math.floor((400 * MARS_SOL_SECONDS) / TICK_WORLD_SECONDS);
    for (let i = 0; i < cap; i++) {
      world.worldTimeSec += TICK_WORLD_SECONDS;
      environmentSystem(world, TICK_WORLD_SECONDS, ctx);
      crisesSystem(world, TICK_WORLD_SECONDS, ctx);
      maxDust = Math.max(maxDust, world.dust);
      if (events.some((e) => e.title === "The skies clear")) break;
    }
    // One crisis at a time, so the first dust storm's four beats are consecutive and ordered.
    const arc = events.filter((e) => DUST_ARC.includes(e.title)).map((e) => e.title);
    expect(arc.slice(0, 4)).toEqual(DUST_ARC);
    expect(maxDust).toBeGreaterThan(0.5); // panels really did dim
    expect(world.dust).toBeLessThan(0.3); // and the skies cleared
  });

  it("the drama thermostat never runs two crises at once, and enforces calm gaps", () => {
    for (const seed of [1, 7]) {
      const world = seededWorld(seed);
      const ctx = ctxFor(seed, []);
      const ticks = Math.floor((200 * MARS_SOL_SECONDS) / TICK_WORLD_SECONDS);
      let maxConcurrent = 0;
      for (let i = 0; i < ticks; i++) {
        world.worldTimeSec += TICK_WORLD_SECONDS;
        environmentSystem(world, TICK_WORLD_SECONDS, ctx);
        crisesSystem(world, TICK_WORLD_SECONDS, ctx);
        resourcesSystem(world, TICK_WORLD_SECONDS, ctx);
        constructionSystem(world, TICK_WORLD_SECONDS, ctx);
        populationSystem(world, TICK_WORLD_SECONDS, ctx);
        earthSystem(world, TICK_WORLD_SECONDS, ctx);
        maxConcurrent = Math.max(maxConcurrent, world.crises.length);
      }
      expect(maxConcurrent).toBeLessThanOrEqual(1);
    }
  });

  it("crises fire but the colony stays hopeful (pop > 0.8x start over 200 sols)", () => {
    const world = seededWorld(42);
    const startPop = world.colonists.filter((c) => c.alive).length;
    const events: EmittedEvent[] = [];
    const ctx = ctxFor(42, events);
    const ticks = Math.floor((200 * MARS_SOL_SECONDS) / TICK_WORLD_SECONDS);
    for (let i = 0; i < ticks; i++) {
      world.worldTimeSec += TICK_WORLD_SECONDS;
      environmentSystem(world, TICK_WORLD_SECONDS, ctx);
      crisesSystem(world, TICK_WORLD_SECONDS, ctx);
      resourcesSystem(world, TICK_WORLD_SECONDS, ctx);
      constructionSystem(world, TICK_WORLD_SECONDS, ctx);
      populationSystem(world, TICK_WORLD_SECONDS, ctx);
      earthSystem(world, TICK_WORLD_SECONDS, ctx);
    }
    const endPop = world.colonists.filter((c) => c.alive).length;
    expect(events.some((e) => e.category === "crisis")).toBe(true); // crises actually happened
    expect(endPop).toBeGreaterThan(0.8 * startPop); // and never wiped the colony
  }, 30000);

  it("a collapse clears any in-progress crisis (no storm frozen over the ruins)", () => {
    const world = seededWorld(9);
    const events: EmittedEvent[] = [];
    const ctx = ctxFor(9, events);
    // Inject an active dust storm, then wipe the colony.
    world.crises.push({
      id: "kX",
      kind: "dust_storm",
      stage: "peak",
      stageStartSec: 0,
      stageEndsSec: 1e9,
      severity: 0.9,
      startDust: 0.12,
      targetId: null,
    });
    world.dust = 0.85;
    for (const c of world.colonists) c.alive = false;
    world.worldTimeSec = 100 * MARS_SOL_SECONDS;
    earthSystem(world, TICK_WORLD_SECONDS, ctx);
    expect(world.status).toBe("fallen");
    expect(world.crises).toHaveLength(0); // crisis cleared by the fall
    expect(world.dust).toBeLessThan(0.3); // dust no longer frozen at storm peak
  });
});
