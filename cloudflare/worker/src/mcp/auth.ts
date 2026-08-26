/**
 * MCP API-token authentication.
 *
 * Tokens are opaque `osler_mcp_<32 random bytes>` strings. Only the SHA-256
 * hash is stored; the plaintext is returned exactly once at mint time. A
 * token is valid while it is unrevoked, unexpired, and its owning user still
 * exists with an admin-namespace role.
 */

export const TOKEN_PREFIX = "osler_mcp_";

/** Roles allowed to authenticate against /v1/mcp (mirrors ADMIN_ROLES). */
const ADMIN_ROLES = new Set(["admin", "content_admin"]);

/** Structural subset of the worker Env that the MCP module touches. */
export interface McpEnv {
  DB: D1Database;
  CONTENT?: R2Bucket;
}

export interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

export interface TokenAuthResult {
  tokenId: string;
  userId: string;
  username: string;
  displayName: string;
  role: string;
  scope: "admin" | "content_admin";
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (let i = 0; i < arr.length; i += 0x8000) str += String.fromCharCode.apply(null, [...arr.subarray(i, i + 0x8000)]);
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256B64Url(value: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Generates a new token. Returns the plaintext once plus storage fields. */
export async function generateApiToken(): Promise<{ token: string; prefix: string; tokenHash: string }> {
  const raw = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const token = TOKEN_PREFIX + raw;
  return { token, prefix: token.slice(0, TOKEN_PREFIX.length + 6), tokenHash: await sha256B64Url(token) };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

/** Verifies a request's bearer API token and resolves its owning user. */
export async function verifyApiToken(env: McpEnv, request: Request): Promise<TokenAuthResult | null> {
  const raw = bearerToken(request);
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) return null;
  const row = await env.DB.prepare(
    "SELECT t.id AS token_id, t.scopes, t.expires_at, t.revoked_at, u.id, u.username, u.display_name, u.role" +
      " FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?"
  )
    .bind(await sha256B64Url(raw))
    .first<any>();
  if (!row) return null;
  const t = nowMs();
  if (row.revoked_at != null || (row.expires_at != null && row.expires_at < t)) return null;
  if (!ADMIN_ROLES.has(row.role)) return null;
  const scope: "admin" | "content_admin" =
    row.role === "admin" && (row.scopes === "admin" || row.scopes === "full_admin")
      ? "admin"
      : "content_admin";
  return { tokenId: row.token_id, userId: row.id, username: row.username, displayName: row.display_name, role: row.role, scope };
}

const nowMs = () => Date.now();

/** Fire-and-forget usage stamp — best-effort, never blocks the RPC response. */
export function touchToken(env: McpEnv, tokenId: string): void {
  env.DB.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?")
    .bind(nowMs(), tokenId)
    .run()
    .catch(() => {});
}
