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

## Secrets

This is a **public repository**. Never commit secrets. All credentials
(`DATABASE_URL`, `PORT`, …) come from environment variables only — Railway injects them
at runtime. Copy [`.env.example`](.env.example) to `.env` for local dev; `.env` is
gitignored.
