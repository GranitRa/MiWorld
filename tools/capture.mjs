#!/usr/bin/env node
// MiWorld capture — proof that the world actually renders, not that it compiles.
//
// Loads the running colony in a headless Chrome, waits for the client's capture probe to
// report a drawn world, and writes either a single screenshot or a short proof video.
// A clean `npm run build` says nothing about a Mars colony that boots to a black screen,
// so this is the gate that matters for a watch-only world.
//
//   node tools/capture.mjs shot  [--url U] [--out proof/shot.png]
//   node tools/capture.mjs video [--seconds 18] [--fps 30] [--out proof/proof.mp4]
//
// Common flags: --width --height --timeout (ms) --headed --require-gpu --keep-frames
// Exits non-zero on a page error, a worldgen failure, or a world that never becomes ready.

import { mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { platform } from "node:process";

const HELP = `Usage:
  node tools/capture.mjs shot  [options]
  node tools/capture.mjs video [options]

Options:
  --url <url>        page to capture            (default http://localhost:8080)
  --out <path>       output file                (default proof/shot.png | proof/proof.mp4)
  --seconds <n>      video length               (default 18)
  --fps <n>          video frame rate           (default 30)
  --width <px>       viewport width             (default 1280)
  --height <px>      viewport height            (default 720)
  --timeout <ms>     wait for a drawn world     (default 120000)
  --settle <ms>      extra wait after ready     (default 1500)
  --headed           show the browser window
  --require-gpu      fail instead of warn on a software renderer
  --require-light    fail instead of warn on a near-black (night) frame
  --keep-frames      keep the raw video frames`;

// --- args ----------------------------------------------------------------
const argv = process.argv.slice(2);
const mode = argv[0];
if (!mode || mode === "--help" || mode === "-h") {
  console.log(HELP);
  process.exit(mode ? 0 : 1);
}
if (mode !== "shot" && mode !== "video") {
  console.error(`unknown mode "${mode}"\n\n${HELP}`);
  process.exit(1);
}

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
}
const has = (name) => argv.includes(`--${name}`);

const url = flag("url", process.env.CAPTURE_URL ?? "http://localhost:8080");
const width = Number(flag("width", 1280));
const height = Number(flag("height", 720));
const timeout = Number(flag("timeout", 120_000));
const settleMs = Number(flag("settle", 1500));
const seconds = Number(flag("seconds", 18));
const fps = Number(flag("fps", 30));
const out = resolve(flag("out", mode === "shot" ? "proof/shot.png" : "proof/proof.mp4"));

function fail(message, extra) {
  console.error(JSON.stringify({ ok: false, error: message, ...extra }, null, 2));
  process.exit(1);
}

// --- browser -------------------------------------------------------------
let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  fail("playwright-core is not installed — run `npm install` at the repo root.");
}

