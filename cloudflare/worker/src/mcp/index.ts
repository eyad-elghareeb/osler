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
import { ERR_PARSE, handleRpc, MAX_BODY_BYTES } from "./rpc";
import type { McpCtx } from "./tools";

export { TOKEN_PREFIX } from "./auth";
export { SERVER_NAME, SERVER_VERSION };

/** Host-side helpers injected from index.ts (avoids a circular import). */
export interface McpHost {
  auditLog(env: any, actorId: string, action: string, targetId: string | null, detail: Record<string, unknown> | null): Promise<void>;
  r2Get(env: any, key: string): Promise<string | null>;
  r2Put(env: any, key: string, text: string | Uint8Array, contentType?: string): Promise<void>;
  r2Delete?(env: any, key: string): Promise<void>;
  validateContent(contentType: string, parsed: unknown): string[];
  publishObject?(env: any, objectId: string, reviewerId: string, targetPath?: string | null): Promise<{ ok: boolean; hybridKeys: string[] }>;
  unpublishObject?(env: any, objectId: string, actorId: string): Promise<{ ok: boolean }>;
  deleteObject?(env: any, objectId: string, actorId: string): Promise<{ ok: boolean }>;
  updateManifestIncremental?(env: any, category: string, touchedPaths?: string[]): Promise<any>;
  getConfig?(env: any): Promise<any>;
  putConfig?(env: any, config: any): Promise<void>;
  /** Read-only observability hooks for the MCP context tools. */
  readContentVersion?(env: any): Promise<string | null>;
  getAuditTrail?(env: any, opts: { page?: number; limit?: number; action?: string }): Promise<{ items: any[]; total: number }>;
  /**
   * Registers a promise to keep running after the Response is returned
   * (`ExecutionContext.waitUntil`). When absent, best-effort background work
   * (e.g. the token usage stamp) is left un-awaited as before — correct but
   * not guaranteed to finish under load.
   */
  waitUntil?(promise: Promise<unknown>): void;
  /**
   * Per-token rate limit, checked once a request is authenticated. Returns
   * false when the token has exceeded its budget. This is in addition to
   * (not a replacement for) the host's own per-IP gate: the IP gate protects
   * the endpoint from pre-auth abuse, while this protects the shared IP
   * budget from a single noisy or compromised token, and protects a single
   * token from being starved by unrelated traffic on the same IP.
   */
  rateLimitToken?(tokenId: string): boolean;
}

const draftKey = (base: string) => `${base}/draft.json`;
const pendingKey = (base: string) => `${base}/pending.json`;
const publishedKey = (base: string) => `${base}/published.json`;

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
 * Reads a request body up to `maxBytes`, rejecting the request as soon as
 * that many bytes have been seen rather than trusting the `Content-Length`
 * header. A header-only check can be bypassed by a request that omits
 * Content-Length (e.g. chunked transfer-encoding) or simply lies about it —
 * either way `request.json()` would still buffer the whole body in memory
 * before any check ran. Streaming the cap instead bounds worst-case memory
 * and CPU regardless of what the client claims.
 */
async function readLimitedBody(request: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, text: "" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false };
      }
      chunks.push(value);
    }
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(buf) };
}

/**
 * Handles one MCP HTTP request end-to-end:
 * method check → bearer-token auth → JSON-RPC dispatch → tool execution → response.
 */
