import * as React from "react";

/**
 * useHideOnScroll — hide-on-scroll with hysteresis, for scroll-away chrome
 * (mobile app bar, QBank collapsible header). Returns `true` when the bar
 * should be collapsed.
 *
 * Attachment: one capture-phase `scroll` listener on `document` that reacts
 * only to events from `.osler-page` elements. This sees every descendant
 * scroller no matter when it mounts — skeleton→content swaps, lazy pack
 * grids, tab switches — with zero polling/retry machinery. (The previous
 * querySelector+rAF-retry version permanently gave up when the container
 * appeared late or wasn't scrollable yet, which read as "the bar stopped
 * working on some pages".)
 *
 * Collapse rules (the anti-oscillation contract):
 *  - Always expanded at/near the top (`SHOW_AT_TOP`).
 *  - Never collapses on short pages: if the scrollable range is under
 *    `MIN_RANGE`, rubber-band bounce dominates and hiding buys nothing —
 *    this is what made short scrolls oscillate before.
 *  - Hides after `DOWN_THRESHOLD` of sustained downward scroll; reveals
 *    after the larger `UP_THRESHOLD` upward (asymmetric hysteresis band).
 *    Direction changes reset the accumulators.
 *  - A `TOGGLE_COOLDOWN_MS` lockout after each flip kills residual
 *    flip-flopping from gesture settling.
 *
 * @param retryKey change to reset state when the scroller is replaced
 * (active view / tab).
 */
const SHOW_AT_TOP = 40;
const MIN_RANGE = 140;
const DOWN_THRESHOLD = 24;
const UP_THRESHOLD = 48;
const TOGGLE_COOLDOWN_MS = 280;

export function useHideOnScroll(retryKey: string | number = "default"): boolean {
  const [hidden, setHidden] = React.useState(false);

  React.useEffect(() => {
    let lastY = 0;
    let down = 0;
    let up = 0;
    let lastToggle = 0;

    const expand = () => {
      down = 0;
      up = 0;
      setHidden(false);
    };

    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.classList || !target.classList.contains("osler-page")) return;

      const y = target.scrollTop;
      if (y <= SHOW_AT_TOP) {
        lastY = y;
        expand();
        return;
      }

      // Short page — nothing meaningful to scroll past; keep chrome stable.
      if (target.scrollHeight - target.clientHeight < MIN_RANGE) {
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
        lastToggle = now;
        setHidden(true);
      } else if (up >= UP_THRESHOLD) {
        up = 0;
        lastToggle = now;
        setHidden(false);
      }
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    // Fresh view/tab always starts expanded, whatever scroll depth restores.
    expand();

    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [retryKey]);

  return hidden;
}
