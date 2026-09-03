-- 0001_schema.sql - Consolidated Osler Cloud D1 schema (single-file baseline).
--
-- This ONE file replaces the old 0001-0025 migration chain. Every table,
-- column, index, and trigger below is the exact final shape those migrations
-- converged on in production (verified against the live D1 sqlite_master),
-- with two exceptions:
--
--   * The dead WebAuthn biometric tables are gone. `biometric_credentials`
--     (old 0009) is dropped below; `biometric_sessions` was referenced by
--     removed worker code but never had a migration, so it is dropped too
--     in case any database ever created it by hand.
--   * The one-off data backfills are NOT replayed (the 0015
--     progress_documents rebuild and the 0016 FTS reindex). Databases that
--     ran the old chain already have that data; fresh databases create the
--     final shapes directly, so there is nothing to backfill.
--
-- IDEMPOTENCY (why this is safe on databases that ran the old chain):
--   * Every CREATE uses IF NOT EXISTS and there are NO ALTER TABLEs (SQLite
--     has no ADD COLUMN IF NOT EXISTS, so ALTERs would fail on existing
--     databases). On an old database every object already exists and this
--     file is a pure no-op apart from the two dead-table DROPs.
--   * D1 tracks applied migrations by filename in d1_migrations. The old
--     rows stay there untouched; this new filename applies exactly once.
--
-- GOING FORWARD the forward-only rule resumes: never edit this file, put
-- new schema changes in 0002_*.sql, 0003_*.sql, ... (see docs/deployment.md).

PRAGMA foreign_keys = ON;

-- ── Dead-feature cleanup ─────────────────────────────────────────────
-- WebAuthn biometric unlock was removed end to end (frontend + worker).
-- Drop its tables when this runs on a database that applied the old chain.

DROP TABLE IF EXISTS biometric_credentials;
DROP TABLE IF EXISTS biometric_sessions;

