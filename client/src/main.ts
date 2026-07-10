import { MARS_SOL_SECONDS } from "@miworld/shared";
import { Connection, defaultWsUrl } from "./net/connection";
import { PlaybackBuffer } from "./net/playback";

// WP-3 client: connect to the authoritative stream and show live world time + status.
// The 3D world, camera rig, HUD and chronicle arrive in later WPs; the PlaybackBuffer is
// already wired so pause/rewind/4x work as soon as there is something to render.
const app = document.getElementById("app")!;
app.innerHTML = `
  <div>
    <h1>MiWorld</h1>
    <p id="status" style="opacity:0.6">connecting…</p>
    <p id="clock" style="font-variant-numeric:tabular-nums"></p>
  </div>
`;
const statusEl = document.getElementById("status")!;
const clockEl = document.getElementById("clock")!;

const fmt = (sec: number) =>
  `Sol ${Math.floor(sec / MARS_SOL_SECONDS)} · ${Math.round(sec).toLocaleString()} s world-time`;

const playback = new PlaybackBuffer();
const conn = new Connection(defaultWsUrl(), {
  onHello: (m) => {
    clockEl.textContent = fmt(m.worldTimeSec);
  },
  onTick: (m) => {
    playback.ingest(m);
    clockEl.textContent = fmt(m.worldTimeSec);
  },
  onStatus: (connected) => {
    statusEl.textContent = connected ? "● live" : "reconnecting…";
  },
});
conn.connect();
