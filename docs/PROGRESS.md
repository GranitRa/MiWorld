# MiWorld — build progress

Tracking against `docs/plan.md`. Built with the fable-architect loop (Opus builds,
Fable 5 plans & adversarially reviews).

## Phase 0 — architecture spine ✅ COMPLETE

| WP | Title | Status |
|----|-------|--------|
| WP-1 | Repo scaffold + shared types | ✅ done |
| WP-2 | Heartbeat + RNG + Postgres persistence | ✅ done |
| WP-3 | WS protocol + client playback | ✅ done |

**Verification:** 15 unit tests green (clock/planBoot, RNG resume, playback, protocol);
typecheck + build clean; live-tested against real Railway Postgres:
- Crash-restart (force-kill) → world resumes, advances over downtime, no rewind.
- Single-writer advisory lock → second instance waits; deadlock-free deploy (new instance
  healthy at `live:false` before it owns the lock, ticks only after takeover).
- WS: hello+tick stream works; illegal client message closed with 1008.

**Fable reviews:** round 1 → NO-GO (7 findings: torn snapshot, SIGTERM-persist skip,
no single-writer fence, catch-up burst, dead-timeline chronicle, socket hardening, +
already-handled bigint). All fixed. Round 2 → GO; 6 residuals (client resync R1/R2, lock
loss R3, acquire crash-loop R4, shutdown exit-code R5, id counter R6) — R1–R5 fixed, R6
harmless by design (chronicle has its own serial PK; stream id is never written to DB).

## Phase 1 — a planet worth looking at 🚧

| WP | Title | Status |
|----|-------|--------|
| WP-4 | Deterministic Mars worldgen + client terrain | ✅ done |

## Phase 2 — a colony that builds itself 🚧

| WP | Title | Status |
|----|-------|--------|
| WP-5 | Resource & life-support economy | ✅ done |
| WP-6 | Construction & city growth (+ RWP-4 building render) | ✅ done |
| WP-7 | Colonists — movement, pairing, births, aging (+ RWP-5 astronauts) | ✅ done |

## Phase 3 — a world that tells its story 🚧

| WP | Title | Status |
|----|-------|--------|
| WP-8 | HUD + Chronicle + Inspector | ✅ done |

## Phase 4 — a world that endures 🚧

| WP | Title | Status |
|----|-------|--------|
| WP-9 | Earth link + unkillable colony | ✅ done (Fable max-effort → GO) |

**Fable max-effort review (2026-07-11) — WP-9.** Round 1 → **NO-GO**: Fable read the full sim
and ran its own repros, finding a **CRITICAL** my 2-tick reseed test missed — the construction
planner's soft cap counted **ruins** (kept forever as monuments), so after the *first* collapse
the reseeded colony hit the cap instantly and could never build, house, birth, or immigrate
again: recovery was cosmetic, an eternal loop of doomed 16-person expeditions (violates the
unkillable + hopeful reqs). Plus F2 (a `fallen`+`fallenSec:null` permanent soft-lock reachable
via the snapshot-loss boot rebuild) and tone/chronicle gaps (F3 milestones lost under coarse,
F4 a dead colony still building). Fixes: **F1** — cap + spiral + in-progress filter count only
*standing* structures, and construction is gated off while `status!=="alive"`; **F2** — self-heal
`fallenSec` in both the earth tick and `normalizeWorld`; **F3** — priority-10 milestones pass the
coarse gate and boot-catch-up persists them, collapse/expedition emits unconditional; **F4** —
status gate + ruin-skip; **F6** — reseed site is now a bounded, slope/spacing-checked spiral (no
off-map drift); **F7** — a rescue clears shortage pressure so it can't instantly re-trigger. New
regression test: collapse → reseed → 60 sols → asserts epoch-2 *actually* builds and grows past
16. Round 2 re-verify → **GO** (18/18 + typecheck, 10 adversarial repros incl. 12 collapses to
epoch 13 still building, byte-identical snapshot/restore through a reseed; no regressions).
Deferred (LOW, noted by Fable): F5 in-flight ships aren't mourned at collapse (mechanically safe);
boot-persisted milestones dated at gap-end; dead colonists accumulate across many epochs.

