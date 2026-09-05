-- 0001_schema.sql - Osler Cloud D1 schema for the OPTIONAL sync shard.
--
-- Holds exactly one table: progress_documents, the per-user sync payloads —
-- the largest user-facing data in the deployment. Isolating it gives it its
-- own free-tier storage ceiling (500 MB) so telemetry churn can never crowd
-- it out. Created, populated (copied from the primary database), and
-- verified by `npm run db:shard` (scripts/shard-d1.mjs); without the DB_SYNC
-- binding in wrangler.toml the worker keeps this table in the primary
-- database and this file is unused.
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
