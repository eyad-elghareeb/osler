/**
 * Osler View Transitions — wrapper around the View Transitions API.
 *
 * Docs: https://whatpwacando.today/view-transitions
 * Spec: https://www.w3.org/TR/view-transitions/
 *
 * Design notes:
 *  - The View Transitions API lets the browser snapshot the DOM before and
 *    after a mutation and crossfade (or slide) between the two snapshots.
 *    Without it, our React updates are instant and there is no spatial
 *    cue for the user. With it, navigating between Dashboard / Library /
 *    QBank / Videos feels like a native push-navigation transition.
 *  - The API is `document.startViewTransition(cb)` on Chrome/Edge/Safari
 *    (recent versions). Firefox support is still partial — we feature-detect
 *    and fall back to instant update when unavailable.
 *  - Direction (slide left vs slide right) is signaled by setting
 *    `data-vt-direction` on <html> before calling startViewTransition.
 *    The matching CSS lives in globals.css under `@view-transition`.
 *  - We honor `prefers-reduced-motion`: when reduced, we skip the snapshot
 *    roundtrip entirely and just call the callback synchronously.
 */

export type ViewTransitionDirection = "forward" | "backward" | "none";

const VT_DIR_ATTR = "data-vt-direction";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function isViewTransitionsSupported(): boolean {
  if (typeof document === "undefined") return false;
  return typeof (document as any).startViewTransition === "function";
}

/**
 * Run `cb` (typically a React state setter or an async navigation) inside a
 * view transition. Returns when the transition has been started (not
 * necessarily finished).
 *
 * The callback may be async — the spec waits for its promise before
 * capturing the "new" snapshot. This is essential for Next.js App Router,
 * where router.push() updates the DOM asynchronously: without awaiting the
 * route change the browser would snapshot old→old (identical frames) while
 * the real render popped in abruptly afterwards.
 *
 * If the API is unavailable or the user prefers reduced motion, the
 * callback runs directly with no transition.
 */
export function withViewTransition<T>(
  cb: () => T | Promise<T>,
  direction: ViewTransitionDirection = "none",
): void {
  // Reduced motion / unsupported: run directly, no snapshot roundtrip.
  if (prefersReducedMotion() || !isViewTransitionsSupported()) {
    void Promise.resolve(cb());
    return;
  }

  try {
    const root = document.documentElement;
    if (direction !== "none") {
      root.setAttribute(VT_DIR_ATTR, direction);
    } else {
      root.removeAttribute(VT_DIR_ATTR);
    }

    const transition = (document as any).startViewTransition(async () => {
      await cb();
    });

    // Clean up the direction attribute after the transition finishes so it
    // doesn't leak into the next navigation.
    if (transition?.finished) {
      transition.finished.finally(() => {
        root.removeAttribute(VT_DIR_ATTR);
      });
    }
  } catch {
    // Any failure — just run the callback directly.
    void Promise.resolve(cb());
  }
}

/**
 * Resolve after the SPA route has actually changed AND the new page has
 * committed + painted (two extra frames). Used to keep a view transition's
 * "new" snapshot honest for async client-side routers like Next.js App
 * Router, whose push() mutates the DOM some time after being called.
 *
 * Caps at ~maxFrames (~650ms) so a stalled navigation can't freeze the
 * page behind the transition overlay forever.
 */
export function waitForRouteChange(beforeUrl: string, maxFrames = 40): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0;
    const tick = () => {
      const now = window.location.pathname + window.location.search;
      if (now !== beforeUrl) {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        return;
      }
      if (++frames >= maxFrames) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Push a new SPA route inside a view transition, waiting for the router to
 * actually render it so the browser crossfades old→new (not old→old).
 * Falls back to a plain push when VT is unsupported or reduced motion is on.
 *
 * `push` is typically Next.js's router.push — any synchronous kick-off of an
 * async client-side navigation works.
 */
export function pushWithViewTransition(
  push: (path: string) => void,
  path: string,
  direction: ViewTransitionDirection = "none",
): void {
  withViewTransition(async () => {
    const before = window.location.pathname + window.location.search;
    push(path);
    await waitForRouteChange(before);
  }, direction);
}

/**
 * Track the navigation stack so we can pick a sensible direction for the
 * slide transition. Call `pushNavHistory(key)` whenever the user enters
 * a new top-level view, and `popNavHistory()` on back navigation.
 *
 * The history is purely advisory — the caller decides what "forward" and
 * "backward" mean. This helper just gives us a counter-based heuristic.
 */
const navStack: string[] = [];

export function pushNavHistory(key: string): ViewTransitionDirection {
  const last = navStack[navStack.length - 1];
  if (last === key) return "none";
  navStack.push(key);
  return "forward";
}

export function popNavHistory(): ViewTransitionDirection {
  navStack.pop();
  return "backward";
}

export function resetNavHistory(key?: string): void {
  navStack.length = 0;
  if (key) navStack.push(key);
}

export function peekNavHistory(): string | undefined {
  return navStack[navStack.length - 1];
}
