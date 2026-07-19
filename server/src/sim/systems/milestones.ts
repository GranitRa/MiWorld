import {
  GOOD_CAP,
  MARS_SOL_SECONDS,
  type Building,
  type World,
} from "@miworld/shared";
import type { SimContext, System } from "../engine";

// The milestone / "wow" engine (runs LAST each tick, right before the bus flush). A set of
// authored templates each has a predicate over world state and fires AT MOST ONCE PER EPOCH —
// a max-priority `milestone` beat, and sometimes a physical artifact left in the world (a
// monument) so history is visible. Each template carries several tone variants so a repeated
// life event (a first child, a naming) never reads as the same canned string. The naming
// ceremony writes `world.settlementName`, which later beats then weave in.

const SOL = MARS_SOL_SECONDS;

const pick = <T>(ctx: SimContext, arr: T[]): T => arr[ctx.rng.int("milestone", arr.length)]!;

function aliveCount(w: World): number {
  return w.colonists.reduce((n, c) => n + (c.alive ? 1 : 0), 0);
}
function firstCompleteDome(w: World): Building | undefined {
  return w.buildings.find((b) => b.kind === "dome" && b.tier !== "ruin" && b.progress >= 1);
}
function hasCompleteDome(w: World): boolean {
  return firstCompleteDome(w) !== undefined;
}
function place(w: World): string {
  return w.settlementName ?? "the colony";
}

// --- settlement naming grammar (deterministic via the "milestone" rng stream) ---
const NAME_A = ["New", "Nova", "Ares", "Red", "Olympus", "Tharsis", "Elysium", "Aurora", "Hope", "Kepler", "Bradbury"];
const NAME_B = ["Haven", "Reach", "Landing", "Rest", "Hearth", "Terrace", "Gate", "Dawn", "Cradle", "Vale"];

interface Milestone {
  id: string;
  ready: (w: World) => boolean;
  fire: (w: World, ctx: SimContext) => void;
}

function emit(
  w: World,
  ctx: SimContext,
  title: string,
  body: string,
  cam: { x: number; z: number } | null = null,
  subjectRefs: string[] = [],
): void {
  ctx.emit({
    category: "milestone",
    priority: 10, // max-priority: milestones survive coarse catch-up + interrupt gentler shots
    title,
    body,
    subjectRefs,
    cameraHint: cam ?? w.landingSite,
  });
}

