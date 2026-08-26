# MiWorld

A persistent, self-evolving **Mars colony you only watch**. Humanity lands; over time a
functioning city builds itself out of the landing site. One single shared world runs on
a server 24/7 and evolves entirely on its own — there is no gameplay, no building, no
god-powers. You just watch it live and grow.

Adapted from the design doc *"ANNALS — a living kingdom in a single file"*; see
[`docs/plan.md`](docs/plan.md) for the full implementation plan and
[`docs/fable-briefing.md`](docs/fable-briefing.md) for the locked design decisions.

## Stack

- **server** — Node + TypeScript. The authoritative simulation heartbeat (ticks even
  when nobody watches), a WebSocket stream, and Postgres persistence. Hosted on Railway.
- **client** — Three.js + Vite. A pure viewer: camera, zoom, inspect, overlays. Never
  mutates the world.
- **shared** — world-state types, the wire protocol, and tunable constants.

npm workspaces tie the three together.

## Local development

```bash
npm install
npm run dev      # server on http://localhost:8080  (serves a placeholder until the client is wired up)
```

To build everything (what Railway runs):

```bash
npm run build && npm run start
```

## Proof

A green build proves nothing about a world you only watch — MiWorld can compile perfectly
and still boot to a black screen. `tools/capture.mjs` loads the running colony in a headless
Chrome, waits until the client reports a frame actually drawn with the planet in it, and
writes evidence:

```bash
npm run capture                       # proof/shot.png
npm run capture:video -- --seconds 18 # proof/proof.mp4
```

Both print a JSON verdict and exit non-zero on a page error, a worldgen failure, or a world
that never becomes ready. The verdict also carries the GPU string and the frame's mean
luminance — the colony runs a full sol, so a capture can legitimately land at Martian
midnight, and a near-black frame is flagged rather than passed off as proof. `--require-gpu`
and `--require-light` turn those warnings into failures for CI.

Defaults to `http://localhost:8080` (the Node server serving `client/dist`); pass
`--url http://localhost:5173` to shoot the Vite dev server instead. Needs Chrome or Chromium
installed (`CHROME_PATH` overrides the lookup); the video mode additionally needs `ffmpeg` on
`PATH`. Output lands in `proof/`, which is gitignored.

The capture harness is adapted from [godogen](https://github.com/htdt/godogen) (MIT).

## Secrets

This is a **public repository**. Never commit secrets. All credentials
(`DATABASE_URL`, `PORT`, …) come from environment variables only — Railway injects them
at runtime. Copy [`.env.example`](.env.example) to `.env` for local dev; `.env` is
gitignored.
