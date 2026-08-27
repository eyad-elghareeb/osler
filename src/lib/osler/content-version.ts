/**
 * Content freshness tracker.
 *
 * Cloud instances publish content by writing R2 manifests; a tiny version
 * document (GET /v1/content-version, ~40 bytes, no-store) advances on every
 * mutation. Bundled instances expose the same shape at
 * /osler-content/content-version.json (regenerated alongside the manifests).
 *
 * Clients poll the version document, and when it moves: manifest URLs gain a
 * `?v=<stamp>` cache-buster (turning them immutable for browsers/CDN), the
 * in-memory content caches are dropped, and an `osler-content-invalidated`
 * window event fires so live views can refetch on their next load. This is
 * what makes freshly published content appear instantly instead of waiting
 * out the browser/HTTP cache or requiring a hard refresh.
 */

import { getConfig } from "./config";

const POLL_INTERVAL_MS = 90_000;
const MIN_CHECK_GAP_MS = 30_000;

let currentVersion: string | null = null;
let started = false;
let lastCheckAt = 0;
let inFlight: Promise<boolean> | null = null;
let failedOnce = false;

const listeners = new Set<(version: string | null) => void>();

function storageKey(): string {
  try {
    return `osler-content-version:${resolvedSourceOriginLabel()}`;
  } catch {
    return "osler-content-version:default";
  }
}

/** Distinguishes caches when the instance's API URL (or lack of one) changes. */
function resolvedSourceOriginLabel(): string {
  const cfg = getConfig().cloud as { enabled?: boolean; apiUrl?: string } | undefined;
  const envUrl = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_CLOUD_API_URL : undefined;
  return (envUrl || (cfg?.enabled && cfg.apiUrl) || "local").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function versionDocUrl(): string {
  const cfg = getConfig().cloud as { enabled?: boolean; apiUrl?: string } | undefined;
  const envUrl = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_CLOUD_API_URL : undefined;
  const apiUrl = envUrl || (cfg?.enabled && cfg.apiUrl) || "";
  // no-store: even a cached copy that claims to be fresh would defeat the poll.
  return apiUrl ? `${apiUrl.replace(/\/$/, "")}/v1/content-version` : "/osler-content/content-version.json";
}

/** The version currently backing cache-busted URLs, or null when unknown. */
export function currentContentVersion(): string | null {
  return currentVersion;
}

/**
 * Re-fetch the version document. Throttled to once per MIN_CHECK_GAP_MS
 * (unless forced); concurrent callers share one request. Returns true when
 * the version changed (or became known) during this call.
 */
export async function refreshContentVersion(force = false): Promise<boolean> {
  if (inFlight) return inFlight;
  const sinceLast = Date.now() - lastCheckAt;
  if (!force && sinceLast < MIN_CHECK_GAP_MS && currentVersion !== null) return false;

  inFlight = (async () => {
    lastCheckAt = Date.now();
    try {
      const res = await fetch(versionDocUrl(), { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const doc = (await res.json()) as { version?: unknown };
      failedOnce = false;
      const next = typeof doc.version === "string" && doc.version ? doc.version : null;
      if (next === currentVersion) return false;
      currentVersion = next;
      try {
        localStorage.setItem(storageKey(), next ?? "");
      } catch {}
      notify();
      return true;
    } catch (e) {
      // A dead/unreachable version endpoint must not spam warnings or flip
      // already-known state — keep serving whatever we hold.
      if (!failedOnce && currentVersion == null) console.warn("content-version check failed:", e);
      failedOnce = true;
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn(currentVersion);
    } catch {}
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("osler-content-invalidated", { detail: { version: currentVersion } }));
  }
}

/** Subscribe to version changes (fired after the stored version is updated). */
export function onContentVersionChange(fn: (version: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Start background tracking: seed from localStorage (so session restarts keep
 * using already-known immutable URLs), then poll on wake/visibility and at a
 * slow cadence. Idempotent.
 */
export function startContentVersionSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    const saved = localStorage.getItem(storageKey());
    if (saved) currentVersion = saved;
  } catch {}

  void refreshContentVersion(true);

  const check = () => {
    if (document.visibilityState === "visible") void refreshContentVersion();
  };
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
  window.setInterval(check, POLL_INTERVAL_MS);
}
