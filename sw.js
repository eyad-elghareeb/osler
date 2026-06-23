/* MU61 Quiz — generated precache manifest for all quiz and hub pages.
   CACHE_VERSION is content-hashed by scripts/sync_quiz_assets.py so new files activate automatically. */
const CACHE_VERSION = 'mu61-quiz-bust-20260601';
const CACHE_NAME = 'quiz-tool-cache-' + CACHE_VERSION;

const GOOGLE_FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap';

const HTML2PDF_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';

/* Lazy-loaded by sync-engine.js when user opens QR tab or scanner */
const QRCODE_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

const HTML5QRCODE_CDN =
  'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';

var PRECACHE_REL_PATHS = [
  'engines/quiz-engine.js',
  'engines/bank-engine.js',
  'engines/index-engine.js',
  'engines/search-engine.js',
  'engines/written-engine.js',
  'tracker-map.json',
  'index.html',
  'bank-maker.html',

  'index-editor.html',
  'index-template.html',
  'js-question-bank.html',
  'pdf-exporter.html',
  'question-bank-template.html',
  'quiz-combiner.html',
  'quiz-editor.html',
  'quiz-maker-js.html',
  'quiz-maker.html',
  'quiz-template.html',
  'written-template.html',
  'written-maker.html',
  'favicon.svg',
  'icon-48.png',
  'icon-72.png',
  'icon-96.png',
  'icon-144.png',
  'icon-192.png',
  'icon-512.png',
  'engines/index-engine.css',
  'manifest.webmanifest',
  'tracker-map.json'
];

/* ── Build a full URL from scope + relative path ── */
function hrefFromScope(scope, relPath) {
  var s = scope.endsWith('/') ? scope : scope + '/';
  return new URL(relPath, s).href;
}

function shouldStore(res) {
  return res && (res.ok || res.type === 'opaque');
}

/* ── Precache Google Fonts (CSS + @font-face files) ── */
function precacheGoogleFonts(cache) {
  return fetch(GOOGLE_FONT_CSS, { mode: 'cors', credentials: 'omit' })
    .then(function (res) {
      if (!res.ok) return;
      return cache.put(GOOGLE_FONT_CSS, res.clone()).then(function () {
        return res.text();
      });
    })
    .then(function (txt) {
      if (!txt) return;
      var re = /url\s*\(\s*([^)]+)\s*\)/g;
      var m;
      var jobs = [];
      while ((m = re.exec(txt)) !== null) {
        var raw = m[1].replace(/["']/g, '').trim();
        if (!raw || raw.indexOf('data:') === 0) continue;
        var fontUrl = new URL(raw, GOOGLE_FONT_CSS).href;
        (function (u) {
          jobs.push(
            fetch(u, { mode: 'cors', credentials: 'omit' }).then(function (r) {
              if (r.ok) return cache.put(u, r);
            })
          );
        })(fontUrl);
      }
      return Promise.all(
        jobs.map(function (j) {
          return j.catch(function () { });
        })
      );
    })
    .catch(function () { });
}

/* ── Precache html2pdf.js CDN bundle for offline PDF export ── */
function precacheHtml2Pdf(cache) {
  return fetch(HTML2PDF_CDN, { mode: 'cors', credentials: 'omit' })
    .then(function (res) {
      if (res.ok) return cache.put(HTML2PDF_CDN, res);
    })
    .catch(function () { });
}

/* ══════════════════════════════════════════════════════════════
   INSTALL — precache everything
   ══════════════════════════════════════════════════════════════ */
self.addEventListener('install', function (event) {
  event.waitUntil(
    (async function () {
      var scope = self.registration.scope;
      var cache = await caches.open(CACHE_NAME);

      var REQUIRED = [
        'engines/quiz-engine.js',
        'engines/bank-engine.js',
        'engines/index-engine.js',
        'engines/written-engine.js',
        'engines/index-engine.css',
        'index.html',
        'manifest.webmanifest',
        'favicon.svg'
      ];

      /* 1. Critical assets — DO NOT CATCH (fails install on error) */
      await Promise.all(
        REQUIRED.map(function (rel) {
          return cache.add(hrefFromScope(scope, rel));
        })
      );

      /* 2. All other HTML/icons — tolerate failures */
      var others = PRECACHE_REL_PATHS.filter(function (p) {
        return REQUIRED.indexOf(p) === -1;
      });
      await Promise.all(
        others.map(function (rel) {
          return cache.add(hrefFromScope(scope, rel)).catch(function () { });
        })
      );

      /* 3. Cross-origin CDN resources */
      await precacheGoogleFonts(cache);
      await precacheHtml2Pdf(cache);

      /* 4. (Optional) Lazy-loaded CDN libs for QR sync — tolerate failures */
      var lazyCDNs = [QRCODE_CDN, HTML5QRCODE_CDN];
      await Promise.all(
        lazyCDNs.map(function (url) {
          return fetch(url, { mode: 'cors', credentials: 'omit' })
            .then(function (res) {
              if (res.ok) return cache.put(url, res);
            })
            .catch(function () { });
        })
      );

      await self.skipWaiting();
    })()
  );
});

/* ══════════════════════════════════════════════════════════════
   ACTIVATE — clean old caches, claim clients immediately
   ══════════════════════════════════════════════════════════════ */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      var keys = await caches.keys();
      await Promise.all(
        keys.map(function (k) {
          return k !== CACHE_NAME ? caches.delete(k) : Promise.resolve();
        })
      );
      await self.clients.claim();
    })()
  );
});

