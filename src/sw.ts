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
import { CacheFirst, ExpirationPlugin, NetworkFirst, StaleWhileRevalidate, Serwist } from "serwist";

declare const self: ServiceWorkerGlobalScope;

/** Injected by scripts/build-sw.js — changes on every build so the browser
 *  always detects a new worker after a deploy. NOT part of cache names:
 *  the content cache must survive deploys to keep downloaded packs. */
declare const __OSLER_SW_BUILD_ID__: string;

// Explicitly downloaded packs are retained until the user removes them. All
// automatically populated caches are bounded to avoid exhausting storage on
// lower-end Android devices, where quota eviction can terminate the PWA.
const CONTENT_CACHE = "osler-content-v1";
const CONTENT_RUNTIME_CACHE = "osler-content-runtime-v1";
const STATIC_CACHE = "osler-static-v2";
const IMAGE_CACHE = "osler-images-v2";
const PAGE_CACHE = "osler-pages-v2";

// Route shells the background warmer keeps available offline. Mirrors
// APP_ROUTES in src/lib/osler/precache.ts — used for the readiness report.
const APP_SHELL_ROUTES = [
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
];

const DAY_SECONDS = 24 * 60 * 60;
const cacheableResponse = {
  cacheWillUpdate: async ({ response }: { response?: Response }) =>
    response?.status === 200 ? response : null,
};

// Shared by both content fallbacks below: one registry, one 180-entry /
// 14-day bound for the runtime content cache.
const contentRuntimeExpiration = new ExpirationPlugin({ maxEntries: 180, maxAgeSeconds: 14 * DAY_SECONDS });
const contentVersionedFallback = new CacheFirst({
  cacheName: CONTENT_RUNTIME_CACHE,
  plugins: [cacheableResponse, contentRuntimeExpiration],
});
const contentUnversionedFallback = new NetworkFirst({
  cacheName: CONTENT_RUNTIME_CACHE,
  plugins: [cacheableResponse, contentRuntimeExpiration],
});

