"use client";

/**
 * useSwipeGallery — iOS Photos-style swipe gallery hook.
 *
 * Manages the motion state for a three-card gallery (prev / current / next):
 *   • A single `swipeX` motion value drives all three cards simultaneously.
 *   • Prev/next cards are positioned one `step` (cardWidth + gap) to the
 *     left/right of the current card. As `swipeX` changes, all three move
 *     together — they appear "connected" by a fixed distance, exactly like
 *     swiping through photos in the iOS Photos app.
 *   • Rubber-band resistance at the first/last card prevents over-scrolling.
 *   • Preview cards are hidden (visibility: hidden) when at rest, and become
 *     visible the moment a swipe begins — no overlapping content at rest.
 *   • A `movedRef` tracks whether the current gesture was a swipe (>8px move)
 *     vs a tap, so the consumer can suppress tap actions after a swipe.
 *   • RTL aware: in RTL, swipe directions and card positions are inverted.
 *   • Input guard: panning is suppressed when starting from INPUT,
 *     TEXTAREA, or contentEditable elements (handled by useSwipe).
 *
 * Usage:
 *   const { swipeRef, swipeX, prevCardX, nextCardX, prevVisible, nextVisible, movedRef } =
 *     useSwipeGallery({ currentIndex, itemCount, onNavigateNext, onNavigatePrev, rtl });
 *
 *   <div ref={swipeRef} onPointerDown={() => (movedRef.current = false)}>
 *     {hasPrev && <motion.div style={{ x: prevCardX, visibility: prevVisible }}>...</motion.div>}
 *     <motion.div style={{ x: swipeX }} onClick={() => { if (movedRef.current) return; onTap(); }}>
 *       current card
 *     </motion.div>
 *     {hasNext && <motion.div style={{ x: nextCardX, visibility: nextVisible }}>...</motion.div>}
 *   </div>
 */

import * as React from "react";
import { useMotionValue, useTransform, animate, type MotionValue } from "framer-motion";
import { useSwipe } from "./use-gestures";
import { haptic } from "@/lib/osler/native";

export interface SwipeGalleryOptions {
  /** Index of the currently visible card. */
  currentIndex: number;
  /** Total number of cards in the gallery. */
  itemCount: number;
  /** Called when the user swipes to the next card (swipe left in LTR). */
  onNavigateNext: () => void;
  /** Called when the user swipes to the previous card (swipe right in LTR). */
  onNavigatePrev: () => void;
  /** Disable all swipe gestures. */
  disabled?: boolean;
  /** Gap between adjacent cards in px. Default 0 (cards are adjacent). */
  gap?: number;
  /** Right-to-left layout. Inverts swipe directions and card positions. */
  rtl?: boolean;
}

export interface SwipeGalleryState {
  /** Ref to attach to the swipe target element (also used for width measurement). */
  swipeRef: React.RefObject<HTMLDivElement | null>;
  /** Motion value driving the current card's x position. Set to ±step to animate. */
  swipeX: MotionValue<number>;
  /** Transform for the prev card's x position: `swipeX - step`. */
  prevCardX: MotionValue<number>;
  /** Transform for the next card's x position: `swipeX + step`. */
  nextCardX: MotionValue<number>;
  /** Visibility transform for the prev card — "hidden" at rest, "visible" during swipe. */
  prevVisible: MotionValue<"visible" | "hidden">;
  /** Visibility transform for the next card — "hidden" at rest, "visible" during swipe. */
  nextVisible: MotionValue<"visible" | "hidden">;
  /** True if the current gesture moved >8px (was a swipe, not a tap). */
  movedRef: React.MutableRefObject<boolean>;
  /** Measured card width in px (0 until measured). */
  cardWidth: number;
}