export async function handleMcpRequest(request: Request, env: any & McpEnv, origin: string, log: any, host: McpHost): Promise<Response> {
  // Cheap check first: avoids a D1 round-trip (the auth lookup below) for
  // wrong-method scans/bots hitting this public path, which is the common
  // case for unsolicited traffic against it.
  if (request.method !== "POST") return jsonError(405, "MCP transport is POST-only (Streamable HTTP)");

  const auth = await verifyApiToken(env, request);
  if (!auth) {
    // RFC 9728 resource-metadata pointer so OAuth-capable MCP clients
    // (Claude, Cursor, …) auto-discover the authorization flow instead of
    // surfacing a bare 401 to the user.
    const resourceMetadata = `${new URL(request.url).origin}/.well-known/oauth-protected-resource`;
    return jsonError(401, "Valid API token required (Authorization: Bearer osler_mcp_...) — mint one from the web admin panel, or connect via OAuth", {
      "www-authenticate": `Bearer resource_metadata="${resourceMetadata}"`,
    });
  }

  if (host.rateLimitToken && !host.rateLimitToken(auth.tokenId)) {
    return jsonError(429, "Too many MCP requests for this token — slow down, or mint a second token to run parallel workloads");
  }

  const touchPromise = touchToken(env, auth.tokenId);
  if (host.waitUntil) host.waitUntil(touchPromise);

  const bodyRead = await readLimitedBody(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return jsonError(413, "Request body too large");

  let body: unknown;
  try {
    body = bodyRead.text ? JSON.parse(bodyRead.text) : {};
  } catch {
    return rpcResponse([{ jsonrpc: "2.0", id: null, error: { code: ERR_PARSE, message: "Invalid JSON body" } }], origin);
  }

  const ctx: McpCtx = {
    env,
    userId: auth.userId,
    username: auth.username,
    tokenId: auth.tokenId,
    scope: auth.scope,
    log,
    audit: (action, targetId, detail) => host.auditLog(env, auth.userId, action, targetId, detail),
    r2Get: (key) => host.r2Get(env, key),
    r2Put: (key, text, contentType) => host.r2Put(env, key, text, contentType),
    r2Delete: (key) => (host.r2Delete ? host.r2Delete(env, key) : env.CONTENT?.delete(key) ?? Promise.resolve()),
    draftKey,
    pendingKey,
    publishedKey,
    validateContent: host.validateContent,
    publishObject: host.publishObject ? (objectId, targetPath) => host.publishObject!(env, objectId, auth.userId, targetPath) : undefined,
    unpublishObject: host.unpublishObject ? (objectId) => host.unpublishObject!(env, objectId, auth.userId) : undefined,
    deleteObject: host.deleteObject ? (objectId) => host.deleteObject!(env, objectId, auth.userId) : undefined,
    updateManifestIncremental: host.updateManifestIncremental ? (category, paths) => host.updateManifestIncremental!(env, category, paths) : undefined,
    getConfig: host.getConfig ? () => host.getConfig!(env) : undefined,
    putConfig: host.putConfig ? (cfg) => host.putConfig!(env, cfg) : undefined,
    readContentVersion: host.readContentVersion ? () => host.readContentVersion!(env) : undefined,
    getAuditTrail: host.getAuditTrail ? (opts) => host.getAuditTrail!(env, opts) : undefined,
    uuid: () => crypto.randomUUID(),
  };

  log.info("mcp_request", { tokenId: auth.tokenId, username: auth.username, scope: auth.scope });
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
  scope: "admin" | "content_admin";
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
}

export async function listApiTokens(env: McpEnv, userId: string): Promise<ApiTokenView[]> {
  const rows = await env.DB.prepare(
    "SELECT id, name, prefix, scopes, created_at, last_used_at, expires_at, revoked_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(userId)
    .all<any>();
  return (rows.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scope: (r.scopes === "admin" || r.scopes === "full_admin" ? "admin" : "content_admin") as "admin" | "content_admin",
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at ?? null,
    expiresAt: r.expires_at ?? null,
    revokedAt: r.revoked_at ?? null,
  }));
}

/** Mints a token for the user; the plaintext is returned exactly once. */
export async function mintApiToken(
  env: McpEnv,
  userId: string,
  userRole: string,
  name: string,
  expiresInDays: number | null,
  requestedScope: string = "content_admin"
): Promise<{ view: ApiTokenView; token: string }> {
  const { token, prefix, tokenHash } = await generateApiToken();
  const tokenId = crypto.randomUUID();
  const t = Date.now();
  const expiresAt = expiresInDays && expiresInDays > 0 ? t + expiresInDays * 86_400_000 : null;
  // If user is not super admin, they can ONLY mint content_admin tokens.
  const scope: "admin" | "content_admin" =
    userRole === "admin" && (requestedScope === "admin" || requestedScope === "full_admin")
      ? "admin"
      : "content_admin";

  await env.DB.prepare("INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(tokenId, userId, name.slice(0, 80), prefix, tokenHash, scope, t, expiresAt)
    .run();
  return {
    token,
    view: { id: tokenId, name: name.slice(0, 80), prefix, scope, createdAt: t, lastUsedAt: null, expiresAt, revokedAt: null },
  };
}

export async function revokeApiToken(env: McpEnv, userId: string, tokenId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM api_tokens WHERE id = ? AND user_id = ?").bind(tokenId, userId).first<any>();
  if (!row) return false;
  await env.DB.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").bind(Date.now(), tokenId).run();
  return true;
}
