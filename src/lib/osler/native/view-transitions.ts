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
 * Run `cb` (typically a React state setter) inside a view transition.
 * Returns the transition object for advanced use, or null if unsupported.
 *
 * If the API is unavailable or the user prefers reduced motion, the
 * callback runs synchronously with no transition.
 */
export function withViewTransition<T>(
  cb: () => T,
  direction: ViewTransitionDirection = "none",
): T | undefined {
  // Reduced motion: skip transition entirely.
  if (prefersReducedMotion()) return cb();

  if (!isViewTransitionsSupported()) {
    return cb();
  }

  try {
    const root = document.documentElement;
    if (direction !== "none") {
      root.setAttribute(VT_DIR_ATTR, direction);
    } else {
      root.removeAttribute(VT_DIR_ATTR);
    }

    const transition = (document as any).startViewTransition(() => {
      // The callback MUST be synchronous from the browser's perspective —
      // React state updates batch and flush before this returns, which
      // is what we want. The returned value is preserved.
      return cb();
    });

    // Clean up the direction attribute after the transition finishes so it
    // doesn't leak into the next navigation.
    if (transition?.finished) {
      transition.finished.finally(() => {
        root.removeAttribute(VT_DIR_ATTR);
      });
    }

    return undefined as T | undefined; // we discard the callback return value
  } catch {
    // Any failure — just run the callback directly.
    return cb();
  }
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
