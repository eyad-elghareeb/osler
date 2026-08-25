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
 *  - **Clamp-signature filtering is the core defense.** Collapsing the
 *    chrome resizes the scroller, which lowers its max scroll position;
 *    the browser then CLAMPS scrollTop without any user input, emitting a
 *    phantom counter-delta that reads as a reverse swipe (this — not
 *    threshold tuning — caused persistent oscillation on just-tall-enough
 *    pages). Only events matching that exact signature (range shrank AND
 *    scrollTop is pinned to the new max) are discarded as noise; a range
 *    change alone is not enough, since late images, lazy-loaded grids, and
 *    growing/filtered lists change the range too without any clamp — and
 *    treating those as noise zeroed the accumulators and made the bar
 *    unable to ever collapse on those pages.
 *  - Asymmetric bands (`DOWN_THRESHOLD` vs the larger `UP_THRESHOLD`),
 *    direction-change accumulator resets, and a `TOGGLE_COOLDOWN_MS`
 *    lockout absorb gesture settling. A ResizeObserver expands the bar if
 *    the page becomes genuinely unscrollable while hidden (no scroll
 *    events fire to reveal through).
 *  - **Post-collapse headroom guard.** Collapsing chrome gives the
 *    scroller more room, which SHRINKS its scrollable range. On pages
 *    whose range barely clears `MIN_HIDE_RANGE`, hiding the bars makes
 *    the page unscrollable, the browser clamps scrollTop to the top, and
 *    the ResizeObserver safety net expands the bars right back — felt as
 *    a spring/bounce. Callers therefore declare how much layout space
 *    their collapsible chrome reclaims (`reservePx`); collapse is only
 *    allowed while the predicted post-collapse range still has real
 *    scroll depth. When several collapsible surfaces share one scroller
 *    (app bar + view header), each caller passes the COMBINED reclaim so
 *    they collapse together or not at all.
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
const DOWN_THRESHOLD = 24;
const UP_THRESHOLD = 48;
const TOGGLE_COOLDOWN_MS = 280;

export function useHideOnScroll(
  retryKey: string | number = "default",
  options?: { reservePx?: number },
): boolean {
  const [hidden, setHidden] = React.useState(false);
  const reservePx = Math.max(0, options?.reservePx ?? 0);

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

      // Layout noise filter — but only for the specific signature of a
      // browser-forced clamp: the range SHRANK (chrome collapsing gave the
      // scroller more room) AND scrollTop is pinned at/near the new, smaller
      // max. That pinning is what the browser does when it yanks scrollTop
      // down without user input; a genuine gesture never lands exactly on
      // the new boundary by coincidence.
      //
      // A range change on its own is NOT noise — it also fires for entirely
      // legitimate reasons (late images finishing layout, a lazy pack grid
      // appending rows, a filtered list growing) where scrollTop is
      // untouched and the in-flight gesture is real. Treating every range
      // change as noise silently zeroed the accumulators on those pages, so
      // `down`/`up` could never cross their thresholds and the bar simply
      // never collapsed. Only resync-and-discard the clamp case; for any
      // other range change, just rebase `lastMax` and let the delta below
      // flow through normally.
      if (max !== lastMax) {
        const wasClamped = max < lastMax && y >= max - 1;
        lastMax = max;
        if (wasClamped) {
          lastY = y;
          down = 0;
          up = 0;
          return;
        }
        // Range grew/shrank without a clamp — not noise, keep processing
        // this event's real delta below (lastY is still the pre-change
        // scrollTop, which is what we want to diff against).
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
        // Collapse only if the page will STILL be scrollable once the
        // chrome's layout space is handed back to the scroller (see the
        // post-collapse headroom guard note above).
        if (max - reservePx >= UNSCROLLABLE_RANGE && max >= MIN_HIDE_RANGE) {
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
  }, [retryKey, reservePx]);

  return hidden;
}
