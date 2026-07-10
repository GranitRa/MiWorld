# MiWorld — Implementation Plan (Fable 5, Phase 2 of fable-architect)

> Adapts the ANNALS concept into a persistent, single, shared, self-evolving Mars
> colony you only watch. See `docs/fable-briefing.md` for the locked decisions.

## Phase 0 — Skeleton that ticks and survives (deploy first, world later)

### WP-1: Repo scaffold + shared types (P0)
- Files: `package.json` (npm workspaces), `tsconfig.base.json`, `server/package.json`, `server/tsconfig.json`, `client/package.json`, `client/vite.config.ts`, `shared/src/types.ts`, `shared/src/protocol.ts`, `shared/src/constants.ts`, `.gitignore`, `railway.json`
- Change: npm workspaces `server`/`client`/`shared` (chosen over pnpm: zero extra installs on a fresh Windows box). Server = Node20+TS (tsx dev, tsc build), Express serves `client/dist` in prod + `ws` on same port (`process.env.PORT`). `shared` holds all world-state interfaces (`World`, `Colonist`, `Building`, `ResourceLedger`, `ChronicleEvent`), protocol message unions, and tempo constants: `WORLD_SECONDS_PER_REAL_SECOND = 7`, `TICK_WORLD_SECONDS = 60` (one tick = 1 world-minute, fired every ~8.571 real s).
- Depends on: —
- Migration needed: no
- Tests: `npm run build` at root builds all three; `server/test/protocol.test.ts` (vitest): protocol messages round-trip JSON with type narrowing.
- Acceptance: `npm run dev` serves a page saying "MiWorld" locally; `railway up` deploys the same.
- Risk: Windows path/script quirks — use cross-platform npm scripts only, no shell-specific syntax.

### WP-2: Heartbeat loop + RNG gateway + Postgres persistence (P0)
- Files: `server/src/sim/clock.ts`, `server/src/sim/rng.ts`, `server/src/sim/engine.ts`, `server/src/db/pool.ts`, `server/src/db/migrate.ts`, `server/src/db/migrations/001_init.sql`, `server/src/db/persistence.ts`, `server/src/index.ts`
- Change: `clock.ts`: drift-free scheduler — computes each tick's absolute wall-clock deadline from `epochStartedAt` (never `setInterval` accumulation); tick handler receives `worldTimeSec` (monotonic). `rng.ts`: mulberry32 gateway `rng(streamName)` with named streams; per-stream call counters serialized into snapshots so history randomness resumes exactly; `planet` stream derives purely from world seed. `engine.ts`: `tick(world)` runs registered systems in fixed order (array populated in later WPs). Schema 001: `world_meta(id=1, seed, epoch, world_time_sec, status, updated_at)`, `snapshots(id, epoch, world_time_sec, state jsonb, created_at)` (keep last 20), `chronicle(id bigserial, epoch, world_time_sec, category, priority, title, body, subject_refs jsonb, camera_hint jsonb)`. Persistence: full-state JSONB snapshot every 120 real s and on SIGTERM; chronicle rows inserted immediately. Recovery on boot: load latest snapshot, compute wall-clock gap, fast-forward in coarse catch-up mode (systems run at world-hour granularity, event bus muted except milestones) until world time re-anchors to `now`, then resume normal ticking.
- Depends on: WP-1
- Migration needed: yes (001)
- Tests: `server/test/clock.test.ts`: 1000 simulated ticks show zero cumulative drift vs mocked wall clock. `server/test/persistence.test.ts`: Given snapshot at T / When boot at T+30min real / Then world time ≈ T+3.5h world and RNG stream counters match a never-restarted run's counts. `rng.test.ts`: same seed+stream → identical sequence.
- Acceptance: kill/restart the Railway service; world time in `/healthz` JSON resumes with no gap or jump-back.
- Risk: THE core risk of the project — snapshot atomicity (write new row then prune, never update in place), long catch-up after multi-day downtime (cap catch-up work per boot at ~30 world-days, log the skip in chronicle as "records lost in a dust storm").

