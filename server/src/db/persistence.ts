import type pg from "pg";
import { SNAPSHOT_KEEP, type ChronicleEvent, type World } from "@miworld/shared";

export interface WorldMetaRow {
  seed: number;
  epoch: number;
  worldTimeSec: number;
  foundedRealMs: number;
  status: string;
}

export interface LoadedState {
  world: World;
  rng: Record<string, number>;
}

interface SnapshotBlob {
  world: World;
  rng: Record<string, number>;
}

/**
 * A frozen snapshot to write. `stateJson` MUST be produced synchronously by the caller
 * (before any await) so the persisted world and RNG are captured at the exact same
 * instant — otherwise a tick firing mid-save could tear world@T+n against rng@T.
 */
export interface SnapshotWrite {
  seed: number;
  epoch: number;
  worldTimeSec: number;
  foundedRealMs: number;
  status: string;
  stateJson: string;
}

export async function loadWorldMeta(pool: pg.Pool): Promise<WorldMetaRow | null> {
  const res = await pool.query(
    "SELECT seed, epoch, world_time_sec, founded_real_ms, status FROM world_meta WHERE id = 1",
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    seed: Number(row.seed),
    epoch: Number(row.epoch),
    worldTimeSec: Number(row.world_time_sec),
    foundedRealMs: Number(row.founded_real_ms),
    status: String(row.status),
  };
}

export async function loadLatestSnapshot(pool: pg.Pool): Promise<LoadedState | null> {
  const res = await pool.query<{ state: SnapshotBlob }>(
    "SELECT state FROM snapshots ORDER BY id DESC LIMIT 1",
  );
  const row = res.rows[0];
  if (!row) return null;
  return { world: row.state.world, rng: row.state.rng };
}

/**
 * Persist the world atomically: append a new snapshot row (never update in place),
 * upsert the meta pointer, then prune old snapshots — all in one transaction so a crash
 * mid-write can never leave meta pointing at a missing snapshot.
 */
export async function saveSnapshot(pool: pg.Pool, snap: SnapshotWrite): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO snapshots (epoch, world_time_sec, state) VALUES ($1, $2, $3::jsonb)",
      [snap.epoch, snap.worldTimeSec, snap.stateJson],
    );
    await client.query(
      `INSERT INTO world_meta (id, seed, epoch, world_time_sec, founded_real_ms, status, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO UPDATE SET
         seed = EXCLUDED.seed,
         epoch = EXCLUDED.epoch,
         world_time_sec = EXCLUDED.world_time_sec,
         founded_real_ms = EXCLUDED.founded_real_ms,
         status = EXCLUDED.status,
         updated_at = now()`,
      [snap.seed, snap.epoch, snap.worldTimeSec, snap.foundedRealMs, snap.status],
    );
    await client.query(
      "DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT $1)",
      [SNAPSHOT_KEEP],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Serialize a world + rng snapshot synchronously (no await), so nothing can tear it. */
export function freezeSnapshot(
  world: World,
  rng: Record<string, number>,
  foundedRealMs: number,
): SnapshotWrite {
  const blob: SnapshotBlob = { world, rng };
  return {
    seed: world.seed,
    epoch: world.epoch,
    worldTimeSec: world.worldTimeSec,
    foundedRealMs,
    status: world.status,
    stateJson: JSON.stringify(blob),
  };
}

/**
 * Delete chronicle rows strictly AFTER a given world time (for the current epoch). Used
 * on crash recovery to erase the "dead timeline" — events that live ticks wrote past the
 * last snapshot but which the coarse fast-forward will re-derive differently.
 */
export async function deleteChronicleAfter(
  pool: pg.Pool,
  epoch: number,
  worldTimeSec: number,
): Promise<void> {
  await pool.query(
    "DELETE FROM chronicle WHERE epoch = $1 AND world_time_sec > $2",
    [epoch, worldTimeSec],
  );
}

export async function insertChronicle(
  pool: pg.Pool,
  event: Omit<ChronicleEvent, "id">,
): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO chronicle (epoch, world_time_sec, category, priority, title, body, subject_refs, camera_hint)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      event.epoch,
      event.worldTimeSec,
      event.category,
      event.priority,
      event.title,
      event.body,
      JSON.stringify(event.subjectRefs),
      event.cameraHint ? JSON.stringify(event.cameraHint) : null,
    ],
  );
  return Number(res.rows[0]!.id);
}
