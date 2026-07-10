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

// --- DOM / renderer -------------------------------------------------------
const app = document.getElementById("app")!;
app.innerHTML = `
  <div id="hud">
    <div id="title">MiWorld</div>
    <div id="status">connecting…</div>
    <div id="clock"></div>
    <div id="hint">drag to orbit · shift-drag to pan · scroll to zoom</div>
  </div>
`;
Object.assign(app.style, { position: "fixed", inset: "0", margin: "0" });
injectHudStyles();

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
  setStatus("forging the planet…");
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
      rig.setHeightSampler((x, z) => p.height(x, z));
      rig.focus(p.landingSite.x, p.landingSite.z, 60);
      setStatus("● live");
    } catch (err) {
      console.error("buildWorld failed:", err);
      setStatus("error: " + String(err));
    }
  }, 0);
}

// --- Network stream drives world time -----------------------------------
const conn = new Connection(defaultWsUrl(), {
  onHello: (m) => {
    worldTimeSec = m.worldTimeSec;
    if (!planet) buildWorld(m.snapshot.seed, m.snapshot.buildings, m.snapshot.colonists);
  },
  onTick: (m) => {
    playback.ingest(m);
    worldTimeSec = m.worldTimeSec; // snap to authoritative time (frame loop advances between ticks)
    for (const d of m.deltas) {
      if (d.id.startsWith("b:")) buildings?.applyDelta(d.id.slice(2), d.changes);
      else if (d.id.startsWith("c:")) colonists?.applyDelta(d.id.slice(2), d.changes);
    }
  },
  onStatus: (connected) => setStatus(connected ? (planet ? "● live" : "connecting…") : "reconnecting…"),
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

  const solFraction = ((worldTimeSec % MARS_SOL_SECONDS) + MARS_SOL_SECONDS) % MARS_SOL_SECONDS / MARS_SOL_SECONDS;
  sky.update(solFraction);
  // Keep the shadow frustum over what the camera looks at.
  sky.sun.position.copy(rig.target).addScaledVector(sky.sunDirection, 3000);
  sky.sun.target.position.copy(rig.target);
  sky.sun.target.updateMatrixWorld();

  post.render();
  updateClock(solFraction);
  scheduleFrame();
}
// rAF pauses in background tabs; fall back to a low-rate timer when hidden so the world
// still renders (screenshots, tab switches) without wasting GPU at full frame rate.
function scheduleFrame() {
  if (document.hidden) setTimeout(frame, 250);
  else requestAnimationFrame(frame);
}
scheduleFrame();

// --- HUD helpers ---------------------------------------------------------
function setStatus(text: string) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}
function updateClock(solFraction: number) {
  const el = document.getElementById("clock");
  if (!el) return;
  const sol = Math.floor(worldTimeSec / MARS_SOL_SECONDS);
  const hh = String(Math.floor(solFraction * 24)).padStart(2, "0");
  const mm = String(Math.floor(((solFraction * 24) % 1) * 60)).padStart(2, "0");
  el.textContent = `Sol ${sol} · ${hh}:${mm}`;
}

function injectHudStyles() {
  const s = document.createElement("style");
  s.textContent = `
    #app { background:#0b0a0e; overflow:hidden; }
    canvas { display:block; }
    #hud { position:absolute; top:16px; left:18px; color:#e9dcc3;
      font-family: ui-sans-serif, system-ui, sans-serif; text-shadow:0 1px 3px rgba(0,0,0,.6);
      pointer-events:none; user-select:none; }
    #title { font-size:20px; letter-spacing:.14em; font-weight:600; }
    #status { font-size:13px; opacity:.85; margin-top:2px; }
    #clock { font-size:15px; font-variant-numeric:tabular-nums; margin-top:6px; }
    #hint { position:fixed; bottom:14px; left:18px; font-size:12px; opacity:.5;
      color:#e9dcc3; font-family: ui-sans-serif, system-ui, sans-serif; pointer-events:none; }
  `;
  document.head.appendChild(s);
}
