import { getConfig, loadConfig } from "@/lib/osler/config";
import { flashcardReview, storage, type FlashcardReviewRecord, type QuestionRecord } from "@/lib/osler/storage";

const SESSION_STORAGE_KEY = "osler-cloud-session-v1";
const SYNC_DEBOUNCE_MS = 4_000;
const MIN_SYNC_INTERVAL_MS = 20_000;

export interface CloudUser {
  id: string;
  username: string;
  displayName: string;
  role: "student" | "admin";
  email: string | null;
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
  if (typeof window !== "undefined") sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearCloudSession(): void {
  if (typeof window !== "undefined") sessionStorage.removeItem(SESSION_STORAGE_KEY);
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
  return session;
}

export async function requestPasswordReset(email: string, turnstileToken?: string): Promise<void> {
  await request("/v1/auth/reset/request", { method: "POST", body: JSON.stringify({ email, turnstileToken }) });
}

export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  await request("/v1/auth/reset/confirm", { method: "POST", body: JSON.stringify({ token, password }) });
}

export async function logoutCloudAccount(session: CloudSession | null): Promise<void> {
  try {
    if (session) await request("/v1/auth/logout", { method: "POST", body: "{}" }, session.token);
  } finally {
    clearCloudSession();
  }
}

let stopSync: (() => void) | null = null;

export function startCloudSync(session: CloudSession): () => void {
  stopSync?.();
  let stopped = false;
  let dirty = true;
  let syncing = false;
  let lastSyncAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const sync = async () => {
    if (stopped || syncing || !dirty || !navigator.onLine) return;
    const sinceLastSync = Date.now() - lastSyncAt;
    if (sinceLastSync < MIN_SYNC_INTERVAL_MS) {
      timer = setTimeout(sync, MIN_SYNC_INTERVAL_MS - sinceLastSync);
      return;
    }
    syncing = true;
    try {
      await storage.ensureCacheHydrated();
      const config = getConfig();
      const remote = await request<{
        qbank: { records: Record<string, QuestionRecord> };
        flashcards: { records: Record<string, FlashcardReviewRecord> };
      }>("/v1/sync", {}, session.token);
      await storage.mergeCloudProgress(
        config.cloud.syncQbank ? remote.qbank.records : undefined,
        config.cloud.syncFlashcards ? remote.flashcards.records : undefined,
      );
      const saved = await request("/v1/sync", {
        method: "PUT",
        body: JSON.stringify({
          ...(config.cloud.syncQbank ? { qbank: { records: storage.exportProgressRecords() } } : {}),
          ...(config.cloud.syncFlashcards ? { flashcards: { records: flashcardReview.getAll() } } : {}),
        }),
      }, session.token);
      void saved;
      dirty = false;
      lastSyncAt = Date.now();
    } catch (error) {
      if (error instanceof CloudApiError && error.status === 401) {
        clearCloudSession();
        window.dispatchEvent(new CustomEvent("osler-cloud-session-expired"));
      }
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
  stopSync = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener("osler-progress-changed", schedule);
    window.removeEventListener("osler-flashcard-changed", schedule);
    window.removeEventListener("online", onOnline);
  };
  return stopSync;
}
