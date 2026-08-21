"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Typewriter revealer for streamed AI text.
 *
 * Network deltas can arrive faster than they can be read (a flash-lite
 * model finishes a short reply in a few hundred ms), which makes even
 * genuinely chunked SSE look like it "spawned". This hook decouples
 * arrival from display: the caller feeds the full-so-far target string
 * and gets back the portion that should be visible right now, advanced
 * every animation frame with an exponential ease (fast start, gentle
 * tail) that auto-adapts to length — short answers take ~0.5s, long
 * ones catch up without falling behind.
 *
 * `enabled` gates animation: pass false for historical/static messages
 * so they render in full instantly, and flip it on for the message that
 * is actively arriving. Once enabled, the hook keeps animating any
 * future growth of `target` until caught up, so callers don't need to
 * carefully time the off switch. Honours prefers-reduced-motion by
 * returning the target verbatim.
 */
export function useTypewriter(target: string, enabled: boolean): string {
  const reduce = useReducedMotion();
  const [shownLen, setShownLen] = React.useState(() => (enabled && !reduce ? 0 : target.length));
  const shownLenRef = React.useRef(shownLen);
  const targetRef = React.useRef(target);
  targetRef.current = target;

  React.useEffect(() => {
    // Shrunken target = a new message replaced the old one — restart.
    if (target.length < shownLenRef.current) {
      shownLenRef.current = 0;
      setShownLen(0);
    }
    if (!enabled || reduce) {
      shownLenRef.current = target.length;
      setShownLen(target.length);
      return;
    }
    if (shownLenRef.current >= target.length) return;
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const total = targetRef.current.length;
      const remaining = total - shownLenRef.current;
      if (remaining <= 0) return;
      // Exponential catch-up: reveal ~1/18 of what's left per frame
      // (≥1 char), easing out as it approaches the end.
      shownLenRef.current = Math.min(total, shownLenRef.current + Math.max(1, Math.ceil(remaining / 18)));
      setShownLen(shownLenRef.current);
      if (shownLenRef.current < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [enabled, reduce, target]);

  return target.slice(0, shownLen);
}
