import {
  LIFE_CRITICAL,
  MARS_SOL_SECONDS,
  type Crisis,
  type CrisisKind,
  type CrisisStage,
  type World,
} from "@miworld/shared";
import type { System } from "../engine";

// Threats & crises (runs right after environment, before resources — a dust storm must dim the
// panels this very tick). Each crisis is a warning → onset → peak → recovery state machine that
// emits a beat at every stage, so the causal chain is watchable (forecast → panels dim →
// rationing → the skies clear). A "drama thermostat" caps things to ONE crisis at a time,
// guarantees a calm window after each, and never piles a crisis onto an existing life-support
// shortage or a fragile colony — so the tone stays hopeful and the colony is pressured, never
// casually wiped (WP-9's Earth rescue + reseed remain the true safety net).

const SOL = MARS_SOL_SECONDS;
const CALM_DUST = 0.12;
const MIN_CALM_SOL = 6; // enforced quiet after a crisis ends
const CRISIS_CHANCE_PER_SOL = 0.11; // when eligible → mean spacing ~15 sols
const MIN_POP_FOR_CRISIS = 4;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Stage durations in sols, [min, max]. A near-zero warning = it strikes almost immediately.
const DUR: Record<CrisisKind, Record<CrisisStage, [number, number]>> = {
  dust_storm: { warning: [0.3, 0.6], onset: [0.6, 1.0], peak: [1.4, 3.2], recovery: [0.8, 1.4] },
  equipment_failure: { warning: [0.05, 0.12], onset: [0.15, 0.3], peak: [0.8, 1.8], recovery: [0.3, 0.6] },
  solar_storm: { warning: [0.4, 0.8], onset: [0.3, 0.6], peak: [0.5, 1.1], recovery: [0.3, 0.6] },
};
const WEIGHT: Record<CrisisKind, number> = { dust_storm: 3, equipment_failure: 2, solar_storm: 1 };
const NEXT: Record<CrisisStage, CrisisStage | "done"> = {
  warning: "onset",
  onset: "peak",
  peak: "recovery",
  recovery: "done",
};

// Buildings an equipment failure can strike (a producer going down is legible).
const FAILABLE = new Set(["solar_field", "isru_plant", "water_extractor", "greenhouse", "workshop"]);

const STAGE_LABEL: Record<CrisisStage, string> = {
  warning: "incoming",
  onset: "onset",
  peak: "peak",
  recovery: "easing",
};

function aliveCount(world: World): number {
  let n = 0;
  for (const c of world.colonists) if (c.alive) n++;
  return n;
}

/** Building ids currently knocked offline by an equipment failure — resources skips these. */
export function disabledBuildingIds(world: World): Set<string> {
  const s = new Set<string>();
  for (const c of world.crises) {
    if (c.kind === "equipment_failure" && c.stage !== "warning" && c.targetId) s.add(c.targetId);
  }
  return s;
}

/** Human label of the most severe active crisis, for the HUD banner (or null when calm). */
export function crisisLabel(world: World): string | null {
  if (world.crises.length === 0) return null;
  const names: Record<CrisisKind, string> = {
    dust_storm: "Dust storm",
    equipment_failure: "Equipment failure",
    solar_storm: "Solar storm",
  };
  const c = world.crises[0]!;
  return `${names[c.kind]} · ${STAGE_LABEL[c.stage]}`;
}

function stageDuration(kind: CrisisKind, stage: CrisisStage, ctx: Parameters<System>[2]): number {
  const [lo, hi] = DUR[kind][stage];
  return ctx.rng.range("crisis", lo, hi) * SOL;
}

function enterStage(crisis: Crisis, stage: CrisisStage, now: number, ctx: Parameters<System>[2]): void {
  crisis.stage = stage;
  crisis.stageStartSec = now;
  crisis.stageEndsSec = now + stageDuration(crisis.kind, stage, ctx);
}

