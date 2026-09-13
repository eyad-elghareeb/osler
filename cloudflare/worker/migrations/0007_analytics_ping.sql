-- 0007_analytics_ping.sql - allow the `ping` presence-heartbeat event type.
--
-- The "visitors now" tile counts distinct session_ids with an event in the
-- last 5 minutes, but clients only flush when they have buffered real events
-- (page views, route changes, sampled API calls). A tab left open on an
-- article emits nothing for minutes at a time, so idle-but-present readers
-- vanished from the live count while the hourly curves still showed them.
-- Clients now send a cheap `ping` (no path, no metric, session id only) at
-- most every 2 minutes while visible and otherwise idle, which keeps the
-- live count truthful. Volume aggregates (overview totals, all-time rollup,
-- top pages) explicitly exclude pings; session/distinct counts include them.
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt. Data is
-- preserved (INSERT ... SELECT * — column order is unchanged). Safe to
-- re-apply (IF NOT EXISTS everywhere; the rebuild is idempotent because a
-- second run rebuilds the already-correct table into itself).
-- Keep byte-identical with migrations-telemetry/0003_analytics_ping.sql and
-- the SHARD_SCHEMA_SQL bootstrap in src/index.ts.

CREATE TABLE IF NOT EXISTS analytics_events_new (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  event_type   TEXT NOT NULL CHECK (event_type IN (
    'page_view', 'web_vital', 'js_error', 'api_call', 'route_change', 'ping'
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
INSERT OR IGNORE INTO analytics_events_new SELECT * FROM analytics_events;
DROP TABLE IF EXISTS analytics_events;
ALTER TABLE analytics_events_new RENAME TO analytics_events;
CREATE INDEX IF NOT EXISTS analytics_events_type_time ON analytics_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_time      ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_session   ON analytics_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_path      ON analytics_events(path, created_at DESC);
