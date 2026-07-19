import "dotenv/config";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import {
  BURST_LAG_TICKS,
  CATCHUP_CAP_WORLD_SEC,
  GOODS,
  MARS_SOL_SECONDS,
  REAL_MS_PER_TICK,
  SNAPSHOT_INTERVAL_REAL_MS,
  TICK_WORLD_SECONDS,
  generatePlanet,
  type ChronicleCategory,
  type ChronicleEvent,
  type EntityDelta,
  type World,
} from "@miworld/shared";
import { getPool, closePool } from "./db/pool";
import { migrate } from "./db/migrate";
import { acquireWorldLock, type WorldLock } from "./db/lock";
import {
  deleteChronicleAfter,
  freezeSnapshot,
  insertChronicle,
  loadLatestSnapshot,
  loadWorldMeta,
  saveSnapshot,
} from "./db/persistence";
import { deadlineForTick, Heartbeat, planBoot } from "./sim/clock";
import { RngGateway } from "./sim/rng";
import { createWorld, normalizeWorld, seedColony } from "./sim/world";
import { registerSystems } from "./sim/systems/register";
import { fastForwardTo, stepTick, type EmittedEvent, type SimContext } from "./sim/engine";
import { Broadcaster } from "./net/wsServer";
import { buildTick, coalesceDeltas } from "./net/serializer";
import { crisisLabel } from "./sim/systems/crises";

const PORT = Number(process.env.PORT ?? 8080);
const here = dirname(fileURLToPath(import.meta.url));
const clientDist = join(here, "../../client/dist");

