/// <reference lib="webworker" />

/**
 * Osler Service Worker
 *
 * Built by `scripts/build-sw.js` (esbuild) into `public/sw.js`.
 *
 * Architecture notes:
 *   - We use the `serwist` runtime library (NOT `@serwist/turbopack`,
 *     which is tightly coupled to Next.js's build pipeline and doesn't
 *     support `output: "export"`).
 *   - Precache manifest is empty — we rely on runtime caching only.
 *     This keeps the SW small and avoids the need for the turbopack
 *     precache injection.
 *   - The Osler app is a static export hosted on Cloudflare Pages.
 *     Cross-origin content (Worker /v1/content/* endpoints) is cached
 *     network-first so users can download content packs for offline use.
 */

import type { RuntimeCaching } from "serwist";
import { CacheFirst, NetworkFirst, StaleWhileRevalidate, Serwist } from "serwist";

declare const self: ServiceWorkerGlobalScope;

/** Injected by scripts/build-sw.js — changes on every build so the browser
 *  always detects a new worker after a deploy. NOT part of cache names:
 *  the content cache must survive deploys to keep downloaded packs. */
declare const __OSLER_SW_BUILD_ID__: string;

const CONTENT_CACHE = "osler-content-v1";
const STATIC_CACHE = "osler-static-v1";
const IMAGE_CACHE = "osler-images-v1";

const runtimeCaching: RuntimeCaching[] = [
  // App shell code — hashed /_next/static/* is immutable but CacheFirst
  // makes revisits offline-first (localfirst) and instant. Without this,
  // each chunk would need a network round trip even though it never changes.
  {
    matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: STATIC_CACHE,
      plugins: [
        {
          cacheWillUpdate: async ({ response }) => {
            if (response && response.status === 200) return response;
            return null;
          },
        },
      ],
    }),
  },
  // Content packs — split by cache-bust to save bandwidth + Worker hits:
  //  • Versioned (?v=…): CacheFirst — immutable. First load caches; every
  //    revisit hits local cache only. A publish bumps ?v, making a new cache
  //    key that fetches fresh. Zero Worker/R2 cost for repeat views.
  //  • Unversioned (initial boot before version known, fallback fetches):
  //    NetworkFirst with timeout — tries network for up to 3s then falls
  //    back to cache so spotty networks stay usable while online publishes
  //    still land without a hard refresh.
  {
    matcher: ({ url }) => {
      if (!url.searchParams.has("v")) return false;
      const p = url.pathname;
      return p.startsWith("/osler-content/") || p.startsWith("/v1/content/") || p.startsWith("/v1/content-manifests/");
    },
    handler: new CacheFirst({
      cacheName: CONTENT_CACHE,
      plugins: [
        {
          cacheWillUpdate: async ({ response }) => {
            if (response && response.status === 200) return response;
            return null;
          },
        },
      ],
    }),
  },
  {
    matcher: ({ url }) => {
      if (url.searchParams.has("v")) return false;
      const p = url.pathname;
      return p.startsWith("/osler-content/") || p.startsWith("/v1/content/") || p.startsWith("/v1/content-manifests/");
    },
    handler: new NetworkFirst({
      cacheName: CONTENT_CACHE,
      networkTimeoutSeconds: 3,
      plugins: [
        {
          cacheWillUpdate: async ({ response }) => {
            if (response && response.status === 200) return response;
            return null;
          },
        },
      ],
    }),
  },
  // Thumbnails + content images: stale-while-revalidate so a cached image
  // paints instantly and refreshes in the background. Offline-friendly and
  // keeps YouTube hqdefault (remote) from blocking hub first paint.
  {
    matcher: ({ request, url }) => request.destination === "image" || url.pathname.includes("/images/"),
    handler: new StaleWhileRevalidate({
      cacheName: IMAGE_CACHE,
      plugins: [
        {
          cacheWillUpdate: async ({ response }) => {
            if (response && response.status === 200) return response;
            return null;
          },
        },
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: [],
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  disableDevLogs: process.env.NODE_ENV !== "production",
  runtimeCaching,
});

serwist.addEventListeners();

/* ── Custom message API (content cache) ──────────────────────────────────
 *
 * Preserved from the original hand-rolled sw.js so the offline content
 * download feature continues to work via useContentCache hook.
 *
 * Messages from the page: { type, ...payload }
 *   PRECACHE_CONTENT       { packId, urls }
 *   CHECK_CONTENT_CACHED   { packId, urls }
 *   REMOVE_CONTENT         { packId, urls }
 *   CLEAR_CONTENT_CACHE
 *   GET_CONTENT_CACHE_STATS
 * ─────────────────────────────────────────────────────────────────────── */

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  const { data } = event;
  if (!data || !data.type) return;

  const source = event.source as Client | null;

  switch (data.type) {
    case "GET_SW_BUILD":
      source?.postMessage({ type: "SW_BUILD", buildId: __OSLER_SW_BUILD_ID__ });
      break;
    case "PRECACHE_CONTENT":
      event.waitUntil(precacheContent(source, data.packId, data.urls));
      break;
    case "CHECK_CONTENT_CACHED":
      event.waitUntil(checkContentCached(source, data.packId, data.urls));
      break;
    case "REMOVE_CONTENT":
      event.waitUntil(removeContent(source, data.packId, data.urls));
      break;
    case "CLEAR_CONTENT_CACHE":
      event.waitUntil(
        caches.delete(CONTENT_CACHE).then(() => caches.open(CONTENT_CACHE))
      );
      break;
    case "GET_CONTENT_CACHE_STATS":
      event.waitUntil(reportCacheStats(source));
      break;
  }
});

