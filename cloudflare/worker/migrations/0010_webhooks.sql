-- 0010_webhooks.sql — Webhook system for external service integration.
-- Fires HTTP callbacks on events like user registration, content publish,
-- and account deletion.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS webhooks (
  id         TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  events     TEXT NOT NULL,          -- JSON array: ["user.registered", "content.published"]
  secret     TEXT,                   -- HMAC secret for signature header (optional)
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS webhooks_events ON webhooks(events);
