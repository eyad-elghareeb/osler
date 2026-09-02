-- MCP OAuth 2.1 — browser-based client authorization for /v1/mcp.
--
-- mcp_oauth_clients  — apps registered via dynamic client registration
--                      (RFC 7591); Claude/Cursor register themselves.
-- mcp_oauth_codes    — single-use, 10-minute authorization codes, stored
--                      SHA-256 hashed and bound to client_id + redirect_uri
--                      + PKCE S256 challenge. Claimed atomically via a
--                      conditional UPDATE ... RETURNING at token exchange.
--
-- Codes exchange for rows in api_tokens (see 0022), so OAuth-granted access
-- uses the same hashed-token format and can be listed/revoked in the admin
-- panel exactly like manually minted tokens.
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