WP-9: the colony is no longer a closed box — Earth answers it, and it can never truly die.
New `earthSystem` (runs LAST in tick order, after population) plus `Flight` type and world
fields `flights[]` / `lastFlightSec` / `fallenSec`:
- **Ships in transit** — Earth launches flights that take world-weeks to arrive (`arriveSec`
  in world-time, serialized in the snapshot so a mid-transit ship survives restart). On arrival
  a ship delivers **feedstock** (fuels construction) and **immigrants** (fuel growth, `makeColonist`).
- **Earth as balancer** — a life-support shortage triggers an **emergency rescue** (fast transit,
  tops O₂/water/food back to 50% cap, brings 4 colonists if the crew is nearly gone); when the
  colony **thrives** the flights grow rarer and lighter. Immigration is gated by spare housing
  (`housingCapacity − alive ≥ 2`), so growth still couples to the settlement.
- **Unkillable** — if population ever hits zero the world does NOT end: the settlement becomes
  **ruins**, and after a short interval a **fresh expedition lands nearby**, the **epoch increments**,
  and the old ruins persist as a monument to the first colony. `reseedColony` appends a new
  starter cluster + crew (ids continue the array, never colliding) and restocks.
Verified: an `earth` unit test (ships fly + births/immigration grow the colony over 80 sols; a
forced collapse reseeds → epoch 2, ruins persist, status recovers to alive, new cluster lands).
The soak now runs the full loop **including the Earth link** across 4 seeds × 250 sols and stays
supplied and bounded (pop < 500 with immigration). 18 server tests + typecheck clean.

WP-8: protocol gained a per-tick `hud` summary (pop, dust, stockpiles) and a `chronicle`
backlog in hello (server keeps an in-memory ring of recent events). Client `ui/`:
- `hud.ts` — top-left strip: title, status, sol clock, and a vitals row (population + power/
  O₂/water/food mini-meters + dust).
- `chronicle.ts` — a scrolling colony log (seeded from hello + live tick events), each entry
  category-coloured and clickable → the camera flies to where it happened.
- `inspector.ts` — click a colonist or building (raycast, click-vs-drag aware) → a detail card:
  colonist name/role/sex/age/traits/partner, or building kind/tier/construction %.
Building/colonist meshes carry their id in `userData` + expose `getRecord`. Verified live:
HUD vitals render; clicking astronaut "Amara Frost" → "Doctor · ♀ · 42 yr · bold tough";
clicking a solar array → "Solar array · Printed · operational". (Chronicle populates during
active events — sparse in a steady-state colony, prominent in early growth / WP-10 crises /
WP-11 milestones.)

WP-7: `populationSystem` (after construction in tick order) — colonists age, walk between
modules (a walk leg pos→dest over depart/arrive sim-times, client-interpolated), pair up by
trait compatibility, have Mars-born children and (rarely, at great age) die. Births are gated
by housing capacity, so population growth **couples to the settlement**: more people → the
(Fable-hardened) planner builds more habitats → room for more people. Colonist state extended
(pos/dest/departSec/arriveSec/partner); movement/birth/death stream as `c:`-prefixed deltas.
Verified: population unit test (pairing, walking, Mars-born growth) + the soak now runs the
FULL loop (4 seeds × 250 sols) asserting population grows but stays bounded, and the colony
stays supplied — the integrated growth loop is stable.
RWP-5 (client): `render/colonists.ts` `ColonistLayer` renders each colonist as a CC0
Quaternius **astronaut (spacesuit) 3D model** (3 variants), interpolating its position from
the server walk leg each frame with a walk-bob and facing; the client advances world time
smoothly between ticks so motion is fluid. Astronauts ~2.8 m (readable at diorama zoom; a
bubble-LOD + auto-director close-ups land in WP-12). Verified rendering + walking in-browser.

