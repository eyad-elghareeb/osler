-- 0003_analytics_ping.sql - allow the `ping` presence-heartbeat event type.
--
-- Telemetry-shard twin of migrations/0007_analytics_ping.sql (see it for the
-- full rationale). SQLite cannot ALTER a CHECK constraint, so the table is
-- rebuilt with data preserved. Keep byte-identical with that file and with
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
