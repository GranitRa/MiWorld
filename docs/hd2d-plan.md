# MiWorld — HD-2D Rendering Pipeline Plan (Fable 5)

> Client-only rendering design for the HD-2D visual identity. Does NOT change the server,
> sim, or protocol. Slots onto the sim work packages: RWP-4→WP-6, RWP-5→WP-7,
> RWP-6/7→WP-12, RWP-8→WP-13.

## Technique decision

**Switch to true HD-2D: drop the screen-space RenderPixelatedPass; render crisp low-res
procedural pixel-art textures (NearestFilter) on 3D geometry + Y-billboarded pixel sprites,
at full native resolution, keeping bloom → tilt-shift → grade.**

Rationale: screen-space pixelation quantizes the *final image*, so every camera move
re-rasterizes the world into a new pixel grid — edges crawl and sub-pixel motion shimmers,
and it fights the texel density of any pixel-art. Authentic HD-2D (Octopath/DQ3R) puts the
"pixel" in the *assets* and keeps camera, lighting, DOF and bloom smooth — exactly right for
a slowly-orbiting living diorama. Hybrid rejected (two pixel grids beat against each other).

**post.ts changes:** remove `RenderPixelatedPass` → `RenderPass` + `SMAAPass` (AA on
geometry silhouettes; NearestFilter texels stay crisp). Keep bloom/tilt-shift/grade. Add
`PostFX.setFocusDistance(m)` for tilt-shift focus tracking. Keep `toneMapping = NoToneMapping`.

**Texel-density convention** (`client/src/render/pixelconst.ts`): terrain 4 px/m, buildings
8 px/m, colonists 24–32 px tall for ~1.7 m (sprites denser than environment — authentic).

## RWP-1: True-HD-2D post chain (P0)
- Files: `client/src/render/post.ts`, `client/src/main.ts`
- Change: RenderPass + SMAAPass replacing RenderPixelatedPass; keep bloom/tilt-shift/grade;
  add `setFocusDistance(meters)` mapping camera-space distance → tilt-shift gradient uniforms.
- Acceptance: orbiting shows zero pixel-crawl; texture pixels stay square & crisp (after 2/3).
- Risk: SMAA cost (~0.5 ms ok); "pixel look" absent until RWP-3 — sequence 2/3 right after.

## RWP-2: Procedural pixel-art asset factory (P0)
- Files: `client/src/pixelart/{palette,prng,factory,source}.ts`
- Change: fixed 32-colour Mars/colony palette as named ramps; mulberry32 PRNG seeded from
  `hash(worldSeed, assetKey)` (deterministic per asset, order-independent); `factory` draws to
  16–256 px canvases → `CanvasTexture` (NearestFilter mag, mipmap min, SRGB); primitives
  fillDither/outline/px/line/noiseSpeckle. Interface `SpriteSource { building(kind,tier),
  colonistSheet(role,sex), terrainTile(i) }` with `ProceduralSpriteSource` now and a future
  `SheetSpriteSource` (authored PNGs) swappable behind it. Memoize one texture per kind×tier.
- Acceptance: debug atlas grid; reload → pixel-identical canvases.
- Risk: determinism (no Math.random/time); mipmap greying mitigated by close-luminance ramps.

## RWP-3: Terrain pixel-art pass (P0)
- Files: `client/src/render/terrain.ts`
- Change: keep heightfield + vertex colours + flatShading as macro layer; add micro layer via
  `material.onBeforeCompile` — 3 seeded 128² regolith tiles sampled in world XZ at 4 px/m,
  tile chosen per 8×8 m cell by hash (kills tiling), `mix(1.0, texel, 0.65)`; ice discs →
  dithered pixel ice tile. Deterministic, no geometry change.
- Acceptance: 50–300 m zoom shows crisp texels glued to terrain while orbiting; far unchanged.
- Risk: far moiré handled by LinearMipmap + 0.65 mix; verify at 6500 m.

## RWP-4: Buildings renderer — WP-6 (P1)
- Files: `client/src/render/buildings.ts`, `main.ts`
- Change: 3D kit meshes with pixel-art textures (billboards rejected — buildings big, camera
  orbits, need parallax). Per-kind low-poly kit from primitives; UVs box-mapped 8 px/m into a
  per-kind×tier albedo+emissive atlas. One `InstancedMesh` per kind×tier; `BuildingLayer.sync(
  buildings)` diffs by id. Construction: per-instance `aProgress` float, `onBeforeCompile`
  discards fragments above `minY + progress*height` (rises from ground) + scaffold props while
  building; tier swaps texture+scale; per-id hash picks a baked palette variant strip via UV.
