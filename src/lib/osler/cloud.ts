import { getConfig, loadConfig } from "@/lib/osler/config";
import { storage, settings, SYNC_KINDS, type SyncKind } from "@/lib/osler/storage";
import {
  getRealtimeConnId,
  startRealtime,
  stopRealtime,
} from "./cloud/realtime";

const SESSION_STORAGE_KEY = "osler-cloud-session-v1";
/** Set in sessionStorage when a stored cloud session could not be restored
 *  (revoked / expired beyond the refresh grace). The login screen reads and
 *  clears it to explain why the user was signed out. */
export const SESSION_EXPIRED_FLAG = "osler-cloud-session-expired";
const SYNC_DEBOUNCE_MS = 4_000;
const MIN_SYNC_INTERVAL_MS = 20_000;
// Realtime pokes arrive per pushing device — a burst of N devices pushing at
// once would otherwise trigger N full pull cycles. One trailing pull covers
// them all (each pull HEADs the server for what actually changed).
const POKE_PULL_DEBOUNCE_MS = 1_500;
// Rotate the token through /v1/auth/refresh once it's within this window of
// its expiry, so an active session never dies mid-use.
const REFRESH_AHEAD_MS = 6 * 60 * 60 * 1000;
// Exponential backoff for failed syncs (conflicts, transient 5xx, offline).
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;
// Only gzip request bodies that actually benefit from it (large sync snapshots).
const GZIP_BODY_THRESHOLD = 4 * 1024;

export interface CloudUser {
  id: string;
  username: string;
  displayName: string;
  role: "student" | "admin" | "content_admin";
  email: string | null;
  hasPassword: boolean;
}

export interface CloudSession {
  token: string;
  expiresAt: number;
  user: CloudUser;
}

export class CloudApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function cloudConfig() {
  const config = await loadConfig();
  if (!config.cloud.enabled || !config.cloud.apiUrl) return null;
  return config.cloud;
}

/** gzip a JSON request body when it's large enough to be worth it. Falls back
 *  to the raw string when CompressionStream is unavailable or compression
 *  wouldn't shrink the payload. */
