/**
 * Resolves the content base URL based on cloud config.
 *
 * When the instance is cloud-enabled (cloud.enabled = true, cloud.apiUrl set),
 * content is served from the Cloudflare Worker's R2-backed endpoints.
 * Otherwise, falls back to the local /osler-content/ directory.
 */

import { getConfig } from "./config";

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

/** Resolve the manifest URL for a given category folder. */
export function manifestUrl(folder: string): string {
  const cfg = getConfig().cloud;
  if (cfg.enabled && cfg.apiUrl) return remoteManifestUrl(cfg.apiUrl, folder);
  return localManifestUrl(folder);
}

/** Resolve a content file URL (data files, images, articles). */
export function contentFileUrl(category: string, relativePath: string): string {
  const cfg = getConfig().cloud;
  if (cfg.enabled && cfg.apiUrl) return remoteContentUrl(cfg.apiUrl, category, relativePath);
  return localContentUrl(category, relativePath);
}

/** Base URL for a content node's folder (used for precache URLs and fetch bases). */
export function packBasePath(category: string, nodePath: string): string {
  const cfg = getConfig().cloud;
  if (cfg.enabled && cfg.apiUrl) return remotePackBasePath(cfg.apiUrl, category, nodePath);
  return localPackBasePath(category, nodePath);
}
