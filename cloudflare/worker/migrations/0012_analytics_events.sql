-- 0012_analytics_events.sql — Privacy-preserving performance & usage analytics.
--
-- Design goals:
--   * NO personally identifiable information (PII). We never store user ids,
--     emails, IPs, full user agents, or query strings. Only the route path.
--   * One row per atomic event (page_view, web_vital, js_error, api_call,
--     route_change). Aggregations are computed at read time via SQL.
--   * Cheap to write and prune. The cron job deletes rows older than
--     ANALYTICS_RETENTION_DAYS (default 30) — see cleanupStale() in the
--     worker. On the Cloudflare free tier (D1, 5M rows read / day) this is
--     plenty for a small-to-medium medical education site.
--
-- Columns:
--   session_id   — random per-browser-session id (uuid generated client-side,
--                  rotated every ~30 min). Lets us count distinct sessions
--                  without identifying the user.
--   event_type   — page_view | web_vital | js_error | api_call | route_change
--   path         — pathname only (no query, no hash). Truncated to 255 chars.
--   metric_name  — for web_vital: LCP | INP | CLS | TTFB | FCP | FID.
--                  For api_call: the request method + path template.
--                  NULL for events that don't have a metric.
--   value        — numeric value (ms for timings, unitless for CLS).
--   detail       — small JSON blob (e.g. error message, status code).
--   browser      — short family label: chrome | firefox | safari | edge |
--                  opera | other. Derived client-side from UA hints.
--   device       — mobile | tablet | desktop | other.
--   connection   — effective connection type: 4g | 3g | 2g | slow-2g | unknown.
--   created_at   — server-side epoch millis (for timezone-correct bucketing).

PRAGMA foreign_keys = ON;

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