async function maybeGzipBody(body: string): Promise<{ body: BodyInit; encoding: string | null }> {
  if (body.length < GZIP_BODY_THRESHOLD || typeof CompressionStream === "undefined") return { body, encoding: null };
  try {
    const bytes = new TextEncoder().encode(body);
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    if (compressed.byteLength >= body.length) return { body, encoding: null };
    return { body: compressed, encoding: "gzip" };
  } catch {
    return { body, encoding: null };
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const config = await cloudConfig();
  if (!config) throw new CloudApiError(503, "Cloud accounts are unavailable");
  let body = init.body;
  let encoding: string | null = null;
  if (typeof init.body === "string") {
    const gzipped = await maybeGzipBody(init.body);
    body = gzipped.body;
    encoding = gzipped.encoding;
  }
  const response = await fetch(`${config.apiUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    body,
    headers: {
      "content-type": "application/json",
      ...(encoding ? { "content-encoding": encoding } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const bodyJson = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new CloudApiError(response.status, bodyJson.error || "Cloud request failed");
  return bodyJson;
}

export async function cloudEnabled(): Promise<boolean> {
  return !!await cloudConfig();
}

export async function cloudGoogleEnabled(): Promise<boolean> {
  const status = await request<{ googleEnabled: boolean }>("/v1/health", { method: "GET" });
  return status.googleEnabled;
}

/** Parse + shape-validate a persisted CloudSession JSON blob. A corrupted or
 *  tampered entry must not be trusted — callers use `session.token` to call
 *  Worker APIs and a bad value would send `Bearer undefined`. */
function parseCloudSession(raw: string | null): CloudSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    if (
      typeof value.token !== "string" || value.token.length === 0 || value.token.length > 2048 ||
      typeof value.expiresAt !== "number" ||
      !value.user || typeof value.user !== "object" ||
      typeof value.user.id !== "string" ||
      typeof value.user.username !== "string" ||
      typeof value.user.displayName !== "string" ||
      typeof value.user.role !== "string"
    ) {
      return null;
    }
    return value as CloudSession;
  } catch {
    return null;
  }
}

/**
 * Read the persisted cloud session from either storage tier. `sessionStorage`
 * is the per-tab fast path; `localStorage` is a cross-tab / cross-restart
 * mirror that keeps the account signed in across tabs and browser sessions.
 *
 * When both copies exist they are reconciled to the one with the later
 * `expiresAt` (a rotated token supersedes an older one) and the loser copy is
 * re-synced so the two mirrors never diverge.
 */
export function readStoredCloudSession(): CloudSession | null {
  if (typeof window === "undefined") return null;
  let fromStorage: CloudSession | null = null;
  let fromLocal: CloudSession | null = null;
  try { fromStorage = parseCloudSession(sessionStorage.getItem(SESSION_STORAGE_KEY)); } catch {}
  try { fromLocal = parseCloudSession(localStorage.getItem(SESSION_STORAGE_KEY)); } catch {}
  let session: CloudSession | null = null;
  if (fromStorage && fromLocal) {
    session = fromStorage.expiresAt >= fromLocal.expiresAt ? fromStorage : fromLocal;
  } else {
    session = fromStorage ?? fromLocal;
  }
  if (!session) return null;
  // Re-sync both mirrors so they agree on the winning session.
  try { sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session)); } catch {}
  try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session)); } catch {}
  return session;
}

export function readCloudSession(): CloudSession | null {
  const session = readStoredCloudSession();
  if (!session || session.expiresAt <= Date.now()) return null;
  return session;
}

/**
 * Save the cloud session to `sessionStorage` (per-tab fast path) AND mirror
 * it to `localStorage` so the account stays signed in across new tabs and
 * browser restarts. A redacted username hint is also written for the login
 * form pre-fill. The bearer token is HMAC-signed, validated server-side
 * against D1 (revocable), and readable by same-origin JS regardless of which
 * storage tier holds it — localStorage just gives the session a longer life.
 *
 * NOTE: There is no longer an httpOnly cookie issued by a Next.js server
 * route — the static export has no server. Route gating is enforced purely
 * client-side by `RouteGuard` (see `src/components/osler/route-guard.tsx`).
 */
export function saveCloudSession(session: CloudSession): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session)); } catch {}
  try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session)); } catch {}
  // Notify other tabs on the same origin that the session changed.
  // The storage event fires automatically for localStorage writes, but
  // sessionStorage writes don't fire it — so we dispatch a custom event
  // on the same window (intra-tab) and use BroadcastChannel for cross-tab.
  try {
    notifySessionChange("login", session.user.displayName);
  } catch {
    // BroadcastChannel might be unavailable in old browsers; ignore.
  }
}

export function clearCloudSession(): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(SESSION_STORAGE_KEY); } catch {}
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch {}
  try {
    notifySessionChange("logout", null);
  } catch {
    // ignore
  }
}

// ─── Cross-tab session notifications ─────────────────────────────────────────
//
// The static export has no server-side cookie to gate routes. Instead we use
// a BroadcastChannel so a logout on tab A immediately clears the UI on tab B.
// The OslerSessionProvider listens for these events and updates its state.

let bc: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (bc) return bc;
  try {
    bc = new BroadcastChannel("osler-session");
    return bc;
  } catch {
    return null;
  }
}

function notifySessionChange(kind: "login" | "logout", username: string | null): void {
  const ch = getChannel();
  if (!ch) return;
  ch.postMessage({ kind, username, at: Date.now() });
}

export function subscribeSessionChanges(cb: (kind: "login" | "logout", username: string | null) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (e: MessageEvent) => {
    if (!e.data || typeof e.data !== "object") return;
    if (e.data.kind !== "login" && e.data.kind !== "logout") return;
    cb(e.data.kind, e.data.username ?? null);
  };
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}
// ─────────────────────────────────────────────────────────────────────────────

export async function registerCloudAccount(input: {
  username: string;
  email?: string;
  displayName: string;
  password: string;
  turnstileToken?: string;
}): Promise<CloudSession> {
  const session = await request<CloudSession>("/v1/auth/register", { method: "POST", body: JSON.stringify(input) });
  saveCloudSession(session);
  // New account has no server settings yet — the first device's local
  // settings will be pushed on the first sync; no pull needed here.
  return session;
}

export async function cloudUsernameAvailable(username: string): Promise<boolean> {
  const result = await request<{ available: boolean }>(`/v1/auth/username-available?username=${encodeURIComponent(username)}`);
  return result.available === true;
}

/** Verify a Turnstile token for a guest (local-only) login. The guest session
 *  never reaches the auth endpoints, so the bot check runs through this
 *  dedicated pre-auth endpoint instead. */
export async function verifyGuestTurnstile(turnstileToken: string): Promise<boolean> {
  const result = await request<{ ok: boolean }>("/v1/guest/verify", {
    method: "POST",
    body: JSON.stringify({ turnstileToken }),
  });
  return result.ok === true;
}

export async function loginCloudAccount(input: {
  identifier: string;
  password: string;
  turnstileToken?: string;
}): Promise<CloudSession> {
  const session = await request<CloudSession>("/v1/auth/login", { method: "POST", body: JSON.stringify(input) });
  saveCloudSession(session);
  // Best-effort: pull the user's saved Gemini API key and account-level
  // settings so they don't have to re-enter them on this device. Settings
  // is account-level and always synced — a device that enabled cloud sync
  // on another machine will pick up `cloud-sync-enabled=true` here.
  void syncGeminiKeyFromCloud();
  void pullSettingsFromCloud(session);
  return session;
}

export function startGoogleLogin(): void {
  if (typeof window === "undefined") return;
  const config = getConfig();
  const returnUrl = `${window.location.origin}/login`;
  // Cross-origin hop to the Worker (which 302s to Google) — router.push can't leave the app origin.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`${config.cloud.apiUrl.replace(/\/$/, "")}/v1/auth/google/start?returnTo=${encodeURIComponent(returnUrl)}`);
}

export async function consumeGoogleLogin(ticket: string): Promise<CloudSession> {
  const session = await request<CloudSession>("/v1/auth/google/consume", { method: "POST", body: JSON.stringify({ ticket }) });
  saveCloudSession(session);
  void syncGeminiKeyFromCloud();
  void pullSettingsFromCloud(session);
  return session;
}

/**
 * Rotate the current session through the Worker's /v1/auth/refresh endpoint.
 * The Worker accepts a still-signed token even after its `exp` claim passes
 * (within a 30-day grace) and returns a brand-new session; the old one is
 * revoked server-side. Used on restore when the persisted token is expired
 * and by the sync loop on 401 — this is what stops a 7-day-old session from
 * silently degrading the user to a local-only account.
 *
 * Returns null on any failure (revoked session, network error, cloud
 * disabled). The refreshed session is persisted via `saveCloudSession` and
 * broadcast to other tabs / the session provider via
 * `osler-cloud-session-refreshed`.
 */
export async function refreshCloudSession(session: CloudSession): Promise<CloudSession | null> {
  try {
    const next = await request<CloudSession>("/v1/auth/refresh", { method: "POST", body: "{}" }, session.token);
    if (!next?.token || typeof next.expiresAt !== "number" || !next?.user) return null;
    saveCloudSession(next);
    try {
      window.dispatchEvent(new CustomEvent("osler-cloud-session-refreshed", { detail: { session: next } }));
    } catch {
      // ignore
    }
    return next;
  } catch {
    return null;
  }
}

/**
 * Provenance marker: set when the local Gemini key copy was pulled from the
 * cloud account. Lets a later sync safely remove a stale local copy when the
 * key is deleted on another device — without touching locally-entered keys.
 */
export const GEMINI_CLOUD_SYNCED_FLAG = "osler_gemini_cloud_synced";

const GEMINI_API_KEY = "osler_gemini_api_key";
const GEMINI_MODEL = "osler_gemini_model";
const GEMINI_MAX_WAIT = "osler_gemini_max_wait";

/** Write a cloud-pulled Gemini key into localStorage and flag it as
 *  cloud-synced so a future removal can be reconciled across devices. */
export function applyGeminiKeyInfo(info: {
  apiKey: string | null;
  model?: string | null;
  maxWait?: number | null;
}): void {
  if (typeof window === "undefined") return;
  if (!info.apiKey) return;
  localStorage.setItem(GEMINI_API_KEY, info.apiKey);
  if (info.model) localStorage.setItem(GEMINI_MODEL, info.model);
  if (info.maxWait != null) localStorage.setItem(GEMINI_MAX_WAIT, String(info.maxWait));
  localStorage.setItem(GEMINI_CLOUD_SYNCED_FLAG, "1");
  window.dispatchEvent(new CustomEvent("osler-gemini-key-synced", { detail: info }));
}

/** Remove the locally-cached Gemini key copy entirely. */
export function clearGeminiLocalKey(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(GEMINI_API_KEY);
  localStorage.removeItem(GEMINI_MODEL);
  localStorage.removeItem(GEMINI_MAX_WAIT);
  localStorage.removeItem(GEMINI_CLOUD_SYNCED_FLAG);
}

/**
 * Fetch the user's saved Gemini API key from /v1/account/gemini-key and write
 * it to localStorage so the AI assistant / qbank-studio / osce-studio pick
 * it up. Silently no-ops if cloud isn't enabled, the session is missing, or
 * the user has never saved a key.
 *
 * Reconciliation: when the cloud reports the key was removed, the local copy
 * is deleted too — but only if it came from a previous cloud sync, so a
 * locally-entered key is never wiped.
 */
export async function syncGeminiKeyFromCloud(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const session = readCloudSession();
    if (!session?.token) return;
    const apiUrl = resolvedApiUrl();
    if (!apiUrl) return;
    const res = await fetch(`${apiUrl}/v1/account/gemini-key`, {
      headers: { authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return;
    const info = await res.json();
    if (info?.hasKey && info.apiKey) {
      applyGeminiKeyInfo(info);
    } else if (info?.hasKey === false) {
      // Key removed on another device — drop the stale local copy only if it
      // was cloud-synced before. Never a locally-entered key.
      if (localStorage.getItem(GEMINI_CLOUD_SYNCED_FLAG) === "1") {
        clearGeminiLocalKey();
      }
    }
  } catch {
    // silent
  }
}

/**
 * Pull the account-level settings snapshot (always synced) so a new device
 * inherits the account's preferences — notably `cloud-sync-enabled` — on its
 * first login. Best-effort: no-ops when offline or when the settings doc
 * hasn't been created yet (e.g. first-ever login on the account).
 */
export async function pullSettingsFromCloud(sessionOverride?: CloudSession): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const session = sessionOverride ?? readCloudSession();
    if (!session?.token) return;
    const apiUrl = resolvedApiUrl();
    if (!apiUrl) return;
    await storage.ensureCacheHydrated();
    const remote = await request<Record<string, { records: Record<string, unknown>; updatedAt: number }>>(
      `/v1/sync?kinds=settings`,
      {},
      session.token,
    );
    if (remote.settings) {
      await storage.mergeCloudSnapshot(remote);
      // Keep the in-memory pref in sync so the realtime hub and the
      // session provider see the new value without an extra IDB read.
      try {
        syncEnabledPref = (await settings.getBool(CLOUD_SYNC_PREF)) === true;
      } catch {}
    }
  } catch {
    // silent – settings sync is best-effort on login/restore
  }
}

/** Helper: resolve the cloud API URL the same way admin-api.ts does. */
function resolvedApiUrl(): string | null {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLOUD_API_URL) {
    return process.env.NEXT_PUBLIC_CLOUD_API_URL.replace(/\/$/, "");
  }
  try {
    const cfg = getConfig().cloud;
    if (cfg.enabled && cfg.apiUrl) return cfg.apiUrl.replace(/\/$/, "");
  } catch {}
  return null;
}

/**
 * Resolve the cloud API URL synchronously (no config reload). Used by the
 * admin R2 browser / image-upload helpers to fetch R2-backed content
 * directly from the Worker — replacing the old /api/r2-fetch proxy that
 * lived in the Pages backend. Returns null if cloud is disabled.
 */
export function resolvedCloudApiUrlSync(): string | null {
  return resolvedApiUrl();
}

export interface CloudAccount {
  user: CloudUser;
  providers: string[];
}

export async function getCloudAccount(session: CloudSession): Promise<CloudAccount> {
  return request<CloudAccount>("/v1/auth/me", { method: "GET" }, session.token);
}

export async function updateCloudAccount(session: CloudSession, input: { displayName: string; email: string | null }): Promise<CloudAccount> {
  return request<CloudAccount>("/v1/account", { method: "PATCH", body: JSON.stringify(input) }, session.token);
}

export async function changeCloudPassword(session: CloudSession, input: { currentPassword?: string; password: string }): Promise<CloudSession> {
  const next = await request<CloudSession>("/v1/account/password", { method: "POST", body: JSON.stringify(input) }, session.token);
  saveCloudSession(next);
  return next;
}

export async function exportCloudAccount(session: CloudSession): Promise<unknown> {
  return request("/v1/account/export", { method: "GET" }, session.token);
}

/* ── Session / device management ─────────────────────────────────────────── */

/** One active sign-in ("device") for the account. */
export interface CloudSessionInfo {
  id: string;
  /** Raw User-Agent string captured at sign-in (null for legacy rows). */
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  /** True when this is the session making the request. */
  current: boolean;
}

/** List every active session for the account (newest activity first). */
export async function listCloudSessions(session: CloudSession): Promise<CloudSessionInfo[]> {
  const result = await request<{ sessions: CloudSessionInfo[] }>("/v1/account/sessions", { method: "GET" }, session.token);
  return result.sessions ?? [];
}

/** Revoke one session ("sign out that device"). */
export async function revokeCloudSession(session: CloudSession, sessionId: string): Promise<void> {
  await request(`/v1/account/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }, session.token);
}

