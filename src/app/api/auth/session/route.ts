import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { CloudSession } from "@/lib/osler/cloud";
import { getConfig } from "@/lib/osler/config";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  signSessionCookie,
  verifySessionCookie,
  type SessionCookiePayload,
} from "@/lib/osler/server-session";

/**
 * /api/auth/session — manages the httpOnly, HMAC-signed `osler-session` cookie.
 *
 * SECURITY MODEL
 *   * POST accepts ONLY a CloudSession payload that the caller already
 *     obtained from the Worker (via /v1/auth/login, /v1/auth/register, or
 *     /v1/auth/google/consume). Before issuing the cookie, the route verifies
 *     the session against the Worker by calling `GET /v1/auth/me` with the
 *     bearer token. This means an attacker cannot POST an arbitrary username
 *     and get a valid cookie.
 *   * For local (non-cloud) mode, the client posts `{ username }` WITHOUT a
 *     session. The cookie is issued only if cloud is disabled in the runtime
 *     config — so a cloud-enabled instance cannot be downgraded to local-mode
 *     auth by an attacker.
 *   * The cookie value is `<base64url(payloadJSON)>.<hmac>` — the HMAC is
 *     derived from `OSLER_SESSION_SECRET` (or `JWT_SECRET` fallback). The
 *     middleware verifies the HMAC on every request.
 *   * GET returns a REDACTED view of the session — enough for the client to
 *     render the UI (username, displayName, role, expiresAt) but NOT the
 *     bearer `token`. The full token stays in sessionStorage (per-tab) and
 *     is never exposed via this endpoint to JS that didn't already have it.
 *     This limits the blast radius of an XSS that reads the cookie response.
 *   * DELETE clears the cookie.
 */

const LOCAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for local-only mode
const MAX_BODY_BYTES = 8 * 1024; // 8 KB — a CloudSession is well under this

interface CloudConfig {
  enabled: boolean;
  apiUrl: string;
}

/**
 * Load the cloud config synchronously from the cached in-memory config.
 * `getConfig()` returns the cached value or the default config (which has
 * `cloud.enabled = false`). This is sufficient for the auth route because:
 *   - On the server, `getConfig()` returns DEFAULT_CONFIG (cloud disabled)
 *     unless the config was loaded via `loadConfig()` earlier in the same
 *     request lifecycle. For the auth route, we only need to know whether
 *     cloud is enabled — and on a cloud-enabled instance, the config is
 *     loaded client-side and the Worker verifies the token anyway.
 *   - For local-mode (cloud disabled), we accept the username. For cloud
 *     mode, we verify the bearer token with the Worker before issuing the
 *     cookie, so even if `getConfig()` returns the wrong value, the worst
 *     case is a local-mode cookie on a cloud instance — which the client
 *     will reject because it can't call Worker APIs without a real token.
 *
 * To be safe, we ALSO check the env var `NEXT_PUBLIC_CLOUD_API_URL` — if
 * it's set, cloud is enabled regardless of the config.
 */
function readCloudConfigSync(): CloudConfig {
  const envApiUrl = process.env.NEXT_PUBLIC_CLOUD_API_URL;
  if (envApiUrl) {
    return { enabled: true, apiUrl: envApiUrl.replace(/\/$/, "") };
  }
  try {
    const cfg = getConfig();
    return {
      enabled: !!cfg.cloud?.enabled,
      apiUrl: (cfg.cloud?.apiUrl || "").replace(/\/$/, ""),
    };
  } catch {
    return { enabled: false, apiUrl: "" };
  }
}

/**
 * Verify a CloudSession against the Worker by calling GET /v1/auth/me.
 *
 * SECURITY: We do NOT trust the `user` object in the POST body — an attacker
 * who steals a token for user A could POST `{ session: { token: <A's token>,
 * user: { id: "B", role: "admin", ... } }` to escalate privileges. Instead,
 * we call `/v1/auth/me` with the token and use the Worker's response as the
 * source of truth for the user payload. The returned `verifiedUser` replaces
 * the POST body's `user` when building the cookie payload.
 *
 * Returns the Worker's user payload if the token is valid, or `null` otherwise.
 * Times out after 6 seconds so a misconfigured Worker URL doesn't hang login.
 */
