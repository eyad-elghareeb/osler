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

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
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
