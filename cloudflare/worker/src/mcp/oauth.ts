/**
 * MCP OAuth 2.1 — browser-based authorization for MCP clients.
 *
 * Lets an admin connect Claude (web/desktop), Cursor, or any spec-compliant
 * MCP client by pasting the server URL: the client discovers this server's
 * OAuth metadata, registers itself dynamically, and opens a browser window
 * where the admin approves access with their normal Osler session — no
 * hand-minted tokens required. Manual tokens (mcp/auth.ts) remain supported.
 *
 * Implemented surface (all on the worker origin):
 *   GET  /.well-known/oauth-protected-resource   RFC 9728 resource metadata
 *   GET  /.well-known/oauth-authorization-server RFC 8414 server metadata
 *   POST /v1/mcp/oauth/register                  RFC 7591 dynamic registration
 *   GET  /v1/mcp/oauth/authorize                 validates params → consent page
 *   POST /v1/mcp/oauth/authorize                 web session approves → mint code
 *   POST /v1/mcp/oauth/token                     code + PKCE → api_tokens bearer
 *
 * Design decisions:
 *  - Authorization codes are stored SHA-256 hashed, single-use (atomic
 *    conditional UPDATE), 10-minute TTL, and bound to client_id + redirect_uri
 *    + PKCE challenge (S256 only — the MCP spec forbids `plain`).
 *  - Codes exchange for rows in the SAME api_tokens table manual tokens use,
 *    so OAuth-granted access shows up (and is revocable) in the existing
 *    admin panel list. Scope is always content_admin: OAuth never grants the
 *    unrestricted admin tier.
 *  - The consent step reuses the SPA's normal session auth on the Pages
 *    origin: GET authorize redirects there with the original params; the
 *    consent page POSTs them back with the admin's bearer token. Nothing
 *    sensitive travels through the browser — only client_id, redirect_uri,
 *    state, and the PKCE challenge (public by design).
 */

import type { McpEnv } from "./auth";

const CODE_TTL_MS = 10 * 60 * 1000;

export interface McpOAuthEnv extends McpEnv {
  /** Pages-site origin the consent page lives on. */
  ALLOWED_ORIGIN?: string;
}

