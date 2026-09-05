-- 0001_schema.sql - Osler Cloud D1 schema for the OPTIONAL telemetry shard.
--
-- Holds the highest-volume, most disposable data: analytics_events,
-- question_choice_stats, question_choice_respondents, and daily_counters
-- (the per-day write-cap counters for the telemetry flows — they are bumped
-- in the same D1 batch as the telemetry rows they guard, so they must share
-- its database). Isolating them gives the shard its own free-tier storage
-- ceiling (500 MB) and keeps telemetry churn away from auth/sync/content.
-- Created, populated (copied from the primary database), and verified by
-- `npm run db:shard` (scripts/shard-d1.mjs); without the DB_TELEMETRY
-- binding in wrangler.toml the worker keeps these tables in the primary
-- database and this file is unused.
--
-- DDL is byte-identical to the telemetry section of ../migrations/0001 plus
-- ../migrations/0002 (daily_counters) — same indexes, same retention
-- semantics, pruned by the hourly cron's telemetry batch.

CREATE TABLE IF NOT EXISTS analytics_events (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  event_type   TEXT NOT NULL CHECK (event_type IN (
    'page_view', 'web_vital', 'js_error', 'api_call', 'route_change'
  )),
  path         TEXT,
  metric_name  TEXT,
  value        REAL,
  detail       TEXT,
  browser      TEXT,
  device       TEXT,
  connection   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS analytics_events_type_time ON analytics_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_time      ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_session   ON analytics_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_path      ON analytics_events(path, created_at DESC);

CREATE TABLE IF NOT EXISTS question_choice_stats (
  uid           TEXT NOT NULL,
  qid           TEXT NOT NULL,
  choice        INTEGER NOT NULL,
  options_count INTEGER NOT NULL DEFAULT 0,
  count         INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (uid, qid, choice)
);
CREATE INDEX IF NOT EXISTS question_choice_stats_updated ON question_choice_stats(updated_at);

CREATE TABLE IF NOT EXISTS question_choice_respondents (
  aid        TEXT NOT NULL,
  uid        TEXT NOT NULL,
  qid        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (aid, uid, qid)
);
CREATE INDEX IF NOT EXISTS question_choice_respondents_created ON question_choice_respondents(created_at);

CREATE TABLE IF NOT EXISTS daily_counters (
  name TEXT NOT NULL,
  day  TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, day)
);
