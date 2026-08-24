import * as React from "react";

/**
 * useHideOnScroll — hide-on-scroll with hysteresis.
 *
 * Returns `true` when the app bar should collapse (user is scrolling down),
 * `false` when it should expand. Replaces the previous per-component
 * implementations whose ±4px delta checks flapped the bar on short pages,
 * trackpad jitter, and iOS momentum bounce — any tiny alternating scroll
 * toggled the bar every frame ("freaking out").
 *
 * Behavior:
 *  - Always visible at/near the top of the page (`SHOW_AT_TOP`).
 *  - Hides only after ~24px of accumulated downward scroll; reveals after
 *    ~48px accumulated upward scroll. The asymmetric thresholds are the
 *    hysteresis band: small jitters never cross them, and direction changes
 *    reset the accumulators so mixed micro-scrolls can't add up.
 *  - Attaches to `.osler-page` only when it actually overflows — on short
 *    non-scrolling pages the bar stays put instead of chasing phantom
 *    fallback containers.
 *
 * @param retryKey change this to re-find the scroll container (e.g. the
 * active view or tab) after it has been replaced in the DOM.
 */
const SHOW_AT_TOP = 40;
const DOWN_THRESHOLD = 24;
const UP_THRESHOLD = 48;
const RETRY_FRAMES = 30;

export function useHideOnScroll(retryKey: string | number = "default"): boolean {
  const [hidden, setHidden] = React.useState(false);

  React.useEffect(() => {
    let el: HTMLElement | null = null;
    let rafId = 0;
    let lastY = 0;
    let down = 0;
    let up = 0;
    let attempts = 0;

    const onScroll = () => {
      if (!el) return;
      const y = el.scrollTop;
      // Near the top the bar always expands — it carries brand + search.
      if (y <= SHOW_AT_TOP) {
        down = 0;
        up = 0;
        setHidden(false);
        lastY = y;
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
      if (down >= DOWN_THRESHOLD) {
        down = 0;
        setHidden(true);
      } else if (up >= UP_THRESHOLD) {
        up = 0;
        setHidden(false);
      }
    };

    const findContainer = () => {
      const node = document.querySelector(".osler-page") as HTMLElement | null;
      return node && node.scrollHeight > node.clientHeight ? node : null;
    };

    const attach = () => {
      const next = findContainer();
      if (next !== el) {
        if (el) el.removeEventListener("scroll", onScroll);
        el = next;
        if (el) {
          el.addEventListener("scroll", onScroll, { passive: true });
          lastY = el.scrollTop;
          setHidden(false);
        }
      }
    };

    // Attach now and retry a few frames until the freshly mounted view's
    // container appears — bounded work, no observers or intervals.
    const retry = () => {
      attach();
      if (el || ++attempts > RETRY_FRAMES) return;
      rafId = requestAnimationFrame(retry);
    };
    retry();

    return () => {
      cancelAnimationFrame(rafId);
      if (el) el.removeEventListener("scroll", onScroll);
    };
  }, [retryKey]);

  return hidden;
}
