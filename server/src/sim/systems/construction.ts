import {
  BUILDING_ECONOMY,
  BUILD_SPEC,
  GOOD_CAP,
  HOUSING_PER,
  MARS_SOL_SECONDS,
  TIER_MULT,
  type Building,
  type BuildingEconomy,
  type BuildingKind,
  type Planet,
  type World,
} from "@miworld/shared";
import type { System } from "../engine";
import { getPlanet } from "../planet";
import { SHORTAGE_THRESHOLD_SOL } from "./resources";

const LABEL: Record<BuildingKind, string> = {
  habitat: "habitat",
  solar_field: "solar array",
  greenhouse: "greenhouse",
  isru_plant: "oxygen plant",
  water_extractor: "water extractor",
  workshop: "workshop",
  dome: "dome",
  tunnel: "tunnel",
  landing_pad: "landing pad",
  monument: "monument",
};

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const NO_ECON: BuildingEconomy = { produces: [], consumes: [] };
const AVG_SUN = 0.318; // sol-average of clamp(-cos, 0, 1)

function poolTotal(world: World): number {
  let n = 0;
  for (const k of Object.keys(world.pools)) n += world.pools[k] ?? 0;
  return n;
}

function population(world: World): number {
  return world.colonists.reduce((n, c) => n + (c.alive ? 1 : 0), 0) + poolTotal(world);
}

/**
 * Pick the most-needed module to build next, or null to BUILD NOTHING when the colony is
 * satisfied (critical: a "default" pick would spam filler habitats into a frozen cap and
 * starve the base of power). Solar is driven by a proactive power-margin projection, not the
 * power stockpile, so the colony keeps a real supply headroom.
 */
function chooseKind(world: World): BuildingKind | null {
  const t = world.treasury;
  const built = world.buildings.filter((b) => b.tier !== "ruin"); // complete + in-progress
  // Count planned housing (incl. in-progress) so we don't over-queue habitats while they build.
  const housing = built.reduce((s, b) => s + (HOUSING_PER[b.kind] ?? 0), 0);
  const pop = population(world);
  const count = (k: BuildingKind) => built.filter((b) => b.kind === k).length;
  const active = (g: string) =>
    (world.shortages[g as keyof typeof world.shortages] ?? 0) >= SHORTAGE_THRESHOLD_SOL;
  const powerShort = active("power");
  const need = (good: keyof typeof GOOD_CAP) => 1 - t[good].amount / GOOD_CAP[good];
  // Suppress a good's shortage bonus while power is the root cause (a power-caused famine
  // must be answered with solar, not with more power-hungry producers).
  const short = (good: string) => (active(good) && !powerShort ? 24 : 0);

  // Proactive power margin: keep projected supply ~20% above total power demand.
  const avgEff = AVG_SUN * (1 - world.dust);
  const powerSupply = count("solar_field") * 50 * avgEff;
  let powerDemand = 0;
  for (const b of built) {
    const econ = BUILDING_ECONOMY[b.kind] ?? NO_ECON;
    for (const c of econ.consumes) if (c.good === "power") powerDemand += c.perSol * TIER_MULT[b.tier];
  }
  const powerDeficit = powerDemand * 1.2 - powerSupply;
  const solarScore = (powerDeficit > 0 ? 8 + powerDeficit * 0.5 : -6) + (powerShort ? 30 : 0);

  const scores: [BuildingKind, number][] = [
    ["solar_field", solarScore],
    ["greenhouse", 20 * need("food") + short("food") - count("greenhouse") * 4],
    ["isru_plant", 16 * need("oxygen") + short("oxygen") - count("isru_plant") * 7],
    ["water_extractor", 16 * need("water") + short("water") - count("water_extractor") * 7],
    ["workshop", 12 * need("feedstock") - count("workshop") * 9],
    ["habitat", pop - housing + 2 - count("habitat") * 0.4], // grows housing toward pop, then stops
    ["dome", (housing > pop * 1.6 ? 5 : 1) - count("dome") * 3], // a little prosperity growth
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0]![1] > 0 ? scores[0]![0] : null;
}

/** Find a buildable spot: golden-angle spiral, then a checked ring fallback. Never returns
 * an unchecked position (bounds, slope and 14 m spacing are always enforced). */
