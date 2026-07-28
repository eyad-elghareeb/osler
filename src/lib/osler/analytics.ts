/**
 * Osler analytics — privacy-preserving performance & usage telemetry.
 *
 * Design contract (read before changing):
 *
 *   1. NO personally identifiable information. We collect:
 *        - Event type (page_view | web_vital | js_error | api_call | route_change)
 *        - Pathname only (NO query string, NO hash, NO referrer)
 *        - Numeric value (ms for timings, unitless for CLS)
 *        - Metric name (LCP | INP | CLS | TTFB | FCP)
 *        - Browser family (chrome | firefox | safari | edge | opera | samsung | other)
 *        - Device class (mobile | tablet | desktop | other)
 *        - Effective connection type (4g | 3g | 2g | slow-2g | unknown)
 *        - A per-tab sessionId that rotates every 30 min — NOT a user id.
 *      We do NOT collect: user id, username, email, IP, full user-agent
 *      string, query parameters, cookies, or referrer URLs.
 *
 *   2. Best-effort delivery. If the network is offline, the worker is
 *      unreachable, or the user has telemetry disabled in their browser,
 *      we silently drop events. Analytics MUST NEVER throw into the host
 *      app or block the UI thread.
 *
 *   3. Batched + throttled. Events accumulate in an in-memory ring buffer
 *      and are flushed:
 *        - on a periodic timer (every 20s),
 *        - when the buffer hits 25 events,
 *        - on `visibilitychange` to `hidden`,
 *        - on `beforeunload`.
 *
 *   4. Respects Do-Not-Track. If `navigator.doNotTrack === "1"` we never
 *      start collection. The provider also reads a localStorage flag so
 *      the user can opt out from inside the app.
 *
 *   5. Skip in development. In `NODE_ENV !== "production"` we keep the
 *      buffer but do not POST, so dev sessions don't pollute the dashboard.
 *      (Override with `localStorage.osler_analytics_force = "1"`.)
 */

import { getConfig } from "@/lib/osler/config";
import { readCloudSession } from "@/lib/osler/cloud";

// ─── Types ─────────────────────────────────────────────────────────────────

export type AnalyticsEventType =
  | "page_view"
  | "web_vital"
  | "js_error"
  | "api_call"
  | "route_change";

export type AnalyticsMetricName = "LCP" | "INP" | "CLS" | "TTFB" | "FCP" | "FID";

export interface AnalyticsEvent {
  type: AnalyticsEventType;
  path?: string;
  /** Metric name. For `web_vital` events this MUST be one of the
   *  `AnalyticsMetricName` values; for `api_call` events it carries the
   *  endpoint label (e.g. "GET /v1/sync"). The worker enforces both cases. */
  metric?: string;
  value?: number;
  detail?: Record<string, unknown> | string;
  ts?: number;
}

export interface AnalyticsBatch {
  sessionId: string;
  events: AnalyticsEvent[];
}

// ─── Internal state ────────────────────────────────────────────────────────

const BUFFER_LIMIT = 50;
const FLUSH_INTERVAL_MS = 20_000;
const FLUSH_THRESHOLD = 25;
const SESSION_ROTATION_MS = 30 * 60 * 1000;
/** Max consecutive network failures before we drop the buffer to avoid
 *  unbounded stale-event re-queueing (e.g. persistent 401 after logout). */
const MAX_CONSECUTIVE_FAILURES = 3;

let buffer: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let listenersBound = false;
let sessionId: string = "";
let sessionIssuedAt: number = 0;
let consecutiveFailures = 0;

