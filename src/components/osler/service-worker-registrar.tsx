"use client";

import * as React from "react";

export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const isProduction = process.env.NODE_ENV === "production";

    if (!isProduction) {
      // Dev must never be controlled by a service worker — a previously
      // installed production SW would otherwise hijack/reload dev pages.
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister().catch(() => {}));
      });
      return;
    }

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      // Register immediately too, so the SW is active (and able to trigger
      // `beforeinstallprompt`) even if the load event is delayed on mobile.
      onLoad();
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
