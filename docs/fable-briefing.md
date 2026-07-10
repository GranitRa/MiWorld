# BRIEFING: MiWorld — a self-evolving, persistent Mars colony you watch (never build)

## 1. Role & output contract
You are exclusively a planner. Write no runnable code, run no commands, ask no
questions. Your only output is an implementation plan in the exact format of block 5.
The plan is executed by another model (Opus) that has full repo access but NOT this
conversation — the plan must be self-contained. You have no repo access; do not plan a
"read the code / analyze the repo" phase — the repo is empty greenfield (facts in
block 3 are ground truth). Where multiple approaches exist, pick ONE and justify it in
one sentence — no alternative listings. Max plan length ~150 lines.

## 2. Project context (compressed)
- Greenfield. Repo `MiWorld` is empty except a design doc (.docx) and .git. No code,
  no package.json yet. Target OS for dev: Windows 11 (PowerShell primary). Node.js is
  NOT yet installed locally (will be installed in build phase); Railway CLI 5.23.2 IS
  installed. Git user is set.
- This project ADAPTS an existing spec ("ANNALS — a living kingdom in a single file",
  summarized in block 3B) into a fundamentally different app. Reuse ANNALS's *engine
  ideas*; discard its medieval theme, its single-file/no-backend constraint, and its
  user-intervention buttons.
- Hard product identity: ONE single shared, persistent world that runs on a server
  24/7 and evolves ENTIRELY on its own. The viewer only WATCHES — there is zero
  gameplay input, no building, no god-powers. It is a living-documentary web app.

## 3A. Verified facts — resolved product decisions (ground truth, user-approved)
These are locked. Do not re-open them; plan to satisfy them.
1. PERSISTENCE: One real, always-running world persisted across restarts/deploys.
   Runs indefinitely; "~1 year" is the natural arc horizon, not a stop. World state
   survives server restarts (stored in Postgres).
2. SINGLE SHARED WORLD: exactly one world instance, same for all viewers, no login,
   no per-user worlds. One authoritative simulation process is the source of truth.
3. NO USER INTERVENTION: pure observation. None of ANNALS's "Acts" (no "unleash
   plague", no god buttons). All drama is endogenous. Viewer controls are limited to
   camera, zoom, time-speed of their OWN view (playback rate over streamed state),
   selecting things to inspect, and toggling overlays — never mutating the world.
4. HOSTING: Railway. Architecture = a long-running Node service (the sim "heartbeat"
   that ticks even when nobody watches) + Railway Postgres plugin + WebSocket for
   pushing live events/state to clients. No serverless/lazy-catchup — a genuine
   always-on tick.
5. TIME TEMPO: 1 real day ≈ 1 world week (~7x real-time). Over a real year ≈ ~7 world
   years. Content is human/seasonal-scale (daily colony life, construction, seasons,
   births, relationships), NOT centuries-of-dynasties scale.
6. SETTING: a Mars colony. Humanity lands; over time a functioning CITY builds ITSELF
   out of the landing site. This is the core pivot from ANNALS: the settlement is NOT
   generated complete at worldgen — worldgen makes only the PLANET (Mars terrain,
   resource deposits, landing site). Buildings are constructed by the colony DURING
   the simulation, building by building. Construction is a core visible process.
7. BUILDINGS: fully procedural, NO external assets (ANNALS philosophy kept). A sci-fi
   modular kit built from primitives (domes = hemispheres, habitats = cylinders with
   airlocks, greenhouses = glass tunnels with green interior glow, solar fields,
   ISRU/life-support plants, landing pads, connective tunnels). 3 build tiers:
   inflatable → 3D-printed regolith → hardened. Vertex colors + small in-code canvas
   texture atlases (windows, hazard stripes, solar grids) + shaders (mars dust,
   night emissive glow, sunrise/sunset) carry all visuals.
8. RENDERING: full real-time 3D, Three.js. Zoom-is-the-reward preserved: orbital view
   → district → single habitat → a colonist's face at the window. LOD bands.
9. PEOPLE — two-layer model (ANNALS's Crusader-Kings trick, kept):
   - Founding crew ~12–20 colonists, ALL fully individual: name, role (engineer,
     doctor, botanist, geologist, …), 2–3 personality traits, relationships.
   - Growth via Earth resupply/immigration flights AND births. Past a few hundred
     pop, a rotating cast of ~100–150 "named notables" stays fully simulated (founders,
     leaders, anyone in a current storyline); the rest become statistical POOLS that
     drive resource consumption, labor, housing demand, and background crowd density
     (visible only when zoomed into the "bubble" band). Anyone the viewer clicks has a
     name, personality, and history.
   - Target size after ~1 year: hundreds, trending toward low thousands. Tunable.
10. COLONY IS UNKILLABLE (project-critical): a single shared persistent world must
    NEVER become permanently empty, or the app is dead. Design two safety layers:
    (a) Earth as counter-balancer + a hard life-support survival floor so no single
    crisis wipes everyone; when pop/resources fall critical, resupply/rescue flights
    become more frequent; when thriving, Earth grows lax and the colony must self-rely.
    (b) Safety net: if the colony ever does collapse to zero, the WORLD does not end —
    the chronicle records "the First Colony has fallen", ruins persist as a monument,
    and after a short interval a NEW expedition lands (fresh crew, often near the old
    ruins). Viewers never see a permanently dead world — at worst a dramatic restart.
    Individuals CAN die (that stake is wanted); the colony as a whole recovers.
11. TONE: hopeful / upward-building. Crises happen, but the colony visibly thrives
    most of the time. Not a grim survival-horror.
12. NORTH STAR — "wow" emergence: colonists should not merely survive but do
    emergent, surprising, impressive things worth watching: name their settlement,
    the first Mars-born child, raising a landmark/monument, heroically weathering a
    solar-storm emergency, starting a terraforming experiment, forming little
    cultures/rituals, scientific breakthroughs, daring rescues. Make "cool emergent
    milestones" an explicit engine feature (a milestone/achievement system that fires
    named, dramatic, chronicle-worthy events), not an accident.
