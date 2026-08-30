// ---------------------------------------------------------------------------
// Realtime sync pokes (opt-in).
//
// A single WebSocket to the Worker's /v1/realtime endpoint that receives tiny
// "your other device pushed — pull now" frames, so cross-device sync
// converges in seconds instead of waiting out the idle poll. The socket
// carries no sync data — a poke just triggers the normal HTTP pull in
// cloud.ts, so the idempotent merge/409 machinery stays authoritative.
//
// Free-tier economics (mirrors the worker's UserSyncHub):
//   - The socket is only open while the app is visible and online; a hidden
//     tab closes it and reopening re-evaluates from scratch.
//   - Heartbeats are client-initiated "ping" frames answered at the edge by
//     setWebSocketAutoResponse — they keep the connection alive without
//     waking or billing the hub.
//   - Auth: browsers can't set an Authorization header on a WS upgrade, so a
//     60-second ticket is minted first (POST /v1/realtime/ticket) and passed
//     as a query param.
//   - Everything degrades silently: unsupported, disabled (opt-in off),
//     Data Saver, or repeated failures just leave the existing polling
//     cadence in charge.
// ---------------------------------------------------------------------------

import { readNetworkInfo, subscribeNetworkInfo } from "@/lib/osler/native";

const HEARTBEAT_MS = 45_000;
// If no frame (pong or poke) arrives within this window the edge silently
// dropped us — recycle the socket instead of half-listening forever.
const PONG_TIMEOUT_MS = 100_000;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
const MAX_POKE_KINDS = 32;

export type RealtimeState = "off" | "connecting" | "open" | "backoff";

/** Window event fired on every state transition (detail: { state }). */
export const REALTIME_STATE_EVENT = "osler-realtime-state";

interface RealtimeOptions {
  isEnabled: () => boolean;
  getApiUrl: () => string | null;
  getAccessToken: () => string | null;
  onSyncPoke: () => void;
}

let opts: RealtimeOptions | null = null;
let ws: WebSocket | null = null;
let state: RealtimeState = "off";
let attempts = 0;
let intentionalClose = false;
let lastPongAt = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let unsubNetwork: (() => void) | null = null;
let bound = false;
const healthListeners = new Set<(open: boolean) => void>();

/** Stable per-tab connection id — lets the hub skip the socket that caused a
 *  push (it just wrote that data locally; it doesn't need to pull it). */
export function getRealtimeConnId(): string {
  if (!connId) {
    try {
      connId = crypto.randomUUID();
    } catch {
      connId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    }
  }
  return connId;
}
let connId = "";

export function getRealtimeState(): RealtimeState {
  return state;
}

export function isRealtimeOpen(): boolean {
  return state === "open" && !!ws;
}

/** Fires on open↔closed transitions. The initial value is NOT delivered —
 *  read `isRealtimeOpen()` directly when wiring up. */
export function subscribeRealtimeHealth(cb: (open: boolean) => void): () => void {
  healthListeners.add(cb);
  return () => healthListeners.delete(cb);
}

function setState(next: RealtimeState): void {
  if (state === next) return;
  const wasOpen = state === "open";
  state = next;
  const isOpen = next === "open";
  if (wasOpen !== isOpen) {
    for (const fn of [...healthListeners]) {
      try { fn(isOpen); } catch { /* listener error must not break the loop */ }
    }
  }
  try {
    window.dispatchEvent(new CustomEvent(REALTIME_STATE_EVENT, { detail: { state: next } }));
  } catch { /* ignore */ }
}

function shouldConnect(): boolean {
  if (!opts || typeof WebSocket === "undefined") return false;
  if (!opts.isEnabled()) return false;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (!opts.getApiUrl() || !opts.getAccessToken()) return false;
  // Honor the user's Data Saver: the socket is a convenience, not a need.
  if (readNetworkInfo().saveData) return false;
  return true;
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(RETRY_BASE_MS * 2 ** Math.min(attempts, 5), RETRY_MAX_MS);
  attempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    evaluate();
  }, delay);
}