async function main() {
  const pool = getPool();
  registerSystems(); // before boot, so catch-up fast-forward runs the sim systems too

  // Mutable holder so the WS broadcaster and /healthz always read the current world.
  // `live` flips true once we own the write-lock and the heartbeat is running.
  const state = {
    world: createWorld(0),
    rng: new RngGateway(0),
    foundedRealMs: Date.now(),
    live: false,
  };

  // Serve the existing world immediately (read-only), so the healthcheck and viewers do
  // NOT wait on the write-lock — otherwise a Railway rolling deploy would deadlock (new
  // instance can't get healthy without the lock; old won't release it until it's retired,
  // which only happens once the new one is healthy). Falls back to a placeholder on the
  // first-ever boot (tables not migrated yet).
  try {
    const snap = await loadLatestSnapshot(pool);
    if (snap) {
      state.world = normalizeWorld(snap.world);
      state.rng = new RngGateway(snap.world.seed, snap.rng);
    }
  } catch {
    /* tables not created yet — first ever boot; we found under the lock below */
  }

  let inFlight: Promise<void> | null = null;
  let lastSnapshotRealMs = Date.now();
  let streamEventId = 0;
  let wasCoarse = false;
  const recentChronicle: ChronicleEvent[] = []; // in-memory backlog sent to new viewers
  const remember = (e: ChronicleEvent) => {
    recentChronicle.push(e);
    if (recentChronicle.length > 40) recentChronicle.shift();
  };
  const persist = (): Promise<void> => {
    if (inFlight) return inFlight;
    // Freeze synchronously (before any await) so world and rng can never tear apart.
    const snap = freezeSnapshot(state.world, state.rng.serialize(), state.foundedRealMs);
    inFlight = saveSnapshot(pool, snap)
      .then(() => {
        lastSnapshotRealMs = Date.now();
      })
      .catch((err) => console.error("snapshot failed", err))
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  // --- HTTP + WS come up first (healthy independent of the write-lock) ----
  let lastTickRealMs = Date.now();
  const app = express();
  const server = createServer(app);
  const broadcaster = new Broadcaster(
    server,
    () => state.world,
    TICK_WORLD_SECONDS,
    () => recentChronicle,
  );

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      world: "MiWorld",
      live: state.live,
      seed: state.world.seed,
      epoch: state.world.epoch,
      status: state.world.status,
      worldTimeSec: Math.round(state.world.worldTimeSec),
      sol: Math.floor(state.world.worldTimeSec / MARS_SOL_SECONDS),
      tickAgeMs: state.live ? Date.now() - lastTickRealMs : null,
      viewers: broadcaster.clientCount,
      dust: Number(state.world.dust.toFixed(3)),
      buildings: state.world.buildings.length,
      colonists: state.world.colonists.filter((c) => c.alive).length,
      shortages: state.world.shortages,
      crisis: crisisLabel(state.world),
      stock: Object.fromEntries(
        GOODS.map((g) => [g, Math.round(state.world.treasury[g].amount)]),
      ),
    });
  });

  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
  } else {
    app.get("/", (_req, res) => {
      res
        .type("html")
        .send("<!doctype html><meta charset=utf-8><title>MiWorld</title><h1>MiWorld</h1>");
    });
  }

  server.listen(PORT, () => console.log(`MiWorld listening on :${PORT}`));

  // --- Shutdown (safe whether or not we ever became live) -----------------
  let shuttingDown = false;
  let lock: WorldLock | null = null;
  let heartbeat: Heartbeat | null = null;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${sig} received`);
    if (!state.live) {
      process.exit(0);
      return;
    }
    heartbeat?.stop();
    broadcaster.stop();
    if (inFlight) await inFlight.catch(() => {}); // let any in-flight periodic save settle
    // Final save with one retry. NEVER exit 0 on a failed save — the successor would load
    // an older snapshot and the world would rewind, silently, under a green exit code.
    const finalSnap = freezeSnapshot(state.world, state.rng.serialize(), state.foundedRealMs);
    let saved = false;
    for (let i = 0; i < 2 && !saved; i++) {
      try {
        await saveSnapshot(pool, finalSnap);
        saved = true;
      } catch (e) {
        console.error("final save attempt failed", e);
      }
    }
    if (lock) await lock.release();
    await closePool();
    process.exit(saved ? 0 : 1);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // --- Acquire the single-writer lock, then activate the simulation -------
  lock = await acquireWorldLock(pool, {
    onLost: () => {
      if (!shuttingDown) {
        console.error("world lock lost (db connection dropped) — exiting for a clean restart");
        process.exit(1);
      }
    },
  });
  if (shuttingDown) {
    await lock.release();
    return;
  }
  await migrate(pool);

  const now = Date.now();
  const meta = await loadWorldMeta(pool);
  if (!meta) {
    const seed = Math.floor(Math.random() * 2 ** 31);
    state.world = createWorld(seed);
    state.rng = new RngGateway(seed);
    const planet = generatePlanet(seed);
    seedColony(state.world, planet.landingSite, state.rng);
    state.foundedRealMs = now;
    await saveSnapshot(pool, freezeSnapshot(state.world, state.rng.serialize(), state.foundedRealMs));
    await insertChronicle(pool, {
      epoch: state.world.epoch,
      worldTimeSec: 0,
      category: "founding",
      priority: 10,
      title: "First landing",
      body: `${state.world.colonists.length} colonists touch down on Mars and raise the first modules.`,
      subjectRefs: [],
      cameraHint: state.world.landingSite,
    });
    console.log(`founded new world seed=${seed} crew=${state.world.colonists.length}`);
  } else {
    // Reload the authoritative snapshot now that we're the writer (it may be newer than
    // what we loaded before the lock — e.g. the retired instance's final save).
    const snap = await loadLatestSnapshot(pool);
    if (snap) {
      state.world = normalizeWorld(snap.world);
      state.rng = new RngGateway(snap.world.seed, snap.rng);
    } else {
      state.world = createWorld(meta.seed);
      state.world.epoch = meta.epoch;
      state.world.worldTimeSec = meta.worldTimeSec;
      state.world.status = meta.status as World["status"];
      state.rng = new RngGateway(meta.seed);
    }

    const plan = planBoot(
      { foundedRealMs: meta.foundedRealMs, worldTimeSec: state.world.worldTimeSec },
      now,
      CATCHUP_CAP_WORLD_SEC,
    );
    state.foundedRealMs = plan.foundedRealMs;

    // Erase the dead timeline: chronicle rows past the restored snapshot were written by
    // the previous run and will be re-derived differently by the fast-forward.
    await deleteChronicleAfter(pool, state.world.epoch, state.world.worldTimeSec);

    if (plan.startWorldTimeSec > state.world.worldTimeSec) {
      const caught: EmittedEvent[] = [];
      fastForwardTo(state.world, plan.startWorldTimeSec, state.rng, (e) => caught.push(e));
      // Persist milestones that happened during the offline gap (a fall / a new expedition) so
      // the deep history isn't silently lost to the catch-up (Fable F3). Ordinary beats stay muted.
      for (const e of caught) {
        if (e.priority < 10) continue;
        await insertChronicle(pool, {
          epoch: state.world.epoch,
          worldTimeSec: state.world.worldTimeSec,
          category: e.category as ChronicleCategory,
          priority: e.priority,
          title: e.title,
          body: e.body,
          subjectRefs: e.subjectRefs,
          cameraHint: e.cameraHint,
        });
      }
    }
    if (plan.skippedWorldSec > 0) {
      await insertChronicle(pool, {
        epoch: state.world.epoch,
        worldTimeSec: state.world.worldTimeSec,
        category: "crisis",
        priority: 6,
        title: "Records lost to a dust storm",
        body: `About ${Math.round(plan.skippedWorldSec / MARS_SOL_SECONDS)} sols passed unrecorded while the relay was down.`,
        subjectRefs: [],
        cameraHint: null,
      });
    }
    // Snapshot the recovered + fast-forwarded state at once, so a crash-loop can't keep
    // re-running the same fast-forward and duplicating events.
    await saveSnapshot(pool, freezeSnapshot(state.world, state.rng.serialize(), state.foundedRealMs));
    console.log(
      `resumed world seed=${state.world.seed} epoch=${state.world.epoch} t=${Math.round(state.world.worldTimeSec)}s`,
    );
  }

  lastSnapshotRealMs = Date.now();

  // --- The heartbeat: one authoritative tick, then broadcast to viewers ---
  const startTickIndex = Math.round(state.world.worldTimeSec / TICK_WORLD_SECONDS);
  heartbeat = new Heartbeat(state.foundedRealMs, startTickIndex, (_worldTimeSec, tickIndex) => {
    // If we've fallen far behind real time (host suspend, long GC), run coarse: advance
    // the sim but suppress per-tick broadcast + chronicle so we don't flood viewers/DB.
    const lagTicks =
      (Date.now() - deadlineForTick(state.foundedRealMs, tickIndex)) / REAL_MS_PER_TICK;
    const coarse = lagTicks > BURST_LAG_TICKS;

    const events: ChronicleEvent[] = [];
    const deltas: EntityDelta[] = [];

    const ctx: SimContext = {
      rng: state.rng,
      coarse,
      emit: (e: EmittedEvent) => {
        if (coarse && e.priority < 10) return; // suppress spam during a catch-up burst, but keep milestones (Fable F3)
        const event: ChronicleEvent = {
          id: ++streamEventId,
          epoch: state.world.epoch,
          worldTimeSec: state.world.worldTimeSec,
          category: e.category as ChronicleCategory,
          priority: e.priority,
          title: e.title,
          body: e.body,
          subjectRefs: e.subjectRefs,
          cameraHint: e.cameraHint,
        };
        events.push(event);
        remember(event);
        void insertChronicle(pool, event).catch((err) =>
          console.error("chronicle insert failed", err),
        );
      },
      patch: (id, changes) => {
        if (!coarse) deltas.push({ id, changes });
      },
    };

    stepTick(state.world, ctx);
    lastTickRealMs = Date.now();
    if (!coarse) {
      const w = state.world;
      const hud = {
        pop: w.colonists.reduce((n, c) => n + (c.alive ? 1 : 0), 0),
        dust: Number(w.dust.toFixed(3)),
        stock: Object.fromEntries(GOODS.map((g) => [g, Math.round(w.treasury[g].amount)])) as Record<
          (typeof GOODS)[number],
          number
        >,
        crisis: crisisLabel(w),
        name: w.settlementName,
      };
      broadcaster.broadcast(buildTick(w.worldTimeSec, events, coalesceDeltas(deltas), hud));
    }
    // Leaving a catch-up burst: viewers missed the suppressed deltas, so push a full
    // resync and record that the relay had lapsed.
    if (wasCoarse && !coarse) {
      broadcaster.resyncAll();
      void insertChronicle(pool, {
        epoch: state.world.epoch,
        worldTimeSec: state.world.worldTimeSec,
        category: "crisis",
        priority: 4,
        title: "The relay caught up",
        body: "Telemetry lagged for a spell; the feed has re-synced.",
        subjectRefs: [],
        cameraHint: null,
      }).catch((err) => console.error("chronicle insert failed", err));
    }
    wasCoarse = coarse;
    if (lastTickRealMs - lastSnapshotRealMs >= SNAPSHOT_INTERVAL_REAL_MS) {
      void persist();
    }
  });

  state.live = true;
  broadcaster.resyncAll(); // any viewers who connected before activation now get the real world
  heartbeat.start();
}

main().catch((err) => {
  console.error("fatal boot error", err);
  process.exit(1);
});