### WP-3: WS protocol — snapshot + delta stream, client playback buffer (P0)
- Files: `server/src/net/wsServer.ts`, `server/src/net/serializer.ts`, `client/src/net/connection.ts`, `client/src/net/playback.ts`
- Change: On connect server sends `{type:'hello', snapshot, worldTimeSec, tickWorldSeconds}`; thereafter one `{type:'tick', worldTimeSec, events[], deltas[]}` batch per tick (deltas = changed entities only, id-keyed patches). Inbound whitelist is exactly `{type:'ping'}` — anything else disconnects; the server never reads client input into sim state. `playback.ts`: ring buffer of last ~10 real-minutes of tick batches; local speed 0×/1×/4× + rewind operate purely on this buffer; playing past the head clamps to LIVE. Reconnect = fresh hello (buffer reset).
- Depends on: WP-2
- Migration needed: no
- Tests: `client/test/playback.test.ts`: Given 100 buffered ticks / When speed 4× / Then playback head reaches live and clamps; pause holds world view frozen while buffer grows.
- Acceptance: two browsers show the identical world time and identical event feed; pausing one browser never affects the other or the server.
- Risk: unbounded delta size at city scale — serializer must diff per-entity dirty flags, not deep-compare the whole world each tick.

## Phase 1 — A planet worth looking at

### WP-4: Deterministic Mars worldgen + client terrain (P1)
- Files: `shared/src/worldgen/planet.ts`, `shared/src/worldgen/fbm.ts`, `client/src/render/terrain.ts`, `client/src/render/sky.ts`, `client/src/render/palette.ts`, `client/src/camera/rig.ts`, `client/src/main.ts`
- Change: Worldgen lives in `shared` so client regenerates terrain locally from the seed (server sends only seed — no mesh over the wire). fBm heightfield ~8×8 km play area, crater stamping, one canyon carve, resource deposit map (regolith quality, water-ice, metals) via masked noise; picks `landingSite` (flat, near ice). Client: chunked heightmap mesh, vertex-colored ochre/rust palette + slope-based rock tint, dust-haze fog shader, simple sun with sol cycle (sun angle driven by `worldTimeSec`). Camera rig: orbit + free-fly with altitude-eased speeds (orbital→surface).
- Depends on: WP-3
- Migration needed: no
- Tests: `shared/test/planet.test.ts`: same seed → byte-identical heightfield hash on two runs; landing site slope < threshold and within N m of an ice deposit.
- Acceptance: open the site, see Mars with craters/canyon, sun rises and sets on a ~24.6h world-sol schedule, zoom orbital→ground smoothly at 60fps.
- Risk: seed determinism across server/client requires identical float ops — use integer-hash noise (no `Math.sin` tricks); chunk LOD needed early or ground-level fps dies.

## Phase 2 — A colony that builds itself

### WP-5: Resource & life-support economy (P1)
- Files: `server/src/sim/systems/environment.ts`, `server/src/sim/systems/resources.ts`, `shared/src/goods.ts`
- Change: First two systems in tick order. `environment`: sol cycle, season index, dust-opacity field (slow noise walk; storms come in WP-10). `resources`: 7 goods — power, oxygen, water, food, feedstock (regolith print material), spares, science. Per-building `Producer/Consumer/Store` components; hourly settle pass: production (solar scaled by sun+dust, ISRU, greenhouse) vs consumption (colonists + building upkeep) → stockpiles; deficits emit typed `Shortage` pressure objects consumed by later systems (never direct kills — legible causality chain). Hard survival floor: emergency reserves cache that only WP-9's rescue logic can breach.
- Depends on: WP-2
- Migration needed: no (lives in snapshot blob)
- Tests: `resources.test.ts`: Given dust opacity 0.8 for 3 sols / Then power stockpile falls, `Shortage(power)` emitted before oxygen production drops (cause precedes effect in event order).
- Acceptance: HUD strip (WP-8) shows stockpiles breathing on a daily cycle: solar surplus at noon, battery draw at night.
- Risk: economy tuning explosions — clamp all stocks to [0,cap], unit-test steady-state at pop 20/200/2000 stays bounded for 100 simulated sols.