const CATALOG: Milestone[] = [
  {
    id: "first_child",
    // A colonist younger than an Earth-year must be Mars-born (crew + immigrants arrive adult).
    ready: (w) => w.colonists.some((c) => c.alive && c.ageDays < 668),
    fire: (w, ctx) => {
      const child = w.colonists.find((c) => c.alive && c.ageDays < 668);
      emit(
        w,
        ctx,
        pick(ctx, ["The first Martian", "A world's first child", "Born of Mars"]),
        pick(ctx, [
          `${child?.name ?? "A child"} is the first human ever born on Mars — the colony gathers to celebrate.`,
          `For the first time, a child draws breath under a Martian sky. ${child?.name ?? "The newborn"} belongs to no other world.`,
          `${child?.name ?? "A child"} is born — not a settler, but a native. Mars has its first daughter or son.`,
        ]),
        child?.pos ?? null,
        child ? [child.id] : [],
      );
    },
  },
  {
    id: "first_dome",
    ready: (w) => hasCompleteDome(w),
    fire: (w, ctx) => {
      const dome = firstCompleteDome(w); // this epoch's dome, never an old ruin (Fable MEDIUM-1)
      emit(
        w,
        ctx,
        pick(ctx, ["The first dome rises", "Under glass", "A pressurized sky"]),
        pick(ctx, [
          "The colony raises its first geodesic dome — room to stand tall under a sky of its own.",
          "A great dome closes over the settlement. Inside, for the first time, the air is warm and the light is soft.",
          "The first dome is sealed and pressurized — the colony is no longer just shelters and tunnels, but a place to live.",
        ]),
        dome?.pos ?? null,
        dome ? [dome.id] : [],
      );
    },
  },
  {
    id: "naming_ceremony",
    ready: (w) => w.settlementName === null && aliveCount(w) >= 24 && hasCompleteDome(w),
    fire: (w, ctx) => {
      const name = `${pick(ctx, NAME_A)} ${pick(ctx, NAME_B)}`;
      w.settlementName = name;
      emit(
        w,
        ctx,
        pick(ctx, ["The colony is named", "A settlement christened", "It has a name"]),
        pick(ctx, [
          `The colonists gather and, by acclaim, name their home: ${name}. The settlement is no longer a base — it is a town.`,
          `After long debate the notables settle on a name. From today the colony is known as ${name}.`,
          `A vote, a cheer, a name carved into the first plaque: ${name}. The people have made this red plain their own.`,
        ]),
      );
    },
  },
  {
    id: "first_100_sols",
    ready: (w) => w.worldTimeSec - w.epochStartSec >= 100 * SOL,
    fire: (w, ctx) => {
      emit(
        w,
        ctx,
        pick(ctx, ["One hundred sols", "A hundred sunrises", "The 100-sol mark"]),
        pick(ctx, [
          `${place(w)} has endured a hundred Martian days — and grown through every one of them.`,
          `A hundred sols since the first landing. What began as a handful of shelters is now a living settlement.`,
          `One hundred sunrises over the dust. The colony marks the day and looks to the next hundred.`,
        ]),
      );
    },
  },
  {
    id: "growing_strong",
    ready: (w) => aliveCount(w) >= 50,
    fire: (w, ctx) => {
      emit(
        w,
        ctx,
        pick(ctx, ["Fifty souls and rising", "A thriving colony", "Strength in numbers"]),
        pick(ctx, [
          `${place(w)} is home to fifty people now — a true community taking root on Mars.`,
          `The population passes fifty. Corridors that once echoed are full of voices.`,
          `Fifty colonists strong and still growing — Mars is becoming a home, not an outpost.`,
        ]),
      );
    },
  },
  {
    id: "terraforming_experiment",
    ready: (w) => w.treasury.science.amount >= GOOD_CAP.science * 0.8,
    fire: (w, ctx) => {
      emit(
        w,
        ctx,
        pick(ctx, ["A green experiment", "First life takes hold", "The terraforming trial"]),
        pick(ctx, [
          `Researchers seal a test dome and seed it with hardy lichen — the first deliberate life spread across Mars.`,
          `${place(w)}'s scientists begin a terraforming trial: a faint green glow where nothing green has ever grown.`,
          `In a sealed chamber, engineered lichen clings to Martian rock and lives. A first, fragile step toward a breathing world.`,
        ]),
      );
    },
  },
  {
    id: "monument",
    ready: (w) =>
      aliveCount(w) >= 30 &&
      w.treasury.feedstock.amount >= GOOD_CAP.feedstock * 0.6 &&
      w.treasury.science.amount >= GOOD_CAP.science * 0.4 &&
      !w.buildings.some((b) => b.kind === "monument" && b.tier !== "ruin"),
    fire: (w, ctx) => {
      // Prosperity diverts feedstock to a landmark — a permanent artifact in the world.
      w.treasury.feedstock.amount = Math.max(0, w.treasury.feedstock.amount - GOOD_CAP.feedstock * 0.25);
      // Nudge outward along -z until the site clears the 14 m spacing rule (Fable LOW-1).
      const clear = (x: number, z: number) =>
        w.buildings.every((b) => (b.pos.x - x) ** 2 + (b.pos.z - z) ** 2 >= 14 * 14);
      let dz = 22;
      while (dz < 120 && !clear(w.landingSite.x, w.landingSite.z - dz)) dz += 8;
      const pos = { x: w.landingSite.x, z: w.landingSite.z - dz };
      const id = `b${w.buildings.length}`;
      const rot = ctx.rng.range("milestone", 0, Math.PI * 2);
      const monument: Building = { id, kind: "monument", tier: "hardened", pos, rot, progress: 1 };
      w.buildings.push(monument);
      ctx.patch(`b:${id}`, { kind: "monument", tier: "hardened", pos, rot, progress: 1 });
      emit(
        w,
        ctx,
        pick(ctx, ["A monument rises", "Built to endure", "The colony's mark"]),
        pick(ctx, [
          `With surplus to spare, ${place(w)} raises a monument on the plain — a promise that people were here, and stayed.`,
          `The colony diverts its prosperity into something lasting: a landmark of steel and stone, visible for miles.`,
          `A monument is unveiled — not shelter, not machinery, but meaning. ${place(w)} builds for the ones who come after.`,
        ]),
        pos,
        [id],
      );
    },
  },
];

export const milestonesSystem: System = (world, _dt, ctx) => {
  if (world.status !== "alive") return; // a fallen colony sets no milestones (WP-9 owns that arc)
  for (const m of CATALOG) {
    if (world.milestones.includes(m.id)) continue;
    if (!m.ready(world)) continue;
    world.milestones.push(m.id); // mark fired first, so a throw in fire() can't loop-refire it
    m.fire(world, ctx);
  }
};
