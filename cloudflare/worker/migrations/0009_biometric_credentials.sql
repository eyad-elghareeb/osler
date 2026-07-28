-- 0009_biometric_credentials.sql — Cloud-backed WebAuthn credentials.
-- Stores credential IDs and public keys for biometric authentication.
-- Credentials are revoked (deleted) on password change.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS biometric_credentials (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0,
  device_name   TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS biometric_credentials_user
  ON biometric_credentials(user_id);
