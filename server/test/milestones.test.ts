import { describe, it, expect } from "vitest";
import { GOOD_CAP, MARS_SOL_SECONDS, generatePlanet, type Building } from "@miworld/shared";
import { createWorld, seedColony, reseedColony } from "../src/sim/world";
import { milestonesSystem } from "../src/sim/systems/milestones";
import { makeChild, makeColonist } from "../src/sim/people/names";
import { RngGateway } from "../src/sim/rng";
import type { EmittedEvent, SimContext } from "../src/sim/engine";

function ctxFor(seed: number, events: EmittedEvent[]): SimContext {
  return { rng: new RngGateway(seed), emit: (e) => events.push(e), patch: () => {}, coarse: false };
}

/** Fabricate a state that qualifies for every milestone at once. */
function qualifyAll(seed: number) {
  const world = createWorld(seed);
  seedColony(world, generatePlanet(seed).landingSite, new RngGateway(seed));
  const rng = new RngGateway(seed + 1);
  world.buildings.push({
    id: "bd",
    kind: "dome",
    tier: "printed",
    pos: { x: 0, z: 0 },
    rot: 0,
    progress: 1,
  } as Building);
  for (let i = 0; i < 40; i++) {
    world.colonists.push(makeColonist(rng, `cx${i}`, i, { x: 0, z: 0 }));
  }
  world.colonists.push(makeChild(rng, "cbaby", { x: 0, z: 0 }, "bold")); // a Mars-born child
  world.treasury.feedstock.amount = GOOD_CAP.feedstock;
  world.treasury.science.amount = GOOD_CAP.science;
  world.worldTimeSec = world.epochStartSec + 120 * MARS_SOL_SECONDS;
  return world;
}

const ALL_IDS = [
  "first_child",
  "first_dome",
  "naming_ceremony",
  "first_100_sols",
  "growing_strong",
  "terraforming_experiment",
  "monument",
];

describe("milestones", () => {
  it("every milestone fires exactly once per epoch under a qualifying state", () => {
    const world = qualifyAll(3);
    const events: EmittedEvent[] = [];
    const ctx = ctxFor(3, events);

    milestonesSystem(world, MARS_SOL_SECONDS, ctx);
    expect(world.milestones.sort()).toEqual([...ALL_IDS].sort());
    for (const e of events) expect(e.category).toBe("milestone");
    expect(events).toHaveLength(ALL_IDS.length);

    // Run again on the same (still-qualifying) state — nothing re-fires.
    const before = events.length;
    milestonesSystem(world, MARS_SOL_SECONDS, ctx);
    milestonesSystem(world, MARS_SOL_SECONDS, ctx);
    expect(events).toHaveLength(before);
  });

  it("the naming ceremony writes a persisted settlement name later beats can use", () => {
    const world = qualifyAll(7);
    milestonesSystem(world, MARS_SOL_SECONDS, ctxFor(7, []));
    expect(world.settlementName).toBeTruthy();
    expect(world.settlementName).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/); // "<A> <B>"
    // The monument milestone actually left an artifact in the world.
    expect(world.buildings.some((b) => b.kind === "monument")).toBe(true);
  });

  it("a reseeded epoch clears milestones + name and can earn them again", () => {
    const world = qualifyAll(5);
    milestonesSystem(world, MARS_SOL_SECONDS, ctxFor(5, []));
    expect(world.milestones.length).toBeGreaterThan(0);

    reseedColony(world, new RngGateway(99));
    expect(world.milestones).toHaveLength(0); // fresh epoch, blank slate
    expect(world.settlementName).toBeNull();

    // The reseeded colony still has a large (living) population here, so growth milestones re-arm.
    const events: EmittedEvent[] = [];
    milestonesSystem(world, MARS_SOL_SECONDS, ctxFor(5, events));
    expect(world.milestones).toContain("growing_strong");
    expect(events.some((e) => e.category === "milestone")).toBe(true);
  });
});
