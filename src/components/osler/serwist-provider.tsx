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
 */
export function SerwistProvider({ children }: { children: React.ReactNode }) {
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

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          if (cancelled) return;
          registration = reg;
          updateTimer = window.setInterval(update, 60 * 60 * 1000);
          document.addEventListener("visibilitychange", onVisibilityChange);
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
    };
  }, []);

  return <>{children}</>;
}
