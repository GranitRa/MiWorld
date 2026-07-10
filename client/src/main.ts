import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { MARS_SOL_SECONDS, generatePlanet, type Planet } from "@miworld/shared";
import { Connection, defaultWsUrl } from "./net/connection";
import { PlaybackBuffer } from "./net/playback";
import { buildTerrain } from "./render/terrain";
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
function buildWorld(seed: number) {
  setStatus("forging the planet…");
  // Defer a frame so the status paints before the (brief) synchronous worldgen.
  requestAnimationFrame(() => {
    planet = generatePlanet(seed);
    scene.add(buildTerrain(planet));
    scene.add(makeLander(planet));
    rig.setHeightSampler((x, z) => planet!.height(x, z));
    rig.focus(planet.landingSite.x, planet.landingSite.z, 1200);
    setStatus("● live");
  });
}

function makeLander(p: Planet): Group {
  const g = new Group();
  const y = p.height(p.landingSite.x, p.landingSite.z);
  const pad = new Mesh(
    new CylinderGeometry(16, 18, 1.5, 20),
    new MeshStandardMaterial({ color: "#3a3a42", roughness: 0.8, metalness: 0.3 }),
  );
  pad.position.set(p.landingSite.x, y + 0.75, p.landingSite.z);
  pad.receiveShadow = true;
  const body = new Mesh(
    new ConeGeometry(6, 12, 8),
    new MeshStandardMaterial({ color: "#c7cdd6", roughness: 0.4, metalness: 0.7, emissive: "#221a10" }),
  );
  body.position.set(p.landingSite.x, y + 8, p.landingSite.z);
  body.castShadow = true;
  g.add(pad, body);
  return g;
}

// --- Network stream drives world time -----------------------------------
const conn = new Connection(defaultWsUrl(), {
  onHello: (m) => {
    worldTimeSec = m.worldTimeSec;
    if (!planet) buildWorld(m.snapshot.seed);
  },
  onTick: (m) => {
    playback.ingest(m);
    worldTimeSec = m.worldTimeSec;
  },
  onStatus: (connected) => setStatus(connected ? (planet ? "● live" : "connecting…") : "reconnecting…"),
});
conn.connect();

// --- Render loop ---------------------------------------------------------
function frame() {
  rig.update();

  const solFraction = ((worldTimeSec % MARS_SOL_SECONDS) + MARS_SOL_SECONDS) % MARS_SOL_SECONDS / MARS_SOL_SECONDS;
  sky.update(solFraction);
  // Keep the shadow frustum over what the camera looks at.
  sky.sun.position.copy(rig.target).addScaledVector(sky.sunDirection, 3000);
  sky.sun.target.position.copy(rig.target);
  sky.sun.target.updateMatrixWorld();

  post.render();
  updateClock(solFraction);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

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
