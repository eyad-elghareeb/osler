// ---------------------------------------------------------------------------
// Osler Cloud Worker — realtime sync hub (WebSocket pokes)
//
// Poke-only channel: no sync data ever flows over the socket — clients keep
// using the idempotent HTTP sync (pull / merge / 409-conflict machinery).
//
// Free-tier economics: sockets hibernate between pokes (zero duration while
// idle); client "ping" heartbeats are answered at the edge via
// setWebSocketAutoResponse and never wake the object; billed requests are
// therefore ≈ connects + one notify() RPC per sync push + actual pokes at the
// 20:1 message ratio — a rounding error against the 100k/day DO budget.
//
// Abuse bounds: upgrades require a 60-second ticket minted from an
// authenticated, non-revoked session (ticket endpoint is rate-limited per
// IP); sockets per user are capped; every client message other than the exact
// "ping" heartbeat reaches webSocketMessage and closes the socket, so a
// hostile client cannot loop wake-ups.
// ---------------------------------------------------------------------------

import { DurableObject } from "cloudflare:workers";
import { SYNC_KINDS } from "./sync-docs";

export const REALTIME_TICKET_TTL_MS = 60_000;
// Sockets per user are bounded by their devices (MAX_SESSIONS_PER_USER
// server-side) plus open tabs; 24 is generous headroom above that and stops a
// runaway client from hoarding hibernation slots.
const MAX_HUB_SOCKETS = 24;
// Poke frames list the kinds that changed; sync has 9 kinds, so anything
// longer is a bug or abuse — clamp it.
const MAX_POKE_KINDS = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Token helpers are mirrored from index.ts (they are module-private there, and
// the entry module must never be imported from below).

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

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

/** Constant-time string comparison (used for HMAC signatures). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export interface RealtimeTicket {
  ticket: string;
  expiresAt: number;
}

/**
 * Mint a short-lived one-way ticket the browser can hand to the WebSocket
 * upgrade (browsers cannot set an Authorization header on WS requests). Same
 * `payload.hmac` token format as session tokens, but with a `typ: "rt"` claim
 * so the two can never be confused for each other in either direction.
 */
export async function mintRealtimeTicket(
  secrets: { JWT_SECRET: string },
  sessionId: string,
  userId: string,
  opts: { ttlMs?: number } = {},
): Promise<RealtimeTicket> {
  const expiresAt = Date.now() + (opts.ttlMs ?? REALTIME_TICKET_TTL_MS);
  const payload = b64url(encoder.encode(JSON.stringify({ sub: userId, sid: sessionId, typ: "rt", exp: Math.floor(expiresAt / 1000) })));
  return { ticket: `${payload}.${await hmac(payload, secrets.JWT_SECRET)}`, expiresAt };
}

/** Verify a realtime ticket's signature, type and freshness. Does NOT check
 *  the D1 session row — callers must do that (revocation lives in D1). */
export async function verifyRealtimeTicket(secrets: { JWT_SECRET: string }, ticket: string): Promise<{ userId: string; sessionId: string } | null> {
  if (!ticket || ticket.length > 1024) return null;
  const [payload, signature] = ticket.split(".");
  if (!payload || !signature || !timingSafeEqual(signature, await hmac(payload, secrets.JWT_SECRET))) return null;
  try {
    const claims = JSON.parse(decoder.decode(unb64url(payload))) as { typ?: unknown; sub?: unknown; sid?: unknown; exp?: unknown };
    // Inverted expiry comparison: `Number(...) <= Date.now()` would accept a
    // missing/NaN exp (NaN comparisons are always false).
    if (claims?.typ !== "rt" || typeof claims.sub !== "string" || typeof claims.sid !== "string" || !(Number(claims.exp) > Date.now() / 1000)) return null;
    return { userId: claims.sub, sessionId: claims.sid };
  } catch {
    return null;
  }
}

interface SocketAttachment {
  /** Client-generated connection id used to skip the socket that caused a push. */
  conn: string;
}

/**
 * One hub per user (`getByName(userId)` — deterministic routing). Holds the
 * user's device sockets and broadcasts poke frames; persists nothing, so it
 * never writes a storage row and hibernates for free between pokes.
 */
export class UserSyncHub extends DurableObject<Record<string, unknown>> {
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    // Answer client heartbeat pings at the edge: no wake-up, no duration, no
    // billed request — the single most important free-tier optimization here.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= MAX_HUB_SOCKETS) {
      return new Response("Too many connections", { status: 429 });
    }
    const rawConn = new URL(request.url).searchParams.get("conn") ?? "";
    const conn = /^[A-Za-z0-9_-]{1,64}$/.test(rawConn) ? rawConn : "";
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], [conn || "anon"]);
    (pair[1] as WebSocket & { serializeAttachment(attachment: unknown): void }).serializeAttachment({ conn } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // Heartbeat pings never reach here — setWebSocketAutoResponse handles them
  // without waking the object. Anything that DOES arrive is a protocol
  // violation (or a deliberate wake-up flood): close immediately so it can
  // never loop. Each wake is billed at the 20:1 message ratio, so this guard
  // is what caps a hostile client's burn at one twentieth of a request.
  // (An exact "ping" is tolerated as a no-op rather than closed: if the
  // auto-response pair were ever unavailable, closing would turn every
  // heartbeat into a reconnect storm.)
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === "ping") return;
    try {
      ws.close(1008, "unexpected message");
    } catch {
      // already closing/closed
    }
  }

  /**
   * RPC: after a device pushes progress, poke every OTHER connected device.
   * `origin` is the pushing connection's id (empty/unknown → broadcast to all).
   * Sends are best-effort: a socket that errored between enumeration and send
   * must not fail the caller's sync response.
   */
  async notify(origin: string, kinds: string[]): Promise<void> {
    const safeKinds = kinds.filter((k) => (SYNC_KINDS as readonly string[]).includes(k)).slice(0, MAX_POKE_KINDS);
    if (safeKinds.length === 0) return;
    const frame = JSON.stringify({ t: "sync", kinds: safeKinds });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = (ws as WebSocket & { deserializeAttachment<T>(): unknown }).deserializeAttachment<SocketAttachment>() as SocketAttachment | null;
        if (origin && attachment?.conn === origin) continue;
        ws.send(frame);
      } catch {
        // Broken/half-closed socket (or missing attachment) — the next sync
        // pull reconciles it.
      }
    }
  }
}
