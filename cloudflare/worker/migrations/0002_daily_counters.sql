-- 0002_daily_counters.sql - per-day write counters for the telemetry quota guards.
--
-- Replaces the per-request COUNT(*) scans that backed the analytics and
-- choice-stats daily write caps. Those scans read up to 30 days of event
-- rows per check — at ~1000-MAU scale that alone threatens D1's 5M
-- rows-read/day free-tier budget. The guard check is now a 1-row point read
-- on today's counter (cached 60s per isolate), and each ingest bumps the
-- day's counter inside the same D1 batch that writes its rows.
--
-- One row per (counter, day); the maintenance cron prunes rows older than
-- 90 days. Safe on fresh installs (wrangler d1 migrations apply) and on
-- existing databases alike — CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS daily_counters (
  name TEXT NOT NULL,
  day  TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, day)
);