/** Capabilities index.ts injects (avoids importing the 5k-line index). */
export interface McpOAuthHost {
  /** Verifies the interactive session bearer and returns the user, or null. */
  requireAdminSession(request: Request): Promise<{ id: string; username: string; displayName: string; role: string } | null>;
  rateLimit(key: string, bucket: string): boolean;
  sha256(value: string): Promise<string>;
  auditLog(actorId: string, action: string, targetId: string | null, detail: Record<string, unknown> | null): Promise<void>;
  now(): number;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (let i = 0; i < arr.length; i += 0x8000) str += String.fromCharCode.apply(null, [...arr.subarray(i, i + 0x8000)]);
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256B64Url(value: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function randomId(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function oauthJson(body: unknown, status: number, origin: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function oauthError(status: number, error: string, description: string, origin: string): Response {
  return oauthJson({ error, error_description: description }, status, origin);
}

const SUPPORTED_SCOPES = ["content_admin"];

/**
 * Redirect URIs we accept at registration:
 *  - https:// anywhere (web clients: claude.ai, chatgpt.com, …)
 *  - http:// on loopback only (desktop clients / mcp-remote)
 *  - custom app schemes (e.g. cursor://) for installed desktop apps
 * Fragment-carrying URIs are always invalid (RFC 6749 §3.1.2).
 */
export function isValidRedirectUri(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.hash || !u.protocol) return false;
    if (u.protocol === "https:") return !!u.hostname;
    if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.hostname.endsWith(".localhost");
    return /^[a-z][a-z0-9+.-]{1,31}:$/.test(u.protocol);
  } catch {
    return false;
  }
}

async function readBody(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    try {
      const body = await request.json();
      return new URLSearchParams(Object.entries(body ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)]));
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(await request.text());
}

// ─── Metadata documents ──────────────────────────────────────────────────────

function workerOrigin(request: Request): string {
  return new URL(request.url).origin;
}

export function resourceUrl(request: Request): string {
  return `${workerOrigin(request)}/v1/mcp`;
}

/** RFC 9728 — where MCP clients learn that this resource uses us for auth. */
export function handleProtectedResource(request: Request, origin: string): Response {
  const base = workerOrigin(request);
  return oauthJson(
    {
      resource: `${base}/v1/mcp`,
      authorization_servers: [base],
      scopes_supported: SUPPORTED_SCOPES,
      bearer_methods_supported: ["header"],
    },
    200,
    origin,
  );
}

/** RFC 8414 — server metadata the MCP client auto-discovers. */
export function handleServerMetadata(request: Request, origin: string): Response {
  const base = workerOrigin(request);
  return oauthJson(
    {
      issuer: base,
      authorization_endpoint: `${base}/v1/mcp/oauth/authorize`,
      token_endpoint: `${base}/v1/mcp/oauth/token`,
      registration_endpoint: `${base}/v1/mcp/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: SUPPORTED_SCOPES,
    },
    200,
    origin,
  );
}

// ─── Dynamic client registration (RFC 7591) ──────────────────────────────────

export async function handleRegister(request: Request, env: McpOAuthEnv, origin: string, ip: string, host: McpOAuthHost): Promise<Response> {
  if (!host.rateLimit(ip, "mcp:register")) return oauthError(429, "rate_limited", "Too many registration attempts", origin);
  if (request.method !== "POST") return oauthError(405, "invalid_request", "Registration is POST-only", origin);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return oauthError(400, "invalid_client_metadata", "Body must be JSON", origin);
  }
  const redirectUris: string[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u: unknown) => typeof u === "string") : [];
  if (!redirectUris.length || !redirectUris.every(isValidRedirectUri)) {
    return oauthError(400, "invalid_redirect_uri", "redirect_uris must be https, loopback http, or custom app-scheme URIs without fragments", origin);
  }
  if (body?.grant_types && !(Array.isArray(body.grant_types) && body.grant_types.every((g: string) => g === "authorization_code"))) {
    return oauthError(400, "invalid_client_metadata", "Only the authorization_code grant is supported", origin);
  }

  const clientId = `osler_mc_${randomId(16)}`;
  const clientName = String(body?.client_name ?? "MCP client").slice(0, 80);
  await env.DB.prepare("INSERT INTO mcp_oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)")
    .bind(clientId, clientName, JSON.stringify(redirectUris), host.now())
    .run();

  return oauthJson(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(host.now() / 1000),
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "content_admin",
    },
    201,
    origin,
  );
}

// ─── Authorize ───────────────────────────────────────────────────────────────

interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
  codeChallenge: string;
  resource: string;
}

function paramsFromSearch(search: URLSearchParams): AuthorizeParams {
  return {
    clientId: search.get("client_id") ?? "",
    redirectUri: search.get("redirect_uri") ?? "",
    state: search.get("state") ?? "",
    scope: search.get("scope") ?? "content_admin",
    codeChallenge: search.get("code_challenge") ?? "",
    resource: (search.get("resource") ?? "").replace(/\/$/, ""),
  };
}

/** Shared validation for both authorize steps; returns the client row or an error code. */
async function validateAuthorize(env: McpOAuthEnv, params: AuthorizeParams, expectedResource: string): Promise<{ client_name: string } | { error: string; description: string }> {
  if (!params.clientId) return { error: "invalid_request", description: "client_id is required" };
  if (params.resource && params.resource !== expectedResource) {
    return { error: "invalid_target", description: "resource must be the Osler MCP endpoint URL" };
  }
  const client = await env.DB.prepare("SELECT client_name, redirect_uris FROM mcp_oauth_clients WHERE client_id = ?").bind(params.clientId).first<any>();
  if (!client) return { error: "invalid_client", description: "Unknown client_id — the app must register first" };
  let uris: string[] = [];
  try {
    uris = JSON.parse(client.redirect_uris);
  } catch {
    return { error: "invalid_client", description: "Client registration is corrupt" };
  }
  if (!uris.includes(params.redirectUri)) return { error: "invalid_request", description: "redirect_uri is not registered for this client" };
  if (!params.codeChallenge) return { error: "invalid_request", description: "PKCE code_challenge is required" };
  if (params.scope && !params.scope.split(/[\s+]/).every((s) => SUPPORTED_SCOPES.includes(s))) {
    return { error: "invalid_scope", description: `Only ${SUPPORTED_SCOPES.join(", ")} is supported` };
  }
  return { client_name: client.client_name };
}

/**
 * GET /v1/mcp/oauth/authorize — the MCP client's browser lands here. We
 * validate what we can server-side, then hand the request to the consent
 * page on the Pages origin (the SPA re-authenticates the admin there with
 * its normal session and POSTs the params back to the authorize endpoint).
 */
export async function handleAuthorizeGet(request: Request, env: McpOAuthEnv, origin: string, ip: string, host: McpOAuthHost): Promise<Response> {
  if (!host.rateLimit(ip, "mcp:authorize")) return oauthError(429, "rate_limited", "Too many attempts", origin);
  const url = new URL(request.url);
  const params = paramsFromSearch(url.searchParams);
  const consentBase = (env.ALLOWED_ORIGIN || "").replace(/\/$/, "");
  if (!consentBase) return oauthError(503, "server_error", "ALLOWED_ORIGIN is not configured", origin);

  const check = await validateAuthorize(env, params, resourceUrl(request));
  const next = new URLSearchParams(url.searchParams);
  next.delete("resource");
  if ("error" in check) {
    next.set("error", check.error);
    next.set("error_description", check.description.slice(0, 200));
  } else {
    next.set("client_name", check.client_name);
  }
  return Response.redirect(`${consentBase}/admin/mcp-authorize?${next.toString()}`, 302);
}

/**
 * POST /v1/mcp/oauth/authorize — called by the consent page with the
 * admin's web-session bearer. Mints a single-use authorization code bound
 * to the approving user, the client, the redirect_uri, and the PKCE
 * challenge, then returns the callback URL for the browser to follow.
 */
export async function handleAuthorizePost(request: Request, env: McpOAuthEnv, origin: string, ip: string, host: McpOAuthHost): Promise<Response> {
  if (!host.rateLimit(ip, "mcp:authorize")) return oauthError(429, "rate_limited", "Too many attempts", origin);
  const session = await host.requireAdminSession(request);
  if (!session) return oauthError(401, "access_denied", "Sign in to the Osler admin site first", origin);
  if (!["admin", "content_admin"].includes(session.role)) return oauthError(403, "access_denied", "Only admin users can authorize MCP clients", origin);

  const body = await readBody(request);
  const params = paramsFromSearch(body);
  const check = await validateAuthorize(env, params, resourceUrl(request));
  if ("error" in check) return oauthError(400, check.error, check.description, origin);

  const code = `osler_ac_${randomId(32)}`;
  await env.DB.prepare(
    "INSERT INTO mcp_oauth_codes (code_hash, client_id, user_id, scope, redirect_uri, code_challenge, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(await sha256B64Url(code), params.clientId, session.id, params.scope || "content_admin", params.redirectUri, params.codeChallenge, host.now() + CODE_TTL_MS, host.now())
    .run();
  await host.auditLog(session.id, "mcp_oauth_authorize", null, { client_id: params.clientId, client_name: check.client_name, redirect_uri: params.redirectUri, scope: params.scope || "content_admin" });

  // Best-effort cleanup of this client's expired codes (one DELETE, immune to failure).
  void env.DB.prepare("DELETE FROM mcp_oauth_codes WHERE client_id = ? AND expires_at < ?").bind(params.clientId, host.now()).run().catch(() => undefined);

  const sep = params.redirectUri.includes("?") ? "&" : "?";
  return oauthJson({ redirect_to: `${params.redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(params.state)}` }, 200, origin);
}

// ─── Token exchange ──────────────────────────────────────────────────────────

/**
 * POST /v1/mcp/oauth/token — the MCP client exchanges code + PKCE verifier
 * for a long-lived bearer (an api_tokens row, visible/revocable in the
 * admin panel like any manual token).
 */
export async function handleToken(request: Request, env: McpOAuthEnv, origin: string, ip: string, host: McpOAuthHost): Promise<Response> {
  if (!host.rateLimit(ip, "mcp:token")) return oauthError(429, "rate_limited", "Too many token requests", origin);
  const body = await readBody(request);
  if (body.get("grant_type") !== "authorization_code") {
    return oauthError(400, "unsupported_grant_type", "Only authorization_code is supported", origin);
  }
  const code = body.get("code") ?? "";
  const verifier = body.get("code_verifier") ?? "";
  const clientId = body.get("client_id") ?? "";
  const redirectUri = body.get("redirect_uri") ?? "";
  if (!code || !verifier || !clientId || !redirectUri) {
    return oauthError(400, "invalid_request", "code, code_verifier, client_id and redirect_uri are required", origin);
  }

  // Atomic single-use claim: the conditional UPDATE either claims the code
  // or finds it already used/expired — no double-spend window.
  const claimed = await env.DB.prepare(
    "UPDATE mcp_oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING client_id, user_id, scope, redirect_uri, code_challenge",
  )
    .bind(host.now(), await sha256B64Url(code), host.now())
    .first<any>();
  if (!claimed) return oauthError(400, "invalid_grant", "Code is invalid, expired, or already used", origin);
  if (claimed.client_id !== clientId || claimed.redirect_uri !== redirectUri) {
    return oauthError(400, "invalid_grant", "Code does not match this client or redirect_uri", origin);
  }
  if ((await sha256B64Url(verifier)) !== claimed.code_challenge) {
    return oauthError(400, "invalid_grant", "PKCE verification failed", origin);
  }

  const user = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(claimed.user_id).first<any>();
  if (!user || !["admin", "content_admin"].includes(user.role)) {
    return oauthError(400, "invalid_grant", "Authorizing user no longer exists or lost admin access", origin);
  }

  // Mint the api token (same table/format as manual tokens — mcp/auth.ts).
  const raw = randomId(32);
  const token = `osler_mcp_${raw}`;
  const client = await env.DB.prepare("SELECT client_name FROM mcp_oauth_clients WHERE client_id = ?").bind(claimed.client_id).first<any>();
  await env.DB.prepare(
    "INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, scopes, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), user.id, `MCP · ${String(client?.client_name ?? "client").slice(0, 64)}`, token.slice(0, "osler_mcp_".length + 6), await sha256B64Url(token), "content_admin", host.now(), null)
    .run();
  await host.auditLog(user.id, "mcp_oauth_token_grant", null, { client_id: claimed.client_id, scope: "content_admin" });

  return oauthJson(
    {
      access_token: token,
      token_type: "Bearer",
      scope: "content_admin",
      // Long-lived like a manually minted token; revocable from the admin panel.
    },
    200,
    origin,
  );
}