function pickKind(world: World, ctx: Parameters<System>[2]): CrisisKind {
  const kinds = Object.keys(WEIGHT) as CrisisKind[];
  const total = kinds.reduce((s, k) => s + WEIGHT[k], 0);
  let r = ctx.rng.next("crisis") * total;
  for (const k of kinds) {
    r -= WEIGHT[k];
    if (r <= 0) return k;
  }
  return "dust_storm";
}

function stormDust(crisis: Crisis, now: number): number {
  const span = Math.max(1, crisis.stageEndsSec - crisis.stageStartSec);
  const prog = clamp((now - crisis.stageStartSec) / span, 0, 1);
  const peak = lerp(0.5, 0.9, crisis.severity);
  const haze = Math.max(0.2, crisis.startDust); // don't dip below where the sky already was
  switch (crisis.stage) {
    case "warning":
      return lerp(crisis.startDust, haze, prog);
    case "onset":
      return lerp(haze, peak, prog);
    case "peak":
      return peak;
    case "recovery":
      return lerp(peak, CALM_DUST, prog);
  }
}

export const crisesSystem: System = (world, dt, ctx) => {
  if (world.status !== "alive") return; // a fallen colony has no crises (WP-9 owns that arc)
  const dtSol = dt / SOL;
  const now = world.worldTimeSec;

  // --- maybe spawn a new crisis (thermostat-gated) ---
  const shortageActive = LIFE_CRITICAL.some((g) => (world.shortages[g] ?? 0) >= 0.5);
  const eligible =
    world.crises.length === 0 &&
    now - world.lastCrisisEndSec >= MIN_CALM_SOL * SOL &&
    aliveCount(world) >= MIN_POP_FOR_CRISIS &&
    !shortageActive;
  if (eligible && ctx.rng.next("crisis") < CRISIS_CHANCE_PER_SOL * dtSol) {
    let kind = pickKind(world, ctx);
    let targetId: string | null = null;
    if (kind === "equipment_failure") {
      const targets = world.buildings.filter(
        (b) => b.progress >= 1 && b.tier !== "ruin" && FAILABLE.has(b.kind),
      );
      if (targets.length === 0) kind = "dust_storm";
      else targetId = targets[ctx.rng.int("crisis", targets.length)]!.id;
    }
    const crisis: Crisis = {
      id: `k${Math.round(now)}`,
      kind,
      stage: "warning",
      stageStartSec: now,
      stageEndsSec: now + stageDuration(kind, "warning", ctx),
      severity: ctx.rng.range("crisis", 0.5, 1),
      startDust: world.dust,
      targetId,
    };
    world.crises.push(crisis);
    emitStageBeat(world, crisis, "warning", ctx);
  }

  // --- advance state machines (and apply per-stage one-shots) ---
  for (const crisis of [...world.crises]) {
    let guard = 0;
    while (now >= crisis.stageEndsSec && guard++ < 8) {
      const nxt = NEXT[crisis.stage];
      if (nxt === "done") {
        endCrisis(world, crisis, now, ctx);
        break;
      }
      enterStage(crisis, nxt, now, ctx);
      emitStageBeat(world, crisis, nxt, ctx);
      if (nxt === "peak") applyPeakOneShot(world, crisis, ctx);
    }
  }

  // --- continuous effect: a dust storm drives atmospheric dust (environment yields to it) ---
  const storm = world.crises.find((c) => c.kind === "dust_storm");
  if (storm) world.dust = clamp(stormDust(storm, now), 0.02, 0.95);
};

