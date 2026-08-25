import * as React from "react";

/**
 * useHideOnScroll — hide-on-scroll with hysteresis, for scroll-away chrome
 * (mobile app bar, QBank collapsible header). Returns `true` when the bar
 * should be collapsed.
 *
 * Attachment: one capture-phase `scroll` listener on `document` that reacts
 * only to events from `.osler-page` elements. This sees every descendant
 * scroller no matter when it mounts — skeleton→content swaps, lazy pack
 * grids, tab switches — with zero polling/retry machinery.
 *
 * Collapse rules (the anti-oscillation contract):
 *  - Always expanded at/near the top (`SHOW_AT_TOP`).
 *  - Collapsing requires the page to have real scroll depth
 *    (`MIN_HIDE_RANGE`) at the moment of collapse.
 *  - **Per-element gesture state.** Views built on NavigationStack (QBank /
 *    folder browsers) keep TWO `.osler-page` scrollers mounted at once —
 *    the home list underneath and the subpage overlay. Hysteresis state is
 *    tracked per element (WeakMap), so deltas, clamp filtering, and
 *    accumulators from one layer never pollute or reset the other's;
 *    `hidden` itself remains global chrome state.
 *  - **Clamp-signature filtering is the core defense.** Collapsing the
 *    chrome resizes the scroller, which lowers its max scroll position;
 *    the browser then CLAMPS scrollTop without any user input, emitting a
 *    phantom counter-delta that reads as a reverse swipe (this — not
 *    threshold tuning — caused persistent oscillation on just-tall-enough
 *    pages). Only events matching that exact signature (range shrank AND
 *    scrollTop is pinned to the new max) are discarded as noise; a range
 *    change alone is not enough, since late images, lazy grids, and
 *    growing/filtered lists change the range too without any clamp.
 *  - **Post-collapse headroom guard.** Hiding chrome gives the scroller
 *    more room, shrinking its range. Callers declare how much layout space
 *    their collapsible chrome reclaims (`reservePx`, summed across ALL
 *    collapsible surfaces sharing the scroller); collapse is allowed only
 *    when the predicted post-collapse range clears POST_COLLAPSE_MIN_RANGE
 *    — deep enough that the resulting clamp can never land scrollTop at or
 *    under SHOW_AT_TOP (which would instantly re-expand the bars: the
 *    "spring back" felt on just-tall-enough pages and folder subpages).
 *  - Asymmetric bands (`DOWN_THRESHOLD` vs the larger `UP_THRESHOLD`),
 *    direction-change accumulator resets, and a `TOGGLE_COOLDOWN_MS`
 *    lockout absorb gesture settling. A ResizeObserver watches EVERY seen
 *    scroller but only expands when the ACTIVE (most recently scrolled)
 *    one becomes genuinely unscrollable while hidden — an inactive
 *    NavigationStack layer shrinking must not pop the bars back.
 *
 * @param retryKey change to reset state when the scroller is replaced
 * (active view / tab).
 * @param options.reservePx layout px reclaimed when the chrome collapses
 * (defaults to 0). Pass the total across ALL collapsible chrome on the
 * same scroller.
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

interface ScrollGestureState {
  lastY: number;
  lastMax: number;
  down: number;
  up: number;
}

export function useHideOnScroll(
  retryKey: string | number = "default",
  options?: { reservePx?: number },
): boolean {
  const [hidden, setHidden] = React.useState(false);
  const reservePx = Math.max(0, options?.reservePx ?? 0);

  React.useEffect(() => {
    let activeEl: HTMLElement | null = null;
    const states = new WeakMap<HTMLElement, ScrollGestureState>();
    const observed = new Set<HTMLElement>();
    let down = 0;
    let up = 0;
    let lastToggle = 0;

    const resetAccumulators = () => {
      down = 0;
      up = 0;
    };

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const st = states.get(el);
          if (!st) continue;
          st.lastMax = el.scrollHeight - el.clientHeight;
          // Safety net: if the page the user is actually reading becomes
          // unscrollable while the bar is hidden (filter shrinks the list,
          // orientation change), no scroll event will reveal it through —
          // watch container sizes instead. Inactive NavigationStack layers
          // are ignored: their shrink must not pop the bars back.
          if (el === activeEl && st.lastMax < UNSCROLLABLE_RANGE) {
            st.lastY = el.scrollTop;
            resetAccumulators();
            setHidden(false);
          }
        }
      });
    }

    const stateFor = (el: HTMLElement): ScrollGestureState => {
      let st = states.get(el);
      if (!st) {
        st = { lastY: el.scrollTop, lastMax: el.scrollHeight - el.clientHeight, down: 0, up: 0 };
        states.set(el, st);
        if (ro && !observed.has(el)) {
          observed.add(el);
          ro.observe(el);
        }
      }
      return st;
    };

    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.classList || !target.classList.contains("osler-page")) return;
      activeEl = target;
      const st = stateFor(target);

      const y = target.scrollTop;
      const max = target.scrollHeight - target.clientHeight;

      // Clamp-signature filter (see docblock): swallow only events that
      // match a browser-forced clamp on THIS element — range shrank AND
      // scrollTop is pinned at/near the new, smaller max. Any other range
      // change (late images, lazy grids, filtered lists) rebases lastMax
      // and lets the real delta flow through.
      if (max !== st.lastMax) {
        const wasClamped = max < st.lastMax && y >= max - 1;
        st.lastMax = max;
        if (wasClamped) {
          st.lastY = y;
          resetAccumulators();
          return;
        }
      }

      if (y <= SHOW_AT_TOP) {
        st.lastY = y;
        resetAccumulators();
        setHidden(false);
        return;
      }

      const delta = y - st.lastY;
      st.lastY = y;
      if (delta > 0) {
        down += delta;
        up = 0;
      } else if (delta < 0) {
        up += -delta;
        down = 0;
      } else {
        return;
      }

      const now = performance.now();
      if (now - lastToggle < TOGGLE_COOLDOWN_MS) return;

      if (down >= DOWN_THRESHOLD) {
        down = 0;
        // Collapse only if the page will STILL be scrollable — with real
        // depth beyond the always-expanded zone — once the chrome's layout
        // space is handed back (post-collapse headroom guard).
        if (max >= MIN_HIDE_RANGE && max - reservePx >= POST_COLLAPSE_MIN_RANGE) {
          lastToggle = now;
          setHidden(true);
        }
      } else if (up >= UP_THRESHOLD) {
        up = 0;
        lastToggle = now;
        setHidden(false);
      }
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    // Fresh view/tab always starts expanded, whatever scroll depth restores.
    setHidden(false);

    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      ro?.disconnect();
    };
  }, [retryKey, reservePx]);

  return hidden;
}