### WP-6: Construction & city growth + procedural building kit (P1)
- Files: `server/src/sim/systems/construction.ts`, `shared/src/buildings/catalog.ts`, `shared/src/buildings/layout.ts`, `client/src/render/buildings/kit.ts`, `client/src/render/buildings/atlas.ts`
- Change: Catalog: landing pad, habitat (cylinder+airlock), dome, greenhouse (glass tunnel, green emissive interior), solar field, ISRU plant, water extractor, workshop, tunnel connector; each with tier (inflatable→printed→hardened), cost (feedstock+spares+labor), capacity effects. Planner (runs world-daily): scores needs (housing, power, food, O2 margins) → picks next project → sites it via `layout.ts` (grows outward from pad along tunnel graph, respects slope/deposits). Construction progresses per tick with assigned worker labor; buildings render mid-construction (scaffold ring, printer gantry sweep, % height) — construction is the show. Client kit: primitives + vertex colors + in-code canvas atlas (windows, hazard stripes, solar cells), night emissive windows; deterministic geometry from building record (server sends records, never meshes).
- Depends on: WP-4, WP-5
- Migration needed: no
- Tests: `construction.test.ts`: Given housing at 95% capacity / Then next planned project is a habitat; site is reachable via tunnel graph. Manual watch-check: a habitat visibly rises over ~2 real hours.
- Acceptance: from bare landing site, 8–10 structures self-build in the first real day, connected by tunnels, greenhouses glowing green at night.
- Risk: planner oscillation (build/starve loops) — hysteresis margins on every trigger; geometry determinism client-side (same record → same mesh).

### WP-7: Colonists — pools + notables, lifecycle (P1)
- Files: `server/src/sim/systems/population.ts`, `server/src/sim/people/names.ts`, `server/src/sim/people/notables.ts`, `client/src/render/agents.ts`
- Change: Founding crew 16, fully individual (name, role, 2–3 traits from a 12-trait list, relationship graph with valence). Two layers per 3A.9: notables cap 130 (founders pinned; promotion score = storyline involvement + leadership + viewer-click "hydration": clicking a pool person mints a persistent notable on the spot); pools per district drive labor/consumption/housing/crowd-density stats. Lifecycle: pairing (trait compatibility + proximity), pregnancies/births (first Mars-born child flagged for WP-11), aging, hazard-based deaths (fed by Shortage/crisis pressures, never RNG-only — every death names its cause). Movement: server assigns `path + departTime + arriveTime` on activity change; client interpolates — smooth motion, no teleporting; agents visible only in near LOD bands.
- Depends on: WP-5, WP-6
- Migration needed: no
- Tests: `population.test.ts`: Given `Shortage(oxygen)` sustained 2 sols / Then deaths occur with cause `hypoxia`, notables die last (drama budget); demote/promote keeps notable count ≤130 while preserving anyone referenced by an active storyline.
- Acceptance: click any walking figure → they have a name, role, traits, current task, and a personal history card.
- Risk: pool↔notable accounting leaks (pop double-count) — single `totalPopulation()` assertion after every tick in dev mode.

## Phase 3 — A world that tells its story

### WP-8: Event bus, chronicle, HUD + inspector (P1)
- Files: `server/src/sim/events/bus.ts`, `server/src/sim/events/grammar.ts`, `client/src/ui/hud.ts`, `client/src/ui/chronicle.ts`, `client/src/ui/inspector.ts`
- Change: Bus: systems emit `Beat{category, priority, subjects, cameraHint}`; per-category cooldowns; grammar = template strings with slots + tone variants (mission-log voice: "Sol 214 — The printer crews topped out Habitat 4 before the cold set in."), rendered server-side into chronicle rows (WP-2 table) and streamed in tick batches. Client: scrolling dated feed, click → camera flies to `cameraHint`; HUD strip (pop, power, O2, water, food margins, sol/date); inspector cards for colonist/building/vehicle (typed renderers over entity records).
- Depends on: WP-3, WP-7
- Migration needed: no (table exists from 001)
- Tests: `grammar.test.ts`: every template renders with no unfilled slots for all category payload shapes; cooldown suppresses duplicate beats within window.
- Acceptance: new viewer scrolls back through days of history (paged from Postgres), clicks an entry, camera flies there.
- Risk: chronicle spam — priority budget of ~1 beat per few world-hours except crises; scrollback pagination must hit DB, not RAM.

## Phase 4 — Stakes, drama, and the unkillable colony

