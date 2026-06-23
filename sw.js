const STATIC_CACHE = 'osler-static-v1';
const CONTENT_CACHE = 'osler-content-v1';

const PRECACHE_URLS = [
  'engine-shared.js',
  'quiz-engine.js',
  'bank-engine.js',
  'flashcard-engine.js',
  'written-engine.js',
  'osce-engine.js',
  'index-engine.js',
  'uworld-engine.js',
  'search-engine.js',
  // 'sync-engine.js' removed (H8 fix): legacy WebRTC/MQTT sync engine deleted.
  // Firebase sync lives in src/lib/sync.js, loaded via the lib-bridge.
  'ai-assistant-engine.js',
  'engine-tracker.js',
  'shared.css',
  'index-engine.css',
  'quiz-engine.css',
  'bank-engine.css',
  'flashcard-engine.css',
  'written-engine.css',
  'osce-engine.css',
  'uworld-engine.css',
  'ai-assistant-engine.css',
  'search-engine.css',
  'assets/favicon.svg',
  'assets/icon-48.png',
  'assets/icon-72.png',
  'assets/icon-96.png',
  'assets/icon-144.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'manifest.webmanifest',
];

function isJsCss(url) {
  return url.pathname.endsWith('.js') || url.pathname.endsWith('.css');
}

function isJson(url) {
  return url.pathname.endsWith('.json');
}

function isIcon(url) {
  return url.pathname.startsWith('/assets/') && (url.pathname.endsWith('.png') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.ico'));
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>
      cache.addAll(PRECACHE_URLS.map(u => new Request(u, { credentials: 'same-origin' })))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== STATIC_CACHE && k !== CONTENT_CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isIcon(url)) {
    event.respondWith(cacheFirst(event.request));
  } else if (isJson(url)) {
    event.respondWith(networkFirst(event.request, 5000));
  } else if (isJsCss(url)) {
    // stale-while-revalidate
    event.respondWith(staleWhileRevalidate(event.request));
  } else {
    event.respondWith(networkFirst(event.request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch (e) {
    return new Response('', { status: 408 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function networkFirst(request, timeoutMs) {
  const cache = await caches.open(CONTENT_CACHE);
  let timeoutId;
  const timeoutPromise = timeoutMs ? new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  }) : null;

  try {
    const res = await (timeoutPromise ? Promise.race([fetch(request), timeoutPromise]) : fetch(request));
    clearTimeout(timeoutId);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    clearTimeout(timeoutId);
    const cached = await cache.match(request);
    if (cached) return cached;
    if (e.message === 'timeout') return new Response(JSON.stringify({ error: 'timeout' }), { status: 408, headers: { 'Content-Type': 'application/json' } });
    throw e;
  }
}
