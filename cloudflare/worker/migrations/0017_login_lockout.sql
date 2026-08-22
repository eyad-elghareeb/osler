-- 0017_login_lockout.sql - Distributed brute-force protection.
--
-- The in-memory per-IP rate limit only bounds requests within a single
-- worker isolate, so distributed credential stuffing slips through. This
-- table tracks consecutive FAILED logins per identifier+IP pair in D1 so
-- every isolate shares one lockout state. Cleared on success; entries are
-- pruned by the hourly cron alongside the other stale-token cleanup.

CREATE TABLE IF NOT EXISTS login_failures (
  identifier TEXT NOT NULL,   -- lowercased username/email attempted
  ip         TEXT NOT NULL,
  failures   INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,       -- epoch ms; NULL while only counting
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (identifier, ip)
);
CREATE INDEX IF NOT EXISTS login_failures_locked ON login_failures(locked_until);
