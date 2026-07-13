"use client";

/**
 * useSwipeGallery — iOS Photos-style swipe gallery hook.
 *
 * Uses framer-motion's pan gesture (onPan) instead of raw pointer events.
 * This means the swipe can be initiated from ANY empty space within the
 * container — not just on the card itself. The pan recognizer is also
 * more robust than manual pointer tracking: it handles multi-touch,
 * gesture cancellation, and direction locking automatically.
 *
 * Features:
 *   • A single `swipeX` motion value drives prev/current/next cards.
 *   • Rubber-band resistance at the first/last card.
 *   • Preview cards are hidden (visibility: hidden) at rest.
 *   • `movedRef` tracks swipe-vs-tap for tap suppression.
 *   • RTL aware: in RTL, prev is to the right, next is to the left,
 *     and swipe directions are inverted.
 *   • Input guard: panning is suppressed when starting from INPUT,
 *     TEXTAREA, or contentEditable elements (so the user can interact
 *     with form fields without triggering a swipe).
 *
 * Usage:
 *   const { containerRef, swipeX, prevCardX, nextCardX, prevVisible, nextVisible,
 *           movedRef, onPointerDown, onPanStart, onPan, onPanEnd } =
 *     useSwipeGallery({ currentIndex, itemCount, onNavigateNext, onNavigatePrev, rtl });
 *
 *   <motion.div
 *     ref={containerRef}
 *     onPointerDown={onPointerDown}
 *     onPanStart={onPanStart}
 *     onPan={onPan}
 *     onPanEnd={onPanEnd}
 *     style={{ touchAction: "pan-y" }}
 *   >
 *     {hasPrev && <motion.div style={{ x: prevCardX, visibility: prevVisible }}>...</motion.div>}
 *     <motion.div style={{ x: swipeX }} onClick={() => { if (movedRef.current) return; onTap(); }}>
 *       current card
 *     </motion.div>
 *     {hasNext && <motion.div style={{ x: nextCardX, visibility: nextVisible }}>...</motion.div>}
 *   </motion.div>
 */

import * as React from "react";
import {
  useMotionValue,
  useTransform,
  animate,
  type MotionValue,
  type PanInfo,
} from "framer-motion";
import { haptic } from "@/lib/osler/native";

export interface SwipeGalleryOptions {
  /** Index of the currently visible card. */
  currentIndex: number;
  /** Total number of cards in the gallery. */
  itemCount: number;
  /** Called when the user swipes to the next card. */
  onNavigateNext: () => void;
  /** Called when the user swipes to the previous card. */
  onNavigatePrev: () => void;
  /** Disable all swipe gestures. */
  disabled?: boolean;
  /** Gap between adjacent cards in px. Default 0. */
  gap?: number;
  /** Right-to-left layout. Inverts swipe directions and card positions. */
  rtl?: boolean;
}

export interface SwipeGalleryState {
  /** Ref to attach to the container element (used for width measurement). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Motion value driving the current card's x position. */
  swipeX: MotionValue<number>;
  /** Transform for the prev card's x position. */
  prevCardX: MotionValue<number>;
  /** Transform for the next card's x position. */
  nextCardX: MotionValue<number>;
  /** Visibility transform for the prev card — "hidden" at rest, "visible" during swipe. */
  prevVisible: MotionValue<"visible" | "hidden">;
  /** Visibility transform for the next card — "hidden" at rest, "visible" during swipe. */
  nextVisible: MotionValue<"visible" | "hidden">;
  /** True if the current gesture moved >8px (was a swipe, not a tap). */
  movedRef: React.MutableRefObject<boolean>;
  /** Measured container width in px (0 until measured). */
  cardWidth: number;
  /** Attach to the container's onPointerDown — sets the input-guard flag. */
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  /** Attach to the container's onPanStart. */
  onPanStart: () => void;
  /** Attach to the container's onPan. */
  onPan: (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => void;
  /** Attach to the container's onPanEnd. */
  onPanEnd: (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => void;
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
  const containerRef = React.useRef<HTMLDivElement>(null);
  // Input guard: suppresses panning when the gesture starts on an input,
  // textarea, or contentEditable element.
  const panDisabledRef = React.useRef(false);

  // Keep latest values in a ref so pan callbacks don't go stale.
  const stateRef = React.useRef({
    currentIndex,
    itemCount,
    onNavigateNext,
    onNavigatePrev,
    cardWidth,
    rtl,
    gap,
    disabled,
  });
  stateRef.current = {
    currentIndex,
    itemCount,
    onNavigateNext,
    onNavigatePrev,
    cardWidth,
    rtl,
    gap,
    disabled,
  };

  // Measure the container's width so prev/next cards can be positioned
  // exactly one card-width (+ gap) to the left/right.
  React.useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setCardWidth(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Step = cardWidth + gap.
  // LTR: prev is to the left (-step), next is to the right (+step).
  // RTL: prev is to the right (+step), next is to the left (-step).
  const step = cardWidth + gap;
  const prevCardX = useTransform(swipeX, (v) => v + (rtl ? step : -step));
  const nextCardX = useTransform(swipeX, (v) => v + (rtl ? -step : step));

  // Hide prev/next cards when at rest (swipeX ≈ 0). They become visible
  // the moment a swipe begins, and stay visible during the commit animation.
  const prevVisible = useTransform(swipeX, (v) =>
    Math.abs(v) > 3 ? "visible" : "hidden"
  );
  const nextVisible = useTransform(swipeX, (v) =>
    Math.abs(v) > 3 ? "visible" : "hidden"
  );

  // ── Input guard ──────────────────────────────────────────────────
  // Called on pointerdown. If the target is an input/textarea/contentEditable,
  // set a flag so the pan handlers know to ignore this gesture. This lets
  // the user interact with form fields (type, select text, scroll) without
  // the swipe gallery hijacking the gesture.
  const onPointerDown = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement | null;
    panDisabledRef.current = !!(
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable)
    );
  }, []);