/** One-shot at peak: a solar storm may claim a single colonist on EVA (rare → hopeful tone). */
function applyPeakOneShot(world: World, crisis: Crisis, ctx: Parameters<System>[2]): void {
  if (crisis.kind !== "solar_storm") return;
  if (aliveCount(world) <= MIN_POP_FOR_CRISIS) return; // never strike a fragile colony
  if (ctx.rng.next("crisis") >= 0.35 * crisis.severity) return;
  const living = world.colonists.filter((c) => c.alive);
  const victim = living[ctx.rng.int("crisis", living.length)]!;
  victim.alive = false;
  if (victim.partner) {
    const p = world.colonists.find((x) => x.id === victim.partner);
    if (p) {
      p.partner = null;
      ctx.patch(`c:${p.id}`, { partner: null });
    }
    victim.partner = null;
  }
  ctx.patch(`c:${victim.id}`, { alive: false });
  if (!ctx.coarse) {
    ctx.emit({
      category: "crisis",
      priority: 8,
      title: "Lost to the storm",
      body: `${victim.name} (${victim.role}) was caught outside when the radiation surged.`,
      subjectRefs: [victim.id],
      cameraHint: victim.pos,
    });
  }
}

function endCrisis(world: World, crisis: Crisis, now: number, ctx: Parameters<System>[2]): void {
  world.crises = world.crises.filter((c) => c.id !== crisis.id);
  world.lastCrisisEndSec = now;
  if (crisis.kind === "dust_storm") world.dust = CALM_DUST;
  // Repairing an equipment failure draws down the spares stockpile (flavor + a resource cost).
  if (crisis.kind === "equipment_failure") {
    world.treasury.spares.amount = Math.max(0, world.treasury.spares.amount - 12);
  }
  if (ctx.coarse) return;
  const done: Record<CrisisKind, { title: string; body: string }> = {
    dust_storm: { title: "The skies clear", body: "The dust settles and the panels drink the sun again." },
    equipment_failure: {
      title: `${targetName(world, crisis)} back online`,
      body: "Engineers finish the repair and the module hums back to life.",
    },
    solar_storm: { title: "The all-clear sounds", body: "The radiation fades; the colony emerges from shelter." },
  };
  const d = done[crisis.kind];
  ctx.emit({
    category: "crisis",
    priority: 6,
    title: d.title,
    body: d.body,
    subjectRefs: crisis.targetId ? [crisis.targetId] : [],
    cameraHint: crisisCamera(world, crisis),
  });
}

function targetName(world: World, crisis: Crisis): string {
  const b = world.buildings.find((x) => x.id === crisis.targetId);
  return b ? b.kind.replace(/_/g, " ") : "a module";
}

function crisisCamera(world: World, crisis: Crisis): { x: number; z: number } {
  const b = world.buildings.find((x) => x.id === crisis.targetId);
  return b ? b.pos : world.landingSite;
}

function emitStageBeat(world: World, crisis: Crisis, stage: CrisisStage, ctx: Parameters<System>[2]): void {
  if (ctx.coarse) return;
  const cam = crisisCamera(world, crisis);
  const name = targetName(world, crisis);
  const beats: Partial<Record<CrisisStage, { title: string; body: string; priority: number }>> = {};
  if (crisis.kind === "dust_storm") {
    beats.warning = { title: "Dust on the horizon", body: "The forecast warns of a storm rolling toward the colony.", priority: 5 };
    beats.onset = { title: "The dust storm hits", body: "A wall of red dust swallows the sky; the solar arrays dim.", priority: 7 };
    beats.peak = { title: "The storm rages", body: "The colony hunkers down and rations power through the dark.", priority: 6 };
  } else if (crisis.kind === "equipment_failure") {
    beats.warning = { title: "A warning light blinks", body: `Sensors flag trouble in the ${name}.`, priority: 4 };
    beats.onset = { title: `The ${name} has failed`, body: `The ${name} drops offline; the colony reroutes around it.`, priority: 6 };
  } else {
    beats.warning = { title: "Solar flare detected", body: "Instruments pick up an incoming radiation front.", priority: 5 };
    beats.onset = { title: "Radiation lockdown", body: "Colonists shelter as the storm front arrives.", priority: 6 };
  }
  const b = beats[stage];
  if (!b) return;
  ctx.emit({
    category: "crisis",
    priority: b.priority,
    title: b.title,
    body: b.body,
    subjectRefs: crisis.targetId ? [crisis.targetId] : [],
    cameraHint: cam,
  });
}