export function useSwipeGallery(options: SwipeGalleryOptions): SwipeGalleryState {
  const {
    currentIndex,
    itemCount,
    onNavigateNext,
    onNavigatePrev,
    disabled = false,
    gap = 0,
    rtl = false,
  } = options;

  const swipeX = useMotionValue(0);
  const [cardWidth, setCardWidth] = React.useState(0);
  const movedRef = React.useRef(false);
  const pendingNavRef = React.useRef(false);

  // Keep latest values in a ref so swipe callbacks don't go stale.
  const stateRef = React.useRef({ currentIndex, itemCount, onNavigateNext, onNavigatePrev, rtl });
  stateRef.current = { currentIndex, itemCount, onNavigateNext, onNavigatePrev, rtl };

  // Create the swipe hook first — we'll reuse its ref for width measurement.
  const swipeRef = useSwipe<HTMLDivElement>({
    threshold: 50,
    maxDuration: 600,
    disabled,
    onSwipeProgress: (dx, _dy) => {
      if (Math.abs(dx) > 8) movedRef.current = true;
      const { currentIndex: ci, itemCount: ic, rtl: isRtl } = stateRef.current;
      // Rubber-band resistance at the edges.
      // RTL: invert the resistance direction.
      let clamped = dx;
      if (ci === 0) {
        if ((!isRtl && clamped > 0) || (isRtl && clamped < 0)) clamped *= 0.3;
      }
      if (ci === ic - 1) {
        if ((!isRtl && clamped < 0) || (isRtl && clamped > 0)) clamped *= 0.3;
      }
      swipeX.set(clamped);
    },
    onSwipeCancel: () => {
      movedRef.current = false;
      animate(swipeX, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
    },
    onSwipeLeft: () => {
      const { currentIndex: ci, itemCount: ic, onNavigateNext: goNext, onNavigatePrev: goPrev, rtl: isRtl } = stateRef.current;
      // LTR: swipe left → next. RTL: swipe left → prev.
      const go = isRtl ? (ci > 0) : (ci < ic - 1);
      if (go) {
        haptic("selection");
        const w = cardWidth || (typeof window !== "undefined" ? window.innerWidth : 400);
        const target = w + gap;
        // LTR: animate to -target (current slides left). RTL: animate to +target (current slides right).
        const animTarget = isRtl ? target : -target;
        animate(swipeX, animTarget, { type: "spring", stiffness: 400, damping: 35, mass: 0.8 })
          .then(() => {
            pendingNavRef.current = true;
            if (isRtl) goPrev();
            else goNext();
            movedRef.current = false;
          });
      } else {
        movedRef.current = false;
        animate(swipeX, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
      }
    },
    onSwipeRight: () => {
      const { currentIndex: ci, itemCount: ic, onNavigateNext: goNext, onNavigatePrev: goPrev, rtl: isRtl } = stateRef.current;
      // LTR: swipe right → prev. RTL: swipe right → next.
      const go = isRtl ? (ci < ic - 1) : (ci > 0);
      if (go) {
        haptic("selection");
        const w = cardWidth || (typeof window !== "undefined" ? window.innerWidth : 400);
        const target = w + gap;
        // LTR: animate to +target (current slides right). RTL: animate to -target (current slides left).
        const animTarget = isRtl ? -target : target;
        animate(swipeX, animTarget, { type: "spring", stiffness: 400, damping: 35, mass: 0.8 })
          .then(() => {
            pendingNavRef.current = true;
            if (isRtl) goNext();
            else goPrev();
            movedRef.current = false;
          });
      } else {
        movedRef.current = false;
        animate(swipeX, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
      }
    },
  });

  // After a navigation completes, the .then() callback triggers a React state
  // update (goNext/goPrev) and sets pendingNavRef. We reset swipeX to 0 here
  // in a useLayoutEffect so it happens AFTER React commits the new currentIndex
  // but BEFORE the browser paints — eliminating the 1-frame flash where the old
  // question content (with its selected answer) would briefly appear at center.
  React.useLayoutEffect(() => {
    if (pendingNavRef.current) {
      pendingNavRef.current = false;
      swipeX.set(0);
    }
  }, [currentIndex, swipeX]);

  // Measure the swipe element's width so prev/next cards can be positioned
  // exactly one card-width (+ gap) to the left/right.
  React.useEffect(() => {
    if (!swipeRef.current) return;
    const el = swipeRef.current;
    const update = () => setCardWidth(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [swipeRef]);

  // Step = cardWidth + gap. Prev card sits one step to the left, next card
  // one step to the right. All three move together with swipeX.
  // RTL: prev is to the right (+step), next is to the left (-step).
  const step = cardWidth + gap;
  const prevCardX = useTransform(swipeX, (v) => v + (rtl ? step : -step));
  const nextCardX = useTransform(swipeX, (v) => v + (rtl ? -step : step));

  // Hide prev/next cards when at rest (swipeX ≈ 0). They become visible the
  // moment a swipe begins, and stay visible during the commit animation.
  // This prevents overlapping content from prev/next cards when at rest.
  const prevVisible = useTransform(swipeX, (v) =>
    Math.abs(v) > 3 ? "visible" : "hidden"
  );
  const nextVisible = useTransform(swipeX, (v) =>
    Math.abs(v) > 3 ? "visible" : "hidden"
  );

  return {
    swipeRef,
    swipeX,
    prevCardX,
    nextCardX,
    prevVisible,
    nextVisible,
    movedRef,
    cardWidth,
  };
}
