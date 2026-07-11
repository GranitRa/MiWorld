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
import { Hud } from "./ui/hud";
import { Chronicle } from "./ui/chronicle";
import { Inspector } from "./ui/inspector";

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
const chronicle = new Chronicle(app, (hint) => rig.focus(hint.x, hint.z, 90));

let worldTimeSec = 0;
let planet: Planet | null = null;
let buildings: BuildingLayer | null = null;
let colonists: ColonistLayer | null = null;
let lastFrameMs = performance.now();
const playback = new PlaybackBuffer();

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
      colonists = new ColonistLayer(p);
      scene.add(colonists.group);
      colonists.syncAll(initialColonists);
      new Inspector(app, camera, renderer.domElement, buildings, colonists);
      rig.setHeightSampler((x, z) => p.height(x, z));
      rig.focus(p.landingSite.x, p.landingSite.z, 60);
      hud.setStatus("● live");
    } catch (err) {
      console.error("buildWorld failed:", err);
      hud.setStatus("error: " + String(err));
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
    hud.setVitals(m.hud);
    for (const e of m.events) chronicle.add(e);
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
  worldTimeSec += (dtMs / 1000) * WORLD_SECONDS_PER_REAL_SECOND;

  rig.update();
  post.setFocusDistance(camera.position.distanceTo(rig.target));
  colonists?.update(worldTimeSec);

  const solFraction =
    (((worldTimeSec % MARS_SOL_SECONDS) + MARS_SOL_SECONDS) % MARS_SOL_SECONDS) / MARS_SOL_SECONDS;
  sky.update(solFraction);
  // Keep the shadow frustum over what the camera looks at.
  sky.sun.position.copy(rig.target).addScaledVector(sky.sunDirection, 3000);
  sky.sun.target.position.copy(rig.target);
  sky.sun.target.updateMatrixWorld();

  post.render();
  hud.setClock(worldTimeSec);
  scheduleFrame();
}
// rAF pauses in background tabs; fall back to a low-rate timer when hidden so the world still
// renders (screenshots, tab switches) without wasting GPU at full frame rate.
function scheduleFrame() {
  if (document.hidden) setTimeout(frame, 250);
  else requestAnimationFrame(frame);
}
scheduleFrame();