/** Revoke every session except the caller's (sign out all other devices). */
export async function revokeOtherCloudSessions(session: CloudSession): Promise<void> {
  await request("/v1/account/sessions/revoke-others", { method: "POST" }, session.token);
}

export async function deleteCloudAccount(session: CloudSession, input: { password?: string }): Promise<void> {
  await request("/v1/account", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE", ...input }) }, session.token);
  clearCloudSession();
}

export async function requestPasswordReset(email: string, turnstileToken?: string): Promise<void> {
  await request("/v1/auth/reset/request", { method: "POST", body: JSON.stringify({ email, turnstileToken }) });
}

export async function confirmPasswordReset(token: string, password: string, turnstileToken?: string): Promise<void> {
  await request("/v1/auth/reset/confirm", { method: "POST", body: JSON.stringify({ token, password, turnstileToken }) });
}

export async function requestEmailVerify(email: string, turnstileToken?: string): Promise<void> {
  await request("/v1/auth/verify/request", { method: "POST", body: JSON.stringify({ email, turnstileToken }) });
}

export async function confirmEmailVerify(token: string): Promise<{ ok: boolean; verified: boolean }> {
  return request<{ ok: boolean; verified: boolean }>("/v1/auth/verify/confirm", { method: "POST", body: JSON.stringify({ token }) });
}

export async function logoutCloudAccount(session: CloudSession | null): Promise<void> {
  try {
    if (session) await request("/v1/auth/logout", { method: "POST", body: "{}" }, session.token);
  } finally {
    clearCloudSession();
  }
}

/* ── QBank choice stats ──
 * Aggregated peer-answer percentages (see question-stats.ts for the client
 * buffer/cache). Auth is optional — guests contribute and read too; the
 * worker stores only anonymous aggregate counts.
 */

export interface QuestionChoiceStats {
  /** Choice counts, indexed by choice position. */
  c: number[];
  /** Total respondents across all choices. */
  t: number;
  /** Option count recorded when the counter was written — lets the client
   *  detect aggregates that went stale after the pack was edited. */
  oc: number;
}

/** Report answered choices for a finished session. `answers` entries are
 *  [questionId, chosenIndex, optionsCount]. Every answered MCQ is reported;
 *  the worker dedupes per contributor (signed-in account hash or guest
 *  UUID), so retakes/repeats never inflate aggregates. Throws on failure. */
export async function reportQuestionStats(uid: string, aid: string, answers: Array<[string, number, number]>): Promise<void> {
  const session = readCloudSession();
  await request("/v1/qbank/stats", { method: "POST", body: JSON.stringify({ uid, aid, answers }) }, session?.token);
}

/** Fetch aggregated choice stats for every question in a pack. Throws on failure. */
export async function fetchQuestionStats(uid: string): Promise<Record<string, QuestionChoiceStats>> {
  const session = readCloudSession();
  const result = await request<{ stats: Record<string, QuestionChoiceStats> }>(
    `/v1/qbank/stats?uid=${encodeURIComponent(uid)}`,
    { method: "GET" },
    session?.token,
  );
  return result.stats;
}

/* ── Support tickets ──
 * Filed from Settings / QBank question reports / Library article reports.
 * The client generates the id so its local receipt merges cleanly with the
 * server's status updates. Delivery requires cloud to be configured; the
 * support lib keeps an offline receipt and marks it unsynced otherwise.
 */

export async function submitSupportTicket(input: {
  id: string;
  source: string;
  category: string;
  subject: string;
  message: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  const session = readCloudSession();
  await request("/v1/support/tickets", { method: "POST", body: JSON.stringify(input) }, session?.token);
}

/** The signed-in user's tickets. Returns null when there is no cloud session
 *  (guests keep their receipts locally only). Throws on transport failure. */
export async function fetchMySupportTickets(): Promise<unknown[] | null> {
  const session = readCloudSession();
  if (!session) return null;
  const result = await request<{ tickets: unknown[] }>("/v1/support/tickets", { method: "GET" }, session.token);
  return result.tickets;
}

/* ── Cloud sync (opt-in) ─────────────────────────────────────────────────── */

const CLOUD_SYNC_PREF = "cloud-sync-enabled";
let syncEnabledPref = false;

/** Whether the user opted into cloud sync on this device. Off by default:
 *  a signed-in user who never enables sync makes zero sync requests — nothing
 *  is pushed, pulled, or polled — which keeps the free-tier DB/bandwidth
 *  budget for the devices that actually need cross-device sync. */
export async function getCloudSyncEnabled(): Promise<boolean> {
  try {
    syncEnabledPref = (await settings.getBool(CLOUD_SYNC_PREF)) === true;
  } catch {
    syncEnabledPref = false;
  }
  return syncEnabledPref;
}

/** Window event fired by `setCloudSyncEnabled` (detail: { enabled }) so the
 *  session provider can start/stop the sync loop live, without a reload. */
export const CLOUD_SYNC_PREF_EVENT = "osler-cloud-sync-pref";

export async function setCloudSyncEnabled(value: boolean): Promise<void> {
  syncEnabledPref = value;
  try {
    await settings.set(CLOUD_SYNC_PREF, value ? "true" : "false");
  } catch { /* private mode — session-scoped only */ }
  try {
    window.dispatchEvent(new CustomEvent(CLOUD_SYNC_PREF_EVENT, { detail: { enabled: value } }));
  } catch { /* ignore */ }
  // Push the settings doc immediately so another device's next login sees
  // the new value without waiting for the debounced sync loop (which may
  // not even be running on this device if the user just enabled sync).
  try {
    const session = readCloudSession();
    if (session?.token) {
      void (async () => {
        try {
          await storage.ensureCacheHydrated();
          const payload = storage.exportSyncSnapshot(["settings"] as SyncKind[]);
          await request("/v1/sync", { method: "PUT", body: JSON.stringify(payload) }, session.token);
        } catch {}
      })();
    }
  } catch {}
}

let stopSync: (() => void) | null = null;
let forceSync: (() => void) | null = null;

/** Last known cloud storage usage (reported by the worker's GET /v1/sync). */
let syncQuota: { usedBytes: number; limitBytes: number } | null = null;

const EVENT_TO_KIND: Record<string, SyncKind> = {
  "osler-progress-changed": "qbank",
  "osler-flashcard-changed": "flashcards",
  "osler-sessions-changed": "sessions",
  "osler-notes-changed": "notes",
  "osler-article-highlights-changed": "articleHighlights",
  "osler-bookmarks-changed": "bookmarks",
  "osler-achievements-changed": "achievements",
  "osler-settings-changed": "settings",
  "osler-quiz-settings-changed": "settings",
};

export function getSyncQuota(): { usedBytes: number; limitBytes: number } | null {
  return syncQuota;
}

export type CloudSyncStatus = "off" | "synced" | "syncing" | "offline";

let lastSyncStatus: CloudSyncStatus = "off";

/** Publish a sync-status transition to the UI (shell dot + status card) and
 *  cache it so late-mounting surfaces can initialize truthily. */
export function notifySyncStatus(state: CloudSyncStatus, syncedAt?: number): void {
  lastSyncStatus = state;
  window.dispatchEvent(new CustomEvent("osler-cloud-sync-status", { detail: { state, ...(syncedAt != null ? { syncedAt } : {}) } }));
}

export function getSyncStatus(): CloudSyncStatus {
  return lastSyncStatus;
}

export function syncCloudNow(): void {
  forceSync?.();
}

export function startCloudSync(session: CloudSession): () => void {
  stopSync?.();
  let stopped = false;
  let currentSession = session;
  const dirtyKinds = new Set<SyncKind>();
  const dirtyKindsDuringSync = new Set<SyncKind>();
  let syncing = false;
  let pokePending = false;
  let pokeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSyncAt = 0;
  const serverUpdatedAt: Record<string, number> = {};
  let retryCount = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const runSync = async (pullOnly = false) => {
    if (stopped || syncing) return;
    if (!pullOnly && dirtyKinds.size === 0) return;
    if (!navigator.onLine) {
      timer = setTimeout(() => void runSync(pullOnly), SYNC_DEBOUNCE_MS);
      return;
    }
    const sinceLastSync = Date.now() - lastSyncAt;
    if (sinceLastSync < MIN_SYNC_INTERVAL_MS) {
      timer = setTimeout(() => void runSync(pullOnly), MIN_SYNC_INTERVAL_MS - sinceLastSync);
      return;
    }
    syncing = true;
    dirtyKindsDuringSync.clear();
    const kindsToPush = new Set(dirtyKinds);
    notifySyncStatus("syncing");
    try {
      await storage.ensureCacheHydrated();

      if (currentSession.expiresAt - Date.now() < REFRESH_AHEAD_MS) {
        const refreshed = await refreshCloudSession(currentSession);
        if (refreshed) currentSession = refreshed;
      }

      const config = getConfig();

      // 1. Lightweight HEAD check to inspect server timestamps and quota
      const head = await request<{
        timestamps?: Record<string, number>;
        quota?: { usedBytes: number; limitBytes: number };
      }>("/v1/sync?head=true", {}, currentSession.token);

      if (typeof head.quota?.usedBytes === "number" && typeof head.quota?.limitBytes === "number") {
        syncQuota = { usedBytes: head.quota.usedBytes, limitBytes: head.quota.limitBytes };
        window.dispatchEvent(new CustomEvent("osler-cloud-sync-quota", { detail: syncQuota }));
      }

      const remoteTimestamps = head.timestamps || {};
      const kindsToPull: SyncKind[] = [];
      for (const kind of SYNC_KINDS) {
        const remoteTime = remoteTimestamps[kind] ?? 0;
        const localServerTime = serverUpdatedAt[kind] ?? 0;
        if (remoteTime > localServerTime) {
          // settings is account-level and always synced, even when other
          // content kinds are disabled — it carries the sync-enabled flag
          // itself so a new device picks it up on its next login.
          if (kind === "settings") {
            kindsToPull.push(kind as SyncKind);
            continue;
          }
          if (kind === "qbank" && !config.cloud.syncQbank) continue;
          if (kind === "flashcards" && !config.cloud.syncFlashcards) continue;
          if (kind !== "qbank" && kind !== "flashcards" && !config.cloud.syncContent) continue;
          kindsToPull.push(kind as SyncKind);
        }
      }

      // 2. Pull only outdated kinds (if any)
      if (kindsToPull.length > 0) {
        const remote = await request<Record<string, { records: Record<string, unknown>; updatedAt: number }>>(`/v1/sync?kinds=${kindsToPull.join(",")}`, {}, currentSession.token);
        if (!config.cloud.syncQbank) delete remote.qbank;
        if (!config.cloud.syncFlashcards) delete remote.flashcards;
        if (!config.cloud.syncContent) {
          delete remote.sessions;
          delete remote.notes;
          delete remote.highlights;
          delete remote.articleHighlights;
          delete remote.writtenDrafts;
          delete remote.bookmarks;
        }
        await storage.mergeCloudSnapshot(remote);
        for (const kind of SYNC_KINDS) {
          if (remote[kind]) serverUpdatedAt[kind] = remote[kind]?.updatedAt ?? remoteTimestamps[kind] ?? 0;
        }
      } else {
        for (const kind of SYNC_KINDS) {
          if (remoteTimestamps[kind] != null) serverUpdatedAt[kind] = remoteTimestamps[kind];
        }
      }

      // 3. Selective Push — settings always pushes (account-level).
      if (kindsToPush.size > 0) {
        const activeKindsToPush: SyncKind[] = [];
        for (const kind of kindsToPush) {
          if (kind === "settings") {
            activeKindsToPush.push(kind);
            continue;
          }
          if (kind === "qbank" && !config.cloud.syncQbank) continue;
          if (kind === "flashcards" && !config.cloud.syncFlashcards) continue;
          if (kind !== "qbank" && kind !== "flashcards" && !config.cloud.syncContent) continue;
          activeKindsToPush.push(kind);
        }

        if (activeKindsToPush.length > 0) {
          const headers: Record<string, string> = {};
          for (const kind of activeKindsToPush) {
            if (serverUpdatedAt[kind] > 0) headers[`x-sync-since-${kind}`] = String(serverUpdatedAt[kind]);
          }
          // Lets the realtime hub skip this connection when poking (it just
          // pushed; it doesn't need to pull its own change back).
          headers["x-osler-realtime-conn"] = getRealtimeConnId();
          const payload = storage.exportSyncSnapshot(activeKindsToPush);
          const pushedResult = await request<Record<string, { records: Record<string, unknown>; updatedAt: number }>>("/v1/sync", {
            method: "PUT",
            headers,
            body: JSON.stringify(payload),
          }, currentSession.token);

          for (const kind of activeKindsToPush) {
            if (pushedResult[kind]?.updatedAt) {
              serverUpdatedAt[kind] = pushedResult[kind].updatedAt;
            }
            dirtyKinds.delete(kind);
          }
          lastSyncAt = Date.now();
          notifySyncStatus("synced", lastSyncAt);
        }
      } else {
        lastSyncAt = Date.now();
      }

      for (const kind of dirtyKindsDuringSync) {
        dirtyKinds.add(kind);
      }
      retryCount = 0;
    } catch (error) {
      if (error instanceof CloudApiError) {
        if (error.status === 401) {
          const refreshed = await refreshCloudSession(currentSession);
          if (refreshed) {
            currentSession = refreshed;
            for (const kind of Object.keys(serverUpdatedAt)) serverUpdatedAt[kind] = 0;
            for (const kind of SYNC_KINDS) dirtyKinds.add(kind as SyncKind);
            lastSyncAt = 0;
          } else {
            clearCloudSession();
            window.dispatchEvent(new CustomEvent("osler-cloud-session-expired"));
            stopped = true;
          }
        } else if (error.status === 409) {
          for (const kind of Object.keys(serverUpdatedAt)) serverUpdatedAt[kind] = 0;
          for (const kind of SYNC_KINDS) dirtyKinds.add(kind as SyncKind);
          lastSyncAt = 0;
        }
      } else {
        notifySyncStatus("offline");
      }
    } finally {
      syncing = false;
      // A poke arrived while this cycle was running — one deferred pull
      // covers it. (When dirty kinds remain, the retry below pulls too.)
      if (pokePending) {
        pokePending = false;
        if (dirtyKinds.size === 0 && !stopped && navigator.onLine) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void runSync(true), 1_000);
        }
      }
      if (dirtyKinds.size > 0 && !stopped && navigator.onLine) {
        if (timer) clearTimeout(timer);
        const backoff = Math.min(RETRY_BASE_MS * 2 ** retryCount, RETRY_MAX_MS);
        retryCount += 1;
        timer = setTimeout(() => void runSync(), backoff);
      }
    }
  };

  const schedule = (e?: Event) => {
    if (e && e.type in EVENT_TO_KIND) {
      const kind = EVENT_TO_KIND[e.type];
      dirtyKinds.add(kind);
      dirtyKindsDuringSync.add(kind);
    } else {
      for (const kind of SYNC_KINDS) {
        dirtyKinds.add(kind as SyncKind);
        dirtyKindsDuringSync.add(kind as SyncKind);
      }
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runSync(), SYNC_DEBOUNCE_MS);
  };

  const onOnline = () => schedule();

  // One pull when the tab returns to the foreground — covers pokes missed
  // while the realtime socket was closed (hidden tab, offline). Event-driven,
  // not a cadence: an idle visible tab makes no sync requests at all.
  const onVisible = () => {
    if (document.visibilityState === "visible" && !syncing) void runSync(true);
  };

  const syncEvents = [
    "osler-progress-changed",
    "osler-flashcard-changed",
    "osler-sessions-changed",
    "osler-notes-changed",
    "osler-article-highlights-changed",
    "osler-bookmarks-changed",
    "osler-achievements-changed",
  ];
  for (const event of syncEvents) window.addEventListener(event, schedule);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);

  // The live socket IS the pull signal now: a poke from another device
  // triggers an instant pull, and the socket closes whenever the tab hides,
  // goes offline, or hits Data Saver. Nothing polls on a timer — sync only
  // runs here because the user opted in upstream (session provider).
  startRealtime({
    isEnabled: () => syncEnabledPref && !stopped,
    getApiUrl: () => resolvedApiUrl(),
    getAccessToken: () => currentSession?.token ?? null,
    onSyncPoke: () => {
      if (syncing) {
        pokePending = true;
        return;
      }
      if (pokeTimer) clearTimeout(pokeTimer);
      pokeTimer = setTimeout(() => {
        pokeTimer = null;
        void runSync(true);
      }, POKE_PULL_DEBOUNCE_MS);
    },
  });

  void runSync(true);

  forceSync = () => {
    for (const kind of SYNC_KINDS) dirtyKinds.add(kind as SyncKind);
    lastSyncAt = 0;
    retryCount = 0;
    if (timer) clearTimeout(timer);
    void runSync();
  };

  stopSync = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (pokeTimer) {
      clearTimeout(pokeTimer);
      pokeTimer = null;
    }
    stopRealtime();
    for (const event of syncEvents) window.removeEventListener(event, schedule);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    forceSync = null;
  };
  return stopSync;
}