WP-6: `shared/buildings.ts` (build cost/time, housing, plannable kinds). `constructionSystem`
advances in-progress builds and, when there's slack (< soft cap of 10+pop, feedstock
available, < 2 concurrent), plans the next module by need (shortage-boosted scoring), sites
it via a golden-angle spiral (low slope, spaced ≥14 m, water/O₂ plants near ice), spends
feedstock, and streams it as an id-prefixed `b:` delta (new full record, then progress
patches). Workshop now produces feedstock. Verified: unit test (builds + finishes, spaced,
capped) + live 15-sol catch-up grew the colony 12→23 buildings.
RWP-4 (client): `render/buildings.ts` `BuildingLayer` renders each building on terrain,
scaling up out of the ground by `progress`; upserts from the hello snapshot + `b:` deltas.
**Buildings now use CC0 3D models** (Quaternius Ultimate Space Kit, `client/public/models/
spacekit/*.glb`, loaded via GLTFLoader) — Granit chose authored CC0 models over the
procedural boxes; look is now clean low-poly 3D buildings on the pixel-art world. Verified
in-browser: geodesic dome, habitat pods, solar arrays, base modules, landing pad.

Two rendering-robustness bugs fixed during this: worldgen was deferred via
`requestAnimationFrame` (paused in background tabs → build stalled) → now `setTimeout`; the
render loop was pure rAF (no frames when hidden) → now a visibility-aware scheduler
(rAF when visible, low-rate `setTimeout` when hidden). Important for a "check back later"
persistent watch-app.

**Building polish:** per-function colour tint (green greenhouses, warm habitats, blue solar),
scale up (REF 7.5 m), greenhouse→house_long, workshop→base_large box (was a ring-frame
model). Planner balance fix in `constructionSystem.chooseKind`: diminishing-returns penalty
per kind stops over-building (was building 8 workshops / 9 solars chasing feedstock/power);
now a varied, legible mix. Default camera focus tightened to 220 m so a fresh load frames
the base. Verified in-browser (balanced colourful colony at noon).

WP-5: server generates the planet at founding and seeds a starter colony at the landing
site (crew of 16 + a viable module cluster). `shared/src/goods.ts` catalogs per-building
production/consumption + per-colonist life support + caps. `environmentSystem` drifts dust;
`resourcesSystem` settles in two passes — power balance → brownout ratio, then all other
producers throttle by it, so a dust storm / night cascades legibly into O₂/water/food
shortfalls (Shortage recorded on the world; onset emits a chronicle beat, power before the
goods it powers). Registered before boot so catch-up fast-forwards the economy too.
Verified: unit tests (cascade order + a colony that stays supplied over 5 sols); live
2-sol catch-up showed O₂ climbing, power breathing, dust drifting, no shortages. `/healthz`
now exposes stock/dust/counts/shortages.

**Verification:** 4 worldgen determinism tests green (same seed → identical heightfield,
landing site flat & in-bounds, craters/canyon/deposits present). Visually verified in the
browser: red Mars terrain with craters, a lit mountain spine, ice deposits, a lander at
the flat landing site, a gradient sky dome + dust fog, sol day-cycle sun, custom
orbit/pan/zoom rig with terrain collision. 19 tests total green.

**Aesthetic decision (2026-07-10):** after a low-poly pass and an HD-2D prototype, Granit
chose **HD-2D** (Dragon Quest III remake / Octopath Traveler) as the visual identity:
pixelated 3D diorama + tilt-shift miniature depth of field + bloom + warm filmic grade
(`client/src/render/post.ts`). This revises two original pillars — "seamless orbital→face
zoom" → "zoom within a diorama"; "no external assets" → "procedural pixel-art for now,
authored pixel sprites optional later". **Next:** Fable re-plans the full HD-2D rendering
pipeline (pixel-texture terrain, sprite system for colonists/buildings, diorama camera)
before WP-6/7. Fable's plan: `docs/hd2d-plan.md` (RWP-1..8).

**HD-2D rendering built so far (RWP-1→3, done):**
- RWP-1: `post.ts` switched to TRUE HD-2D — dropped screen-space RenderPixelatedPass (it
  crawled on camera motion), now RenderPass + SMAA + bloom + tilt-shift + warm grade;
  `setFocusDistance` eases tilt-shift by camera distance.
- RWP-2: procedural pixel-art factory — `client/src/pixelart/{prng,palette,factory,source}.ts`
  (deterministic per (seed, assetKey), fixed 32-colour palette, NearestFilter canvases,
  `SpriteSource` interface so authored sprites can swap in later).
- RWP-3: terrain pixel grain — two seeded regolith tiles multiplied onto the terrain via
  `onBeforeCompile`, glued to world space (crisp texels, no crawl).
