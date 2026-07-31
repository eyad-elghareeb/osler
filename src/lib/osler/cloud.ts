import { getConfig, loadConfig } from "@/lib/osler/config";
import { flashcardReview, storage, type FlashcardReviewRecord, type QuestionRecord } from "@/lib/osler/storage";

const SESSION_STORAGE_KEY = "osler-cloud-session-v1";
const SYNC_DEBOUNCE_MS = 4_000;
const MIN_SYNC_INTERVAL_MS = 20_000;

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

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const config = await cloudConfig();
  if (!config) throw new CloudApiError(503, "Cloud accounts are unavailable");
  const response = await fetch(`${config.apiUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new CloudApiError(response.status, body.error || "Cloud request failed");
  return body;
}

export async function cloudEnabled(): Promise<boolean> {
  return !!await cloudConfig();
}

export async function cloudGoogleEnabled(): Promise<boolean> {
  const status = await request<{ googleEnabled: boolean }>("/v1/health", { method: "GET" });
  return status.googleEnabled;
}

export function readCloudSession(): CloudSession | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "null") as CloudSession | null;
    return value && value.expiresAt > Date.now() ? value : null;
  } catch {
    return null;
  }
}

export function saveCloudSession(session: CloudSession): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    void fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session }),
    }).catch(() => {});
  }
}

export function clearCloudSession(): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    void fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
  }
}

export async function registerCloudAccount(input: {
  username: string;
  email?: string;
  displayName: string;
  password: string;
  turnstileToken?: string;
}): Promise<CloudSession> {
  const session = await request<CloudSession>("/v1/auth/register", { method: "POST", body: JSON.stringify(input) });
  saveCloudSession(session);
  return session;
}

export async function cloudUsernameAvailable(username: string): Promise<boolean> {
  const result = await request<{ available: boolean }>(`/v1/auth/username-available?username=${encodeURIComponent(username)}`);
  return result.available;
}

export async function loginCloudAccount(input: {
  identifier: string;
  password: string;
  turnstileToken?: string;
}): Promise<CloudSession> {
  const session = await request<CloudSession>("/v1/auth/login", { method: "POST", body: JSON.stringify(input) });
  saveCloudSession(session);
  // Best-effort: pull the user's saved Gemini API key from the cloud DB so
  // they don't have to re-enter it on this device.
  void syncGeminiKeyFromCloud();
  return session;
}

export function startGoogleLogin(): void {
  if (typeof window === "undefined") return;
  const config = getConfig();
  const returnUrl = `${window.location.origin}/login`;
  window.location.assign(`${config.cloud.apiUrl.replace(/\/$/, "")}/v1/auth/google/start?returnTo=${encodeURIComponent(returnUrl)}`);
}

export async function consumeGoogleLogin(ticket: string): Promise<CloudSession> {
  const session = await request<CloudSession>("/v1/auth/google/consume", { method: "POST", body: JSON.stringify({ ticket }) });
  saveCloudSession(session);
  void syncGeminiKeyFromCloud();
  return session;
}

/**
 * Fetch the user's saved Gemini API key from /v1/account/gemini-key and write
 * it to localStorage so the AI assistant / qbank-studio / osce-studio pick
 * it up. Silently no-ops if cloud isn't enabled, the session is missing, or
 * the user has never saved a key.
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
      localStorage.setItem("osler_gemini_api_key", info.apiKey);
      if (info.model) localStorage.setItem("osler_gemini_model", info.model);
      if (info.maxWait != null) localStorage.setItem("osler_gemini_max_wait", String(info.maxWait));
      // Notify any open settings panel that the key changed.
      window.dispatchEvent(new CustomEvent("osler-gemini-key-synced", { detail: info }));
    }
  } catch {
    // silent
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

export async function deleteCloudAccount(session: CloudSession, input: { password?: string }): Promise<void> {
  await request("/v1/account", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE", ...input }) }, session.token);
  clearCloudSession();
}

export async function requestPasswordReset(email: string, turnstileToken?: string): Promise<void> {
  await request("/v1/auth/reset/request", { method: "POST", body: JSON.stringify({ email, turnstileToken }) });
}

export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  await request("/v1/auth/reset/confirm", { method: "POST", body: JSON.stringify({ token, password }) });
}

export async function requestEmailVerify(email: string): Promise<void> {
  await request("/v1/auth/verify/request", { method: "POST", body: JSON.stringify({ email }) });
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

let stopSync: (() => void) | null = null;
let forceSync: (() => void) | null = null;

export function syncCloudNow(): void {
  forceSync?.();
}

export function startCloudSync(session: CloudSession): () => void {
  stopSync?.();
  let stopped = false;
  let dirty = true;
  let syncing = false;
  let lastSyncAt = 0;
  let serverUpdatedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const sync = async () => {
    if (stopped || syncing || !dirty || !navigator.onLine) return;
    const sinceLastSync = Date.now() - lastSyncAt;
    if (sinceLastSync < MIN_SYNC_INTERVAL_MS) {
      timer = setTimeout(sync, MIN_SYNC_INTERVAL_MS - sinceLastSync);
      return;
    }
    syncing = true;
    window.dispatchEvent(new CustomEvent("osler-cloud-sync-status", { detail: { state: "syncing" } }));
    try {
      await storage.ensureCacheHydrated();
      const config = getConfig();
      const remote = await request<{
        qbank: { records: Record<string, QuestionRecord>; updatedAt: number };
        flashcards: { records: Record<string, FlashcardReviewRecord>; updatedAt: number };
      }>("/v1/sync", {}, session.token);
      await storage.mergeCloudProgress(
        config.cloud.syncQbank ? remote.qbank.records : undefined,
        config.cloud.syncFlashcards ? remote.flashcards.records : undefined,
      );
      // Track the latest server updatedAt for optimistic concurrency.
      serverUpdatedAt = Math.max(
        remote.qbank?.updatedAt ?? 0,
        remote.flashcards?.updatedAt ?? 0,
      );
      const saved = await request("/v1/sync", {
        method: "PUT",
        headers: serverUpdatedAt > 0 ? { "If-Unmodified-Since": String(serverUpdatedAt) } : {},
        body: JSON.stringify({
          ...(config.cloud.syncQbank ? { qbank: { records: storage.exportProgressRecords() } } : {}),
          ...(config.cloud.syncFlashcards ? { flashcards: { records: flashcardReview.getAll() } } : {}),
        }),
      }, session.token);
      void saved;
      dirty = false;
      lastSyncAt = Date.now();
      window.dispatchEvent(new CustomEvent("osler-cloud-sync-status", { detail: { state: "synced", syncedAt: lastSyncAt } }));
    } catch (error) {
      if (error instanceof CloudApiError) {
        if (error.status === 401) {
          clearCloudSession();
          window.dispatchEvent(new CustomEvent("osler-cloud-session-expired"));
        } else if (error.status === 409) {
          // Conflict — data changed since last fetch. Re-fetch and retry immediately.
          serverUpdatedAt = 0;
          dirty = true;
          lastSyncAt = 0;
          void sync();
          return;
        }
      }
      window.dispatchEvent(new CustomEvent("osler-cloud-sync-status", { detail: { state: "offline" } }));
    } finally {
      syncing = false;
    }
  };
  const schedule = () => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(sync, SYNC_DEBOUNCE_MS);
  };
  const onOnline = () => schedule();
  window.addEventListener("osler-progress-changed", schedule);
  window.addEventListener("osler-flashcard-changed", schedule);
  window.addEventListener("online", onOnline);
  void sync();
  forceSync = () => {
    dirty = true;
    lastSyncAt = 0;
    void sync();
  };
  stopSync = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener("osler-progress-changed", schedule);
    window.removeEventListener("osler-flashcard-changed", schedule);
    window.removeEventListener("online", onOnline);
    forceSync = null;
  };
  return stopSync;
}
