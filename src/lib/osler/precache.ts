/**
 * Osler Background Precaching Engine
 *
 * Silently warms and precaches all static files, route HTMLs, Next.js JS/CSS chunks,
 * core static assets, and content manifests in the background.
 *
 * Key guarantees:
 *   1. Non-blocking: Runs strictly during idle cycles via `requestIdleCallback`
 *      with batched concurrency (max 3 in-flight) so UI interactions, scrolling,
 *      and animations are never delayed.
 *   2. Cache-busting compatible: Honors versioned `?v=` stamps for content packs,
 *      Next.js immutable content hashes for `/_next/static/` chunks, and SW update
 *      lifecycles.
 *   3. Silent background recaching: Automatically triggered when a new SW version
 *      activates or when `content-version` updates, keeping the offline cache
 *      fresh without disturbing active sessions.
 */

import { currentContentVersion, onContentVersionChange } from "./content-version";
import { loadCategoryTrees } from "./content";
import { loadConfig } from "./config";

/** Core static route documents across the application. */
export const CORE_ROUTES = [
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
  "/admin/",
] as const;

/** Core static assets that should always be instantly available offline. */
export const CORE_STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/osler.config.json",
  "/assets/favicon.png",
  "/assets/icon.svg",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/apple-touch-icon.png",
  "/assets/og-image.png",
] as const;

/** Core category manifest locations for offline content browsing. */
export const CORE_MANIFEST_FOLDERS = [
  "qbank",
  "flashcard",
  "osce",
  "library",
  "videos",
] as const;

let isPrecaching = false;
let isCompleted = false;
let lastPrecachedVersion: string | null = null;
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
 * Extract script and stylesheet URLs referenced inside an HTML document.
 * Focuses on same-origin Next.js static chunks (`/_next/static/...`).
 */
function extractNextAssetsFromHtml(html: string): string[] {
  const urls = new Set<string>();
  try {
    if (typeof DOMParser !== "undefined") {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const scripts = doc.querySelectorAll("script[src]");
      scripts.forEach((s) => {
        const src = s.getAttribute("src");
        if (src && src.startsWith("/_next/static/")) {
          urls.add(src);
        }
      });

      const links = doc.querySelectorAll('link[rel="stylesheet"][href]');
      links.forEach((l) => {
        const href = l.getAttribute("href");
        if (href && href.startsWith("/_next/static/")) {
          urls.add(href);
        }
      });
    } else {
      // Fallback regex in case DOMParser is unavailable
      const scriptRegex = /<script[^>]+src=["'](\/_next\/static\/[^"']+)["']/g;
      const linkRegex = /<link[^>]+href=["'](\/_next\/static\/[^"']+)["'][^>]*rel=["']stylesheet["']/g;
      let match: RegExpExecArray | null;
      while ((match = scriptRegex.exec(html)) !== null) {
        if (match[1]) urls.add(match[1]);
      }
      while ((match = linkRegex.exec(html)) !== null) {
        if (match[1]) urls.add(match[1]);
      }
    }
  } catch {
    // Ignore parse errors on unusual markup
  }
  return [...urls];
}

/**
 * Fetch a list of URLs with limited concurrency to prevent network saturation.
 */
async function fetchBatched(urls: string[], concurrency = 3): Promise<void> {
  const queue = [...new Set(urls)];
  let index = 0;

  async function worker() {
    while (index < queue.length) {
      const current = queue[index++];
      if (!current) continue;
      try {
        await fetch(current, { cache: "default" });
      } catch {
        // Tolerant to individual resource errors
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker());
  await Promise.all(workers);
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
 * Start full background precaching of all site static files, route HTMLs, JS/CSS chunks,
 * static assets, and content manifests.
 *
 * Idempotent: Subsequent calls in the same session return immediately unless `force: true`.
 */
export async function startBackgroundPrecaching(options?: { force?: boolean }): Promise<void> {
  if (typeof window === "undefined") return;
  if (isPrecaching) return;
  if (isCompleted && !options?.force) return;

  isPrecaching = true;

  return new Promise<void>((resolve) => {
    runOnIdle(async () => {
      try {
        const collectedUrls = new Set<string>();

        // 1. Precache static assets
        for (const asset of CORE_STATIC_ASSETS) {
          collectedUrls.add(asset);
        }

        // 2. Precache content manifests (with ?v= stamp if version is known)
        const version = currentContentVersion();
        lastPrecachedVersion = version;

        for (const folder of CORE_MANIFEST_FOLDERS) {
          const basePath = `/osler-content/${folder}/manifest.json`;
          collectedUrls.add(version ? `${basePath}?v=${encodeURIComponent(version)}` : basePath);
        }
        collectedUrls.add("/osler-content/content-version.json");

        // 3. Precache route documents (HTML) and extract their JS/CSS chunk URLs
        const routeHtmlUrls: string[] = [];
        for (const route of CORE_ROUTES) {
          collectedUrls.add(route);
          routeHtmlUrls.push(route);
        }

        // Fetch routes first to parse referenced Next.js bundles
        const dynamicChunkUrls = new Set<string>();
        for (const route of routeHtmlUrls) {
          try {
            const res = await fetch(route, { cache: "default" });
            if (res.ok) {
              const text = await res.text();
              const extracted = extractNextAssetsFromHtml(text);
              for (const chunk of extracted) {
                dynamicChunkUrls.add(chunk);
                collectedUrls.add(chunk);
              }
            }
          } catch {
            // Ignore offline/network fetch issues
          }
        }

        // 4. Batch fetch any newly discovered dynamic JS/CSS chunks & static assets
        await fetchBatched([...dynamicChunkUrls, ...CORE_STATIC_ASSETS], 3);

        // 5. Warm in-memory caches for category trees and config
        try {
          await loadConfig();
          await loadCategoryTrees();
        } catch {
          // Ignore tree loading failures
        }

        // 6. Notify the Service Worker to retain all precached URLs in STATIC_CACHE & PAGE_CACHE
        sendPrecacheMessageToSW([...collectedUrls]);

        isCompleted = true;
        notify(true);
      } catch (err) {
        console.warn("[precache] background warming encountered an issue:", err);
      } finally {
        isPrecaching = false;
        resolve();
      }
    });
  });
}

/**
 * Silently recache updated routes, assets, and content manifests in the background.
 * Triggered when a new Service Worker activates or a content-version bump is observed.
 */
export async function triggerSilentRecache(): Promise<void> {
  if (typeof window === "undefined") return;
  isCompleted = false;
  return startBackgroundPrecaching({ force: true });
}

/**
 * Initialize automatic background recaching listeners:
 *  - Service Worker controller changes (new deploy)
 *  - Remote content version changes (new content publish)
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

  // Recache when remote content version changes
  onContentVersionChange((newVersion) => {
    if (newVersion && newVersion !== lastPrecachedVersion) {
      void triggerSilentRecache();
    }
  });
}