// Headless Chrome silently falls back to a software rasteriser, which renders MiWorld's
// terrain and post-processing slowly or not at all. Ask for hardware explicitly.
const gpuArgs =
  platform === "linux"
    ? ["--use-angle=vulkan", "--use-gl=angle", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"]
    : ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"];

// playwright-core ships no browsers of its own: drive the Chrome that is already installed.
async function launch() {
  const opts = { headless: !has("headed"), args: gpuArgs };
  if (process.env.CHROME_PATH) {
    return chromium.launch({ ...opts, executablePath: process.env.CHROME_PATH });
  }
  const errors = [];
  for (const channel of ["chrome", "msedge", "chromium"]) {
    try {
      return await chromium.launch({ ...opts, channel });
    } catch (err) {
      errors.push(`${channel}: ${String(err).split("\n")[0]}`);
    }
  }
  fail(
    "no Chrome/Chromium found. Install Chrome, or set CHROME_PATH to its executable.\n  " +
      errors.join("\n  "),
  );
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

async function finish(payload) {
  await browser.close();
  console.log(JSON.stringify(payload, null, 2));
  process.exit(payload.ok ? 0 : 1);
}

try {
  await page.goto(url, { waitUntil: "load", timeout });
} catch (err) {
  await browser.close();
  fail(`could not load ${url} — is the server running? (${String(err).split("\n")[0]})`);
}

// --- wait for a world that has actually been drawn -----------------------
// The client flips `__miworld.ready` only after a frame rendered with the planet in it, so
// this can never shoot the blank pre-worldgen frame.
try {
  await page.waitForFunction(
    () => {
      const p = globalThis.__miworld;
      return Boolean(p) && (p.ready || p.error);
    },
    null,
    { timeout },
  );
} catch {
  const stale = await page.evaluate(() => globalThis.__miworld ?? null);
  await browser.close();
  fail(
    stale
      ? `world never became ready within ${timeout}ms — is the simulation server up and streaming?`
      : "capture probe missing — the client bundle is stale or main.ts failed to load.",
    { probe: stale, consoleErrors },
  );
}

let probe = await page.evaluate(() => ({ ...globalThis.__miworld }));
if (probe.error) await finish({ ok: false, error: `worldgen failed: ${probe.error}`, consoleErrors });

// The renderer string tells us whether this frame is worth trusting.
const renderer = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) return null;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
const software = /swiftshader|llvmpipe|lavapipe|software/i.test(renderer ?? "");
if (software) {
  const msg = `software renderer in use (${renderer}) — frames will be slow and may not match a real GPU`;
  if (has("require-gpu")) await finish({ ok: false, error: msg, renderer, probe });
  console.error(`warning: ${msg}`);
}

// Let the camera director settle and the dust/sky pass converge before shooting.
await page.waitForTimeout(settleMs);

await mkdir(dirname(out), { recursive: true });

// A drawn frame is not the same as a visible one: MiWorld runs a full sol, so a capture
// can legitimately land at Martian midnight and produce a near-black image that proves
// nothing. Measure it and say so, rather than shipping a black frame as evidence.
const luminance = await measureLuminance();
const dark = luminance !== null && luminance < 0.04;
if (dark) {
  const msg = `frame is nearly black (mean luminance ${luminance.toFixed(3)}) — likely Martian night; re-run later in the sol or pass --require-light in CI`;
  if (has("require-light")) await finish({ ok: false, error: msg, renderer, luminance, probe });
  console.error(`warning: ${msg}`);
}

// Screenshot, then hand the PNG back to the page to average — the WebGL backbuffer is not
// preserved, so reading it directly after a render is unreliable.
async function measureLuminance() {
  const png = (await page.screenshot()).toString("base64");
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const w = 64;
    const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    }
    return sum / (data.length / 4);
  }, png);
}

// --- shot ----------------------------------------------------------------
if (mode === "shot") {
  await page.screenshot({ path: out });
  probe = await page.evaluate(() => ({ ...globalThis.__miworld }));
  await finish({ ok: true, mode, path: out, url, renderer, software, luminance, dark, probe, consoleErrors });
}

// --- video ---------------------------------------------------------------
const frameDir = join(dirname(out), "frames");
await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });

const total = Math.max(1, Math.round(seconds * fps));
const intervalMs = 1000 / fps;
const started = Date.now();
for (let i = 0; i < total; i++) {
  await page.screenshot({ path: join(frameDir, `frame_${String(i).padStart(5, "0")}.png`) });
  // Pace against a wall-clock deadline so slow screenshots shorten the wait instead of
  // stretching the clip past the requested length.
  const left = started + (i + 1) * intervalMs - Date.now();
  if (left > 0) await page.waitForTimeout(left);
}
const captureSeconds = (Date.now() - started) / 1000;
probe = await page.evaluate(() => ({ ...globalThis.__miworld }));

const encoded = await encode(frameDir, out, fps);
if (!encoded.ok) {
  await finish({
    ok: false,
    error: encoded.error,
    frames: total,
    frameDir,
    hint: "install ffmpeg, or encode the frames in frameDir yourself",
    probe,
  });
}
if (!has("keep-frames")) await rm(frameDir, { recursive: true, force: true });

await finish({
  ok: true,
  mode,
  path: out,
  url,
  renderer,
  software,
  luminance,
  dark,
  frames: total,
  fps,
  captureSeconds: Number(captureSeconds.toFixed(1)),
  probe,
  consoleErrors,
});

// --- ffmpeg --------------------------------------------------------------
async function encode(dir, target, rate) {
  const frames = (await readdir(dir)).filter((f) => f.endsWith(".png"));
  if (frames.length === 0) return { ok: false, error: "no frames were captured" };
  if (existsSync(target)) await rm(target, { force: true });
  const args = [
    "-loglevel", "error",
    "-framerate", String(rate),
    "-i", join(dir, "frame_%05d.png"),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p", // required for playback in browsers and QuickTime
    "-movflags", "+faststart",
    target,
  ];
  return new Promise((done) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) =>
      done({
        ok: false,
        error:
          err.code === "ENOENT"
            ? "ffmpeg not found on PATH — install it to encode the proof video"
            : String(err),
      }),
    );
    proc.on("close", (code) =>
      done(code === 0 ? { ok: true } : { ok: false, error: `ffmpeg exited ${code}: ${stderr.trim()}` }),
    );
  });
}