- Verified in-browser: crisp pixel ground, miniature tilt-shift, smooth camera. Remaining
  RWP-4 (buildings)/5 (colonists) depend on sim WP-6/7; RWP-6 will make tilt-shift focus
  track the subject (current fixed band is a touch strong at mid zoom).

**Follow-ups noted:**
- Before WP-6 (buildings), move planet feature generation to server-authoritative (send
  craters/canyon/deposits/landingSite in the snapshot) so server building placement matches
  client terrain exactly. Worldgen is already fully engine-stable, so this is a data-flow
  change, not a determinism fix.

## Fable max-effort review (2026-07-10) — sim hardening

Ran Fable 5 at `effort: max` as an adversarial reviewer of the unreviewed sim (WP-5/WP-6). It
reimplemented the systems tick-exact and ran 20 seeds × 600 sols, finding a **CRITICAL** flaw
my short catch-up tests missed: the planner's "default habitat" filler under a frozen soft cap
drove **75% of unattended runs into permanent power brownout** — inverting the hopeful-tone
invariant. Verdict was NO-GO. Fixed:
- **#1 (critical):** `chooseKind` returns null (build nothing) when satisfied instead of filler
  habitats; solar is driven by a proactive power-margin projection (avg sun 0.318 × dust) not
  the stockpile; housing counts in-progress to avoid over-queueing.
- **#2 (high):** shortage beats use hysteresis (a per-good deficit "pressure" in sols) so normal
  nightly dips don't spam the chronicle — only sustained deficits raise one onset.
- **#3 (high):** guarded `BUILDING_ECONOMY[kind]`/`BUILD_SPEC[kind]` lookups.
- **#4 (medium):** buildings now throttle inputs AND outputs by the brownout ratio (colonists
  unthrottled) — no more water burned for nothing; shortages start to have teeth for WP-7.
- **#5:** downstream shortage bonus suppressed while power is the root cause. **#7:** siteFor
  fallback is fully checked. **#8:** seed colony given a 2nd water extractor + 5th solar.
- New **soak test** (4 seeds × 250 sols): asserts stays-supplied + not-chronically-brownout —
  the guardrail Fable recommended. Deferred (noted): #6 coarse-boundary onset, #9a/b forward
  compat (uuid ids, dynamic cap for the deaths WP).

**Fable re-verify (effort:max) → GO.** Fable read the real sources, ran the suite (15/15), and
drove the ACTUAL code through its own harness: 16 seeds × 600 sols, dust pinned 0.6, feedstock
drain, crippled start, pop ×2/×3, determinism double-run, placement audit (then cleaned up). All
7 addressed findings genuinely fixed: tail chronic-power fraction **0.000 in every run** (was
5–38%); zero beat spam (3 onsets over a forced 80-sol crisis); checked placement (min 15.3 m,
max slope 0.29); determinism intact (0 NaN over ~24M ticks); growth visible (~12 builds by
sol 35–60, plateau at softCap; pop→48 triggered 11 more builds, zero shortages = WP-7 ready).
Non-blocking follow-ups for later WPs:
- **WP-10:** at static pop the base pins exactly at softCap (26) with solar sized for dust 0.6;
  storms raising dust >0.6 could cap-block the needed extra solar → exempt/raise the cap for
  solar under an active power deficit.
- **WP-7:** gate greenhouse (and other) output by non-power input availability when food/water
  become lethal (today a dry greenhouse still makes ~1 food/crisis — negligible at static pop).

## Deviations from the plan (intentional)
1. Migrations are embedded TS strings (`server/src/db/migrations.ts`), not `.sql` files —
   so the esbuild single-file bundle has no runtime filesystem dependency.
2. Streamed `ChronicleEvent.id` uses an in-memory counter distinct from the Postgres
   bigserial id; scrollback reconciliation deferred to WP-8.
3. Startup is decoupled from the write-lock (serve read-only → acquire lock → activate)
   to avoid a Railway rolling-deploy deadlock. Not in the original plan; required by the
   single-writer fence.

## Infrastructure
- Railway project `miworld` (workspace "GR Diss"), Postgres plugin provisioned.
- Local dev DB via Railway public proxy (in gitignored `.env`).
- Node 24.18.0 installed locally.

## Next: Phase 1 — WP-4 (deterministic Mars worldgen + client terrain). First visible payoff.
