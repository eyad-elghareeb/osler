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
 *  - **Layout-shift filtering is the core defense.** Collapsing/revealing
 *    the chrome resizes the scroller, which lowers/raises its max scroll
 *    position; the browser then CLAMPS scrollTop without any user input,
 *    emitting a large phantom counter-delta that reads as a reverse swipe
 *    (this — not threshold tuning — is what caused persistent oscillation
 *    on just-tall-enough pages). Any event whose scrollable range changed
 *    is therefore treated as layout noise: resync and ignore.
 *  - Asymmetric bands (`DOWN_THRESHOLD` vs the larger `UP_THRESHOLD`),
 *    direction-change accumulator resets, and a `TOGGLE_COOLDOWN_MS`
 *    lockout absorb gesture settling. A ResizeObserver expands the bar if
 *    the page becomes genuinely unscrollable while hidden (no scroll
 *    events fire to reveal through).
 *
 * @param retryKey change to reset state when the scroller is replaced
 * (active view / tab).
 */
const SHOW_AT_TOP = 40;
const MIN_HIDE_RANGE = 140;
const UNSCROLLABLE_RANGE = 36;
const DOWN_THRESHOLD = 24;
const UP_THRESHOLD = 48;
const TOGGLE_COOLDOWN_MS = 280;

export function useHideOnScroll(retryKey: string | number = "default"): boolean {
  const [hidden, setHidden] = React.useState(false);

  React.useEffect(() => {
    let el: HTMLElement | null = null;
    let lastY = 0;
    let lastMax = 0;
    let down = 0;
    let up = 0;
    let lastToggle = 0;

    const expand = () => {
      down = 0;
      up = 0;
      setHidden(false);
    };

    // Safety net: if the page becomes unscrollable while the bar is hidden
    // (filter shrinks the list, orientation change), there will be no scroll
    // events to reveal it — watch the container's size instead.
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (!el) return;
            lastMax = el.scrollHeight - el.clientHeight;
            if (lastMax < UNSCROLLABLE_RANGE) {
              lastY = el.scrollTop;
              expand();
            }
          })
        : undefined;

    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.classList || !target.classList.contains("osler-page")) return;
      if (target !== el) {
        el = target;
        ro?.observe(target);
        lastY = el.scrollTop;
        lastMax = el.scrollHeight - el.clientHeight;
        down = 0;
        up = 0;
      }

      const y = target.scrollTop;
      const max = target.scrollHeight - target.clientHeight;

      // Layout noise filter: a changed scrollable range means the browser
      // clamped/adjusted scrollTop because content or chrome resized — not
      // a gesture. Resync instead of feeding phantom deltas to hysteresis.
      if (max !== lastMax) {
        lastMax = max;
        lastY = y;
        down = 0;
        up = 0;
        return;
      }

      if (y <= SHOW_AT_TOP) {
        lastY = y;
        expand();
        return;
      }

      const delta = y - lastY;
      lastY = y;
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
        if (max >= MIN_HIDE_RANGE) {
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
    expand();

    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      ro?.disconnect();
    };
  }, [retryKey]);

  return hidden;
}