function finishClose(): void {
  const deliberate = intentionalClose;
  intentionalClose = false;
  stopHeartbeat();
  ws = null;
  if (deliberate) {
    setState("off");
  } else {
    setState("backoff");
    scheduleReconnect();
  }
}

/** Close the live socket. `deliberate` (suspend/disable/stop) lands in "off";
 *  abnormal closes land in "backoff" and schedule a reconnect. */
function closeSocket(deliberate: boolean): void {
  intentionalClose = deliberate;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const sock = ws;
  if (!sock) {
    finishClose();
    return;
  }
  try {
    sock.close(1000, "osler-realtime");
  } catch { /* already closed */ }
  if (sock.readyState === WebSocket.CLOSED) finishClose();
}

async function connect(): Promise<void> {
  const o = opts;
  if (!o || ws) return;
  const apiUrl = o.getApiUrl()?.replace(/\/$/, "");
  const token = o.getAccessToken();
  if (!apiUrl || !token) return;
  setState("connecting");
  let ticket: string;
  try {
    const res = await fetch(`${apiUrl}/v1/realtime/ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`ticket ${res.status}`);
    const body = await res.json() as { ticket?: unknown };
    if (typeof body.ticket !== "string" || !body.ticket) throw new Error("no ticket");
    ticket = body.ticket;
  } catch {
    // Mint failed (offline, rate-limited, dead session). Back off — the sync
    // loop owns auth expiry; we just stop hammering the endpoint.
    attempts += 1;
    setState("backoff");
    scheduleReconnect();
    return;
  }
  // The tab may have been hidden / disabled while the ticket was in flight.
  if (!opts || !shouldConnect()) {
    setState("off");
    return;
  }
  if (ws) return;
  try {
    const sock = new WebSocket(`${apiUrl.replace(/^http/, "ws")}/v1/realtime?ticket=${encodeURIComponent(ticket)}&conn=${encodeURIComponent(getRealtimeConnId())}`);
    ws = sock;
    sock.onopen = () => {
      if (ws !== sock) return;
      attempts = 0;
      lastPongAt = Date.now();
      setState("open");
      stopHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
          closeSocket(false);
          return;
        }
        try { ws.send("ping"); } catch { /* onclose follows */ }
      }, HEARTBEAT_MS);
    };
    sock.onmessage = (event) => {
      if (ws !== sock) return;
      lastPongAt = Date.now();
      if (typeof event.data !== "string") return;
      try {
        const frame = JSON.parse(event.data) as { t?: unknown; kinds?: unknown };
        if (frame?.t === "sync" && Array.isArray(frame.kinds)) {
          if (frame.kinds.some((k) => typeof k === "string")) o.onSyncPoke();
        }
      } catch { /* non-JSON frame ("pong" heartbeat or junk) */ }
    };
    sock.onclose = () => {
      if (ws === sock) finishClose();
    };
    sock.onerror = () => { /* onclose always follows */ };
  } catch {
    ws = null;
    setState("backoff");
    scheduleReconnect();
  }
}

function evaluate(): void {
  if (shouldConnect()) {
    if (!ws && (state === "off" || state === "backoff")) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      void connect();
    }
  } else if (ws || state !== "off") {
    closeSocket(true);
  }
}

const onVisibility = () => evaluate();
const onOnline = () => evaluate();

/** Wire the module to app lifecycle. Safe to call again (rebinds options). */
export function startRealtime(options: RealtimeOptions): void {
  if (typeof window === "undefined") return;
  opts = options;
  if (!bound) {
    bound = true;
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    unsubNetwork = subscribeNetworkInfo(onOnline);
  }
  evaluate();
}

/** Re-evaluate without tearing down listeners (e.g. the opt-in flipped). */
export function refreshRealtime(): void {
  if (!opts) return;
  evaluate();
}

/** Full teardown — listeners unbound, socket closed, timers cleared. */
export function stopRealtime(): void {
  opts = null;
  attempts = 0;
  closeSocket(true);
  if (bound) {
    bound = false;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("online", onOnline);
  }
  if (unsubNetwork) {
    unsubNetwork();
    unsubNetwork = null;
  }
  setState("off");
}