-- ── Identity: users, sessions, password resets ───────────────────────
-- (old 0001 + 0002 has_password + 0005 gemini_* + 0006 email_verified_at
--  + 0024 user_agent/last_seen_at folded in)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  has_password INTEGER NOT NULL DEFAULT 1,
  gemini_api_key TEXT,
  gemini_model TEXT,
  gemini_max_wait INTEGER,
  email_verified_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent TEXT,
  last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_user_active ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS sessions_user_active_v2
  ON sessions(user_id, revoked_at, expires_at, created_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS password_reset_active ON password_reset_tokens(user_id, expires_at);

-- ── Sync documents (old 0001 + 0014 compressed + 0015 rebuild folded in:
--    no kind CHECK, plus raw_bytes for the per-user storage budget) ────

CREATE TABLE IF NOT EXISTS progress_documents (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  compressed INTEGER NOT NULL DEFAULT 0,
  raw_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

-- ── Google OAuth + handoffs (old 0002) ───────────────────────────────

CREATE TABLE IF NOT EXISTS auth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_email TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS auth_identities_user ON auth_identities(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_handoffs (
  id TEXT PRIMARY KEY,
  ticket_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_handoffs_active ON auth_handoffs(ticket_hash, expires_at);

-- ── Admin: content objects + audit log ───────────────────────────────
-- (old 0003 + 0004 indexes + 0007 HMAC chain + 0008 scheduling
--  + 0013 published_r2_key + 0018 origin_r2_key + 0023 target_path)

CREATE TABLE IF NOT EXISTS content_objects (
  id            TEXT PRIMARY KEY,
  r2_key_base   TEXT NOT NULL UNIQUE,
  content_type  TEXT NOT NULL,
  title         TEXT,
  language      TEXT NOT NULL DEFAULT 'en',
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','pending','published','rejected')),
  created_by    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  submitted_at  INTEGER,
  reviewed_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   INTEGER,
  rejection_reason TEXT,
  scheduled_publish_at INTEGER,
  scheduled_unpublish_at INTEGER,
  published_r2_key TEXT,
  origin_r2_key TEXT,
  target_path TEXT
);
CREATE INDEX IF NOT EXISTS content_objects_status ON content_objects(status);
CREATE INDEX IF NOT EXISTS content_objects_user   ON content_objects(created_by);
CREATE INDEX IF NOT EXISTS content_objects_creator_status
  ON content_objects(created_by, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS content_objects_scheduled_publish
  ON content_objects(scheduled_publish_at) WHERE scheduled_publish_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_objects_scheduled_unpublish
  ON content_objects(scheduled_unpublish_at) WHERE scheduled_unpublish_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_objects_published_key
  ON content_objects(published_r2_key);
CREATE INDEX IF NOT EXISTS content_objects_origin_key
  ON content_objects(origin_r2_key);
CREATE INDEX IF NOT EXISTS content_objects_target_path ON content_objects(target_path);

CREATE TABLE IF NOT EXISTS admin_audit (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  target_id  TEXT,
  detail     TEXT,
  created_at INTEGER NOT NULL,
  prev_hash TEXT,
  row_hash TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS admin_audit_actor  ON admin_audit(actor_id);
CREATE INDEX IF NOT EXISTS admin_audit_recent ON admin_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_actor_target
  ON admin_audit(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_chain ON admin_audit(created_at DESC) WHERE row_hash != '';

-- ── Email verification (old 0006) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_verify_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_verify_active ON email_verify_tokens(token_hash, expires_at);

-- ── Webhooks (old 0010) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhooks (
  id         TEXT PRIMARY KEY,
  url        TEXT NOT NULL,
  events     TEXT NOT NULL,
  secret     TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS webhooks_events ON webhooks(events);

-- ── Full-text search (old 0011, triggers in their fixed 0016 form) ────

CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
  content_id UNINDEXED,
  title,
  body
);

CREATE TRIGGER IF NOT EXISTS content_fts_insert AFTER INSERT ON content_objects
BEGIN
  INSERT INTO content_fts (rowid, content_id, title, body)
  VALUES (NEW.rowid, NEW.id, NEW.title, '');
END;

CREATE TRIGGER IF NOT EXISTS content_fts_delete AFTER DELETE ON content_objects
BEGIN
  DELETE FROM content_fts WHERE rowid = OLD.rowid;
END;

CREATE TRIGGER IF NOT EXISTS content_fts_update AFTER UPDATE OF title ON content_objects
BEGIN
  DELETE FROM content_fts WHERE rowid = OLD.rowid;
  INSERT INTO content_fts (rowid, content_id, title, body)
  VALUES (NEW.rowid, NEW.id, NEW.title, '');
END;

-- ── Analytics events (old 0012, privacy-preserving, no PII) ───────────

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

-- ── Login lockout (old 0017, distributed brute-force protection) ──────

CREATE TABLE IF NOT EXISTS login_failures (
  identifier TEXT NOT NULL,
  ip         TEXT NOT NULL,
  failures   INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (identifier, ip)
);
CREATE INDEX IF NOT EXISTS login_failures_locked ON login_failures(locked_until);

-- ── QBank choice stats, anonymized (old 0019 + 0020) ──────────────────

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

-- ── Support tickets (old 0021, guests allowed via NULL user_id) ───────

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  reply TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS support_tickets_status_created ON support_tickets(status, created_at);
CREATE INDEX IF NOT EXISTS support_tickets_user ON support_tickets(user_id, created_at);

-- ── MCP API tokens, hashed (old 0022) ────────────────────────────────

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT 'content',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS api_tokens_user ON api_tokens(user_id, created_at);

-- ── MCP OAuth 2.1 clients + codes (old 0025) ──────────────────────────

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'content_admin',
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expiry ON mcp_oauth_codes(expires_at);

-- ── Gemini per-user key (old 0005 index; columns live in users) ───────

CREATE INDEX IF NOT EXISTS users_gemini_key_present ON users(gemini_api_key) WHERE gemini_api_key IS NOT NULL;
