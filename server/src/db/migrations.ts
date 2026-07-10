// Migrations are embedded as strings (not .sql files) so the esbuild single-file bundle
// has no runtime filesystem dependency. Each runs once, tracked in _migrations.

export interface Migration {
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    name: "001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS world_meta (
        id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        seed            bigint      NOT NULL,
        epoch           integer     NOT NULL,
        world_time_sec  double precision NOT NULL,
        founded_real_ms bigint      NOT NULL,
        status          text        NOT NULL,
        updated_at      timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id              bigserial PRIMARY KEY,
        epoch           integer     NOT NULL,
        world_time_sec  double precision NOT NULL,
        state           jsonb       NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS chronicle (
        id              bigserial PRIMARY KEY,
        epoch           integer     NOT NULL,
        world_time_sec  double precision NOT NULL,
        category        text        NOT NULL,
        priority        integer     NOT NULL,
        title           text        NOT NULL,
        body            text        NOT NULL,
        subject_refs    jsonb       NOT NULL DEFAULT '[]'::jsonb,
        camera_hint     jsonb,
        created_at      timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS chronicle_time_idx ON chronicle (epoch, world_time_sec);
    `,
  },
];