### WP-9: Earth link — resupply, immigration, balancer, collapse→reseed (P0 for launch)
- Files: `server/src/sim/systems/earth.ts`, `server/src/sim/systems/reseed.ts`, `server/src/db/migrations/002_epochs.sql`
- Change: `earth.ts`: launch-window scheduler (ships take world-weeks in transit — visible landing events); manifest chosen by colony deficit report; immigration sized to housing surplus. Balancer = ANNALS predator rule: prosperity index high → flight cadence and generosity drop ("Earth grows lax"); pop/resources below critical → emergency rescue cadence + survival-floor release. `reseed.ts`: if pop hits 0 → status `fallen`, chronicle epic ("the First Colony has fallen"), buildings frozen as ruins (tier `ruin` render: dust-drifted, dark), after 3–7 world-days a new expedition lands near the ruins with fresh crew; `epoch` increments (002 adds `epochs(id, founded_at, fell_at, cause)`; chronicle rows already carry epoch). Ruins persist as monuments in the new epoch.
- Depends on: WP-5, WP-7, WP-8
- Migration needed: yes (002)
- Tests: `earth.test.ts`: Given pop 4 and food 2 sols / Then next flight is rescue-class within the emergency window. `reseed.test.ts`: Given forced total loss / Then world never reports `dead`, epoch 2 lands within bounds, old buildings remain with `ruin` flag, chronicle spans both epochs.
- Acceptance: dev console force-collapse → within minutes of watching, ruins + a new lander + "Second Expedition" chronicle arc.
- Risk: balancer over-correcting into rescue-flight spam (rate-limit + hysteresis); epoch transition must not orphan chronicle camera refs to dead entities.

### WP-10: Threats & crises (P1)
- Files: `server/src/sim/systems/crises.ts`
- Change: Crisis catalog as data: dust storm (multi-sol, region-wide solar loss), solar storm (radiation — shelter-in-place behavior, EVA deaths possible), equipment failure (per-building MTBF vs spares stock), depressurization accident, drill/EVA accidents. Each crisis is a state machine (warning → onset → peak → recovery) emitting beats at every stage so the causal chain is watchable (storm forecast → panels dim → rationing → resolution). Severity budget: global "drama thermostat" caps concurrent crises and guarantees calm stretches (tone rule 3A.11); crises pressure the survival floor but only WP-9 decides deaths-vs-rescue at the brink.
- Depends on: WP-5, WP-7, WP-9
- Migration needed: no
- Tests: `crises.test.ts`: full dust-storm lifecycle emits ≥4 ordered beats; two max-severity crises never overlap; 200-sol soak run ends with pop > 0.8× start (hopeful-tone invariant).
- Acceptance: over one real day of watching, at least one legible crisis arc plays out and resolves without wiping the colony.
- Risk: tuning — the soak test is the guardrail; run it in CI with 3 seeds.