/* ══════════════════════════════════════════════════════════════
   FETCH — routing strategy
   ══════════════════════════════════════════════════════════════ */

/** Navigation requests (HTML pages): network-first with cache fallback + hub fallback. */
function handleNavigate(event, request) {
  return (async function () {
    var cache = await caches.open(CACHE_NAME);
    try {
      var res = await fetch(request);
      if (res && res.ok) {
        try {
          await cache.put(request, res.clone());
        } catch (_) { }
      }
      return res;
    } catch (err) {
      /* Offline: try exact match first */
      var cached = await cache.match(request);
      if (cached) return cached;

      /* Try matching without query/hash (some browsers append them) */
      var url = new URL(request.url);
      var cleanUrl = url.origin + url.pathname;
      cached = await cache.match(cleanUrl);
      if (cached) return cached;

      /* Directory support: if URL ends in / or has no extension, try appending index.html */
      if (url.pathname.endsWith('/') || !url.pathname.split('/').pop().includes('.')) {
        var indexUrl = cleanUrl.endsWith('/') ? cleanUrl + 'index.html' : cleanUrl + '/index.html';
        cached = await cache.match(indexUrl);
        if (cached) return cached;
      }

      /* Last resort: serve the main hub page */
      var fb = await cache.match(hrefFromScope(self.registration.scope, 'index.html'));
      if (fb) return fb;
      throw err;
    }
  })();
}

/** Assets & cross-origin: cache-first, then network (populates cache on miss). */
function handleAsset(event, request) {
  return (async function () {
    var cache = await caches.open(CACHE_NAME);
    var cached = await cache.match(request);

    /* Root fallback for shared assets (e.g. index-engine.css loaded from subfolders) */
    if (!cached) {
      var url = new URL(request.url);
      var scope = self.registration.scope;
      if (url.origin === self.location.origin && url.href.indexOf(scope) === 0) {
        var filename = url.pathname.split('/').pop();
        var SHARED = [
          'engines/quiz-engine.js',
          'engines/bank-engine.js',
          'engines/index-engine.js',
          'engines/written-engine.js',
  'engines/index-engine.css',
          'manifest.webmanifest',
          'favicon.svg',
          'icon-48.png',
          'icon-72.png',
          'icon-96.png',
          'icon-144.png',
          'icon-192.png',
          'icon-512.png',
          'tracker-map.json'
        ];
        if (SHARED.indexOf(filename) !== -1) {
          cached = await cache.match(hrefFromScope(scope, filename));
        }
      }
    }

    if (cached) return cached;

    try {
      var res = await fetch(request);
      if (shouldStore(res)) {
        try {
          await cache.put(request, res.clone());
        } catch (_) { }
      }
      return res;
    } catch (err) {
      /* Offline miss for asset — try matching without query string */
      var cleanUrl = request.url.split('?')[0].split('#')[0];
      var cachedClean = await cache.match(cleanUrl);
      if (cachedClean) return cachedClean;
      throw err;
    }
  })();
}

/** Decide whether to use network-first (HTML) or cache-first (everything else). */
function shouldNetworkFirst(req) {
  if (req.mode === 'navigate') return true;
  try {
    var u = new URL(req.url);
    if (u.origin !== self.location.origin) return false;
    var p = u.pathname;
    return p.endsWith('manifest.webmanifest') || p.endsWith('favicon.svg');
  } catch (e) {
    return false;
  }
}

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var req = event.request;
  if (shouldNetworkFirst(req)) {
    event.respondWith(handleNavigate(event, req));
    return;
  }
  event.respondWith(handleAsset(event, req));
});