13. FOUR ANNALS PILLARS KEPT, reskinned:
    - Chronicle → the colony LOG / annals: a scrolling dated feed in a mission-log
      voice, every entry clickable → camera flies there.
    - Auto-director camera: cinematic AI camera that flies to the current story beat;
      a "Watch mode" that hides UI for pure documentary spectacle.
    - Inspector: click any colonist / building / vehicle → detail card.
    - Zoom is the reward: every altitude has something worth seeing.
14. STACK/STRUCTURE: a proper small repo (single-file died with the backend
    decision). Node + TypeScript backend (the authoritative sim + WS server + Postgres
    access) on Railway; a Three.js browser client served as static assets; Postgres
    for durable world state. Deterministic SEED for the PLANET (reproducible terrain);
    the colony HISTORY is authoritative mutable state in Postgres (not reproducible
    from seed alone, since it runs continuously and may reseed on collapse). One RNG
    gateway with named streams; server owns all randomness (clients are pure viewers).

## 3B. Source engine to adapt — ANNALS in brief (so you can reuse its good bones)
ANNALS is a watch-only procedurally-generated medieval kingdom. Transferable ideas:
- Deterministic seeded worldgen pipeline (terrain via fBm; we keep terrain, drop
  hydrology/biomes/forests — Mars is barren rock/craters/canyons/dust).
- Fixed-step sim clock in fractional days; systems run in a fixed order per tick;
  render decoupled — agents store path + depart/arrive times, client interpolates
  positions every frame so motion is smooth and nothing teleports.
- Two-layer population (pools + named notables) — kept (see 3A.9).
- Legible-emergence coupling: every effect traceable to a cause. ANNALS: drought →
  failed harvest → hunger → unrest → rebellion. Mars analog to design: e.g. dust
  storm → solar output down → power deficit → life-support/heat strain → O2/thermal
  crisis → deaths/evacuation/rationing → Earth rescue. Resource economy over ~6–8
  colony goods (e.g. power, oxygen, water, food, building material/regolith-print
  feedstock, spare parts, science). Local production/consumption/storage per module.
- "Every positive feedback loop ships with a predator" stability rule (growth →
  resource pressure; large stockpiles → complacency/Earth pulls back; etc.) so the
  world stays in sane bounds unattended.
- Event bus with prioritized "beats" feeding BOTH the chronicle text (template
  grammar with slots + tone variants) and the auto-director camera (shot grammar:
  wide establishing → push-in; tracking shots for rovers/landers; slow orbit for
  ceremonies). Per-category cooldowns; higher priority interrupts.
- Data model = plain objects; systems = pure-ish functions over world state called in
  tick order. Inspector cards per entity type. HUD strip + collapsible panels.
- Acceptance framed as a concrete watch-test (ANNALS: "the five-minute test").

## 4. Task & scope limits
Produce the implementation plan for MiWorld, priority-ordered. Cover, in this order:
1. ARCHITECTURE: the server (authoritative sim loop + tick cadence mapping real time
   to world time at ~7x; how it keeps ticking headless; snapshot/persist cadence to
   Postgres; crash/restart recovery so the world resumes where it left off), the
   Postgres schema sketch for durable world state, the client/server protocol
   (initial state snapshot + incremental event/delta stream over WebSocket; how a
   viewer's local time-speed works as playback over streamed authoritative state
   WITHOUT letting the client mutate the world), and repo/module layout.
2. SIMULATION SYSTEMS (Mars-reskinned), each as a system in tick order: resources &
   life-support economy; construction/city-growth; population pools + colonists
   (personality, relationships, pairing, births, death hazards); Earth resupply/
   immigration & the unkillable-colony balancer + collapse→reseed safety net;
   threats/crises (dust storm, solar storm, equipment failure, radiation, accidents);
   the milestone/"wow"-emergence system; the chronicle + auto-director event bus.
3. RENDERING/CLIENT: procedural Mars terrain, the procedural building kit + tiers,
   colonist agents, LOD bands, day/night + seasons palette, custom camera rig
   (free/follow/director) + Watch mode, HUD + inspector + chronicle panel + overlays.
4. A PHASED BUILD ROADMAP (like ANNALS's phases) where each phase ships something
   runnable and observably testable, with a concrete acceptance test per phase and a
   final "watch test" acceptance for the whole (analogous to the five-minute test but
   fit to our persistence + Mars).
Explicitly OUT of scope to plan: no auth/accounts, no per-user worlds, no user
world-mutation features, no monetization, no mobile-native, no external art assets,
no multiplayer interaction between viewers beyond all seeing the same stream.

## 5. Required plan format
For each work package:
  ## WP-<n>: <title> (priority)
  - Files: <exact intended paths in the new repo>
  - Change: <precise description; module/function/system names; data shapes,
    signatures, or pseudocode where ambiguity would otherwise remain; no full code>
  - Depends on: <WP numbers>
  - Migration needed: yes/no (Postgres schema/version implications)
  - Tests: <concrete cases, Given/When/Then, target test file or manual watch-check>
  - Acceptance: <observable behavior proving it works>
  - Risk: <what can break; what the implementer must watch — esp. determinism,
    tick/real-time drift, persistence correctness, perf at city scale in 3D>
Group WPs under the phased roadmap. End with: recommended execution order (one line)
and a list of explicit assumptions you made.

## 6. Token economy
Do not repeat or summarize this briefing back. Do not restate ANNALS. Produce only the
plan. Maximum ~150 lines.
