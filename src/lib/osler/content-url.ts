/**
 * Resolves the content base URL based on cloud config.
 *
 * When the instance is cloud-enabled (cloud.enabled = true, cloud.apiUrl set),
 * content is served from the Cloudflare Worker's R2-backed endpoints.
 * Otherwise, falls back to the local /osler-content/ directory.
 *
 * If the Worker is unreachable (fetch fails), the URL helpers silently fall
 * back to local paths so the main site keeps working.
 */

import { getConfig } from "./config";

/** Collapse runs of `/` in a URL path (except after `://`) to prevent double-slash R2 key mismatches. */
function normalizeUrl(url: string): string {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) return url.replace(/\/{2,}/g, "/");
  const scheme = url.slice(0, schemeEnd + 3);
  const rest = url.slice(schemeEnd + 3);
  return scheme + rest.replace(/\/{2,}/g, "/");
}

/** Resolve the cloud API base URL. Checks env var first, then falls back to config. */
function resolvedApiUrl(): string | null {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLOUD_API_URL) {
    return process.env.NEXT_PUBLIC_CLOUD_API_URL.replace(/\/$/, "");
  }
  const cfg = getConfig().cloud;
  if (cfg.enabled && cfg.apiUrl) return cfg.apiUrl.replace(/\/$/, "");
  return null;
}

/* ── Local paths (same-origin static files) ─────────────────────── */

function localManifestUrl(folder: string): string {
  return `/osler-content/${folder}/manifest.json`;
}

function localContentUrl(category: string, relativePath: string): string {
  return `/osler-content/${category}/${relativePath}`;
}

function localPackBasePath(category: string, nodePath: string): string {
  return `/osler-content/${category}/${nodePath}`;
}

/* ── Remote paths (Worker R2-backed) ────────────────────────────── */

function remoteManifestUrl(apiUrl: string, folder: string): string {
  return `${apiUrl}/v1/content-manifests/${folder}/manifest.json`;
}

function remoteContentUrl(apiUrl: string, category: string, relativePath: string): string {
  return `${apiUrl}/v1/content/${category}/${relativePath}`;
}

function remotePackBasePath(apiUrl: string, category: string, nodePath: string): string {
  return `${apiUrl}/v1/content/${category}/${nodePath}`;
}

/* ── Cloud health cache ─────────────────────────────────────────── */

let _cloudReachable: boolean | null = null;
let _cloudCheckPromise: Promise<boolean> | null = null;
let _reprobeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Probe the Worker once to check if it's reachable. Caches the result for
 * 60 seconds so repeated calls don't hammer the network.
 *
 * First-call behavior: optimistically returns `true` (so the initial fetch
 * hits the Worker, which is the common case) AND kicks off an async probe
 * to confirm. If the probe fails, `resetCloudReachable()` is called by the
 * fetch-error handler in `content.ts`, which flips `_cloudReachable` to
 * `false` and triggers a 30 s re-probe. This means:
 *   - Online + Worker up: 1 fetch to Worker, success. ✓
 *   - Online + Worker down: 1 fetch to Worker (fails) → 1 fetch to local. ✓
 *   - Offline: 1 fetch to Worker (fails) → 1 fetch to local (SW-cached). ✓
 */
function isCloudReachable(): boolean {
  if (_cloudReachable === null) {
    const apiUrl = resolvedApiUrl();
    if (!apiUrl) return false;
    // Optimistically assume reachable; the probe will correct this.
    _cloudReachable = true;
    if (!_cloudCheckPromise) _probeCloud(apiUrl);
    return true;
  }
  return _cloudReachable;
}

function _probeCloud(apiUrl: string): void {
  _cloudCheckPromise = fetch(`${apiUrl}/v1/health`, {
    method: "GET",
    signal: AbortSignal.timeout(5000),
  })
    .then((r) => r.ok)
    .catch(() => false)
    .then((ok) => {
      _cloudReachable = ok;
      _cloudCheckPromise = null;
      // Re-probe after 60 s or after a forced reset, whichever comes first.
      if (_reprobeTimer) clearTimeout(_reprobeTimer);
      _reprobeTimer = setTimeout(() => {
        _reprobeTimer = null;
        _cloudReachable = null;
      }, 60_000);
      return ok;
    });
}

/* ── Public API ─────────────────────────────────────────────────── */

/** Resolve the manifest URL for a given category folder. */
export function manifestUrl(folder: string): string {
  const apiUrl = resolvedApiUrl();
  if (apiUrl && isCloudReachable()) return normalizeUrl(remoteManifestUrl(apiUrl, folder));
  return localManifestUrl(folder);
}

/** Resolve a content file URL (data files, images, articles). */
export function contentFileUrl(category: string, relativePath: string): string {
  const apiUrl = resolvedApiUrl();
  if (apiUrl && isCloudReachable()) return normalizeUrl(remoteContentUrl(apiUrl, category, relativePath));
  return localContentUrl(category, relativePath);
}

/** Base URL for a content node's folder (used for precache URLs and fetch bases). */
export function packBasePath(category: string, nodePath: string): string {
  const apiUrl = resolvedApiUrl();
  if (apiUrl && isCloudReachable()) return normalizeUrl(remotePackBasePath(apiUrl, category, nodePath));
  return localPackBasePath(category, nodePath);
}

/**
 * Force-reset the cloud reachability cache. Call this after a failed fetch
 * to immediately fall back to local content without waiting for the cache
 * to expire. Marks cloud as unreachable and schedules a re-probe after 30 s.
 */
export function resetCloudReachable(): void {
  _cloudReachable = false;
  _cloudCheckPromise = null;
  // Schedule a re-probe so the Worker can recover without waiting the full 60 s.
  if (_reprobeTimer) clearTimeout(_reprobeTimer);
  _reprobeTimer = setTimeout(() => {
    _reprobeTimer = null;
    _cloudReachable = null;
  }, 30_000);
}

/**
 * Force-recheck the cloud NOW (bypassing the 60 s cache). Use this after an
 * admin publishes new content via the admin panel — the next content fetch
 * will hit R2 fresh instead of relying on a stale reachability result.
 *
 * Returns a promise that resolves to true if the cloud is reachable, false
 * otherwise. Also resets `_cloudReachable` to null so the next call to
 * `manifestUrl()` / `contentFileUrl()` re-probes.
 */
export async function forceRecheckCloud(): Promise<boolean> {
  const apiUrl = resolvedApiUrl();
  if (!apiUrl) return false;
  if (_reprobeTimer) { clearTimeout(_reprobeTimer); _reprobeTimer = null; }
  _cloudReachable = null;
  _cloudCheckPromise = null;
  // Reuse the internal probe and await it this time.
  _probeCloud(apiUrl);
  await _cloudCheckPromise;
  return _cloudReachable === true;
}
