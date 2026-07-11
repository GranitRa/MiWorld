import {
  GOOD_CAP,
  HOUSING_PER,
  LIFE_CRITICAL,
  MARS_SOL_SECONDS,
  type World,
} from "@miworld/shared";
import type { System } from "../engine";
import { makeColonist } from "../people/names";
import { reseedColony } from "../world";

const SUPPLY_TRANSIT_SOL = 7;
const RESCUE_TRANSIT_SOL = 2.5;
const SUPPLY_INTERVAL_SOL = 7;
const IMMIGRANT_BATCH = 5;
const RESEED_DELAY_SOL = 5;
const SUPPLY_FEEDSTOCK = 130;
const SHORT = 0.5;

function housingCapacity(world: World): number {
  let c = 0;
  for (const b of world.buildings) if (b.progress >= 1 && b.tier !== "ruin") c += HOUSING_PER[b.kind] ?? 0;
  return c;
}

const ordinal = (n: number): string => {
  const names = ["Zeroth", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh"];
  return names[n] ?? `${n}th`;
};

/**
 * The Earth link + the unkillable-colony safety net. Ships take world-weeks in transit and,
 * on arrival, deliver feedstock (fuels construction) and immigrants (fuels growth). Earth is
 * the predator-balancer: it launches emergency rescues when the colony is in a life-support
 * shortage, and grows lax (rarer, lighter flights) when the colony thrives. If population ever
 * hits zero the world does NOT end — the settlement becomes ruins and, after a short interval,
 * a fresh expedition lands nearby and the epoch increments.
 */
export const earthSystem: System = (world, _dt, ctx) => {
  const now = world.worldTimeSec;
  const sol = MARS_SOL_SECONDS;
  const alive = world.colonists.reduce((n, c) => n + (c.alive ? 1 : 0), 0);

  // --- collapse → ruins ---
  if (world.status === "alive" && alive === 0) {
    world.status = "fallen";
    world.fallenSec = now;
    for (const b of world.buildings) {
      if (b.tier !== "ruin") {
        b.tier = "ruin";
        ctx.patch(`b:${b.id}`, { tier: "ruin" });
      }
    }
    // Milestone: emit unconditionally so the fall survives a catch-up burst (Fable F3) —
    // it is once per epoch, so there is no spam risk.
    ctx.emit({
      category: "earth",
      priority: 10,
      title: "The First Colony has fallen",
      body: "Silence falls over the Martian dust. Earth mourns — and prepares another expedition.",
      subjectRefs: [],
      cameraHint: world.landingSite,
    });
    return;
  }

  // --- reseed after the delay ---
  if (world.status === "fallen") {
    // Self-heal a world that is fallen but has no fallenSec (e.g. a snapshot-loss boot rebuilt
    // it from meta, or a legacy snapshot): without this the reseed timer never fires and the
    // world is permanently dead — the one hole in the unkillable net (Fable F2).
    if (world.fallenSec == null) world.fallenSec = now;
    if (now >= world.fallenSec + RESEED_DELAY_SOL * sol) {
      const nextEpoch = world.epoch + 1;
      world.epoch = nextEpoch;
      world.status = "alive";
      world.fallenSec = null;
      reseedColony(world, ctx.rng);
      for (const b of world.buildings) {
        if (b.tier !== "ruin") {
          ctx.patch(`b:${b.id}`, {
            kind: b.kind,
            tier: b.tier,
            pos: b.pos,
            rot: b.rot,
            progress: b.progress,
          });
        }
      }
      for (const c of world.colonists)
        if (c.alive) ctx.patch(`c:${c.id}`, c as unknown as Record<string, unknown>);
      // Milestone: emit unconditionally so the reseed survives a catch-up burst (Fable F3).
      ctx.emit({
        category: "earth",
        priority: 10,
        title: `The ${ordinal(nextEpoch)} Expedition lands`,
        body: "A new ship touches down among the ruins of the first colony. Humanity tries again.",
        subjectRefs: [],
        cameraHint: world.landingSite,
      });
    }
    return; // no ordinary flights while fallen
  }

  // --- deliver arrivals ---
  if (world.flights.some((f) => now >= f.arriveSec)) {
    const arrived = world.flights.filter((f) => now >= f.arriveSec);
    world.flights = world.flights.filter((f) => now < f.arriveSec);
    for (const f of arrived) {
      if (f.feedstock) {
        world.treasury.feedstock.amount = Math.min(
          GOOD_CAP.feedstock,
          world.treasury.feedstock.amount + f.feedstock,
        );
      }
      if (f.kind === "rescue") {
        for (const g of LIFE_CRITICAL) {
          world.treasury[g].amount = Math.max(world.treasury[g].amount, GOOD_CAP[g] * 0.5);
          world.shortages[g] = 0; // clear pressure so relief doesn't instantly trigger a 2nd rescue (Fable F7)
        }
      }
      for (let i = 0; i < f.colonists; i++) {
        const pos = {
          x: world.landingSite.x + ctx.rng.range("earth", -25, 25),
          z: world.landingSite.z + ctx.rng.range("earth", -25, 25),
        };
        const c = makeColonist(ctx.rng, `c${world.colonists.length}`, world.colonists.length, pos);
        world.colonists.push(c);
        ctx.patch(`c:${c.id}`, c as unknown as Record<string, unknown>);
      }
      if (!ctx.coarse) {
        const parts: string[] = [];
        if (f.colonists) parts.push(`${f.colonists} new colonists`);
        if (f.feedstock) parts.push("supplies");
        ctx.emit({
          category: "earth",
          priority: f.kind === "rescue" ? 7 : 5,
          title: f.kind === "rescue" ? "A rescue ship lands" : "A ship lands from Earth",
          body: `An Earth ship touches down with ${parts.join(" and ") || "cargo"}.`,
          subjectRefs: [],
          cameraHint: world.landingSite,
        });
      }
    }
  }

  // --- schedule new flights ---
  const anyLifeShort = LIFE_CRITICAL.some((g) => (world.shortages[g] ?? 0) >= SHORT);
  if (anyLifeShort && !world.flights.some((f) => f.kind === "rescue")) {
    world.flights.push({
      id: `f${Math.round(now)}-${world.flights.length}`,
      kind: "rescue",
      arriveSec: now + RESCUE_TRANSIT_SOL * sol,
      feedstock: 60,
      colonists: alive < 6 ? 4 : 0,
    });
    if (!ctx.coarse) {
      ctx.emit({
        category: "earth",
        priority: 6,
        title: "Earth dispatches a rescue ship",
        body: "Sensing the colony in distress, Earth launches an emergency relief flight.",
        subjectRefs: [],
        cameraHint: world.landingSite,
      });
    }
  }

  const thriving =
    !anyLifeShort &&
    world.treasury.feedstock.amount > GOOD_CAP.feedstock * 0.5 &&
    LIFE_CRITICAL.every((g) => world.treasury[g].amount > GOOD_CAP[g] * 0.6);
  const interval = (thriving ? SUPPLY_INTERVAL_SOL * 1.8 : SUPPLY_INTERVAL_SOL) * sol;
  if (now - world.lastFlightSec > interval && world.flights.length < 2) {
    const surplus = housingCapacity(world) - alive;
    const immigrants = surplus >= 2 ? Math.min(IMMIGRANT_BATCH, surplus) : 0;
    const feedstock =
      world.treasury.feedstock.amount < GOOD_CAP.feedstock * 0.4
        ? SUPPLY_FEEDSTOCK
        : Math.round(SUPPLY_FEEDSTOCK * 0.4);
    world.flights.push({
      id: `f${Math.round(now)}-${world.flights.length}`,
      kind: immigrants > 0 ? "colonists" : "supply",
      arriveSec: now + SUPPLY_TRANSIT_SOL * sol,
      feedstock,
      colonists: immigrants,
    });
    world.lastFlightSec = now;
    if (!ctx.coarse) {
      ctx.emit({
        category: "earth",
        priority: 4,
        title: "A ship departs Earth",
        body:
          immigrants > 0
            ? `${immigrants} colonists and supplies are inbound for Mars.`
            : "A resupply run is inbound for Mars.",
        subjectRefs: [],
        cameraHint: world.landingSite,
      });
    }
  }
};
