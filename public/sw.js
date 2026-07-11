/* ── Osler Service Worker ────────────────────────────────────────────────
 *
 * Two caches:
 *   • SHELL_CACHE  — app shell (HTML, JS, CSS, fonts, icons). Auto-cached.
 *   • CONTENT_CACHE — content packs under /osler-content/. NEVER auto-cached.
 *                     The user explicitly "downloads" a pack via the UI,
 *                     which sends a PRECACHE_CONTENT message.
 *
 * Cache-bust strategy:
 *   - Navigation: network-first (fresh HTML), fall back to cache when offline.
 *   - Static assets (JS/CSS/fonts): cache-first (filenames are content-hashed).
 *   - Content (/osler-content/*): network-first when online (always fresh),
 *     fall back to cache only when offline AND the pack was precached.
 *     Content is NEVER auto-cached on fetch — only via explicit user action.
 *
 * Bump SHELL_CACHE version on deploys to invalidate stale shell assets.
 * ─────────────────────────────────────────────────────────────────────── */

const SHELL_CACHE = "osler-shell-v2";
const CONTENT_CACHE = "osler-content-v1";

const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/assets/favicon.png",
  "/assets/icon.svg",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Keep CONTENT_CACHE across SW updates so user downloads persist.
            // Wipe old shell caches so the new shell takes over.
            .filter((k) => k !== SHELL_CACHE && k !== CONTENT_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isContentRequest(url) {
  return url.pathname.startsWith("/osler-content/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first, cache fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then((r) => r || caches.match("/"))
        )
    );
    return;
  }

  // Content requests: network-first (cache-bust), fall back to precached copy
  // only when offline. Never auto-cache content on fetch.
  if (isContentRequest(url)) {
    event.respondWith(
      caches.open(CONTENT_CACHE).then(async (cache) => {
        try {
          // Always prefer fresh network content
          const res = await fetch(request);
          return res;
        } catch (e) {
          // Offline (or network error): serve precached copy if available
          const cached = await cache.match(request);
          if (cached) return cached;
          throw e;
        }
      })
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});

/* ── Message API (from the page) ─────────────────────────────────────────
 *
 * The page communicates with the SW via postMessage to manage the content
 * cache. All messages use { type, ...payload } and are async (SW posts a
 * reply back to the originating client, or broadcasts to all clients for
 * state-sync events).
 *
 * Supported messages:
 *   { type: "PRECACHE_CONTENT", packId, urls }    — download a pack
 *   { type: "CHECK_CONTENT_CACHED", packId, urls } — query cache status
 *   { type: "REMOVE_CONTENT", packId, urls }       — delete a pack from cache
 *   { type: "CLEAR_CONTENT_CACHE" }                — wipe all content cache
 *   { type: "GET_CONTENT_CACHE_STATS" }            — report cache size
 *
 * SW → page messages:
 *   { type: "CONTENT_CACHE_STATUS", packId, urls, allCached }
 *   { type: "PRECACHE_PROGRESS", packId, done, total }
 *   { type: "PRECACHE_RESULT", packId, results }
 *   { type: "CONTENT_REMOVED", packId }
 *   { type: "CONTENT_CACHE_STATS", size }
 * ─────────────────────────────────────────────────────────────────────── */

self.addEventListener("message", (event) => {
  const { data } = event;
  if (!data || !data.type) return;

  if (data.type === "PRECACHE_CONTENT" && Array.isArray(data.urls)) {
    event.waitUntil(precacheContent(event.source, data.packId, data.urls));
    return;
  }

  if (data.type === "CHECK_CONTENT_CACHED" && Array.isArray(data.urls)) {
    event.waitUntil(checkContentCached(event.source, data.packId, data.urls));
    return;
  }

  if (data.type === "REMOVE_CONTENT" && Array.isArray(data.urls)) {
    event.waitUntil(removeContent(event.source, data.packId, data.urls));
    return;
  }

  if (data.type === "CLEAR_CONTENT_CACHE") {
    event.waitUntil(
      caches.delete(CONTENT_CACHE).then(() => {
        return caches.open(CONTENT_CACHE);
      })
    );
    return;
  }

  if (data.type === "GET_CONTENT_CACHE_STATS") {
    event.waitUntil(reportCacheStats(event.source));
    return;
  }
});

async function precacheContent(client, packId, urls) {
  const cache = await caches.open(CONTENT_CACHE);
  let done = 0;
  const total = urls.length;
  const results = [];

  for (const url of urls) {
    try {
      // Revalidate: if cached, delete and re-fetch to bust stale content
      const existing = await cache.match(url);
      if (existing) {
        await cache.delete(url);
      }
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
      client.postMessage({
        type: "PRECACHE_PROGRESS",
        packId,
        done,
        total,
      });
    }
  }

  // Broadcast result to all clients (so other open tabs update their UI)
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

async function checkContentCached(client, packId, urls) {
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

async function removeContent(client, packId, urls) {
  const cache = await caches.open(CONTENT_CACHE);
  await Promise.all(urls.map((url) => cache.delete(url)));
  // Broadcast removal
  const allClients = await self.clients.matchAll();
  for (const c of allClients) {
    c.postMessage({ type: "CONTENT_REMOVED", packId });
  }
}

async function reportCacheStats(client) {
  if (!client) return;
  const cache = await caches.open(CONTENT_CACHE);
  const keys = await cache.keys();
  let size = 0;
  for (const req of keys) {
    try {
      const res = await cache.match(req);
      const blob = await res.blob();
      size += blob.size;
    } catch {
      // ignore
    }
  }
  client.postMessage({
    type: "CONTENT_CACHE_STATS",
    count: keys.length,
    size,
  });
}
