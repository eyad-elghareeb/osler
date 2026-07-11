"use client";

import * as React from "react";

/**
 * useContentCache — React hook for the per-pack content cache.
 *
 * Talks to the service worker (sw.js) via `postMessage` to:
 *   • check whether a pack is already cached
 *   • precache (download) a pack's content URLs
 *   • remove a pack from the cache
 *
 * Cache semantics:
 *   - Content is NEVER auto-cached on fetch. The SW serves from network
 *     first and only falls back to the cache when offline.
 *   - The cache is populated exclusively by user action via this hook.
 *   - Precaching re-fetches even if already cached (cache-bust).
 *
 * Each pack is identified by a stable `packId` (usually the node.uid) and
 * a list of URLs to cache (the manifest + data files for that pack).
 */

export type DownloadState =
  | "unknown"       // haven't checked yet
  | "not-cached"    // checked, not in cache
  | "downloading"   // precache in flight
  | "cached"        // all URLs in cache
  | "partial"       // some URLs in cache
  | "error";        // last precache attempt failed

export interface PrecacheProgress {
  done: number;
  total: number;
}

interface PrecacheResult {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

function swAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    !!navigator.serviceWorker.controller
  );
}

export function useContentCache() {
  const [states, setStates] = React.useState<Record<string, DownloadState>>({});
  const [progress, setProgress] = React.useState<Record<string, PrecacheProgress>>({});

  // Listen for SW → page messages
  React.useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const handler = (event: MessageEvent) => {
      const { data } = event;
      if (!data || !data.type) return;

      switch (data.type) {
        case "CONTENT_CACHE_STATUS": {
          const state: DownloadState = data.allCached
            ? "cached"
            : data.urls.every((r: { cached: boolean }) => r.cached === false)
              ? "not-cached"
              : "partial";
          setStates((prev) => ({ ...prev, [data.packId]: state }));
          break;
        }
        case "PRECACHE_PROGRESS": {
          setProgress((prev) => ({
            ...prev,
            [data.packId]: { done: data.done, total: data.total },
          }));
          break;
        }
        case "PRECACHE_RESULT": {
          const allOk = data.results.every((r: PrecacheResult) => r.ok);
          setStates((prev) => ({
            ...prev,
            [data.packId]: allOk ? "cached" : "error",
          }));
          setProgress((prev) => {
            const next = { ...prev };
            delete next[data.packId];
            return next;
          });
          break;
        }
        case "CONTENT_REMOVED": {
          setStates((prev) => ({ ...prev, [data.packId]: "not-cached" }));
          break;
        }
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    // Re-check controller availability (the SW may take a moment to control)
    const readyCheck = setTimeout(() => {
      // Trigger a re-render so consumers can re-attempt checkStatus
      setStates((prev) => ({ ...prev }));
    }, 1500);

    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
      clearTimeout(readyCheck);
    };
  }, []);

  const checkStatus = React.useCallback((packId: string, urls: string[]) => {
    if (!swAvailable() || urls.length === 0) return;
    navigator.serviceWorker.controller!.postMessage({
      type: "CHECK_CONTENT_CACHED",
      packId,
      urls,
    });
  }, []);

  const precache = React.useCallback((packId: string, urls: string[]) => {
    if (!swAvailable() || urls.length === 0) {
      // No SW — mark as error so the UI can show a message
      setStates((prev) => ({ ...prev, [packId]: "error" }));
      return;
    }
    setStates((prev) => ({ ...prev, [packId]: "downloading" }));
    setProgress((prev) => ({
      ...prev,
      [packId]: { done: 0, total: urls.length },
    }));
    navigator.serviceWorker.controller!.postMessage({
      type: "PRECACHE_CONTENT",
      packId,
      urls,
    });
  }, []);

  const remove = React.useCallback((packId: string, urls: string[]) => {
    if (!swAvailable() || urls.length === 0) return;
    setStates((prev) => ({ ...prev, [packId]: "not-cached" }));
    navigator.serviceWorker.controller!.postMessage({
      type: "REMOVE_CONTENT",
      packId,
      urls,
    });
  }, []);

  const getState = React.useCallback(
    (packId: string): DownloadState => states[packId] ?? "unknown",
    [states]
  );

  const getProgress = React.useCallback(
    (packId: string): PrecacheProgress | undefined => progress[packId],
    [progress]
  );

  return { getState, getProgress, checkStatus, precache, remove, swReady: swAvailable() };
}
