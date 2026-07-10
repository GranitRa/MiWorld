import {
  BUILDING_ECONOMY,
  COLONIST_CONSUMPTION,
  GOOD_CAP,
  LIFE_CRITICAL,
  MARS_SOL_SECONDS,
  TIER_MULT,
  type Good,
  type World,
} from "@miworld/shared";
import type { System } from "../engine";

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function poolTotal(world: World): number {
  let n = 0;
  for (const k of Object.keys(world.pools)) n += world.pools[k] ?? 0;
  return n;
}

/**
 * Resource & life-support settle. Two passes make the causality legible:
 *   1. Power balance → a brownout ratio (solar scaled by sun + dust vs. demand).
 *   2. Every other producer is throttled by that ratio, so a power shortfall (night, dust
 *      storm) cascades visibly into oxygen/water/food shortfalls before anyone is harmed.
 * Shortages are recorded on the world (consumed by mortality/rescue in later WPs) and their
 * ONSET emits a chronicle beat — power first, then the life goods.
 */
export const resourcesSystem: System = (world, dt, ctx) => {
  const dtSol = dt / MARS_SOL_SECONDS;
  const solFraction = (world.worldTimeSec % MARS_SOL_SECONDS) / MARS_SOL_SECONDS;
  const sunFactor = clamp(-Math.cos(2 * Math.PI * solFraction), 0, 1);
  const solarEff = sunFactor * (1 - world.dust);

  const complete = world.buildings.filter((b) => b.progress >= 1 && b.tier !== "ruin");

  // --- pass 1: power ---
  let solarPerSol = 0;
  let powerDemandPerSol = 0;
  for (const b of complete) {
    const econ = BUILDING_ECONOMY[b.kind];
    const mult = TIER_MULT[b.tier];
    for (const p of econ.produces) if (p.good === "power") solarPerSol += p.perSol * mult * solarEff;
    for (const c of econ.consumes) if (c.good === "power") powerDemandPerSol += c.perSol * mult;
  }
  const powerAvail = world.treasury.power.amount + solarPerSol * dtSol;
  const powerNeed = powerDemandPerSol * dtSol;
  const powerRatio = powerNeed > 0 ? clamp(powerAvail / powerNeed, 0, 1) : 1;
  world.treasury.power.amount = clamp(powerAvail - powerNeed * powerRatio, 0, GOOD_CAP.power);

  // --- pass 2: other goods, producers throttled by the brownout ratio ---
  const delta: Partial<Record<Good, number>> = {};
  const add = (g: Good, v: number) => {
    delta[g] = (delta[g] ?? 0) + v;
  };
  for (const b of complete) {
    const econ = BUILDING_ECONOMY[b.kind];
    const mult = TIER_MULT[b.tier];
    for (const p of econ.produces) if (p.good !== "power") add(p.good, p.perSol * mult * powerRatio * dtSol);
    for (const c of econ.consumes) if (c.good !== "power") add(c.good, -c.perSol * mult * dtSol);
  }
  const heads = world.colonists.reduce((n, c) => n + (c.alive ? 1 : 0), 0) + poolTotal(world);
  for (const cc of COLONIST_CONSUMPTION) add(cc.good, -cc.perSol * heads * dtSol);

  // --- apply + detect shortages ---
  const shortages: Partial<Record<Good, number>> = {};
  if (powerRatio < 0.999 && powerDemandPerSol > 0) shortages.power = powerNeed * (1 - powerRatio);
  for (const g of Object.keys(delta) as Good[]) {
    const after = world.treasury[g].amount + (delta[g] ?? 0);
    world.treasury[g].amount = clamp(after, 0, GOOD_CAP[g]);
    if (after < 0) shortages[g] = Math.max(shortages[g] ?? 0, -after);
  }

  // Onset beats in a stable, causal order (power precedes the goods it powers).
  if (!ctx.coarse) {
    for (const g of LIFE_CRITICAL) {
      const now = shortages[g] ?? 0;
      const before = world.shortages[g] ?? 0;
      if (now > 0 && before <= 0) {
        ctx.emit({
          category: "resources",
          priority: 6,
          title: `${cap(g)} shortage`,
          body: `The colony is running short of ${g}.`,
          subjectRefs: [],
          cameraHint: world.landingSite,
        });
      }
    }
  }
  world.shortages = shortages;
};
