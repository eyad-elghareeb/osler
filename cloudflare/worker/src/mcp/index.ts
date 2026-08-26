/**
 * Osler MCP server — public barrel.
 *
 * `handleMcpRequest` is the single entry point wired into the worker's fetch
 * handler at POST /v1/mcp. Authentication is via API tokens minted from the
 * web admin panel (see auth.ts) — never interactive sessions. Token
 * management helpers are consumed by the /v1/admin/tokens routes in index.ts.
 */

import { generateApiToken, touchToken, verifyApiToken, type McpEnv } from "./auth";
import { SERVER_NAME, SERVER_VERSION } from "./instructions";
import { ERR_METHOD, ERR_PARSE, handleRpc } from "./rpc";
import { findTool, type McpCtx } from "./tools";

export { TOKEN_PREFIX } from "./auth";
export { SERVER_NAME, SERVER_VERSION };

/** Host-side helpers injected from index.ts (avoids a circular import). */
export interface McpHost {
  auditLog(env: any, actorId: string, action: string, targetId: string | null, detail: Record<string, unknown> | null): Promise<void>;
  r2Get(env: any, key: string): Promise<string | null>;
  r2Put(env: any, key: string, text: string, contentType?: string): Promise<void>;
  validateContent(contentType: string, parsed: unknown): string[];
}

const draftKey = (base: string) => `${base}/draft.json`;
const pendingKey = (base: string) => `${base}/pending.json`;

function rpcResponse(payload: unknown[] | null, origin: string): Response {
  if (!payload) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // MCP clients are non-browser agents; CORS is unnecessary but harmless.
      "access-control-allow-origin": origin || "*",
      "access-control-allow-headers": "authorization, content-type",
      "cache-control": "no-store",
    },
  });
}

function jsonError(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
}

/**
 * Handles one MCP HTTP request end-to-end:
 * bearer-token auth → JSON-RPC dispatch → tool execution → response.
 */
export async function handleMcpRequest(request: Request, env: any & McpEnv, origin: string, log: any, host: McpHost): Promise<Response> {
  const auth = await verifyApiToken(env, request);
  if (!auth) return jsonError(401, "Valid API token required (Authorization: Bearer osler_mcp_...) — mint one from the web admin panel", { "www-authenticate": "Bearer" });
  touchToken(env, auth.tokenId);

  if (request.method !== "POST") return jsonError(405, "MCP transport is POST-only (Streamable HTTP)");

  let body: unknown;
  try {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > 30_000_000) return jsonError(413, "Request body too large");
    body = await request.json();
  } catch {
    return rpcResponse([{ jsonrpc: "2.0", id: null, error: { code: ERR_PARSE, message: "Invalid JSON body" } }], origin);
  }

  const ctx: McpCtx = {
    env,
    userId: auth.userId,
    username: auth.username,
    tokenId: auth.tokenId,
    log,
    audit: (action, targetId, detail) => host.auditLog(env, auth.userId, action, targetId, detail),
    r2Get: (key) => host.r2Get(env, key),
    r2Put: (key, text, contentType) => host.r2Put(env, key, text, contentType),
    draftKey,
    pendingKey,
    validateContent: host.validateContent,
    uuid: () => crypto.randomUUID(),
  };

  log.info("mcp_request", { tokenId: auth.tokenId, username: auth.username });
  const payload = await handleRpc(ctx, body).catch((e: any) => [
    { jsonrpc: "2.0", id: null, error: { code: -32000, message: String(e?.message ?? "Internal error") } },
  ]);
  return rpcResponse(payload, origin);
}

// ─── Token administration (wired to /v1/admin/tokens in index.ts) ───────────

export interface ApiTokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
}

export async function listApiTokens(env: McpEnv, userId: string): Promise<ApiTokenView[]> {
  const rows = await env.DB.prepare(
    "SELECT id, name, prefix, created_at, last_used_at, expires_at, revoked_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(userId)
    .all<any>();
  return (rows.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at ?? null,
    expiresAt: r.expires_at ?? null,
    revokedAt: r.revoked_at ?? null,
  }));
}

/** Mints a token for the user; the plaintext is returned exactly once. */
export async function mintApiToken(env: McpEnv, userId: string, name: string, expiresInDays: number | null): Promise<{ view: ApiTokenView; token: string }> {
  const { token, prefix, tokenHash } = await generateApiToken();
  const tokenId = crypto.randomUUID();
  const t = Date.now();
  const expiresAt = expiresInDays && expiresInDays > 0 ? t + expiresInDays * 86_400_000 : null;
  await env.DB.prepare("INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'content', ?, ?)")
    .bind(tokenId, userId, name.slice(0, 80), prefix, tokenHash, t, expiresAt)
    .run();
  return {
    token,
    view: { id: tokenId, name: name.slice(0, 80), prefix, createdAt: t, lastUsedAt: null, expiresAt, revokedAt: null },
  };
}

export async function revokeApiToken(env: McpEnv, userId: string, tokenId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM api_tokens WHERE id = ? AND user_id = ?").bind(tokenId, userId).first<any>();
  if (!row) return false;
  await env.DB.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").bind(Date.now(), tokenId).run();
  return true;
}
