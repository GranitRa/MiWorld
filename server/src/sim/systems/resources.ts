import {
  BUILDING_ECONOMY,
  COLONIST_CONSUMPTION,
  GOOD_CAP,
  LIFE_CRITICAL,
  MARS_SOL_SECONDS,
  TIER_MULT,
  type BuildingEconomy,
  type Good,
  type World,
} from "@miworld/shared";
import type { System } from "../engine";

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const NO_ECON: BuildingEconomy = { produces: [], consumes: [] };

/** Sols of sustained deficit before a shortage is "active" (raises a beat / drives planner). */
export const SHORTAGE_THRESHOLD_SOL = 0.5;

function poolTotal(world: World): number {
  let n = 0;
  for (const k of Object.keys(world.pools)) n += world.pools[k] ?? 0;
  return n;
}

/**
 * Resource & life-support settle. Two passes keep causality legible:
 *   1. Power balance → a brownout ratio (solar scaled by sun + dust vs. demand).
 *   2. Buildings run at that ratio — BOTH their inputs and outputs scale, so a brownout
 *      throttles the whole plant (no water burned for nothing). Colonists breathe/eat at full
 *      rate regardless. A power shortfall thus cascades into oxygen/water/food shortfalls.
 * Shortages use HYSTERESIS: a per-good deficit "pressure" (in sols) accumulates while short
 * and decays faster while supplied, so a normal nightly dip doesn't raise a beat — only a
 * sustained deficit does, and it emits its onset once (power before the goods it powers).
 */
export const resourcesSystem: System = (world, dt, ctx) => {
  const dtSol = dt / MARS_SOL_SECONDS;
  const solFraction = (world.worldTimeSec % MARS_SOL_SECONDS) / MARS_SOL_SECONDS;
  const sunFactor = clamp(-Math.cos(2 * Math.PI * solFraction), 0, 1);
  const solarEff = sunFactor * (1 - world.dust);

  const complete = world.buildings.filter((b) => b.progress >= 1 && b.tier !== "ruin");

  // --- pass 1: power balance → brownout ratio ---
  let solarPerSol = 0;
  let powerDemandPerSol = 0;
  for (const b of complete) {
    const econ = BUILDING_ECONOMY[b.kind] ?? NO_ECON;
    const mult = TIER_MULT[b.tier];
    for (const p of econ.produces) if (p.good === "power") solarPerSol += p.perSol * mult * solarEff;
    for (const c of econ.consumes) if (c.good === "power") powerDemandPerSol += c.perSol * mult;
  }
  const powerAvail = world.treasury.power.amount + solarPerSol * dtSol;
  const powerNeed = powerDemandPerSol * dtSol;
  const powerRatio = powerNeed > 0 ? clamp(powerAvail / powerNeed, 0, 1) : 1;
  world.treasury.power.amount = clamp(powerAvail - powerNeed * powerRatio, 0, GOOD_CAP.power);

  // --- pass 2: other goods; buildings run at powerRatio (inputs AND outputs), colonists full ---
  const delta: Partial<Record<Good, number>> = {};
  const add = (g: Good, v: number) => {
    delta[g] = (delta[g] ?? 0) + v;
  };
  for (const b of complete) {
    const econ = BUILDING_ECONOMY[b.kind] ?? NO_ECON;
    const mult = TIER_MULT[b.tier];
    for (const p of econ.produces) if (p.good !== "power") add(p.good, p.perSol * mult * powerRatio * dtSol);
    for (const c of econ.consumes) if (c.good !== "power") add(c.good, -c.perSol * mult * powerRatio * dtSol);
  }
  const heads = world.colonists.reduce((n, c) => n + (c.alive ? 1 : 0), 0) + poolTotal(world);
  for (const cc of COLONIST_CONSUMPTION) add(cc.good, -cc.perSol * heads * dtSol);

  // --- apply, and flag which goods went unmet this tick ---
  const unmet: Partial<Record<Good, boolean>> = {};
  if (powerRatio < 0.999 && powerDemandPerSol > 0) unmet.power = true;
  for (const g of Object.keys(delta) as Good[]) {
    const after = world.treasury[g].amount + (delta[g] ?? 0);
    world.treasury[g].amount = clamp(after, 0, GOOD_CAP[g]);
    if (after < -1e-9) unmet[g] = true;
  }

  // --- hysteresis pressure + onset beats (life-critical only) ---
  const next: Partial<Record<Good, number>> = {};
  for (const g of LIFE_CRITICAL) {
    const prev = world.shortages[g] ?? 0;
    let p = prev + (unmet[g] ? dtSol : -dtSol * 3);
    p = p < 0 ? 0 : p > 3 ? 3 : p;
    const wasActive = prev >= SHORTAGE_THRESHOLD_SOL;
    const isActive = p >= SHORTAGE_THRESHOLD_SOL;
    if (isActive && !wasActive && !ctx.coarse) {
      ctx.emit({
        category: "resources",
        priority: 6,
        title: `${cap(g)} shortage`,
        body: `The colony is running short of ${g}.`,
        subjectRefs: [],
        cameraHint: world.landingSite,
      });
    }
    if (p > 0) next[g] = p;
  }
  world.shortages = next;
};
