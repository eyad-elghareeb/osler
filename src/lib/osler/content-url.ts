/**
 * Resolves the content base URL based on cloud config.
 *
 * Content has a single source of truth, decided at the instance level:
 *   - Cloud-enabled instance (cloud.enabled = true with an apiUrl, or
 *     NEXT_PUBLIC_CLOUD_API_URL set at build time) → content is served
 *     STRICTLY from the Cloudflare Worker's R2-backed endpoints. There is
 *     never a fallback to the local /osler-content/ directory.
 *   - Non-cloud instance → content is served STRICTLY from the local
 *     /osler-content/ directory. No remote URL is ever produced.
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

/* ── Public API ─────────────────────────────────────────────────── */

/**
 * Resolve the manifest URL for a given category folder. Cloud-enabled
 * instances always get the Worker URL; non-cloud instances the local path.
 */
export function manifestUrl(folder: string): string {
  const apiUrl = resolvedApiUrl();
  if (apiUrl) return normalizeUrl(remoteManifestUrl(apiUrl, folder));
  return localManifestUrl(folder);
}

/** Resolve a content file URL (data files, images, articles). */
export function contentFileUrl(category: string, relativePath: string): string {
  const apiUrl = resolvedApiUrl();
  if (apiUrl) return normalizeUrl(remoteContentUrl(apiUrl, category, relativePath));
  return localContentUrl(category, relativePath);
}

/** Base URL for a content node's folder (used for precache URLs and fetch bases). */
export function packBasePath(category: string, nodePath: string): string {
  const apiUrl = resolvedApiUrl();
  if (apiUrl) return normalizeUrl(remotePackBasePath(apiUrl, category, nodePath));
  return localPackBasePath(category, nodePath);
}
