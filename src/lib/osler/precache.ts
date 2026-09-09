
/**
 * Osler Background Precaching Engine
 *
 * Warms the app shell (every route + the chunks the active page already
 * loaded) and the content manifests on idle, so the PWA keeps working
 * offline beyond the pages the user has already visited.
 *
 * Cost control (why not "fetch everything"):
 *   - Route shells + manifests are kilobytes; chunks are discovered from the
 *     active page's own performance entries (already downloaded, no re-fetch
 *     to discover them) plus a bounded parse of each route shell.
 *   - Everything goes through ONE PRECACHE_APP_SHELL message; the worker
 *     fetches sequentially and skips URLs already cached.
 *   - Data Saver (`navigator.connection.saveData`) skips chunks/manifests
 *     and warms route shells only.
 *   - Explicit pack downloads (useContentCache) remain the only path that
 *     pins pack bodies offline; this engine never bulk-downloads content.
 */

/** Small assets required for PWA identity and first-run configuration. */
export const CORE_STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/osler.config.json",
  "/assets/favicon.png",
  "/assets/icons/icon-192.png",
] as const;

/** Every app route whose shell should be available offline. Trailing-slash
 *  form matches the static export (and the SW page cache) exactly. */
const APP_ROUTES = [
  "/",
  "/login/",
  "/learn/",
  "/library/",
  "/qbank/",
  "/flashcards/",
  "/osce/",
  "/videos/",
  "/profile/",
  "/settings/",
] as const;

/** Content category folders whose manifests count as site data. */
const MANIFEST_FOLDERS = ["qbank", "flashcard", "osce", "library", "videos"] as const;

/** Upper bound on warmed chunk/manifest URLs per session (shells excluded). */
const MAX_WARM_URLS = 150;

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
 * Discover the JS/CSS chunks a route shell references, by fetching its static
 * HTML and extracting /_next/static/* URLs. Bounded per route; failures
 * (offline boot, missing route) yield no URLs rather than throwing.
 */
async function routeShellChunks(route: string, budget: number): Promise<string[]> {
  if (budget <= 0) return [];
  try {
    const res = await fetch(route, { cache: "force-cache" });
    if (!res.ok) return [];
    const html = await res.text();
    const found = new Set<string>();
    const re = /\/_next\/static\/[^"'\s)]+?\.(?:js|css)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && found.size < budget) {
      found.add(m[0]);
    }
    return [...found];
  } catch {
    return [];
  }
}

/**
 * Warm the app shell after it is already interactive: every route shell, the
 * chunks the active page already loaded, a bounded set of chunks referenced
 * by the other route shells, and the content manifests. The worker must be
 * controlling this page before we issue requests; otherwise this would
 * duplicate network work without retaining anything for offline use.
 *
 * Idempotent: Subsequent calls in the same session return immediately unless `force: true`.
 */
export async function startBackgroundPrecaching(options?: { force?: boolean }): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (!navigator.serviceWorker.controller || isPrecaching || (isCompleted && !options?.force)) return;

  isPrecaching = true;

  return new Promise<void>((resolve) => {
    runOnIdle(() => {
      void (async () => {
        try {
          const saveData =
            typeof navigator !== "undefined" &&
            (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
          const urls = new Set<string>([...APP_ROUTES, ...CORE_STATIC_ASSETS, ...activeRouteAssets()]);
          if (!saveData) {
            let budget = MAX_WARM_URLS;
            for (const route of APP_ROUTES) {
              if (budget <= 0) break;
              for (const chunk of await routeShellChunks(route, Math.min(budget, 20))) {
                urls.add(chunk);
                budget--;
              }
            }
            if (budget > 0) {
              const { manifestUrl } = await import("./content-url");
              for (const folder of MANIFEST_FOLDERS) {
                if (budget <= 0) break;
                try {
                  urls.add(manifestUrl(folder));
                  budget--;
                } catch {
                  // Config not ready — manifests warm on next navigation.
                }
              }
            }
          }
          sendPrecacheMessageToSW([...urls]);
          isCompleted = true;
          notify(true);
        } catch (err) {
          console.warn("[precache] active route warming encountered an issue:", err);
        } finally {
          isPrecaching = false;
          resolve();
        }
      })();
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
