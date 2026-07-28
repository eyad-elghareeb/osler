PRAGMA foreign_keys = ON;

-- Email verification support
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;

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