-- 0002_analytics_daily.sql - permanent daily rollup of the raw event stream.
--
-- Telemetry efficiency contract: analytics_events rows are pruned after 30
-- days (raw analytics are disposable), while AGGREGATE STATISTICS stay. The
-- hourly cron recomputes the last two days into this table (one grouped
-- INSERT per run), so every day is fully rolled up long before its raw rows
-- age out — all-time and month-to-date event totals keep counting from the
-- rollup after pruning. Question-choice aggregates (question_choice_stats)
-- were already permanent and are unaffected.
--
-- One row per (day, event_type) — 5 event types make this a few hundred
-- bytes per day, i.e. ~150KB/year, forever. Created by `npm run
-- db:migrate:shards` on the telemetry shard; the worker also self-bootstraps
-- it (CREATE IF NOT EXISTS in SHARD_SCHEMA_SQL).

CREATE TABLE IF NOT EXISTS analytics_daily (
  day        TEXT NOT NULL,
  event_type TEXT NOT NULL,
  events     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event_type)
);
