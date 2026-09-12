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
 *    (recent versions). Firefox now exposes it too, but its snapshot
 *    compositing tears visibly on dense pages — quarantined below, we
 *    feature-detect AND engine-detect, falling back to instant update.
 *  - Direction (slide left vs slide right, or the subtle tab crossfade) is
 *    signaled by setting `data-vt-direction` on <html> before calling
 *    startViewTransition. The matching CSS lives in globals.css under
 *    `@view-transition`. "tab" is the lateral-motion-free crossfade used by
 *    bottom-tab / top-nav hub switches; "forward"/"backward" are reserved
 *    for push/pop drill navigation where the slide implies stack depth.
 *  - We honor `prefers-reduced-motion`: when reduced, we skip the snapshot
 *    roundtrip entirely and just call the callback synchronously.
 */

import { isAnimationsEnabled } from "@/lib/osler/motion";

export type ViewTransitionDirection = "forward" | "backward" | "none" | "tab";

const VT_DIR_ATTR = "data-vt-direction";

/**
 * Firefox exposes `document.startViewTransition`, but its snapshot
 * compositing is software-rendered and tears visibly on dense pages (hub
 * grids, admin tables) — every navigation freezes, then flashes. Chrome's
 * GPU path stays smooth, which is exactly the reported
 * "fine in Chrome, flashing in Firefox" split. Quarantined by engine until
 * the implementation matures; harmless where VT is absent (already skipped)
 * and on FxiOS (WebKit, no VT to skip).
 */
function isFirefoxEngine(): boolean {
  try {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    return ua.includes("Firefox/") || ua.includes("FxiOS/");
  } catch {
    return false;
  }
}

/**
 * Whether the route swap should run bare, with no snapshot roundtrip.
 * Beyond OS reduced-motion and missing API support, three Osler-specific
 * cases skip: the user disabling UI animations in Settings (previously the
 * toggle silenced framer-motion but every navigation still slid),
 * low-perf devices (AnimationsProvider flags `<html data-perf="low">`),
 * where the full-page snapshot animation itself janks, and Firefox (see
 * `isFirefoxEngine` — software snapshots tear).
 */
function shouldSkipTransition(): boolean {
  if (isFirefoxEngine()) return true;
  if (prefersReducedMotion() || !isViewTransitionsSupported() || vtInFlight) return true;
  try {
    // startViewTransition() throws / skips with InvalidStateError when the
    // document is hidden (e.g. a navigation kicked off from a background
    // tab, or the tab hid mid-flight). Those skips surfaced as js_error
    // telemetry — run directly instead.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return true;
    if (!isAnimationsEnabled()) return true;
    if (typeof document !== "undefined" && document.documentElement.getAttribute("data-perf") === "low") return true;
  } catch {
    // ignore — fall through to transitioning
  }
  return false;
}

/**
 * True while a view transition is capturing/animating. A newer
 * startViewTransition auto-skips an in-flight one, but every skip still pays
 * a full-page snapshot capture — under rapid taps that cost lands right in
 * the middle of navigation and shows up as jank. While this flag is set we
 * run updates directly: an instant swap beats a queued transition.
 */
let vtInFlight = false;

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
 * Whether navigations need a lightweight CSS fallback animation because the
 * native snapshot transition won't carry them: Firefox (quarantined above),
 * browsers without the API, or low-perf devices — while motion is otherwise
 * allowed. Reduced-motion and the Settings animations toggle are excluded
 * here (no animation at all there; the global kill-switches squash the
 * fallback too, so a stale flag is harmless).
 *
 * AppShell calls `initViewTransitionFlags()` once on mount so CSS can target
 * `html[data-vt="off"]` with a subtle enter animation, keeping tab switches
 * feeling intentional instead of an abrupt cut where VT is absent.
 */