/** A compromised/buggy page script could ask the SW to fetch and persist
 *  arbitrary URLs. Restrict precaching to the two content keyspaces the
 *  app actually uses: bundled same-origin /osler-content/, and the Worker's
 *  /v1/content* endpoints — which are CROSS-ORIGIN on cloud instances
 *  (that's how all content is served there), so the /v1 keyspaces are
 *  allowed by path shape regardless of origin. Everything else is refused. */
function isPrecacheAllowed(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.pathname.startsWith("/osler-content/")) {
      return u.origin === self.location.origin;
    }
    return (
      u.pathname.startsWith("/v1/content/") ||
      u.pathname.startsWith("/v1/content-manifests/")
    );
  } catch {
    return false;
  }
}

async function precacheContent(
  client: Client | null,
  packId: string,
  urls: string[]
) {
  const cache = await caches.open(CONTENT_CACHE);
  let done = 0;
  const total = urls.length;
  const results: { url: string; ok: boolean; status?: number; error?: string }[] = [];

  for (const url of urls) {
    if (!isPrecacheAllowed(url)) {
      results.push({ url, ok: false, error: "URL not allowed for precache" });
      done++;
      continue;
    }
    try {
      const existing = await cache.match(url);
      if (existing) await cache.delete(url);
      const res = await fetch(url);
      if (!res.ok) {
        results.push({ url, ok: false, status: res.status });
      } else {
        await cache.put(url, res.clone());
        results.push({ url, ok: true });
      }
    } catch (e) {
      results.push({ url, ok: false, error: String(e) });
    }
    done++;
    if (client) {
      client.postMessage({ type: "PRECACHE_PROGRESS", packId, done, total });
    }
  }

  const allClients = await self.clients.matchAll();
  for (const c of allClients) {
    c.postMessage({
      type: "PRECACHE_RESULT",
      packId,
      results,
      allOk: results.every((r) => r.ok),
    });
  }
}

async function checkContentCached(
  client: Client | null,
  packId: string,
  urls: string[]
) {
  const cache = await caches.open(CONTENT_CACHE);
  const results = await Promise.all(
    urls.map(async (url) => {
      const match = await cache.match(url);
      return { url, cached: !!match };
    })
  );
  const allCached = results.length > 0 && results.every((r) => r.cached);
  if (client) {
    client.postMessage({
      type: "CONTENT_CACHE_STATUS",
      packId,
      urls: results,
      allCached,
    });
  }
}

async function removeContent(
  client: Client | null,
  packId: string,
  urls: string[]
) {
  const cache = await caches.open(CONTENT_CACHE);
  await Promise.all(
    urls
      .filter((url) => isPrecacheAllowed(url))
      .map((url) => cache.delete(url))
  );
  const allClients = await self.clients.matchAll();
  for (const c of allClients) {
    c.postMessage({ type: "CONTENT_REMOVED", packId });
  }
}

async function reportCacheStats(client: Client | null) {
  if (!client) return;
  const cache = await caches.open(CONTENT_CACHE);
  const keys = await cache.keys();
  let size = 0;
  for (const req of keys) {
    try {
      const res = await cache.match(req);
      const blob = await res!.blob();
      size += blob.size;
    } catch {
      // ignore
    }
  }
  client.postMessage({ type: "CONTENT_CACHE_STATS", count: keys.length, size });
}