function siteFor(world: World, planet: Planet, kind: BuildingKind): { x: number; z: number } {
  let ax = world.landingSite.x;
  let az = world.landingSite.z;
  if (kind === "water_extractor" || kind === "isru_plant") {
    const ice = planet.deposits.filter((d) => d.kind === "ice");
    let best = ice[0];
    let bd = Infinity;
    for (const d of ice) {
      const dd = (d.x - ax) ** 2 + (d.z - az) ** 2;
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    if (best) {
      ax = best.x;
      az = best.z;
    }
  }
  const half = planet.size * 0.45;
  const spaced = (x: number, z: number) => {
    for (const b of world.buildings) {
      const dx = b.pos.x - x;
      const dz = b.pos.z - z;
      if (dx * dx + dz * dz < 14 * 14) return false;
    }
    return true;
  };
  const okCell = (x: number, z: number) =>
    Math.abs(x) <= half && Math.abs(z) <= half && planet.slopeAt(x, z) <= 0.32 && spaced(x, z);

  const base = world.buildings.length;
  for (let i = 0; i < 600; i++) {
    const idx = base + i;
    const r = 16 + Math.sqrt(idx) * 10;
    const a = idx * GOLDEN;
    const x = ax + Math.cos(a) * r;
    const z = az + Math.sin(a) * r;
    if (okCell(x, z)) return { x, z };
  }
  // Checked outward-ring fallback from the landing site.
  for (let ring = 1; ring < 80; ring++) {
    for (let s = 0; s < 12; s++) {
      const ang = (s / 12) * Math.PI * 2;
      const rr = 24 + ring * 16;
      const x = world.landingSite.x + Math.cos(ang) * rr;
      const z = world.landingSite.z + Math.sin(ang) * rr;
      if (okCell(x, z)) return { x, z };
    }
  }
  return { x: world.landingSite.x, z: world.landingSite.z }; // unreachable on a real map
}

/**
 * Construction system: advances in-progress builds and, when there's slack and a real need,
 * plans the next module. Buildings appear via delta (id-prefixed "b:") and grow to progress 1.
 */
export const constructionSystem: System = (world, dt, ctx) => {
  const dtSol = dt / MARS_SOL_SECONDS;

  // --- advance in-progress builds ---
  for (const b of world.buildings) {
    if (b.progress >= 1) continue;
    const sols = BUILD_SPEC[b.kind]?.sols ?? 1;
    const was = b.progress;
    b.progress = Math.min(1, b.progress + dtSol / Math.max(0.05, sols));
    ctx.patch(`b:${b.id}`, { progress: b.progress });
    if (was < 1 && b.progress >= 1 && !ctx.coarse) {
      ctx.emit({
        category: "construction",
        priority: 5,
        title: `${LABEL[b.kind]} online`,
        body: `A new ${LABEL[b.kind]} joins the settlement.`,
        subjectRefs: [b.id],
        cameraHint: b.pos,
      });
    }
  }

  // --- plan the next project (only when a real need exists) ---
  const inProgress = world.buildings.filter((b) => b.progress < 1);
  if (inProgress.length >= 2) return;
  if (inProgress.some((b) => b.progress < 0.2)) return; // one just broke ground
  const softCap = 10 + population(world);
  if (world.buildings.length >= softCap) return;

  const kind = chooseKind(world);
  if (!kind) return; // colony is satisfied — build nothing
  const spec = BUILD_SPEC[kind];
  if (!spec || world.treasury.feedstock.amount < spec.feedstock) return; // guard + save up

  world.treasury.feedstock.amount -= spec.feedstock;
  const planet = getPlanet(world.seed);
  const pos = siteFor(world, planet, kind);
  const id = `b${world.buildings.length}`;
  const rot = ctx.rng.range("site", 0, Math.PI * 2);
  const building: Building = { id, kind, tier: "printed", pos, rot, progress: 0.001 };
  world.buildings.push(building);
  ctx.patch(`b:${id}`, { kind, tier: "printed", pos, rot, progress: building.progress });
  if (!ctx.coarse) {
    ctx.emit({
      category: "construction",
      priority: 5,
      title: "Construction begins",
      body: `The colony breaks ground on a new ${LABEL[kind]}.`,
      subjectRefs: [id],
      cameraHint: pos,
    });
  }
};
