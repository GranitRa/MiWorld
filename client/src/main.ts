import {
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import {
  MARS_SOL_SECONDS,
  WORLD_SECONDS_PER_REAL_SECOND,
  generatePlanet,
  type Building,
  type Colonist,
  type Planet,
} from "@miworld/shared";
import { Connection, defaultWsUrl } from "./net/connection";
import { PlaybackBuffer } from "./net/playback";
import { ProceduralSpriteSource } from "./pixelart/source";
import { buildTerrain } from "./render/terrain";
import { BuildingLayer } from "./render/buildings";
import { ColonistLayer } from "./render/colonists";
import { Sky } from "./render/sky";
import { PostFX } from "./render/post";
import { CameraRig } from "./camera/rig";
import { Director } from "./camera/director";
import { LodController } from "./render/lod";
import { Hud } from "./ui/hud";
import { Chronicle } from "./ui/chronicle";
import { Inspector } from "./ui/inspector";
import { WatchMode } from "./ui/watchMode";
import { Overlays } from "./ui/overlays";

// --- DOM / renderer -------------------------------------------------------
const app = document.getElementById("app")!;
Object.assign(app.style, { position: "fixed", inset: "0", margin: "0" });
const hud = new Hud(app);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.outputColorSpace = SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
const rig = new CameraRig(camera, renderer.domElement);
const sky = new Sky(scene);
const post = new PostFX(renderer, scene, camera);
const director = new Director(rig);
const lod = new LodController();
// Manual camera input hands control back to the viewer (and pauses the director).
rig.onManual = () => director.yieldToManual();
const watchMode = new WatchMode(app, (on) => {
  if (on) director.enable();
  else director.disable();
  overlays?.setHidden(on); // Watch mode hides the diagnostic overlays too
});
const chronicle = new Chronicle(app, (hint) => {
  watchMode.set(false);
  director.disable();
  rig.focus(hint.x, hint.z, 90);
});

let worldTimeSec = 0;
let planet: Planet | null = null;
let buildings: BuildingLayer | null = null;
let colonists: ColonistLayer | null = null;
let overlays: Overlays | null = null;
let dust = 0.12; // latest atmospheric dust (drives storm darkening + fog)
let pop = 0; // latest population (scales the night-city glow)
let lastFrameMs = performance.now();
const playback = new PlaybackBuffer();

// --- Capture probe -------------------------------------------------------
// A headless browser can only prove the world renders if it knows when to look. Expose a
// small status object: `ready` flips once the world exists AND a frame has been drawn with
// it, so a screenshot taken on that signal can never be the blank pre-worldgen frame.
// `error` carries a worldgen failure so capture fails loudly instead of shooting black.
// Diagnostics only — nothing in the app reads this back.
interface CaptureProbe {
  ready: boolean;
  error: string | null;
  frames: number;
  worldTimeSec: number;
  pop: number;
}
const probe: CaptureProbe = { ready: false, error: null, frames: 0, worldTimeSec: 0, pop: 0 };
(globalThis as unknown as { __miworld: CaptureProbe }).__miworld = probe;
let worldBuilt = false;

function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();

// --- Build the world once, from the seed --------------------------------
function buildWorld(seed: number, initialBuildings: Building[], initialColonists: Colonist[]) {
  hud.setStatus("forging the planet…");
  // Defer via setTimeout (not rAF) so worldgen still runs when the tab is hidden — rAF is
  // paused for background tabs, which would otherwise stall the whole build.
  setTimeout(() => {
    try {
      const p = generatePlanet(seed);
      planet = p;
      const source = new ProceduralSpriteSource(seed);
      scene.add(buildTerrain(p, source));
      buildings = new BuildingLayer(p);
      scene.add(buildings.group);
      buildings.syncAll(initialBuildings);
      director.setColonyCenter(buildings.center() ?? p.landingSite);
      colonists = new ColonistLayer(p);
      scene.add(colonists.group);
      colonists.syncAll(initialColonists);
      new Inspector(app, camera, renderer.domElement, buildings, colonists);
      overlays = new Overlays(scene, app, buildings, colonists, () => p.landingSite, (x, z) => p.height(x, z));
      rig.setHeightSampler((x, z) => p.height(x, z));
      rig.focus(p.landingSite.x, p.landingSite.z, 60);
      hud.setStatus("● live");
      worldBuilt = true;
    } catch (err) {
      console.error("buildWorld failed:", err);
      hud.setStatus("error: " + String(err));
      probe.error = String(err);
    }
  }, 0);
}

// --- Network stream --------------------------------------------------------
const conn = new Connection(defaultWsUrl(), {
  onHello: (m) => {
    worldTimeSec = m.worldTimeSec;
    chronicle.seed(m.chronicle);
    if (!planet) buildWorld(m.snapshot.seed, m.snapshot.buildings, m.snapshot.colonists);
  },
  onTick: (m) => {
    playback.ingest(m);
    worldTimeSec = m.worldTimeSec; // snap to authoritative time (frame loop advances between ticks)
    dust = m.hud.dust;
    pop = m.hud.pop;
    hud.setVitals(m.hud);
    for (const e of m.events) {
      chronicle.add(e);
      director.push(e);
      if (e.cameraHint) watchMode.setCaption(e);
    }
    if (buildings) director.setColonyCenter(buildings.center() ?? planet!.landingSite);
    for (const d of m.deltas) {
      if (d.id.startsWith("b:")) buildings?.applyDelta(d.id.slice(2), d.changes);
      else if (d.id.startsWith("c:")) colonists?.applyDelta(d.id.slice(2), d.changes);
    }
  },
  onStatus: (connected) =>
    hud.setStatus(connected ? (planet ? "● live" : "connecting…") : "reconnecting…"),
});
conn.connect();

// --- Render loop ---------------------------------------------------------
function frame() {
  // Advance world time smoothly between server ticks (snapped to authoritative time on each
  // tick) so colonists walk and the sun moves fluidly instead of stepping every ~8.5 s.
  const nowMs = performance.now();
  const dtMs = Math.min(250, nowMs - lastFrameMs);
  lastFrameMs = nowMs;
  const dtSec = dtMs / 1000;
  worldTimeSec += dtSec * WORLD_SECONDS_PER_REAL_SECOND;

  director.update(dtSec); // sets the rig's goal pose; the rig smooths toward it
  rig.update(dtSec);
  post.setFocusDistance(rig.focusDistance);
  // Bubble LOD: only draw + interpolate colonists when the camera is close enough to see them.
  const inBubble = lod.update(rig.focusDistance, colonists?.group ?? null);
  // Keep colonist positions fresh inside the bubble, or when the people overlay needs them.
  if (inBubble || overlays?.peopleActive) colonists?.update(worldTimeSec);
  overlays?.update(dtSec);

  const solFraction =
    (((worldTimeSec % MARS_SOL_SECONDS) + MARS_SOL_SECONDS) % MARS_SOL_SECONDS) / MARS_SOL_SECONDS;
  sky.update(solFraction, dust);
  // The settlement glows warmly after dark, brighter as the colony grows.
  buildings?.setNightGlow(sky.nightFactor * Math.min(1, 0.35 + pop / 80));
  // Keep the shadow frustum over what the camera looks at.
  sky.sun.position.copy(rig.target).addScaledVector(sky.sunDirection, 3000);
  sky.sun.target.position.copy(rig.target);
  sky.sun.target.updateMatrixWorld();

  post.render();
  hud.setClock(worldTimeSec);

  probe.frames++;
  probe.worldTimeSec = worldTimeSec;
  probe.pop = pop;
  if (worldBuilt) probe.ready = true;
  scheduleFrame();
}
// rAF pauses in background tabs; fall back to a low-rate timer when hidden so the world still
// renders (screenshots, tab switches) without wasting GPU at full frame rate.
function scheduleFrame() {
  if (document.hidden) setTimeout(frame, 250);
  else requestAnimationFrame(frame);
}
scheduleFrame();
