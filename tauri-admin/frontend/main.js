// frontend/main.js — Tauri API glue + simple router for the admin dashboard.
//
// Phase 5.0 reconciliation (B9 fix): the existing frontend/index.html is a
// fully-built 5,630-line v5 admin dashboard that handles its own routing
// inline. This file provides the Tauri API bridge that the plan expected,
// but does NOT replace the existing UI — it supplements it.
//
// Phase 5 sessions will progressively migrate the inline UI to use these
// helpers instead of `window.__TAURI__.*` directly.
//
// Phase 6.5 fix (medium): index.html loads this file as a plain `<script src>`
// (NOT `<script type="module">`), so ES `export` syntax is unreachable from
// other scripts. Converted to attach helpers to `window.OslerAdmin` so any
// script on the page can use them. Once Phase 8 migrates index.html to load
// scripts as modules, we can switch back to `export`.

// Detect Tauri 2 environment. The bridge is exposed on window.__TAURI__
// when withGlobalTauri: true (set in tauri.conf.json).
const TAURI_AVAILABLE = typeof window !== 'undefined' && window.__TAURI__;

/**
 * Invoke a Tauri command by name. Returns a Promise.
 * Falls back to a no-op reject in non-Tauri environments (e.g. when
 * opening frontend/index.html directly in a browser for dev).
 */
async function invoke(cmd, args = {}) {
  if (!TAURI_AVAILABLE) {
    return Promise.reject(new Error(`invoke('${cmd}') called outside Tauri environment`));
  }
  return window.__TAURI__.core.invoke(cmd, args);
}

/**
 * Listen to a Tauri event (e.g. 'files-changed' emitted by main.rs).
 */
async function listen(event, handler) {
  if (!TAURI_AVAILABLE) return () => {};
  return window.__TAURI__.event.listen(event, handler);
}

/**
 * Open a URL in the user's default browser.
 */
async function openUrl(url) {
  if (!TAURI_AVAILABLE) {
    window.open(url, '_blank');
    return;
  }
  return invoke('open_in_browser', { url });
}

/**
 * Simple hash-based router. Phase 5 sessions will replace this with a
 * full router when the frontend is migrated to use modular pages.
 *
 * Usage:
 *   OslerAdmin.router.register('dashboard', () => { ... });
 *   OslerAdmin.router.navigate('dashboard');
 */
const router = {
  _routes: {},
  register(path, handler) { this._routes[path] = handler; },
  navigate(path) {
    if (window.location.hash !== '#' + path) {
      window.location.hash = '#' + path;
    } else {
      this._dispatch(path);
    }
  },
  _dispatch(path) {
    const handler = this._routes[path];
    if (handler) handler();
  },
  init() {
    window.addEventListener('hashchange', () => {
      const path = window.location.hash.slice(1) || 'dashboard';
      this._dispatch(path);
    });
    const initial = window.location.hash.slice(1) || 'dashboard';
    this._dispatch(initial);
  },
};

// Expose on window.OslerAdmin so non-module scripts can use these helpers.
// (Phase 8 will switch index.html to type="module" and we can revert to `export`.)
if (typeof window !== 'undefined') {
  window.OslerAdmin = { invoke, listen, openUrl, router, TAURI_AVAILABLE };
}

// Auto-init router on DOMContentLoaded.
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => router.init());
}
