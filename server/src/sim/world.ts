// World bootstrap + colony seeding. At founding the landing site gets a starter cluster of
// deployable modules and a founding crew, so the life-support economy has something to run;
// the construction system (WP-6) grows the settlement from here. On collapse, a fresh
// expedition reseeds near the ruins (WP-9) — the world is never permanently empty.

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
import { getPlanet } from "./planet";

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const FOUNDING_CREW = 16;

function ledgerFrac(good: string): number {
  return good === "spares" || good === "science" || good === "feedstock" ? 0.3 : 0.6;
}

function startingLedger(): ResourceLedger {
  const ledger = {} as ResourceLedger;
  for (const good of GOODS) {
    ledger[good] = { amount: Math.round(GOOD_CAP[good] * ledgerFrac(good)), cap: GOOD_CAP[good] };
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
    flights: [],
    lastFlightSec: 0,
    fallenSec: null,
    crises: [],
    lastCrisisEndSec: 0,
  };
}

/** Append the deployable starter module cluster around a centre (ids continue the array). */
function placeStarterCluster(world: World, center: { x: number; z: number }, rng: RngGateway): void {
  const place = (kind: BuildingKind, tier: BuildingTier, dx: number, dz: number) => {
    world.buildings.push({
      id: `b${world.buildings.length}`,
      kind,
      tier,
      pos: { x: center.x + dx, z: center.z + dz },
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
}

/** Append a crew of `n` around a centre (ids continue the array; dead colonists are kept). */
function addCrew(world: World, center: { x: number; z: number }, rng: RngGateway, n: number): void {
  for (let i = 0; i < n; i++) {
    const pos = {
      x: center.x + rng.range("layout", -30, 30),
      z: center.z + rng.range("layout", -30, 30),
    };
    world.colonists.push(makeColonist(rng, `c${world.colonists.length}`, world.colonists.length, pos));
  }
}

/** Seed the initial colony at the landing site: a starter module cluster + the crew. */
export function seedColony(world: World, landingSite: { x: number; z: number }, rng: RngGateway): void {
  world.landingSite = { x: landingSite.x, z: landingSite.z };
  world.buildings = [];
  world.colonists = [];
  placeStarterCluster(world, landingSite, rng);
  addCrew(world, landingSite, rng, FOUNDING_CREW);
}

/**
 * Pick a landing site for a fresh expedition: a checked golden-angle spiral out from the last
 * site that stays in-bounds, on gentle slope, and clear of existing structures (ruins included).
 * Bounded to the map so repeated collapses can't march the colony off the world (Fable F6).
 */
function reseedCenter(world: World, rng: RngGateway): { x: number; z: number } {
  const planet = getPlanet(world.seed);
  const half = planet.size * 0.4;
  const clamp = (v: number) => Math.max(-half, Math.min(half, v));
  const clear = (x: number, z: number) =>
    world.buildings.every((b) => (b.pos.x - x) ** 2 + (b.pos.z - z) ** 2 >= 40 * 40);
  const ok = (x: number, z: number) =>
    Math.abs(x) <= half && Math.abs(z) <= half && planet.slopeAt(x, z) <= 0.3 && clear(x, z);
  for (let i = 1; i < 400; i++) {
    const r = 60 + Math.sqrt(i) * 14;
    const a = i * GOLDEN;
    const x = clamp(world.landingSite.x + Math.cos(a) * r);
    const z = clamp(world.landingSite.z + Math.sin(a) * r);
    if (ok(x, z)) return { x, z };
  }
  for (let i = 0; i < 200; i++) {
    const x = rng.range("layout", -half, half);
    const z = rng.range("layout", -half, half);
    if (ok(x, z)) return { x, z };
  }
  return { x: clamp(world.landingSite.x), z: clamp(world.landingSite.z) };
}

/**
 * A fresh expedition lands after a collapse. Keeps the ruins (older buildings stay flagged
 * `ruin`), lands a new starter cluster + crew at a checked nearby site, and restocks — so the
 * world recovers instead of ending.
 */
export function reseedColony(world: World, rng: RngGateway): void {
  const center = reseedCenter(world, rng);
  world.landingSite = { ...center };
  placeStarterCluster(world, center, rng);
  addCrew(world, center, rng, FOUNDING_CREW);
  for (const good of GOODS) {
    world.treasury[good].amount = Math.round(GOOD_CAP[good] * ledgerFrac(good));
  }
  world.shortages = {};
  world.flights = [];
  world.dust = 0.12;
  world.crises = [];
  world.lastCrisisEndSec = world.worldTimeSec; // a fresh epoch starts calm
}

/**
 * Backfill fields that older snapshots may lack, so loading a pre-WP-5 snapshot never
 * crashes the sim with undefined/NaN. Does NOT invent a colony — an empty legacy world
 * stays empty (reset the DB to re-found with a seeded colony).
 */
export function normalizeWorld(world: World): World {
  if (typeof world.dust !== "number") world.dust = 0.12;
  if (!world.shortages) world.shortages = {};
  if (!world.landingSite) world.landingSite = { x: 0, z: 0 };
  if (!world.buildings) world.buildings = [];
  if (!world.colonists) world.colonists = [];
  if (!world.pools) world.pools = {};
  if (!world.flights) world.flights = [];
  if (typeof world.lastFlightSec !== "number") world.lastFlightSec = 0;
  if (world.fallenSec === undefined) world.fallenSec = null;
  // Drop any crisis with corrupt fields — a non-finite stageEndsSec would never advance,
  // permanently blocking new crises and (for a storm) NaN-poisoning dust (Fable WP-10 finding).
  const KINDS = new Set(["dust_storm", "equipment_failure", "solar_storm"]);
  const STAGES = new Set(["warning", "onset", "peak", "recovery"]);
  world.crises = Array.isArray(world.crises)
    ? world.crises.filter(
        (c) =>
          c &&
          KINDS.has(c.kind) &&
          STAGES.has(c.stage) &&
          Number.isFinite(c.stageStartSec) &&
          Number.isFinite(c.stageEndsSec) &&
          Number.isFinite(c.severity) &&
          Number.isFinite(c.startDust),
      )
    : [];
  if (typeof world.lastCrisisEndSec !== "number") world.lastCrisisEndSec = world.worldTimeSec ?? 0;
  // A fallen world with no fall time can never re-seed — repair it so the reseed timer can fire
  // (Fable F2: unkillability hole for a snapshot-loss rebuild or legacy fallen snapshot).
  if (world.status === "fallen" && world.fallenSec == null) world.fallenSec = world.worldTimeSec;
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
