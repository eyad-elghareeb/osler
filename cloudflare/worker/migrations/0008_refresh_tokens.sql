-- 0008_refresh_tokens.sql - long-lived opaque refresh tokens ("remember me").
--
-- Short-lived sessions (7 days) alone force anyone who doesn't open the app
-- for a week to type their password again. Instead, every sign-in now also
-- mints an opaque refresh token (1-year sliding TTL) stored on the device.
-- The client silently swaps it for a fresh session + fresh refresh token
-- (rotation) whenever the session lapses, so an active user never sees a
-- login screen again — while a stolen refresh token is single-use: whoever
-- spends it first bricks the other's copy, surfacing the theft as a login
-- prompt instead of a silent takeover.
--
-- Revocation paths (logout, revoke-others, password change, admin revoke,
-- account deletion) all clear refresh rows alongside session rows, so
-- "sign out everywhere" actually signs out everywhere.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  session_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS refresh_tokens_lookup ON refresh_tokens(token_hash, expires_at);
CREATE INDEX IF NOT EXISTS refresh_tokens_user ON refresh_tokens(user_id, revoked_at);