const runtimeCaching: RuntimeCaching[] = [
  // App shell code — hashed /_next/static/* is immutable but CacheFirst
  // makes revisits offline-first (localfirst) and instant. Without this,
  // each chunk would need a network round trip even though it never changes.
  // Sized for every route's chunks at once (~10 routes warmed in one pass).
  {
    matcher: ({ url }) => url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: STATIC_CACHE,
      plugins: [
        cacheableResponse,
        new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * DAY_SECONDS }),
      ],
    }),
  },
  // HTML page navigations — serve a previously visited shell immediately and
  // refresh it in the background. This avoids a 1.5s network-first wait on
  // unreliable mobile networks while matchOptions.ignoreSearch still lets
  // deep links (e.g. /qbank?uid=...) reuse the cached /qbank/ shell.
  // Sized for every route shell plus a few deep links.
  {
    matcher: ({ request }) => request.mode === "navigate",
    handler: new StaleWhileRevalidate({
      cacheName: PAGE_CACHE,
      matchOptions: { ignoreSearch: true },
      plugins: [
        cacheableResponse,
        new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 7 * DAY_SECONDS }),
      ],
    }),
  },
  // Core static assets and config — StaleWhileRevalidate so updates are picked
  // up silently in the background while loads are instant.
  {
    matcher: ({ url }) => {
      const p = url.pathname;
      return (
        p.startsWith("/assets/") ||
        p.startsWith("/fonts/") ||
        p === "/manifest.webmanifest" ||
        p === "/osler.config.json"
      );
    },
    handler: new StaleWhileRevalidate({
      cacheName: STATIC_CACHE,
      plugins: [
        cacheableResponse,
        new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * DAY_SECONDS }),
      ],
    }),
  },
  // Content packs — explicit downloads first, then the freshness-appropriate
  // runtime strategy. CONTENT_CACHE holds ONLY packs the user explicitly
  // downloaded (populated by PRECACHE_CONTENT, never evicted automatically),
  // so it is the offline source of truth: the bounded runtime cache below it
  // may evict entries under storage pressure on low-end devices, which must
  // never silently un-download a pack. Versioned (?v=…) URLs are immutable
  // cache keys — a publish bumps ?v and the downloader evicts the superseded
  // key, so CacheFirst is safe; unversioned URLs stay NetworkFirst so
  // already-visited packs refresh while offline keeps serving the stale copy.
  // One shared expiration registry: both fallbacks feed the same cache.
  {
    matcher: ({ url }) => {
      const p = url.pathname;
      return p.startsWith("/osler-content/") || p.startsWith("/v1/content/") || p.startsWith("/v1/content-manifests/");
    },
    handler: async ({ request, url, event }: { request: Request; url: URL; event: ExtendableEvent }) => {
      const explicit = await (await caches.open(CONTENT_CACHE)).match(request);
      if (explicit) return explicit;
      const fallback = url.searchParams.has("v") ? contentVersionedFallback : contentUnversionedFallback;
      return fallback.handle({ request, event });
    },
  },
  // Thumbnails + content images: stale-while-revalidate so a cached image
  // paints instantly and refreshes in the background. Offline-friendly and
  // keeps YouTube hqdefault (remote) from blocking hub first paint.
  {
    matcher: ({ request, url }) => request.destination === "image" || url.pathname.includes("/images/"),
    handler: new StaleWhileRevalidate({
      cacheName: IMAGE_CACHE,
      plugins: [
        cacheableResponse,
        new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 30 * DAY_SECONDS }),
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

/* ── Custom message API (content cache & precaching) ─────────────────────
 *
 * Preserved from the original hand-rolled sw.js so the offline content
 * download feature continues to work via useContentCache hook, plus app shell
 * background precaching.
 *
 * Messages from the page: { type, ...payload }
 *   GET_SW_BUILD
 *   PRECACHE_APP_SHELL     { urls }
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
    case "PRECACHE_APP_SHELL":
      event.waitUntil(precacheAppShell(source, data.urls));
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
        Promise.all([
          caches.delete(CONTENT_CACHE),
          caches.delete(CONTENT_RUNTIME_CACHE),
        ]).then(() => caches.open(CONTENT_CACHE))
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
    const u = new URL(rawUrl, self.location.origin);
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

async function precacheAppShell(client: Client | null, urls: string[]) {
  if (!Array.isArray(urls) || urls.length === 0) return;

  const staticCache = await caches.open(STATIC_CACHE);
  const pageCache = await caches.open(PAGE_CACHE);
  const contentCache = await caches.open(CONTENT_RUNTIME_CACHE);

  for (const rawUrl of urls) {
    try {
      const u = new URL(rawUrl, self.location.origin);
      if (u.origin !== self.location.origin && !isPrecacheAllowed(rawUrl)) {
        continue;
      }

      // Manifests belong with the content they describe: the serving path
      // only ever reads CONTENT_CACHE (explicit downloads) and
      // CONTENT_RUNTIME_CACHE, so a manifest parked in STATIC_CACHE would
      // be stored yet never served.
      let targetCache = staticCache;
      const p = u.pathname;
      if (
        p.startsWith("/osler-content/") ||
        p.startsWith("/v1/content/") ||
        p.startsWith("/v1/content-manifests/")
      ) {
        targetCache = contentCache;
      } else if (!p.includes(".") || p.endsWith(".html") || p === "/") {
        targetCache = pageCache;
      }

      // Route shells and manifests share URLs across deploys while their
      // bytes change, so always revalidate them: a skipped refresh would
      // pin a stale shell referencing long-deleted chunks. Hashed chunks
      // are immutable — the exists-guard below still applies to them.
      const immutable = targetCache === staticCache;
      if (immutable) {
        const existing = await targetCache.match(u.href);
        if (existing) continue;
      }
      const res = await fetch(u.href, { cache: "default" });
      if (res.ok) {
        await targetCache.put(u.href, res.clone());
      }
    } catch {
      // Ignore individual resource errors
    }
  }

  client?.postMessage({ type: "APP_SHELL_PRECACHED", count: urls.length });
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
      // Evict superseded copies of the same file: a publish bumps ?v=, which
      // changes the cache key, so without this the explicit cache would keep
      // one entry per published version without bound. Pathnames are unique
      // per file (pack path + filename), so same-pathname eviction is safe.
      const u = new URL(url, self.location.origin);
      const keys = await cache.keys();
      await Promise.all(
        keys
          .filter((k) => {
            if (k.url === url) return true;
            try {
              return new URL(k.url).pathname === u.pathname;
            } catch {
              return false;
            }
          })
          .map((k) => cache.delete(k))
      );
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
  // App-shell readiness: which route shells are in the page cache, plus
  // entry counts for the other automatic caches. Lets Settings → Downloads
  // show whether the full app is actually available offline.
  let shellReady: string[] = [];
  let staticCount = 0;
  let pageCount = 0;
  try {
    const pageCache = await caches.open(PAGE_CACHE);
    const [pageKeys, staticKeys] = await Promise.all([
      pageCache.keys(),
      caches.open(STATIC_CACHE).then((c) => c.keys()),
    ]);
    pageCount = pageKeys.length;
    staticCount = staticKeys.length;
    const have = new Set(pageKeys.map((r) => new URL(r.url).pathname));
    shellReady = APP_SHELL_ROUTES.filter((r) => have.has(r));
  } catch {
    // ignore — readiness stays empty
  }
  client.postMessage({
    type: "CONTENT_CACHE_STATS",
    count: keys.length,
    size,
    shell: { ready: shellReady, total: APP_SHELL_ROUTES.length, staticCount, pageCount },
  });
}