  // ── Pan handlers ─────────────────────────────────────────────────
  const onPanStart = React.useCallback(() => {
    movedRef.current = false;
  }, []);

  const onPan = React.useCallback(
    (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const s = stateRef.current;
      if (s.disabled || panDisabledRef.current) return;
      if (Math.abs(info.offset.x) > 8) movedRef.current = true;

      let clamped = info.offset.x;
      // Rubber-band resistance at the edges.
      // LTR: first card resists swiping right (positive), last resists left (negative).
      // RTL: first card resists swiping left (negative), last resists right (positive).
      if (s.currentIndex === 0) {
        if ((!s.rtl && clamped > 0) || (s.rtl && clamped < 0)) clamped *= 0.3;
      }
      if (s.currentIndex === s.itemCount - 1) {
        if ((!s.rtl && clamped < 0) || (s.rtl && clamped > 0)) clamped *= 0.3;
      }
      swipeX.set(clamped);
    },
    [swipeX]
  );

  const onPanEnd = React.useCallback(
    (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const s = stateRef.current;
      const wasDisabled = panDisabledRef.current;
      panDisabledRef.current = false; // Reset for next gesture.
      if (s.disabled || wasDisabled) {
        movedRef.current = false;
        return;
      }

      const w = s.cardWidth || (typeof window !== "undefined" ? window.innerWidth : 400);
      const stepVal = w + s.gap;
      // Distance threshold: 25% of card width.
      const distThreshold = w * 0.25;
      // Velocity threshold: a fast flick commits even below the distance threshold.
      const velocityThreshold = 300;

      // Determine direction based on RTL.
      // LTR: offset < -threshold → next (swipe left), offset > threshold → prev (swipe right).
      // RTL: offset > threshold → next (swipe right), offset < -threshold → prev (swipe left).
      const isNext = s.rtl
        ? info.offset.x > distThreshold || info.velocity.x > velocityThreshold
        : info.offset.x < -distThreshold || info.velocity.x < -velocityThreshold;
      const isPrev = s.rtl
        ? info.offset.x < -distThreshold || info.velocity.x < -velocityThreshold
        : info.offset.x > distThreshold || info.velocity.x > velocityThreshold;

      if (isNext && s.currentIndex < s.itemCount - 1) {
        haptic("selection");
        // LTR: animate swipeX to -step (current slides left, next enters from right).
        // RTL: animate swipeX to +step (current slides right, next enters from left).
        const target = s.rtl ? stepVal : -stepVal;
        animate(swipeX, target, { type: "spring", stiffness: 400, damping: 35, mass: 0.8 })
          .then(() => {
            s.onNavigateNext();
            swipeX.set(0);
            movedRef.current = false;
          });
      } else if (isPrev && s.currentIndex > 0) {
        haptic("selection");
        const target = s.rtl ? -stepVal : stepVal;
        animate(swipeX, target, { type: "spring", stiffness: 400, damping: 35, mass: 0.8 })
          .then(() => {
            s.onNavigatePrev();
            swipeX.set(0);
            movedRef.current = false;
          });
      } else {
        movedRef.current = false;
        animate(swipeX, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
      }
    },
    [swipeX]
  );

  return {
    containerRef,
    swipeX,
    prevCardX,
    nextCardX,
    prevVisible,
    nextVisible,
    movedRef,
    cardWidth,
    onPointerDown,
    onPanStart,
    onPan,
    onPanEnd,
  };
}
