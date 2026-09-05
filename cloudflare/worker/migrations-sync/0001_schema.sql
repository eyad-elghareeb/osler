-- 0001_schema.sql - Osler Cloud D1 schema for the OPTIONAL sync shard pool.
--
-- Holds exactly one table: progress_documents, the per-user sync payloads.
-- The pool is PARTITIONED BY USER: every kind of a user's sync data lives in
-- exactly one of up to six identical databases (this file applies to each of
-- them), and users.sync_shard on the core database names the owner. That
-- gives the pool its own free-tier storage ceilings (6 × 500 MB ≈ 2.5 GB
-- usable) while keeping every per-user sync request a single-database
-- operation. Created, populated, and verified by `npm run db:shard`
-- (scripts/shard-d1.mjs); without the DB_SYNC_* bindings in wrangler.toml
-- the worker keeps this table in the primary database and this file is
-- unused. The worker also self-bootstraps this schema (CREATE IF NOT
-- EXISTS) — migrations remain the source of truth.
--
-- NOTE: deliberately NO FOREIGN KEY on user_id. SQLite cannot enforce a
-- reference across databases, so the FK that exists on single-database
-- deployments is dropped here; user deletion (admin user delete + account
-- delete) already removes this table's rows explicitly in code.

CREATE TABLE IF NOT EXISTS progress_documents (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  compressed INTEGER NOT NULL DEFAULT 0,
  raw_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);
