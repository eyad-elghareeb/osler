-- MCP API tokens: long-lived bearer credentials for AI-agent access to the
-- /v1/mcp endpoint. Tokens are stored SHA-256 hashed; the plaintext is shown
-- exactly once at creation. Each token is bound to its creating user, is
-- capped at the content-authoring surface (create/upload/validate/submit —
-- never publish/approve/delete), and can be revoked or set to expire
-- independently of interactive sessions.
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