// ─── Privacy / enabling ────────────────────────────────────────────────────
//
// The enable/disable decision is split into two categories:
//
//   (a) PERSISTENT reasons — Do-Not-Track, user opt-out, dev-mode. Once
//       decided, the answer never changes for the lifetime of the page.
//       We cache these in `persistentEnabled` so we don't re-check
//       localStorage / navigator on every track() call.
//
//   (b) TRANSIENT reasons — cloud config not yet loaded. `getConfig()`
//       returns DEFAULT_CONFIG (with cloud.enabled = false) until the
//       async `loadConfig()` resolves. If we cached `false` for this
//       reason on the first call, analytics would NEVER start even after
//       config loads — a critical bug in the previous implementation.
//       We do NOT cache the transient result; we re-evaluate it every
//       call until config loads.

let persistentEnabled: boolean | null = null; // null = not yet probed

function localStorageFlag(): "0" | "1" | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem("osler_analytics_opt_out");
    if (v === "1" || v === "0") return v;
  } catch {
    // localStorage can throw in private mode / sandboxed iframes
  }
  return null;
}

function isDoNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  const dnt = (navigator as any).doNotTrack;
  const gpc = (navigator as any).globalPrivacyControl;
  return dnt === "1" || dnt === "yes" || gpc === true;
}

/** Check ONLY the persistent reasons (DNT, opt-out, dev-mode). Cached. */
function persistentCheck(): boolean {
  if (persistentEnabled !== null) return persistentEnabled;
  if (typeof window === "undefined") return (persistentEnabled = false);
  // Dev preview: do not POST unless explicitly forced on.
  if (process.env.NODE_ENV !== "production") {
    let forced = false;
    try { forced = window.localStorage.getItem("osler_analytics_force") === "1"; } catch {}
    if (!forced) return (persistentEnabled = false);
  }
  if (isDoNotTrack()) return (persistentEnabled = false);
  if (localStorageFlag() === "1") return (persistentEnabled = false);
  return (persistentEnabled = true);
}

/** Full enable check: persistent reasons AND cloud config must be ready.
 *  NOT cached — the config half is transient. Safe to call on every track(). */
export function analyticsEnabled(): boolean {
  if (!persistentCheck()) return false;
  // Cloud backend must be configured — otherwise we have nowhere to send.
  // This half is NOT cached because getConfig() returns DEFAULT_CONFIG
  // (cloud.enabled = false) until loadConfig() resolves.
  try {
    const cfg = getConfig();
    if (!cfg.cloud?.enabled || !cfg.cloud?.apiUrl) return false;
  } catch {
    return false;
  }
  return true;
}

export function analyticsDisabledReason(): string | null {
  if (typeof window === "undefined") return "ssr";
  if (process.env.NODE_ENV !== "production") {
    let forced = false;
    try { forced = window.localStorage.getItem("osler_analytics_force") === "1"; } catch {}
    if (!forced) return "dev-mode";
  }
  if (isDoNotTrack()) return "do-not-track";
  if (localStorageFlag() === "1") return "user-opt-out";
  try {
    const cfg = getConfig();
    if (!cfg.cloud?.enabled || !cfg.cloud?.apiUrl) return "no-cloud-backend";
  } catch {
    return "no-config";
  }
  return null;
}

/** Allow the user to opt out from the Settings panel. Persists across sessions. */
export function setAnalyticsOptOut(optOut: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("osler_analytics_opt_out", optOut ? "1" : "0");
  } catch {}
  persistentEnabled = null;
  if (optOut) stopAnalytics();
}

// ─── Session id ────────────────────────────────────────────────────────────

function ensureSessionId(): string {
  if (sessionId && Date.now() - sessionIssuedAt < SESSION_ROTATION_MS) return sessionId;
  sessionId = randomId();
  sessionIssuedAt = Date.now();
  return sessionId;
}

function randomId(): string {
  // Crypto.randomUUID is available on all modern browsers (and https contexts).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try { return crypto.randomUUID(); } catch {}
  }
  // Fallback — Math.random is fine here, this is not a security boundary.
  return Array.from({ length: 4 }, () =>
    Math.random().toString(36).slice(2, 10),
  ).join("");
}

// ─── Environment detection ─────────────────────────────────────────────────

