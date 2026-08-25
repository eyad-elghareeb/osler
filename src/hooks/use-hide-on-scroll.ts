import * as React from "react";

/**
 * useHideOnScroll — hide-on-scroll with hysteresis, for scroll-away chrome
 * (mobile app bar, QBank collapsible header). Returns `true` when the bar
 * should be collapsed.
 *
 * Architecture: ONE shared controller (module singleton) owns the gesture
 * state, the capture-phase scroll listener, and the collapse decision.
 * Every mounted consumer registers itself and mirrors the shared `hidden`
 * flag. This keeps multi-chrome views coherent — the app bar and the QBank
 * hub header collapse/expand TOGETHER at the same threshold instead of two
 * private hook instances fighting over the same scroller (which caused
 * staggered hides and expand-flash on subpages). It also makes scrolling
 * cheaper: one decision pass per scroll event no matter how many bars are
 * mounted.
 *
 * Attachment: a capture-phase `scroll` listener on `document` reacting only
 * to `.osler-page` elements, attached while at least one consumer is
 * mounted. Per-element hysteresis state (WeakMap) means NavigationStack
 * views with stacked home+subpage scrollers never pollute each other's
 * gesture state; `hidden` remains global chrome state.
 *
 * Collapse rules (the anti-oscillation contract):
 *  - Always expanded at/near the top (`SHOW_AT_TOP`) — but a brand-new
 *    scroller becoming active (folder/subpage navigation mounting a fresh
 *    layer at scrollTop 0) never pops the bars open mid-read.
 *  - **Clamp-signature filtering**: collapsing chrome resizes the scroller
 *    and the browser force-clamps scrollTop, emitting a phantom counter-
 *    delta that reads as a reverse swipe. Only events matching that exact
 *    signature (range shrank AND scrollTop pinned to the new max) are
 *    discarded; ordinary range changes flow through.
 *  - **Post-collapse headroom guard**: callers declare how much layout
 *    space their collapsible chrome reclaims (`reservePx`). The controller
 *    SUMS the reserves of all mounted consumers sharing the scroller and
 *    only collapses when the predicted post-collapse range clears
 *    `POST_COLLAPSE_MIN_RANGE` — deep enough that the post-collapse clamp
 *    can never park scrollTop inside the always-expanded zone (the
 *    spring-back felt on just-tall-enough pages).
 *  - Asymmetric bands (`DOWN_THRESHOLD` vs the larger `UP_THRESHOLD`),
 *    direction-change accumulator resets, and a `TOGGLE_COOLDOWN_MS`
 *    lockout absorb gesture settling. A ResizeObserver watches every seen
 *    scroller but expands only when the ACTIVE (most recently scrolled)
 *    one becomes genuinely unscrollable while hidden.
 *
 * @param retryKey change to reset state when the scroller is replaced
 * (active view / tab).
 * @param options.reservePx layout px reclaimed when THIS consumer's chrome
 * collapses; the controller sums them across all mounted consumers.
 */
const SHOW_AT_TOP = 40;
const MIN_HIDE_RANGE = 140;
const UNSCROLLABLE_RANGE = 36;
/** Minimum predicted scroll range AFTER the chrome collapses. Must exceed
 * SHOW_AT_TOP with margin so the post-collapse clamp can't park scrollTop
 * inside the always-expanded zone. */
const POST_COLLAPSE_MIN_RANGE = 80;
const DOWN_THRESHOLD = 24;
const UP_THRESHOLD = 48;
const TOGGLE_COOLDOWN_MS = 280;

interface GestureState {
  lastY: number;
  lastMax: number;
}

interface ChromeController {
  hidden: boolean;
  attached: boolean;
  activeEl: HTMLElement | null;
  down: number;
  up: number;
  lastToggle: number;
  states: WeakMap<HTMLElement, GestureState>;
  observed: Set<HTMLElement>;
  ro: ResizeObserver | null;
  onScroll: (e: Event) => void;
}

let ctrl: ChromeController | null = null;
const listeners = new Set<(hidden: boolean) => void>();
const reserves = new Map<symbol, number>();

/** Total layout px reclaimed when ALL mounted chrome collapses together. */
function totalReserve(): number {
  let sum = 0;
  for (const px of reserves.values()) sum += px;
  return sum;
}

function setChromeHidden(next: boolean) {
  if (!ctrl || ctrl.hidden === next) return;
  ctrl.hidden = next;
  for (const notify of listeners) notify(next);
}

