"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Smooth count-up animation for numeric stat values.
 *
 * Animates from 0 to `value` over `duration` ms using an easeOut curve.
 * Honors `prefers-reduced-motion` by snapping to the final value immediately.
 * Starts counting when the element scrolls into view (if `observe` is true)
 * or immediately on mount.
 *
 * Usage:
 *   const { ref, display } = useCountUp(42);
 *   <span ref={ref}>{display}</span>
 *
 * With all options:
 *   const { ref, display } = useCountUp(1250, { duration: 600, decimals: 0, observe: true });
 */

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

/**
 * Keys that already played their count-up this page load. Used by `onceKey`
 * so hub stats animate on first reveal but snap instantly on revisits and
 * background value updates instead of visibly resetting to zero.
 */
const playedOnceKeys = new Set<string>();

interface CountUpOptions {
  /** Animation duration in ms. Default 500. */
  duration?: number;
  /** Number of decimal places. Default 0. */
  decimals?: number;
  /** Only start when element is in viewport. Default false. */
  observe?: boolean;
  /** Prefix (e.g., "+", "%"). */
  prefix?: string;
  /** Suffix (e.g., "%", "h"). */
  suffix?: string;
  /**
   * When set, the tick animation runs only the first time this key mounts
   * per page load; later mounts and value updates snap to the final value.
   * Use for hub stats (dashboard tiles) that remount on every visit —
   * one-time reveals (result screens) should omit it so they always play.
   */
  onceKey?: string;
}

export function useCountUp(
  value: number,
  options: CountUpOptions = {},
): { ref: React.RefObject<HTMLElement | null>; display: string } {
  const {
    duration = 500,
    decimals = 0,
    observe = false,
    prefix = "",
    suffix = "",
    onceKey,
  } = options;

  const ref = useRef<HTMLElement>(null);
  const [display, setDisplay] = useState<string>(
    `${prefix}${value.toFixed(decimals)}${suffix}`,
  );

  useEffect(() => {
    const format = (n: number) =>
      `${prefix}${n.toFixed(decimals)}${suffix}`;

    // Already played this page load (or a background update changed the
    // value): snap instead of visibly resetting to zero and ticking again.
    if (onceKey && playedOnceKeys.has(onceKey)) {
      setDisplay(format(value));
      return;
    }
    if (onceKey) playedOnceKeys.add(onceKey);

    if (prefersReducedMotion()) return;

    const el = ref.current;
    let startTime: number | null = null;
    let rafId: number;
    let observer: IntersectionObserver | null = null;

    const tick = (now: number) => {
      if (startTime === null) startTime = now;
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutQuart(progress);
      const current = value * eased;
      setDisplay(format(current));
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setDisplay(format(value));
      }
    };

    const start = () => {
      rafId = requestAnimationFrame(tick);
    };

    if (observe && el) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              start();
              observer?.disconnect();
            }
          }
        },
        { threshold: 0.3 },
      );
      observer.observe(el);
    } else {
      start();
    }

    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [value, duration, decimals, observe, prefix, suffix, onceKey]);

  return { ref, display };
}