function detectBrowser(): string {
  if (typeof navigator === "undefined" || !navigator.userAgent) return "other";
  const ua = navigator.userAgent;
  // Order matters — Edge contains "Chrome", Samsung contains "Chrome".
  if (/edg\//i.test(ua)) return "edge";
  if (/samsungbrowser/i.test(ua)) return "samsung";
  if (/opr\/|opera/i.test(ua)) return "opera";
  if (/firefox/i.test(ua)) return "firefox";
  if (/chrome/i.test(ua) && !/chromium/i.test(ua)) return "chrome";
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return "safari";
  if (/chromium/i.test(ua)) return "chrome";
  return "other";
}

function detectDevice(): string {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/ipad|tablet|playbook|silk/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return "mobile";
  // iPadOS 13+ reports as desktop Mac but has touchscreen.
  if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "tablet";
  if (/android|linux|windows|macintosh/i.test(ua)) return "desktop";
  return "other";
}

function detectConnection(): string {
  if (typeof navigator === "undefined") return "unknown";
  const c = (navigator as any).connection;
  const t = c?.effectiveType;
  if (t === "4g" || t === "3g" || t === "2g" || t === "slow-2g") return t;
  return "unknown";
}

// ─── Path normalisation ────────────────────────────────────────────────────

/** Collapse UUIDs, numeric ids, emails, and token-like strings into
 *  placeholders so grouping stays tidy AND no PII leaks through the path.
 *  Query strings and hashes are stripped first, so `?token=secret` and
 *  `#access_token=secret` are never stored. */
export function normalizePath(path: string): string {
  if (!path) return "/";
  let p = path.split("?", 1)[0].split("#", 1)[0];
  // Strip control characters (newline, tab, null byte) to prevent log
  // injection and display corruption.
  p = p.replace(/[\x00-\x1f\x7f]/g, "");
  if (!p.startsWith("/")) p = "/" + p;
  p = p.replace(/\/{2,}/g, "/");
  // UUID / 20+ hex-char id
  p = p.replace(/\/[a-f0-9-]{20,}/gi, "/:id");
  // Pure-numeric segment
  p = p.replace(/\/\d+(?=\/|$)/g, "/:n");
  // Email-like segment (e.g. /users/john@example.com → /users/:email)
  p = p.replace(/\/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "/:email");
  // JWT-like segment (eyJ...)
  p = p.replace(/\/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "/:token");
  // Long base64-like segment (40+ chars — could be an encoded token/credential)
  p = p.replace(/\/[A-Za-z0-9+/]{40,}={0,2}/g, "/:token");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

// ─── PII scrubbing (client-side, defense in depth) ─────────────────────────
//
// The worker also scrubs PII from detail before storing, but we scrub on the
// client too so PII never hits the network in the first place. This catches
// error messages that accidentally include emails, tokens, or credentials.

const CLIENT_PII_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[redacted:email]" },
  // JWT: signature segment can be short, so only require 5+ chars.
  { re: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{5,}/g, replacement: "[redacted:jwt]" },
  { re: /Bearer\s+[a-zA-Z0-9._-]{20,}/gi, replacement: "Bearer [redacted]" },
  { re: /\b[a-f0-9]{32,}\b/gi, replacement: "[redacted:token]" },
];

function scrubPiiClient(text: string): string {
  let out = text;
  for (const { re, replacement } of CLIENT_PII_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

// ─── Track + flush ─────────────────────────────────────────────────────────

/** Enqueue one event. Silently dropped if analytics is disabled. */
export function track(event: AnalyticsEvent): void {
  if (!analyticsEnabled()) return;
  if (buffer.length >= BUFFER_LIMIT) {
    // Drop oldest — keep recent events.
    buffer.shift();
  }
  buffer.push({ ...event, ts: event.ts ?? Date.now() });
  if (buffer.length >= FLUSH_THRESHOLD) {
    void flush();
  }
}

/** Convenience wrappers — keeps call sites terse. */
export const analytics = {
  pageView: (path: string) => track({ type: "page_view", path: normalizePath(path) }),
  routeChange: (path: string) => track({ type: "route_change", path: normalizePath(path) }),
  webVital: (metric: AnalyticsMetricName, value: number, detail?: Record<string, unknown>) =>
    track({ type: "web_vital", metric, value, detail }),
  jsError: (message: string, detail?: Record<string, unknown>) =>
    track({
      type: "js_error",
      // Scrub PII from the error message before it enters the buffer.
      // The worker also scrubs, but this prevents PII from hitting the wire.
      detail: { message: scrubPiiClient(message.slice(0, 500)), ...detail },
    }),
  apiCall: (endpoint: string, durationMs: number, detail?: Record<string, unknown>) =>
    track({ type: "api_call", metric: endpoint.slice(0, 80), value: Math.round(durationMs), detail }),
};

function apiUrl(): string | null {
  try {
    if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLOUD_API_URL) {
      return process.env.NEXT_PUBLIC_CLOUD_API_URL.replace(/\/$/, "");
    }
    const cfg = getConfig();
    if (cfg.cloud?.enabled && cfg.cloud.apiUrl) return cfg.cloud.apiUrl.replace(/\/$/, "");
  } catch {}
  return null;
}

/** POST the buffered events to the worker. Resets the buffer optimistically. */
export async function flush(): Promise<void> {
  if (!analyticsEnabled()) return;
  if (buffer.length === 0) return;
  const base = apiUrl();
  if (!base) return;

  const batch: AnalyticsBatch = {
    sessionId: ensureSessionId(),
    events: buffer,
  };
  buffer = [];

  const session = readCloudSession();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (session?.token) headers["authorization"] = `Bearer ${session.token}`;

  try {
    const res = await fetch(`${base}/v1/analytics/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
      keepalive: true,
      credentials: "omit",
    });
    if (res.ok) {
      consecutiveFailures = 0;
      return;
    }
    if (res.status === 429) {
      // Worker is rate-limiting us — back off by doubling the timer interval.
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS * 2);
      }
      // Re-queue — rate limiting is transient.
      buffer = [...batch.events, ...buffer].slice(0, BUFFER_LIMIT);
    } else if (res.status === 401 || res.status === 403) {
      // Auth failure — the session is dead. DON'T re-queue indefinitely;
      // the events were tied to a now-invalid session. Drop them.
      consecutiveFailures = 0;
    } else {
      // Other server error — re-queue with a failure counter so we
      // eventually give up instead of retrying forever.
      consecutiveFailures += 1;
      if (consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
        buffer = [...batch.events, ...buffer].slice(0, BUFFER_LIMIT);
      }
    }
  } catch {
    // Network error — re-queue with a failure counter.
    consecutiveFailures += 1;
    if (consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
      buffer = [...batch.events, ...buffer].slice(0, BUFFER_LIMIT);
    }
  }
}

function onVisibilityChange(): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    void flush();
  }
}
function onPageHide(): void { void flush(); }
function onBeforeUnload(): void { void flush(); }

/** Start the periodic flush timer + lifecycle listeners. Safe to call
 *  multiple times — listeners are bound exactly once via the
 *  `listenersBound` flag (previous version leaked listeners on every call). */
export function startAnalytics(): void {
  if (!analyticsEnabled()) return;
  if (!flushTimer) {
    flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  }
  if (!listenersBound && typeof window !== "undefined") {
    window.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    listenersBound = true;
  }
}

/** Stop everything and drop pending events. Used by tests + opt-out flow. */
export function stopAnalytics(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (listenersBound && typeof window !== "undefined") {
    window.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("beforeunload", onBeforeUnload);
    listenersBound = false;
  }
  buffer = [];
  consecutiveFailures = 0;
}

// Exported for the provider only:
export const __internal = {
  detectBrowser,
  detectDevice,
  detectConnection,
  ensureSessionId,
  normalizePath,
};
