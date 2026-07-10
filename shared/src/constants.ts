// Central tunable constants. Everything the sim balances hangs off these.

// --- Time tempo -----------------------------------------------------------
// Product decision: 1 real day ≈ 1 world week  →  world runs at 7× real time.
export const WORLD_SECONDS_PER_REAL_SECOND = 7;

// One simulation tick advances this many world-seconds (1 world-minute).
export const TICK_WORLD_SECONDS = 60;

// Real time between ticks, derived so tempo stays exact: 60 / 7 ≈ 8.571 s.
export const REAL_MS_PER_TICK =
  (TICK_WORLD_SECONDS / WORLD_SECONDS_PER_REAL_SECOND) * 1000;

// A Martian sol is 24h 39m 35s. World days are counted in sols.
export const MARS_SOL_SECONDS = 88775;

// --- Persistence / recovery ----------------------------------------------
// Full-state snapshot cadence (real time) and how many snapshots to retain.
export const SNAPSHOT_INTERVAL_REAL_MS = 120_000;
export const SNAPSHOT_KEEP = 20;

// On boot the world fast-forwards to re-anchor to real "now" (downtime is caught
// up). Cap the catch-up so a multi-day outage can't stall boot; the skipped span is
// logged to the chronicle ("records lost in a dust storm").
export const CATCHUP_CAP_WORLD_SEC = 30 * MARS_SOL_SECONDS;

// If the heartbeat falls more than this many ticks behind real time (host suspend, long
// GC), it runs those ticks in coarse mode — advancing the sim but suppressing per-tick
// broadcast + chronicle spam — until it re-anchors to now.
export const BURST_LAG_TICKS = 10;

// --- Client playback ------------------------------------------------------
// How much recent live history the client keeps in RAM for local pause/rewind/4x.
// Deep history is the chronicle (Postgres), not state replay.
export const PLAYBACK_WINDOW_REAL_MS = 600_000; // ~10 real minutes

// --- World / terrain ------------------------------------------------------
export const TERRAIN_SIZE_METERS = 8000; // 8 km × 8 km playable area

// --- Population -----------------------------------------------------------
export const FOUNDING_CREW = 16;
export const NOTABLE_CAP = 130;

// --- Economy --------------------------------------------------------------
export const GOODS = [
  "power",
  "oxygen",
  "water",
  "food",
  "feedstock", // regolith-print building material
  "spares",
  "science",
] as const;
export type Good = (typeof GOODS)[number];
