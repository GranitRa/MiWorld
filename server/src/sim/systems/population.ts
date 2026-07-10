import { HOUSING_PER, MARS_SOL_SECONDS, type Colonist, type World } from "@miworld/shared";
import type { System } from "../engine";
import { makeChild } from "../people/names";

const EARTH_YEAR_SOL = 668;
const ADULT_SOL = 18 * EARTH_YEAR_SOL;
const FERTILE_MAX_SOL = 42 * EARTH_YEAR_SOL;
const OLD_AGE_SOL = 58 * EARTH_YEAR_SOL;
const DEATH_RAMP_SOL = 32 * EARTH_YEAR_SOL;
const MAX_DEATH_HAZARD = 0.02; // per sol at extreme age (rare → hopeful tone)
const WALK_MPS = 1.3; // metres per world-second
const DWELL_SEC = 25; // pause at a destination before the next walk
const FERTILITY_PER_SOL = 0.011; // per fertile couple
const PAIR_ATTEMPT_PER_SOL = 0.6;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function housingCapacity(world: World): number {
  let c = 0;
  for (const b of world.buildings) if (b.progress >= 1 && b.tier !== "ruin") c += HOUSING_PER[b.kind] ?? 0;
  return c;
}

/**
 * Population lifecycle: colonists age, walk between modules, pair up, have Mars-born children
 * and (rarely, at great age) die. Births are gated by housing capacity, so population growth
 * couples to the settlement — more people → the planner builds more habitats → room for more
 * people. Movement is a walk leg (pos → dest over depart/arrive sim-times) the client
 * interpolates; only re-path events are streamed.
 */
export const populationSystem: System = (world, dt, ctx) => {
  const dtSol = dt / MARS_SOL_SECONDS;
  const now = world.worldTimeSec;

  // --- aging + death by age hazard ---
  for (const c of world.colonists) {
    if (!c.alive) continue;
    c.ageDays += dtSol;
    const hazard = clamp((c.ageDays - OLD_AGE_SOL) / DEATH_RAMP_SOL, 0, 1) * MAX_DEATH_HAZARD;
    if (hazard > 0 && ctx.rng.next("death") < hazard * dtSol) {
      c.alive = false;
      if (c.partner) {
        const p = world.colonists.find((x) => x.id === c.partner);
        if (p) {
          p.partner = null;
          ctx.patch(`c:${p.id}`, { partner: null });
        }
        c.partner = null;
      }
      ctx.patch(`c:${c.id}`, { alive: false });
      if (!ctx.coarse) {
        ctx.emit({
          category: "population",
          priority: 5,
          title: "A colonist has died",
          body: `${c.name} (${c.role}) has passed away at a great age.`,
          subjectRefs: [c.id],
          cameraHint: c.pos,
        });
      }
    }
  }

  const living = world.colonists.filter((c) => c.alive);
  const complete = world.buildings.filter((b) => b.progress >= 1 && b.tier !== "ruin");

  // --- movement (cosmetic; live only) ---
  if (!ctx.coarse && complete.length > 0) {
    for (const c of living) {
      if (c.dest && now < c.arriveSec + DWELL_SEC) continue; // still walking or dwelling
      if (c.dest) c.pos = { x: c.dest.x, z: c.dest.z }; // snap to arrival
      const target = complete[ctx.rng.int("move", complete.length)]!;
      const tx = target.pos.x + ctx.rng.range("move", -5, 5);
      const tz = target.pos.z + ctx.rng.range("move", -5, 5);
      const dist = Math.hypot(tx - c.pos.x, tz - c.pos.z);
      c.dest = { x: tx, z: tz };
      c.departSec = now;
      c.arriveSec = now + Math.max(5, dist / WALK_MPS);
      ctx.patch(`c:${c.id}`, {
        pos: c.pos,
        dest: c.dest,
        departSec: c.departSec,
        arriveSec: c.arriveSec,
      });
    }
  }

  // --- pairing (one attempt, throttled) ---
  if (ctx.rng.next("pair") < PAIR_ATTEMPT_PER_SOL * dtSol) {
    const singles = living.filter((c) => !c.partner && c.ageDays >= ADULT_SOL);
    const females = singles.filter((c) => c.sex === "f");
    const males = singles.filter((c) => c.sex === "m");
    if (females.length && males.length) {
      const f = females[ctx.rng.int("pair", females.length)]!;
      const m = males[ctx.rng.int("pair", males.length)]!;
      const shared = f.traits.filter((t) => m.traits.includes(t)).length;
      if (ctx.rng.next("pair") < 0.4 + shared * 0.3) {
        f.partner = m.id;
        m.partner = f.id;
        ctx.patch(`c:${f.id}`, { partner: m.id });
        ctx.patch(`c:${m.id}`, { partner: f.id });
        if (!ctx.coarse) {
          ctx.emit({
            category: "population",
            priority: 5,
            title: "A new bond",
            body: `${f.name} and ${m.name} have paired.`,
            subjectRefs: [f.id, m.id],
            cameraHint: f.pos,
          });
        }
      }
    }
  }

  // --- births (gated by housing so growth couples to the settlement) ---
  const cap = housingCapacity(world);
  if (living.length < cap) {
    const newborns: Colonist[] = [];
    for (const f of living) {
      if (f.sex !== "f" || !f.partner) continue;
      if (f.ageDays < ADULT_SOL || f.ageDays > FERTILE_MAX_SOL) continue;
      if (living.length + newborns.length >= cap) break;
      if (ctx.rng.next("birth") < FERTILITY_PER_SOL * dtSol) {
        const id = `c${world.colonists.length + newborns.length}`;
        const trait = f.traits[ctx.rng.int("birth", Math.max(1, f.traits.length))];
        const child = makeChild(ctx.rng, id, f.pos, trait);
        newborns.push(child);
        if (!ctx.coarse) {
          ctx.emit({
            category: "population",
            priority: 6,
            title: "A child is born",
            body: `${child.name} is born to ${f.name} — a new Martian.`,
            subjectRefs: [id],
            cameraHint: f.pos,
          });
        }
      }
    }
    for (const nb of newborns) {
      world.colonists.push(nb);
      ctx.patch(`c:${nb.id}`, nb as unknown as Record<string, unknown>);
    }
  }
};
