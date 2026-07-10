import type pg from "pg";

// Single-writer fence. Only one server instance may own the authoritative simulation at
// a time. We hold a session-level Postgres advisory lock on a dedicated connection for
// the whole process lifetime; if the process crashes OR the connection drops, Postgres
// releases it automatically — and we watch for that drop so we never keep ticking after
// silently losing the lock (which would allow a second instance to take over → two
// writers). During a Railway rolling deploy the new instance waits here (serving
// read-only meanwhile) until the old one releases on shutdown.

const WORLD_LOCK_KEY = 0x4d69_576f; // "MiWo"
const MAX_DELAY_MS = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WorldLock {
  client: pg.PoolClient;
  release: () => Promise<void>;
}

export interface AcquireOptions {
  delayMs?: number;
  /** Called if the lock is lost unexpectedly (connection error/end) BEFORE release(). */
  onLost?: () => void;
}

/**
 * Acquire the world lock, waiting indefinitely (with backoff) until it is free — the
 * caller stays healthy serving read-only while waiting, so a slow-draining predecessor
 * never crash-loops the successor.
 */
export async function acquireWorldLock(
  pool: pg.Pool,
  opts: AcquireOptions = {},
): Promise<WorldLock> {
  const client = await pool.connect();
  let delay = opts.delayMs ?? 1000;
  let attempt = 0;

  for (;;) {
    const res = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS ok",
      [WORLD_LOCK_KEY],
    );
    if (res.rows[0]?.ok) break;
    if (attempt === 0) console.log("world lock held by another instance; waiting…");
    else if (attempt % 12 === 0) console.log("still waiting for world lock…");
    attempt++;
    await sleep(delay);
    delay = Math.min(MAX_DELAY_MS, Math.round(delay * 1.5));
  }

  let released = false;
  const onLost = () => {
    if (!released) opts.onLost?.();
  };
  // If the lock connection drops, Postgres frees the lock instantly — treat as lost.
  client.on("error", onLost);
  client.on("end", onLost);

  return {
    client,
    release: async () => {
      released = true;
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [WORLD_LOCK_KEY]);
      } catch {
        /* connection may already be gone; the lock is released regardless */
      } finally {
        client.release();
      }
    },
  };
}
