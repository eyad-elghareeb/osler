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
  } = options;

  const ref = useRef<HTMLElement>(null);
  const [display, setDisplay] = useState<string>(
    `${prefix}${value.toFixed(decimals)}${suffix}`,
  );

  useEffect(() => {
    if (prefersReducedMotion()) return;

    const el = ref.current;
    let startTime: number | null = null;
    let rafId: number;
    let observer: IntersectionObserver | null = null;

    const format = (n: number) =>
      `${prefix}${n.toFixed(decimals)}${suffix}`;

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
  }, [value, duration, decimals, observe]);

  return { ref, display };
}
