"use client";

/**
 * AnalyticsProvider — wires the osler analytics collector into the React app.
 *
 * Mounts once at the root layout and:
 *   • captures Core Web Vitals (LCP, INP, CLS, TTFB, FCP) via PerformanceObserver,
 *   • emits a `page_view` event on initial load and a `route_change` event
 *     on subsequent App-Router pathname changes (NOT both on every change —
 *     that was a redundant double-count bug in v1),
 *   • captures uncaught JS errors and unhandled promise rejections,
 *   • wraps `window.fetch` so any call to the cloud backend is automatically
 *     timed — EXCEPT the analytics ingest endpoint itself (otherwise every
 *     flush would generate an api_call event for POST /v1/analytics/events,
 *     creating an infinite self-referential noise loop).
 *
 * The provider is intentionally lightweight (no context, no children wiring) —
 * it just needs to be mounted so its effects run. All actual collection lives
 * in `src/lib/osler/analytics.ts`.
 *
 * Privacy: see the contract documented in `analytics.ts`. No PII is collected.
 * The provider respects Do-Not-Track and the user's localStorage opt-out flag.
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getConfig } from "@/lib/osler/config";
import {
  analytics,
  analyticsEnabled,
  startAnalytics,
  stopAnalytics,
  flush,
  __internal,
} from "@/lib/osler/analytics";

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Track whether we've already emitted the initial page_view so subsequent
  // pathname changes emit route_change instead. Using a ref avoids re-running
  // the effect on every render.
  const firstViewEmitted = useRef(false);

  // ── 0. Wait for cloud config to load, then mark "ready" ────────────────
  // analyticsEnabled() returns false until loadConfig() resolves (async,
  // happens in OslerI18nProvider). Because the setup effect below has []
  // deps, it would run only once on mount — and if config wasn't ready at
  // that instant, analytics would NEVER start. This poller re-checks every
  // 500ms for up to 10s, flips `ready` to true as soon as analyticsEnabled()
  // returns true, and stops. The downstream effects depend on `ready` so
  // they re-run exactly once when config arrives.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (analyticsEnabled()) { setReady(true); return; }
    let elapsed = 0;
    const iv = setInterval(() => {
      elapsed += 500;
      if (analyticsEnabled() || elapsed >= 10_000) {
        clearInterval(iv);
        if (analyticsEnabled()) setReady(true);
      }
    }, 500);
    return () => clearInterval(iv);
  }, []);

  // ── 1. Boot the collector + Core Web Vitals ─────────────────────────────
  // This single effect handles: starting the flush timer, binding lifecycle
  // listeners, and setting up ALL PerformanceObservers (LCP, CLS, INP, FCP,
  // TTFB). Depends on `ready` so it runs once config loads. The previous
  // version split this across two effects with a fragile
  // early-return-inside-try structure that leaked cleanup when the LCP
  // observer constructor threw.
  useEffect(() => {
    if (!ready) return;
    if (!analyticsEnabled()) return;

    startAnalytics();

    const browser = __internal.detectBrowser();
    const device = __internal.detectDevice();
    const connection = __internal.detectConnection();
    const env = { browser, device, connection };

    const observers: PerformanceObserver[] = [];
    const visibilityHandlers: Array<() => void> = [];

    // LCP — Largest Contentful Paint. Fires multiple times; we keep the
    // latest value and report it when the page becomes hidden (the
    // canonical reporting point per web.dev guidance).
    let lcpValue: number | null = null;
    try {
      const lcpObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          lcpValue = entry.startTime;
        }
      });
      lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
      observers.push(lcpObs);
    } catch {
      // PerformanceObserver or the LCP type unsupported — skip silently.
    }

    // CLS — Cumulative Layout Shift. Accumulate session value; report on hide.
    let clsValue = 0;
    try {
      const clsObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as any;
          if (!e.hadRecentInput) clsValue += e.value;
        }
      });
      clsObs.observe({ type: "layout-shift", buffered: true });
      observers.push(clsObs);
    } catch {}

    // INP — Interaction to Next Paint. Report the worst interaction in the
    // session (the p98-ish value).
    let inpValue: number | null = null;
    try {
      const inpObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = (entry as any).duration ?? 0;
          if (inpValue == null || duration > inpValue) inpValue = duration;
        }
      });
      // `durationThreshold` is a valid W3C option but not yet in TS's
      // lib.dom.d.ts — cast to the loose type so the build passes.
      inpObs.observe({
        type: "event",
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
      observers.push(inpObs);
    } catch {}

    // FCP — First Contentful Paint. Single entry, report immediately.
    try {
      const fcpObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === "first-contentful-paint") {
            analytics.webVital("FCP", entry.startTime, env);
          }
        }
      });
      fcpObs.observe({ type: "paint", buffered: true });
      observers.push(fcpObs);
    } catch {}

    // TTFB — Time to First Byte. Comes from the navigation entry.
    try {
      const navObs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "navigation") {
            const ttfb = (entry as PerformanceNavigationTiming).responseStart;
            if (ttfb > 0) analytics.webVital("TTFB", ttfb, env);
          }
        }
      });
      navObs.observe({ type: "navigation", buffered: true });
      observers.push(navObs);
    } catch {}

    // Single visibility handler that flushes LCP / CLS / INP on hide.
    // (Previous version had two separate handlers for the same event.)
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (lcpValue != null) {
          analytics.webVital("LCP", lcpValue, env);
          lcpValue = null;
        }
        if (clsValue > 0) {
          analytics.webVital("CLS", clsValue, env);
          clsValue = 0;
        }
        if (inpValue != null) {
          analytics.webVital("INP", inpValue, env);
          inpValue = null;
        }
        // Also flush the buffer on hide — startAnalytics() already binds
        // visibilitychange for this, but calling flush() here too is a
        // harmless no-op if the buffer is empty.
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    visibilityHandlers.push(onVisibility);

    return () => {
      observers.forEach((o) => o.disconnect());
      visibilityHandlers.forEach((h) => document.removeEventListener("visibilitychange", h));
      // stopAnalytics() is called by the teardown effect below — don't
      // double-stop here.
    };
  }, [ready]);

  // ── 2. Route tracking ───────────────────────────────────────────────────
  // Emit `page_view` on the FIRST mount (initial landing), then `route_change`
  // on every subsequent pathname change. The previous version emitted BOTH
  // on every change, which doubled the event count for no analytical value.
  useEffect(() => {
    if (!ready) return;
    if (!pathname) return;
    if (!firstViewEmitted.current) {
      analytics.pageView(pathname);
      firstViewEmitted.current = true;
    } else {
      analytics.routeChange(pathname);
    }
  }, [pathname, ready]);

  // ── 3. Global error handlers ────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;

    const onError = (event: ErrorEvent) => {
      analytics.jsError(event.message || "(unknown error)", {
        filename: event.filename?.split("/").slice(-2).join("/"),
        lineno: event.lineno,
        colno: event.colno,
        type: event.error?.name || "Error",
      });
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      let message = "(unhandled promise rejection)";
      if (typeof reason === "string") message = reason;
      else if (reason && typeof reason === "object" && "message" in reason) {
        message = String((reason as any).message);
      }
      analytics.jsError(message, {
        type: reason?.name || "PromiseRejection",
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, [ready]);

  // ── 4. Fetch wrapper (times calls to the cloud backend) ─────────────────
  // Wraps window.fetch to time every call to our cloud backend. CRITICAL:
  // we MUST exclude the analytics ingest endpoint itself — otherwise every
  // flush POST generates an api_call event, which gets flushed in the next
  // batch, which generates another api_call event... infinite self-referential
  // noise that pollutes the API performance dashboard.
  useEffect(() => {
    if (!ready) return;
    if (typeof window === "undefined") return;
    // Idempotent — don't double-wrap if React Strict Mode mounts us twice.
    if ((window as any).__oslerAnalyticsFetchWrapped) return;
    (window as any).__oslerAnalyticsFetchWrapped = true;

    const origFetch = window.fetch.bind(window);

    // Resolve the API base URL dynamically on each call rather than capturing
    // it at mount time. The config may not be loaded yet when this effect
    // first runs, and the env var alone is insufficient in setups that rely
    // on osler.config.json. Reading it per-call is cheap (it's a sync cache
    // lookup) and avoids the stale-capture bug.
    const resolveApiBase = (): string => {
      try {
        if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CLOUD_API_URL) {
          return process.env.NEXT_PUBLIC_CLOUD_API_URL.replace(/\/$/, "");
        }
        // getConfig() is a sync cache lookup — returns DEFAULT_CONFIG if
        // loadConfig() hasn't resolved yet, which means isOurs will be false
        // and we skip timing until config is ready. That's fine.
        const cfg = getConfig();
        if (cfg.cloud?.enabled && cfg.cloud.apiUrl) {
          return cfg.cloud.apiUrl.replace(/\/$/, "");
        }
      } catch {}
      return "";
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      const apiBase = resolveApiBase();
      // Only time calls that go to OUR cloud backend. If apiBase is empty
      // (config not loaded), skip — don't fall back to a loose /v1/ match
      // that would catch third-party APIs.
      const isOurs = apiBase.length > 0 && url.startsWith(apiBase);
      // CRITICAL: never time the analytics ingest endpoint itself.
      const isAnalyticsIngest = url.includes("/v1/analytics/events");
      if (!isOurs || isAnalyticsIngest) {
        return origFetch(input, init);
      }

      const start = performance.now();
      try {
        const res = await origFetch(input as any, init);
        const duration = performance.now() - start;
        const u = new URL(url, window.location.origin);
        const method = (init?.method || "GET").toUpperCase();
        const endpoint = `${method} ${__internal.normalizePath(u.pathname)}`;
        analytics.apiCall(endpoint, duration, {
          status: res.status,
        });
        return res;
      } catch (err: any) {
        const duration = performance.now() - start;
        const u = new URL(url, window.location.origin);
        const method = (init?.method || "GET").toUpperCase();
        const endpoint = `${method} ${__internal.normalizePath(u.pathname)}`;
        analytics.apiCall(endpoint, duration, {
          status: 0,
          error: err?.name || "NetworkError",
        });
        throw err;
      }
    };

    return () => {
      // Restore on unmount (mostly for HMR / Strict Mode).
      window.fetch = origFetch;
      (window as any).__oslerAnalyticsFetchWrapped = false;
    };
  }, [ready]);

  // ── 5. Tear down on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      void flush();
      stopAnalytics();
    };
  }, []);

  return <>{children}</>;
}
