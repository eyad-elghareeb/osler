"use client";

import * as React from "react";

/**
 * Registers the service worker at `/sw.js`.
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
 * competing with first-paint network requests.
 */
export function SerwistProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Only register in production — dev builds have a non-minified SW
    // that adds noise to the console and competes with HMR.
    if (process.env.NODE_ENV !== "production") return;

    let registration: ServiceWorkerRegistration | null = null;
    const update = () => void registration?.update().catch(() => {});

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          registration = reg;
          window.setInterval(update, 60 * 60 * 1000);
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") update();
          });
        })
        .catch((err) => {
          // Don't crash the app if SW registration fails — the app still
          // works as a regular website without offline support.
          console.warn("[serwist] registration failed:", err);
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return <>{children}</>;
}