export function wantsFallbackTransition(): boolean {
  if (typeof document === "undefined" || typeof navigator === "undefined") return false;
  try {
    if (prefersReducedMotion() || !isAnimationsEnabled()) return false;
    if (isFirefoxEngine() || !isViewTransitionsSupported()) return true;
    if (document.documentElement.getAttribute("data-perf") === "low") return true;
  } catch {
    // ignore — cosmetic flag only.
  }
  return false;
}

/** Mirror `wantsFallbackTransition()` onto `<html data-vt="off">` for CSS. */
export function initViewTransitionFlags(): void {
  try {
    if (wantsFallbackTransition()) document.documentElement.setAttribute("data-vt", "off");
    else document.documentElement.removeAttribute("data-vt");
  } catch {
    // ignore — cosmetic flag only.
  }
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
  // Reduced motion / animations off / low-perf / unsupported / transition
  // already settling: run directly, no snapshot roundtrip.
  if (shouldSkipTransition()) {
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

    vtInFlight = true;
    const transition = (document as any).startViewTransition(async () => {
      await cb();
    });

    // Clean up the direction attribute after the transition finishes so it
    // doesn't leak into the next navigation. Skipped transitions reject
    // `finished` with an AbortError (a newer navigation superseded this one)
    // — swallow it so it never surfaces as an unhandled rejection. The same
    // applies to `ready` and `updateCallbackDone`: a tab hidden mid-flight
    // rejects them with InvalidStateError ("Transition was aborted because
    // of invalid state"), which previously landed in js_error telemetry.
    if (transition) {
      transition.updateCallbackDone?.catch(() => {});
      transition.ready?.catch(() => {});
      if (transition?.finished) {
        transition.finished
          .catch(() => {})
          .finally(() => {
            vtInFlight = false;
            root.removeAttribute(VT_DIR_ATTR);
          });
      } else {
        vtInFlight = false;
      }
    } else {
      vtInFlight = false;
    }
  } catch {
    vtInFlight = false;
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
 * Caps at ~maxFrames (~500ms) so a stalled navigation can't freeze the
 * page behind the transition overlay forever.
 */
export function waitForRouteChange(beforeUrl: string, targetUrl?: string, maxFrames = 30): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0;
    const tick = () => {
      const now = window.location.pathname + window.location.search;
      if (now !== beforeUrl || (targetUrl && (now === targetUrl || now === `${targetUrl}/` || `${now}/` === targetUrl))) {
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
 * How long a view transition may hold the frozen pre-navigation snapshot
 * while waiting for the router to commit the new route. Warm (prefetched)
 * commits land in 1–3 frames, so the wait is invisible; beyond this budget
 * we start the animation anyway and let the new page paint when it's ready —
 * holding the page inert any longer reads as a hang. Kept tight (160ms) so
 * rapid tab taps never feel stuck on the old page.
 */
const COMMIT_BUDGET_MS = 160;

/**
 * Push a new SPA route inside a view transition, waiting for the router to
 * actually render it so the browser crossfades old→new (not old→old).
 * Falls back to a plain push when VT is unsupported or reduced motion is on.
 *
 * The commit wait races `commitBudgetMs` (default COMMIT_BUDGET_MS): if the
 * route is slow (cold cache, dev compile), the transition starts without it
 * instead of freezing the page until the cap. Tab switches pass a tighter
 * budget — their crossfade is only 170ms and warm commits land in 1–3
 * frames, so holding the old page any longer just reads as stuck.
 *
 * `push` is typically Next.js's router.push — any synchronous kick-off of an
 * async client-side navigation works.
 */
export function pushWithViewTransition(
  push: (path: string) => void,
  path: string,
  direction: ViewTransitionDirection = "none",
  commitBudgetMs: number = COMMIT_BUDGET_MS,
): void {
  withViewTransition(async () => {
    const before = window.location.pathname + window.location.search;
    push(path);
    await Promise.race([
      waitForRouteChange(before, path),
      new Promise<void>((resolve) => setTimeout(resolve, commitBudgetMs)),
    ]);
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
