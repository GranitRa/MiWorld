# MiWorld — build progress

Tracking against `docs/plan.md`. Built with the fable-architect loop (Opus builds,
Fable 5 plans & adversarially reviews).

## Phase 0 — architecture spine ✅ COMPLETE

| WP | Title | Status |
|----|-------|--------|
| WP-1 | Repo scaffold + shared types | ✅ done |
| WP-2 | Heartbeat + RNG + Postgres persistence | ✅ done |
| WP-3 | WS protocol + client playback | ✅ done |

**Verification:** 15 unit tests green (clock/planBoot, RNG resume, playback, protocol);
typecheck + build clean; live-tested against real Railway Postgres:
- Crash-restart (force-kill) → world resumes, advances over downtime, no rewind.
- Single-writer advisory lock → second instance waits; deadlock-free deploy (new instance
  healthy at `live:false` before it owns the lock, ticks only after takeover).
- WS: hello+tick stream works; illegal client message closed with 1008.

**Fable reviews:** round 1 → NO-GO (7 findings: torn snapshot, SIGTERM-persist skip,
no single-writer fence, catch-up burst, dead-timeline chronicle, socket hardening, +
already-handled bigint). All fixed. Round 2 → GO; 6 residuals (client resync R1/R2, lock
loss R3, acquire crash-loop R4, shutdown exit-code R5, id counter R6) — R1–R5 fixed, R6
harmless by design (chronicle has its own serial PK; stream id is never written to DB).

## Deviations from the plan (intentional)
1. Migrations are embedded TS strings (`server/src/db/migrations.ts`), not `.sql` files —
   so the esbuild single-file bundle has no runtime filesystem dependency.
2. Streamed `ChronicleEvent.id` uses an in-memory counter distinct from the Postgres
   bigserial id; scrollback reconciliation deferred to WP-8.
3. Startup is decoupled from the write-lock (serve read-only → acquire lock → activate)
   to avoid a Railway rolling-deploy deadlock. Not in the original plan; required by the
   single-writer fence.

## Infrastructure
- Railway project `miworld` (workspace "GR Diss"), Postgres plugin provisioned.
- Local dev DB via Railway public proxy (in gitignored `.env`).
- Node 24.18.0 installed locally.

## Next: Phase 1 — WP-4 (deterministic Mars worldgen + client terrain). First visible payoff.