async function verifyCloudSessionWithWorker(
  token: string,
  apiUrl: string
): Promise<CloudSession["user"] | null> {
  if (!apiUrl || !token) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    const res = await fetch(`${apiUrl}/v1/auth/me`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      user?: {
        id?: unknown;
        username?: unknown;
        displayName?: unknown;
        role?: unknown;
        email?: unknown;
        hasPassword?: unknown;
      };
    };
    const u = data?.user;
    if (!u || typeof u !== "object") return null;
    // Validate the shape — these are the fields the client UI reads.
    if (
      typeof u.id !== "string" ||
      typeof u.username !== "string" ||
      typeof u.displayName !== "string" ||
      typeof u.role !== "string" ||
      (u.email !== null && typeof u.email !== "string")
    ) {
      return null;
    }
    // Validate `role` is a known value — prevents a future Worker migration
    // from introducing an unexpected role that client code doesn't handle.
    if (u.role !== "student" && u.role !== "admin" && u.role !== "content_admin") {
      return null;
    }
    // Return a sanitized user object (the Worker is the source of truth).
    // `role` is validated above to be one of the three known values.
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role as "student" | "admin" | "content_admin",
      email: u.email as string | null,
      hasPassword: typeof u.hasPassword === "boolean" ? u.hasPassword : true,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  // 1. Read & size-limit the body.
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large" }, { status: 413 });
  }
  let body: { session?: CloudSession; username?: string };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cloud = readCloudConfigSync();

  // 2. Cloud session path — verify the bearer token with the Worker.
  if (body.session) {
    if (!cloud.enabled || !cloud.apiUrl) {
      // An attacker might try to POST a cloud session to a local-mode instance
      // to bypass local auth. Refuse.
      return NextResponse.json({ error: "Cloud accounts are not enabled on this instance" }, { status: 403 });
    }
    const s = body.session;
    if (
      typeof s.token !== "string" || s.token.length === 0 || s.token.length > 2048 ||
      typeof s.expiresAt !== "number" ||
      !s.user || typeof s.user !== "object" ||
      typeof s.user.id !== "string" ||
      typeof s.user.username !== "string" ||
      typeof s.user.displayName !== "string"
    ) {
      return NextResponse.json({ error: "Invalid session payload" }, { status: 400 });
    }
    // Reject already-expired sessions.
    if (s.expiresAt <= Date.now()) {
      return NextResponse.json({ error: "Session has expired" }, { status: 401 });
    }
    // Verify with the Worker BEFORE trusting the cookie. The Worker's response
    // is the source of truth for the user payload — we do NOT use the POST
    // body's `user` object, to prevent privilege escalation via role injection.
    const verifiedUser = await verifyCloudSessionWithWorker(s.token, cloud.apiUrl);
    if (!verifiedUser) {
      return NextResponse.json({ error: "Session could not be verified with the cloud backend" }, { status: 401 });
    }
    // Build the cookie payload with the VERIFIED user, not the POST body's user.
    // Keep the token + expiresAt from the POST body (the Worker doesn't return
    // the token, and the client already has it in sessionStorage).
    const trustedSession: CloudSession = {
      token: s.token,
      expiresAt: s.expiresAt,
      user: verifiedUser,
    };
    const payload: SessionCookiePayload = { kind: "cloud", session: trustedSession, expiresAt: s.expiresAt };
    const cookieValue = await signSessionCookie(payload);
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, cookieValue, {
      ...SESSION_COOKIE_OPTIONS,
      expires: new Date(s.expiresAt),
    });
    return NextResponse.json({ ok: true });
  }

  // 3. Local-mode path — only allowed when cloud is disabled.
  if (cloud.enabled) {
    // Cloud-enabled instances must authenticate via the Worker. Refuse to
    // issue a local-mode cookie so an attacker can't downgrade auth.
    return NextResponse.json(
      { error: "This instance requires cloud authentication" },
      { status: 403 }
    );
  }
  const username = (body.username || "").trim();
  if (!username || username.length > 80) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }
  // Basic sanity: reject newlines/control chars.
  if (/[\r\n\t\x00-\x1f]/.test(username)) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }
  const expiresAt = Date.now() + LOCAL_SESSION_TTL_MS;
  const payload: SessionCookiePayload = { kind: "local", username, expiresAt };
  const cookieValue = await signSessionCookie(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, cookieValue, {
    ...SESSION_COOKIE_OPTIONS,
    expires: new Date(expiresAt),
  });
  return NextResponse.json({ ok: true });
}

/**
 * GET — returns a REDACTED view of the session for client bootstrap.
 *
 * Returns:
 *   - `{ session: null }` if no cookie / invalid cookie / expired.
 *   - `{ session: { kind: "cloud", user: {...}, expiresAt } }` — NO token.
 *   - `{ session: { kind: "local", username, expiresAt } }`
 *
 * The full CloudSession (with bearer token) is NEVER returned by this route.
 * The client reads it from sessionStorage (where `saveCloudSession()` put it
 * on login). Cross-tab restore for cloud sessions: see `session-context.tsx`
 * — when the cookie says "cloud" but sessionStorage has no token, the client
 * must re-authenticate with the Worker (silent re-login via Google ticket or
 * a fresh login form). This is the trade-off for not exposing the token via
 * an HTTP endpoint.
 */
export async function GET() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME);
  const payload = await verifySessionCookie(cookie?.value);
  if (!payload) {
    // Clean up an invalid/expired cookie if present.
    if (cookie?.value) {
      cookieStore.delete(SESSION_COOKIE_NAME);
    }
    return NextResponse.json({ session: null }, { status: 200, headers: { "cache-control": "no-store" } });
  }
  if (payload.kind === "cloud") {
    // Strip the token — only return what the client needs to render the UI.
    return NextResponse.json(
      {
        session: {
          kind: "cloud" as const,
          user: payload.session.user,
          expiresAt: payload.session.expiresAt,
        },
      },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  }
  return NextResponse.json(
    { session: { kind: "local" as const, username: payload.username, expiresAt: payload.expiresAt } },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
