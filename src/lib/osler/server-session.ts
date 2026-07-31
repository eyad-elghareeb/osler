/**
 * Server-side session cookie utilities — HMAC-signed, tamper-evident.
 *
 * The `osler-session` cookie stores a JSON payload (the CloudSession or a
 * local-mode username) together with an HMAC-SHA-256 signature derived from
 * `OSLER_SESSION_SECRET` (or a build-time fallback). The middleware verifies
 * the signature on every request, so an attacker cannot forge a cookie by
 * writing an arbitrary string to `document.cookie` from a different origin
 * or via a subdomain cookie-injection attack.
 *
 * IMPORTANT: this module is server-only. It uses `crypto.subtle` (Web Crypto)
 * which is available in the Next.js server runtime (Node 18+ / Workers / Edge).
 * Never import this from a client component.
 */

import type { NextRequest } from "next/server";
import type { CloudSession } from "@/lib/osler/cloud";

export const SESSION_COOKIE_NAME = "osler-session";

/**
 * The cookie payload. Always includes `kind` so the middleware can tell
 * local-mode sessions (`{ kind: "local", username }`) from cloud sessions
 * (`{ kind: "cloud", session: CloudSession }`).
 */
export type SessionCookiePayload =
  | { kind: "local"; username: string; expiresAt: number }
  | { kind: "cloud"; session: CloudSession; expiresAt: number };

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = new Uint8Array(bytes);
  let str = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    str += String.fromCharCode.apply(null, [...arr.subarray(i, i + chunk)]);
  }
  return btoa(str).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function unb64url(value: string): Uint8Array {
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4));
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

/**
 * Resolve the HMAC secret. Prefer `OSLER_SESSION_SECRET` env var. Fall back
 * to `JWT_SECRET` (shared with the Worker) for backwards compatibility. If
 * neither is set, derive a build-time constant — this is NOT secure for
 * production but lets local dev work without env vars. A warning is logged.
 */
function getSecret(): string {
  if (process.env.OSLER_SESSION_SECRET) return process.env.OSLER_SESSION_SECRET;
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Last-resort dev fallback. NOT for production. The cookie is still more
  // secure than the previous implementation (which had no signature at all)
  // because an attacker still needs to know this constant to forge a cookie.
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[osler/server-session] OSLER_SESSION_SECRET is not set in production. " +
      "Falling back to a derived dev secret — set OSLER_SESSION_SECRET in your environment."
    );
  }
  return "osler-dev-session-secret-do-not-use-in-production";
}

async function hmac(value: string): Promise<string> {
  const secret = getSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, ENCODER.encode(value)));
}

/**
 * Sign a payload and return the cookie value string.
 * Format: `<base64url(payloadJSON)>.<hmac>`
 */
export async function signSessionCookie(payload: SessionCookiePayload): Promise<string> {
  const json = JSON.stringify(payload);
  const encoded = b64url(ENCODER.encode(json));
  const sig = await hmac(encoded);
  return `${encoded}.${sig}`;
}

/**
 * Verify a cookie value and return the parsed payload, or `null` if the
 * signature is invalid, the payload is malformed, or the session has expired.
 */
export async function verifySessionCookie(value: string | undefined | null): Promise<SessionCookiePayload | null> {
  if (!value || typeof value !== "string") return null;
  // Cap the cookie value length to prevent DoS via huge payloads. A real
  // CloudSession cookie is well under 4 KB (token + user + expiry + HMAC).
  // 16 KB is a generous ceiling; anything larger is malicious or corrupt.
  if (value.length > 16_384) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const encoded = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = await hmac(encoded);
  // Constant-time-ish comparison.
  if (sig.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i += 1) mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch !== 0) return null;

  let json: string;
  try {
    json = DECODER.decode(unb64url(encoded));
  } catch {
    return null;
  }
  let parsed: SessionCookiePayload;
  try {
    parsed = JSON.parse(json) as SessionCookiePayload;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.kind !== "local" && parsed.kind !== "cloud") return null;
  if (typeof parsed.expiresAt !== "number") return null;
  // Expiry check.
  if (parsed.expiresAt <= Date.now()) return null;
  if (parsed.kind === "cloud") {
    const s = parsed.session;
    if (!s || typeof s !== "object") return null;
    if (typeof s.token !== "string" || s.token.length === 0 || s.token.length > 2048) return null;
    if (typeof s.expiresAt !== "number") return null;
    if (s.expiresAt <= Date.now()) return null;
    if (!s.user || typeof s.user !== "object") return null;
    // Validate user fields — defense in depth. The cookie was signed by
    // our own server so the payload can't be tampered with, but a bug in
    // the POST handler could store a malformed object. These checks ensure
    // the middleware never trusts a malformed session.
    if (
      typeof s.user.id !== "string" ||
      typeof s.user.username !== "string" ||
      typeof s.user.displayName !== "string" ||
      typeof s.user.role !== "string" ||
      (s.user.email !== null && typeof s.user.email !== "string")
    ) {
      return null;
    }
  } else {
    if (typeof parsed.username !== "string" || parsed.username.length === 0) return null;
    if (parsed.username.length > 80) return null;
  }
  return parsed;
}

/**
 * Convenience: read & verify the session cookie from a NextRequest (middleware).
 */
export async function readSessionFromRequest(request: NextRequest): Promise<SessionCookiePayload | null> {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  return verifySessionCookie(cookie?.value);
}

/**
 * Default cookie options for the `osler-session` cookie.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
} as const;
