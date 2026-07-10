import pg from "pg";

// Single shared connection pool. DATABASE_URL comes from the environment only
// (Railway injects it in prod; local dev reads it from the gitignored .env). Railway's
// public proxy needs TLS but presents a self-signed chain, so relax verification only
// for that managed endpoint.
let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const needsSsl = /proxy\.rlwy\.net|\brailway\b/.test(connectionString);
  pool = new pg.Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
