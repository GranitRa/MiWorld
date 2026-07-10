import {
  BUILD_SPEC,
  GOOD_CAP,
  HOUSING_PER,
  MARS_SOL_SECONDS,
  type Building,
  type BuildingKind,
  type Planet,
  type World,
} from "@miworld/shared";
import type { System } from "../engine";
import { getPlanet } from "../planet";

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

function poolTotal(world: World): number {
  let n = 0;
  for (const k of Object.keys(world.pools)) n += world.pools[k] ?? 0;
  return n;
}

function population(world: World): number {
  return world.colonists.reduce((n, c) => n + (c.alive ? 1 : 0), 0) + poolTotal(world);
}

/** Pick the most-needed module to build next. */
function chooseKind(world: World): BuildingKind {
  const t = world.treasury;
  const complete = world.buildings.filter((b) => b.progress >= 1 && b.tier !== "ruin");
  const housing = complete.reduce((s, b) => s + (HOUSING_PER[b.kind] ?? 0), 0);
  const pop = population(world);
  const need = (good: keyof typeof GOOD_CAP) => 1 - t[good].amount / GOOD_CAP[good];
  const short = (good: string) => (world.shortages[good as keyof typeof world.shortages] ? 30 : 0);

  const scores: [BuildingKind, number][] = [
    ["solar_field", 16 * need("power") + short("power")],
    ["greenhouse", 20 * need("food") + short("food")],
    ["isru_plant", 16 * need("oxygen") + short("oxygen")],
    ["water_extractor", 16 * need("water") + short("water")],
    ["workshop", 12 * need("feedstock")],
    ["habitat", pop - housing + 2], // crowding + a little baseline growth
    ["dome", housing > pop * 1.6 ? 4 : 0],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0]![1] > 0 ? scores[0]![0] : "habitat";
}

/** Find a buildable spot: golden-angle spiral out from an anchor, low slope, spaced out. */
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
  const base = world.buildings.length;
  for (let i = 0; i < 240; i++) {
    const idx = base + i;
    const r = 16 + Math.sqrt(idx) * 10;
    const a = idx * GOLDEN;
    const x = ax + Math.cos(a) * r;
    const z = az + Math.sin(a) * r;
    if (Math.abs(x) > half || Math.abs(z) > half) continue;
    if (planet.slopeAt(x, z) > 0.32) continue;
    let ok = true;
    for (const b of world.buildings) {
      const dx = b.pos.x - x;
      const dz = b.pos.z - z;
      if (dx * dx + dz * dz < 14 * 14) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, z };
  }
  return { x: ax + (base % 7) * 16 - 48, z: az + Math.floor(base / 7) * 16 + 44 };
}

/**
 * Construction system: advances in-progress builds and, when there's slack, plans the next
 * module by need. Buildings appear via delta (id-prefixed "b:") and grow to progress 1.
 */
export const constructionSystem: System = (world, dt, ctx) => {
  const dtSol = dt / MARS_SOL_SECONDS;

  // --- advance in-progress builds ---
  for (const b of world.buildings) {
    if (b.progress >= 1) continue;
    const spec = BUILD_SPEC[b.kind];
    const was = b.progress;
    b.progress = Math.min(1, b.progress + dtSol / Math.max(0.05, spec.sols));
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

  // --- plan the next project ---
  const inProgress = world.buildings.filter((b) => b.progress < 1);
  if (inProgress.length >= 2) return;
  if (inProgress.some((b) => b.progress < 0.2)) return; // one just broke ground
  const softCap = 10 + population(world); // no runaway growth without population (WP-7)
  if (world.buildings.length >= softCap) return;

  const kind = chooseKind(world);
  const spec = BUILD_SPEC[kind];
  if (world.treasury.feedstock.amount < spec.feedstock) return; // save up first

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