function ensureController(): ChromeController {
  if (ctrl || typeof window === "undefined") return ctrl!;

  const states = new WeakMap<HTMLElement, GestureState>();
  const observed = new Set<HTMLElement>();
  let activeEl: HTMLElement | null = null;

  const controller: ChromeController = {
    hidden: false,
    attached: false,
    activeEl: null,
    down: 0,
    up: 0,
    lastToggle: 0,
    states,
    observed,
    ro: null,
    onScroll: () => {},
  };

  const resetPair = () => {
    controller.down = 0;
    controller.up = 0;
  };

  const setExpanded = () => {
    resetPair();
    setChromeHidden(false);
  };

  if (typeof ResizeObserver !== "undefined") {
    controller.ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const st = states.get(el);
        if (!st) continue;
        st.lastMax = el.scrollHeight - el.clientHeight;
        // Safety net: if the page the user is actually reading becomes
        // unscrollable while the bars are hidden (filter shrinks the list,
        // orientation change), no scroll event will reveal through — watch
        // container sizes instead. Inactive NavigationStack layers are
        // ignored: their shrink must not pop the bars back.
        if (el === controller.activeEl && st.lastMax < UNSCROLLABLE_RANGE) {
          st.lastY = el.scrollTop;
          setExpanded();
        }
      }
    });
  }

  controller.onScroll = (e: Event) => {
    // Background tabs deliver nothing meaningful; skip the work.
    if (document.hidden) return;
    const target = e.target as HTMLElement | null;
    if (!target || !target.classList || !target.classList.contains("osler-page")) return;
    // A brand-new scroller becoming active means a view/folder navigation,
    // not a gesture on the page the user was reading. NavigationStack mounts
    // subpage layers at scrollTop 0 — without this guard their first event
    // would pop the bars open mid-read.
    const isNewActive = target !== controller.activeEl;
    controller.activeEl = target;

    let st = states.get(target);
    if (!st) {
      st = { lastY: target.scrollTop, lastMax: target.scrollHeight - target.clientHeight };
      states.set(target, st);
      if (controller.ro && !observed.has(target)) {
        observed.add(target);
        controller.ro.observe(target);
      }
    }

    const y = target.scrollTop;
    const max = target.scrollHeight - target.clientHeight;

    // Clamp-signature filter: swallow only events matching a browser-forced
    // clamp on THIS element — range shrank AND scrollTop is pinned at/near
    // the new, smaller max. Any other range change (late images, lazy grids,
    // filtered lists) rebases lastMax and lets the real delta flow through.
    if (max !== st.lastMax) {
      const wasClamped = max < st.lastMax && y >= max - 1;
      st.lastMax = max;
      if (wasClamped) {
        st.lastY = y;
        resetPair();
        return;
      }
    }

    if (y <= SHOW_AT_TOP) {
      st.lastY = y;
      resetPair();
      if (!isNewActive) setChromeHidden(false);
      return;
    }

    const delta = y - st.lastY;
    st.lastY = y;
    if (delta > 0) {
      controller.down += delta;
      controller.up = 0;
    } else if (delta < 0) {
      controller.up += -delta;
      controller.down = 0;
    } else {
      return;
    }

    const now = performance.now();
    if (now - controller.lastToggle < TOGGLE_COOLDOWN_MS) return;

    if (controller.down >= DOWN_THRESHOLD) {
      controller.down = 0;
      // Collapse only if the page will STILL be scrollable once ALL mounted
      // chrome hands its layout space back (post-collapse headroom guard).
      const reserve = totalReserve();
      if (max >= MIN_HIDE_RANGE && max - reserve >= POST_COLLAPSE_MIN_RANGE) {
        controller.lastToggle = now;
        setChromeHidden(true);
      }
    } else if (controller.up >= UP_THRESHOLD) {
      controller.up = 0;
      controller.lastToggle = now;
      setChromeHidden(false);
    }
  };

  ctrl = controller;
  return controller;
}

export function useHideOnScroll(
  retryKey: string | number = "default",
  options?: { reservePx?: number },
): boolean {
  const [hidden, setLocal] = React.useState(false);
  const reservePx = Math.max(0, options?.reservePx ?? 0);
  const keyRef = React.useRef<symbol | null>(null);

  // Register with the shared controller for this component's lifetime.
  React.useEffect(() => {
    const c = ensureController();
    const key = Symbol();
    keyRef.current = key;
    reserves.set(key, reservePx);
    listeners.add(setLocal);
    if (!c.attached) {
      document.addEventListener("scroll", c.onScroll, { capture: true, passive: true });
      c.attached = true;
    }
    return () => {
      reserves.delete(key);
      listeners.delete(setLocal);
      if (listeners.size === 0 && c.attached) {
        document.removeEventListener("scroll", c.onScroll, { capture: true });
        c.attached = false;
      }
    };
  }, []);

  // Keep this consumer's declared reclaim current without re-registering.
  React.useEffect(() => {
    if (keyRef.current) reserves.set(keyRef.current, reservePx);
  }, [reservePx]);

  // A view/tab switch always resets the chrome: fresh scrollers everywhere.
  React.useEffect(() => {
    const c = ensureController();
    c.down = 0;
    c.up = 0;
    c.activeEl = null;
    if (c.ro) for (const el of Array.from(c.observed)) c.ro.unobserve(el);
    c.observed.clear();
    c.states = new WeakMap();
    setChromeHidden(false);
  }, [retryKey]);

  return hidden;
}