### WP-11: Milestone / "wow" engine (P1)
- Files: `server/src/sim/systems/milestones.ts`, `shared/src/milestones/catalog.ts`
- Change: Explicit condition-watcher system (last before bus flush): ~20 authored milestone templates with trigger predicates over world state — settlement naming ceremony (pop>25 & first dome: notables "vote", name generated from founder culture), first Mars-born child, monument construction (prosperity surplus diverts feedstock to a landmark obelisk/arch — special building type), heroic save (crisis resolved with a notable's action → named in chronicle), terraforming experiment (science threshold → visible test dome with lichen glow), first 100 sols, festival rituals (recurring, culture flavor accumulates per epoch). Each fires a max-priority beat + a permanent `milestones` chronicle category + often spawns a physical artifact (plaque, monument) so history is visible in the world.
- Depends on: WP-6, WP-7, WP-8, WP-10
- Migration needed: no
- Tests: `milestones.test.ts`: each predicate fires exactly once per epoch under a fabricated qualifying state; naming ceremony produces a persisted settlement name used by grammar thereafter.
- Acceptance: within the first 2 real days of a fresh world, the settlement names itself and the event reads like a story beat, not a stat change.
- Risk: milestones feeling canned — every template needs ≥3 tone variants and slots filled from actual sim actors.

## Phase 5 — The documentary lens

### WP-12: Auto-director camera + Watch mode + LOD bands (P1)
- Files: `client/src/camera/director.ts`, `client/src/camera/shots.ts`, `client/src/render/lod.ts`, `client/src/ui/watchMode.ts`
- Change: Director consumes the beat stream (priority queue, per-category cooldowns mirrored client-side): shot grammar — wide establishing → push-in for construction/milestones, tracking for rovers/landers, slow orbit for ceremonies, handheld-ish jitter for crises; higher priority interrupts with a cut. Watch mode: hides all UI, letterboxes, chronicle line as lower-third caption. LOD bands: orbital (imposters/merged district meshes, crowd density as dust-light shimmer), district (full buildings, no agents), street (agents + interiors through windows), face (nearest colonist detail, name tag). Free/follow/director modes on one rig; any manual input exits director.
- Depends on: WP-4, WP-6, WP-7, WP-8
- Migration needed: no
- Tests: manual: leave Watch mode running 15 min — camera never clips terrain, never stares at nothing for >30s, crisis interrupts a ceremony shot.
- Acceptance: Watch mode is screensaver-grade — a non-user can watch 10 minutes and narrate what's happening in the colony.
- Risk: perf at city scale — instanced meshes for buildings/agents mandatory; frustum+band culling; target 60fps at 300 buildings/150 agents on midrange laptop.

### WP-13: Day/night + seasonal palette, overlays, polish (P2)
- Files: `client/src/render/lighting.ts`, `client/src/ui/overlays.ts`, `client/src/render/dust.ts`
- Change: Sunrise/sunset key-color ramps (Mars-correct: blue-tinted sunsets), seasonal dust/frost palette shifts (southern-winter CO2 frost sparkle), storm darkening tied to dust-opacity field; emissive night city glow scaling with population. Overlays (toggle, read-only): power grid, O2 network, construction queue, population heatmap — colored line/tint layers over existing meshes.
- Depends on: WP-12
- Migration needed: no
- Tests: manual: time-lapse one sol at 4× buffer speed — dawn/noon/dusk/night read as distinct moods; each overlay toggles cleanly.
- Acceptance: night orbital view shows a glowing city that grew since yesterday.
- Risk: shader cost stacking — one uber-material for buildings with feature flags, not per-effect materials.

## WP-14: Launch hardening + the Watch Test (P0 for launch)
- Files: `server/src/healthz.ts`, `.github/workflows/ci.yml`, `server/test/soak.test.ts`, `README.md`
- Change: `/healthz` (tick age, world time, DB ok — Railway healthcheck), CI runs all tests + 200-sol soak on 3 seeds, snapshot-restore drill script, WS reconnect/backoff on client, chronicle retention policy (keep all — it IS the product), Railway deploy config finalized (restart policy, Postgres plugin envs).
- Depends on: all
- Migration needed: no
- Tests: soak: 200 sols × 3 seeds → pop bounded (never 0 without a reseed record, never >5000), no NaN in any stockpile, snapshot→restore→resume mid-soak produces identical next-tick state hash.
- Acceptance — THE WATCH TEST (final): deploy to Railway; Day 1: watch 10 min — see construction in progress, a chronicle entry fire, click a colonist, fly orbital→face smoothly. Then close the tab for 48 hours. Day 3: reopen — the colony has visibly grown (new buildings, higher pop, new chronicle pages you can scroll back through), world time advanced ~2 world-weeks, and within 10 minutes of Watch mode something story-worthy happens. Redeploy the service mid-viewing: viewers reconnect and the world has not lost a minute.
- Risk: the 48-hour unattended stretch is where drift, leaks, and tuning failures surface — memory profile the tick loop; alert if tick age exceeds 3× cadence.

## Recommended execution order
WP-1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14.

## Explicit assumptions (Fable)
1. Tick = 60 world-seconds every ~8.571 real-seconds; hourly/daily systems run on world-time boundaries within the tick loop.
2. Whole-world state fits comfortably in one JSONB snapshot (≤ ~10 MB at low-thousands pop); chronicle is the only row-per-record table.
3. Restart catch-up fast-forwards the sim (capped at 30 world-days) — acceptable as it is recovery, not lazy-idle serving; the process otherwise ticks 24/7.
4. Client rewind window is RAM-only (~10 real-minutes); deep history is chronicle text, not state replay.
5. Founding crew 16; notable cap 130; 7 goods; 8×8 km terrain — all tunable constants in `shared/src/constants.ts`.
6. Worldgen code shared client/server with integer-hash noise guarantees identical terrain from seed alone; only the seed crosses the wire.
7. Node 20 LTS installed during build phase; Railway provides `DATABASE_URL` and `PORT`; single service + Postgres plugin, no Redis.
