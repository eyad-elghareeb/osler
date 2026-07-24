-- 0005_gemini_key.sql — Persist per-user Gemini API key so users only enter it once.
--
-- The key is stored encrypted-at-rest conceptually (D1 is encrypted at rest by
-- Cloudflare), but the value itself is plaintext in the DB — anyone with DB
-- access can read it. This is a UX improvement, not a security boundary. The
-- Worker proxies Gemini calls so the key is never exposed to the browser
-- network tab. Set GEMINI_ENCRYPTION_KEY env var to enable HMAC-based field
-- protection (see worker index.mjs).

PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN gemini_api_key TEXT;
ALTER TABLE users ADD COLUMN gemini_model   TEXT;
ALTER TABLE users ADD COLUMN gemini_max_wait INTEGER;

CREATE INDEX IF NOT EXISTS users_gemini_key_present ON users(gemini_api_key) WHERE gemini_api_key IS NOT NULL;
