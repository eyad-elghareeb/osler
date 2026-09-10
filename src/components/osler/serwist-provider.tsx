"use client";

import * as React from "react";

import { startBackgroundPrecaching, initBackgroundSyncListeners } from "@/lib/osler/precache";

/**
 * Registers the service worker at `/sw.js` and manages lightweight active-route
 * precaching and silent recaching on updates.
 *
 * The SW is built separately by `scripts/build-sw.js` (esbuild) into
 * `public/sw.js` before `next build` runs. This avoids the
 * `@serwist/turbopack` integration which doesn't support
 * `output: "export"`.
 *
 * Every build stamps sw.js with a fresh build id (byte-diff → browser
 * update detection), and this provider re-checks for updates hourly and
 * whenever the tab becomes visible, so a deploy activates without the
 * user having to navigate twice.
 *
 * Registration is deferred until after the page is interactive to avoid
 * competing with first-paint network requests, followed by silent idle precaching.
 *
 * When a deploy lands while the app is open, the new worker activates
 * (skipWaiting) but this page keeps running the old JS — so the provider
 * tracks the worker's build id and fires `APP_UPDATE_EVENT` when a newer
 * build takes control, letting the shell prompt for a reload.
 */
export const APP_UPDATE_EVENT = "osler-app-update-available";

export function SerwistProvider({ children }: { children: React.ReactNode }) {
  // Last seen SW build id — a change means a deploy activated mid-session.
  const swBuildRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    // Attach listeners for background controller and content changes
    initBackgroundSyncListeners();

    if (!("serviceWorker" in navigator)) return;
    // Only register in production — dev builds have a non-minified SW
    // that adds noise to the console and competes with HMR.
    if (process.env.NODE_ENV !== "production") return;

    let registration: ServiceWorkerRegistration | null = null;
    let updateTimer: number | null = null;
    let cancelled = false;
    const update = () => {
      void registration?.update().catch(() => {});
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") update();
    };

    // Ask the controlling worker for its build id; when a newer build
    // takes control mid-session, tell the shell so it can prompt for a
    // reload instead of running stale code.
    const querySwBuild = () => {
      try {
        const ctrl = navigator.serviceWorker.controller;
        if (!ctrl || cancelled) return;
        const onMsg = (e: MessageEvent) => {
          if ((e.data as { type?: string })?.type !== "SW_BUILD") return;
          navigator.serviceWorker.removeEventListener("message", onMsg);
          const id = (e.data as { buildId?: unknown }).buildId;
          if (typeof id !== "string" || !id) return;
          if (swBuildRef.current && swBuildRef.current !== id) {
            window.dispatchEvent(new CustomEvent(APP_UPDATE_EVENT));
          }
          swBuildRef.current = id;
        };
        navigator.serviceWorker.addEventListener("message", onMsg);
        ctrl.postMessage({ type: "GET_SW_BUILD" });
      } catch {
        // ignore — update detection is best-effort
      }
    };

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          if (cancelled) return;
          registration = reg;
          updateTimer = window.setInterval(update, 60 * 60 * 1000);
          document.addEventListener("visibilitychange", onVisibilityChange);
          querySwBuild();
          navigator.serviceWorker.addEventListener("controllerchange", querySwBuild);
          // Existing installations already control this page. Fresh installs
          // trigger controllerchange and use the listener initialized above.
          void startBackgroundPrecaching();
        })
        .catch((err) => {
          // Don't crash the app if SW registration fails — the app still
          // works as a regular website without offline support.
          console.warn("[serwist] registration failed:", err);
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      if (updateTimer !== null) window.clearInterval(updateTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("load", register);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", querySwBuild);
      }
    };
  }, []);

  return <>{children}</>;
}
