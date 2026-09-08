
/**
 * Osler Background Precaching Engine
 *
 * Silently warms only the active route and the files it has already loaded.
 *
 * Earlier versions fetched every route, parsed every page document, and pulled the
 * corresponding Next.js chunks after startup. That created a multi-megabyte burst
 * of network, parsing, cache writes, and memory use on every device. On constrained
 * Android PWAs this could cause tab eviction or storage-quota failures before a user
 * interacted with the app. The service worker continues to cache later visited
 * routes, while explicit pack downloads retain their full offline behaviour.
 */

/** Small assets required for PWA identity and first-run configuration. */
export const CORE_STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/osler.config.json",
  "/assets/favicon.png",
  "/assets/icons/icon-192.png",
] as const;

let isPrecaching = false;
let isCompleted = false;
const listeners = new Set<(completed: boolean) => void>();

/** Check if initial full precaching has finished in the current tab session. */
export function isSitePrecached(): boolean {
  return isCompleted;
}

/** Subscribe to precache completion events. */
export function onPrecacheComplete(fn: (completed: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(completed: boolean) {
  for (const fn of [...listeners]) {
    try {
      fn(completed);
    } catch {}
  }
}

/**
 * Return only same-origin static resources the active page has already requested.
 * Reading performance entries avoids re-downloading and reparsing other route
 * documents merely to discover their chunks.
 */
function activeRouteAssets(): string[] {
  if (typeof performance === "undefined") return [];
  const urls = new Set<string>();
  for (const entry of performance.getEntriesByType("resource")) {
    try {
      const url = new URL(entry.name);
      if (url.origin === window.location.origin && url.pathname.startsWith("/_next/static/")) {
        urls.add(`${url.pathname}${url.search}`);
      }
    } catch {
      // Ignore malformed timing entries.
    }
  }
  return [...urls];
}

/**
 * Execute a callback on browser idle, with fallback to setTimeout.
 */
function runOnIdle(cb: () => void, timeout = 2500): void {
  if (typeof window === "undefined") return;
  if ("requestIdleCallback" in window) {
    (window as any).requestIdleCallback(cb, { timeout });
  } else {
    setTimeout(cb, 1200);
  }
}

/**
 * Send discovered precache URLs to the Service Worker so they reside in `STATIC_CACHE` & `PAGE_CACHE`.
 */
function sendPrecacheMessageToSW(urls: string[]) {
  if (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    navigator.serviceWorker.controller
  ) {
    navigator.serviceWorker.controller.postMessage({
      type: "PRECACHE_APP_SHELL",
      urls: [...new Set(urls)],
    });
  }
}

/**
 * Warm the active app shell after it is already interactive. The worker must be
 * controlling this page before we issue requests; otherwise this would duplicate
 * network work without retaining anything for offline use.
 *
 * Idempotent: Subsequent calls in the same session return immediately unless `force: true`.
 */
export async function startBackgroundPrecaching(options?: { force?: boolean }): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (!navigator.serviceWorker.controller || isPrecaching || (isCompleted && !options?.force)) return;

  isPrecaching = true;

  return new Promise<void>((resolve) => {
    runOnIdle(() => {
      try {
        const route = window.location.pathname || "/";
        sendPrecacheMessageToSW([...new Set([route, ...CORE_STATIC_ASSETS, ...activeRouteAssets()])]);
        isCompleted = true;
        notify(true);
      } catch (err) {
        console.warn("[precache] active route warming encountered an issue:", err);
      } finally {
        isPrecaching = false;
        resolve();
      }
    });
  });
}

/**
 * Silently refresh the active app shell after a new Service Worker activates.
 */
export async function triggerSilentRecache(): Promise<void> {
  if (typeof window === "undefined") return;
  isCompleted = false;
  return startBackgroundPrecaching({ force: true });
}

/**
 * Initialize automatic active-route recaching after a Service Worker update.
 */
let listenersAttached = false;
export function initBackgroundSyncListeners(): void {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;

  // Recache when a new Service Worker takes control
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      void triggerSilentRecache();
    });
  }

}
