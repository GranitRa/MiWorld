// World bootstrap + colony seeding. At founding the landing site gets a starter cluster of
// deployable modules and a founding crew, so the life-support economy has something to run;
// the construction system (WP-6) grows the settlement from here.

import {
  GOODS,
  GOOD_CAP,
  type BuildingKind,
  type BuildingTier,
  type ResourceLedger,
  type World,
} from "@miworld/shared";
import type { RngGateway } from "./rng";
import { makeColonist } from "./people/names";

const FOUNDING_CREW = 16;

function startingLedger(): ResourceLedger {
  const ledger = {} as ResourceLedger;
  for (const good of GOODS) {
    // Life goods start with a comfortable reserve; industrial goods lower.
    const frac = good === "spares" || good === "science" || good === "feedstock" ? 0.3 : 0.6;
    ledger[good] = { amount: Math.round(GOOD_CAP[good] * frac), cap: GOOD_CAP[good] };
  }
  return ledger;
}

export function createWorld(seed: number): World {
  return {
    seed,
    epoch: 1,
    worldTimeSec: 0,
    status: "alive",
    settlementName: null,
    landingSite: { x: 0, z: 0 },
    dust: 0.12,
    treasury: startingLedger(),
    shortages: {},
    buildings: [],
    colonists: [],
    pools: {},
  };
}

/** Seed the initial colony at the landing site: a starter module cluster + the crew. */
export function seedColony(world: World, landingSite: { x: number; z: number }, rng: RngGateway): void {
  world.landingSite = { x: landingSite.x, z: landingSite.z };
  world.buildings = [];

  const place = (kind: BuildingKind, tier: BuildingTier, dx: number, dz: number) => {
    world.buildings.push({
      id: `b${world.buildings.length}`,
      kind,
      tier,
      pos: { x: landingSite.x + dx, z: landingSite.z + dz },
      rot: rng.range("layout", 0, Math.PI * 2),
      progress: 1,
    });
  };

  // A viable starting base: power + oxygen + water + food for the crew, with margin.
  place("landing_pad", "printed", 0, 0);
  place("habitat", "inflatable", 24, 8);
  place("habitat", "inflatable", 24, -12);
  place("solar_field", "printed", -28, 14);
  place("solar_field", "printed", -28, -8);
  place("solar_field", "printed", -42, 4);
  place("solar_field", "printed", -42, 24);
  place("solar_field", "printed", -56, 12);
  place("isru_plant", "printed", 42, 20);
  place("water_extractor", "printed", 46, -14);
  place("water_extractor", "printed", 60, -22);
  place("greenhouse", "inflatable", 10, 36);
  place("greenhouse", "inflatable", 28, 42);
  place("workshop", "printed", 56, 8);

  world.colonists = [];
  for (let i = 0; i < FOUNDING_CREW; i++) {
    world.colonists.push(makeColonist(rng, `c${i}`, i));
  }
}

/**
 * Backfill fields that older snapshots may lack, so loading a pre-WP-5 snapshot never
 * crashes the economy with undefined/NaN. Does NOT invent a colony — an empty legacy world
 * stays empty (reset the DB to re-found with a seeded colony).
 */
export function normalizeWorld(world: World): World {
  if (typeof world.dust !== "number") world.dust = 0.12;
  if (!world.shortages) world.shortages = {};
  if (!world.landingSite) world.landingSite = { x: 0, z: 0 };
  if (!world.buildings) world.buildings = [];
  if (!world.colonists) world.colonists = [];
  if (!world.pools) world.pools = {};
  for (const good of GOODS) {
    const slot = world.treasury?.[good];
    if (!slot) {
      world.treasury = world.treasury ?? ({} as ResourceLedger);
      world.treasury[good] = { amount: 0, cap: GOOD_CAP[good] };
    } else {
      slot.cap = GOOD_CAP[good];
      if (typeof slot.amount !== "number" || Number.isNaN(slot.amount)) slot.amount = 0;
    }
  }
  return world;
}
