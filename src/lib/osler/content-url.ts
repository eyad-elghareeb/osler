/**
 * Resolves the content base URL based on cloud config.
 *
 * Cloud-enabled instances prefer the Cloudflare Worker's R2-backed endpoints,
 * while bundled /osler-content/ paths remain available as an offline-safe
 * fallback. Non-cloud instances use the bundled paths directly.
 */

import { getConfig } from "./config";
import { currentContentVersion } from "./content-version";

/** Collapse runs of `/` in a URL path (except after `://`) to prevent double-slash R2 key mismatches. */
function normalizeUrl(url: string): string {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1) return url.replace(/\/{2,}/g, "/");
  const scheme = url.slice(0, schemeEnd + 3);
  const rest = url.slice(schemeEnd + 3);
  return scheme + rest.replace(/\/{2,}/g, "/");
}

/**
 * Resolve the cloud API base URL. Checks env var first, then falls back to
 * config. Returns null when the instance is NOT cloud-enabled — callers then
 * use local content.
 */
function resolvedApiUrl(): string | null {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLOUD_API_URL) {
    return process.env.NEXT_PUBLIC_CLOUD_API_URL.replace(/\/$/, "");
  }
  const cfg = getConfig().cloud;
  if (cfg.enabled && cfg.apiUrl) return cfg.apiUrl.replace(/\/$/, "");
  return null;
}

/* ── Local paths (same-origin static files) ─────────────────────── */

export function localManifestUrl(folder: string): string {
  return `/osler-content/${folder}/manifest.json`;
}

export function localContentUrl(category: string, relativePath: string): string {
  return `/osler-content/${category}/${relativePath}`;
}

export function localPackBasePath(category: string, nodePath: string): string {
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

/* ── Public API ─────────────────────────────────────────────────── */

/**
 * Resolve the preferred manifest URL for a given category folder. Cloud-enabled
 * instances get the Worker URL first; callers may use localManifestUrl() when
 * the remote source is unavailable.
 *
 * When a content version is known (see content-version.ts) the URL gains a
 * `?v=<stamp>` cache-buster, so freshly published manifests download instantly
 * instead of being served from the browser/HTTP cache under the old URL.
 */
export function manifestUrl(folder: string): string {
  const apiUrl = resolvedApiUrl();
  if (apiUrl) return cacheBust(normalizeUrl(remoteManifestUrl(apiUrl, folder)));
  return cacheBust(localManifestUrl(folder));
}

/** Append the current content-version stamp to a URL that has none yet. Exported
 *  for callers that build file URLs by concatenating a base + filename. */
export function cacheBust(url: string): string {
  const version = currentContentVersion();
  if (!version || url.includes("v=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

/** Resolve a preferred content file URL (data files, images, articles).
 *  Cache-busted with `?v=` when a version is known so a publish lands
 *  instantly instead of waiting out the 5-minute /osler-content cache.
 *  SW and CDN treat the versioned URL as immutable. Directory prefixes
 *  (relativePath ending with "/" or empty) are NOT busted — the caller will
 *  append a filename and we must not put `?v=` in the middle of the path. */
export function contentFileUrl(category: string, relativePath: string): string {
  const apiUrl = resolvedApiUrl();
  const url = apiUrl
    ? normalizeUrl(remoteContentUrl(apiUrl, category, relativePath))
    : localContentUrl(category, relativePath);
  // Only bust file URLs; directory bases would place ?v= before the filename.
  if (relativePath === "" || relativePath.endsWith("/")) return url;
  return cacheBust(url);
}

/** Base URL for a content node's folder (used for precache URLs and fetch bases).
 *  Intentionally NOT cache-busted: nodeUrls() and loadNodeContent() build
 *  final file URLs as `${base}${file}` and must not have `?v=` between them. */
export function packBasePath(category: string, nodePath: string): string {
  const apiUrl = resolvedApiUrl();
  if (apiUrl) return normalizeUrl(remotePackBasePath(apiUrl, category, nodePath));
  return localPackBasePath(category, nodePath);
}

/** Cache-busted variant of packBasePath + file resolution — use for any
 *  final file URL that will be fetched or precached. Saves bandwidth: with
 *  `?v=` the SW CacheFirst handler treats the URL as immutable, so repeat
 *  visits hit local cache only (zero Worker/R2 cost) until a publish bumps v. */
export function packFileUrl(category: string, nodePath: string, file: string): string {
  return cacheBust(`${packBasePath(category, nodePath)}${file}`);
}