- Renders from: `Building{id,kind,tier,pos,rot,progress}`.
- Acceptance: streamed buildings appear at sites; a progress 0→1 building visibly rises with
  scaffolding; tier upgrade re-skins; ruin reads decayed.
- Risk: instanced custom-shader fragility; draws = kinds×tiers (~40); shadow cost.

## RWP-5: Colonist sprites — WP-7 (P1)
- Files: `client/src/render/colonists.ts`
- Change: one `InstancedMesh` of unit quads (1 draw call, cap 96), Y-axis billboard in vertex
  shader (upright, camera-azimuth only). Per role×sex generated sheet: 4 dirs × (2 walk + idle),
  16×24 px, packed into one 512² mega-atlas; instance attrs = UV offset, frame, tint.
  `ColonistLayer.update(dt, worldTime)` interpolates along server path by
  `(worldTime-depart)/(arrive-depart)`, clamps Y to `height(x,z)`, facing from camera-relative
  velocity, walk frame from `worldTime*stepRate`. `alphaTest:0.5` (no blend) for correct depth
  sort + fog; dither-blob contact shadow quad.
- Renders from: `Colonist{id,role,sex,alive}` + server path/depart/arrive.
- Acceptance: ≤80 upright pixel people walking smoothly, facing travel dir, crisp, no sparkle.
- Risk: facing-quantize pop → direction hysteresis; atlas packing fixed grid slots.

## RWP-6: Diorama camera + focus tracking — WP-12 support (P1)
- Files: `client/src/camera/rig.ts`, `client/src/render/post.ts`
- Change: "diorama" profile on the existing rig (free mode behind a key): polar 25°–60°,
  default band 40–1200 m (25–6500 still reachable; tilt-shift eases to 0 above ~2000 m). Each
  frame analytic ray-march `height(x,z)` at screen center → distance → `post.setFocusDistance`,
  exp-smoothed. Expose `rig.frame(targetPos, distance, seconds)` as the auto-director API.
- Acceptance: ground under screen center always sharp, fore/back blur; miniature feel holds;
  `frame()` glides to a building.
- Risk: focus breathing → clamp rate.

## RWP-7: Watch-mode LOD bubble & perf budget — WP-12 (P2)
- Files: `client/src/render/lod.ts`, hooks in buildings/colonists/main
- Change: `LodController` on focus point + zoom. Colonists spawn only within 350 m of focus AND
  zoom < 1500 m, cap 80 by distance, dither-in fade; buildings always instanced but scaffold/
  emissive updates skipped outside bubble; > 3000 m colonists off, terrain micro-mix → 0.
  Budget: ≤120 draw calls, material recompiles at startup only, textures generated once at hello.
- Acceptance: 60 fps mid laptop @ 400 buildings + 80 sprites orbiting; no hitch at bubble edge.
- Risk: edge churn → hysteresis (spawn 350 m, despawn 400 m).

## RWP-8: Day/night emissive + polish — WP-13 (P2)
- Files: buildings.ts, sky.ts (read), post.ts
- Change: `BuildingLayer.setNight(f)` from solFraction — window emissive 0→2.2 (glow-warm ramp
  exceeds bloom threshold 0.85 only at night → windows bloom, daytime regolith doesn't); per-
  building hash staggers dark windows; blinking pad beacons keyed to worldTime; grade night
  cool-shift; work-lights on advancing construction.
- Acceptance: dusk windows warm & bloom; 4× time-lapse shows the city breathing light.
- Risk: bloom threshold vs bright ice/sun glints — verify 0.85 gate.

## Recommended order
RWP-1 → 2 → 3 → 4 → 6 → 5 → 7 → 8.

## Assumptions (Fable)
1. Server streams colonist path segments (depart/arrive) + building records per
   `shared/src/types.ts`; this plan consumes them read-only.
2. three.js in repo ships SMAAPass and supports InstancedMesh custom attrs via onBeforeCompile.
3. `height(x,z)` importable client-side (already true).
4. One 512² colonist atlas covers all role×sex; building textures ≤256².
5. The placeholder lander cone is replaced by RWP-4's landing_pad.
