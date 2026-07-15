"use client";

/**
 * VerticalSnapGallery — Instagram-Reels / TikTok-style vertical snap gallery.
 *
 * Renders three "pages" (prev / current / next) stacked vertically. A single
 * `swipeY` motion value drives all three simultaneously, so as the current
 * page slides off-screen the next page slides in from the other side —
 * exactly like swiping through Reels/TikTok.
 *
 * Design highlights:
 *
 *  • **Drag-from-anywhere.** The hook listens on the outer `containerRef`,
 *    not on each rendered card. The user can start a swipe from any pixel
 *    inside the container — including padding, gutters, the question stem,
 *    etc. — as long as the pointer didn't land on an interactive element.
 *
 *  • **Smart interactive-element guard.** Before starting a swipe, the hook
 *    walks the event target's ancestor chain (up to the gallery root)
 *    looking for "interactive" markers: <button>, <a>, <input>, <textarea>,
 *    <select>, [contenteditable], [data-no-swipe], [role="button"], or any
 *    element with an `onClick` that the consumer has flagged as primary
 *    (via [data-swipe-interactive]). If any ancestor matches, the gesture
 *    is suppressed so the underlying click target keeps working.
 *
 *  • **Scroll-then-snap (dual-mode).** Because `touch-action: none`
 *    prevents the browser from scrolling at all, the hook owns ALL
 *    pointer movement. When the user drags inside a scrollable
 *    child (e.g. a long question stem), the hook manually scrolls that
 *    child via `scrollTop -= delta`. When the child reaches its edge
 *    mid-drag, the hook seamlessly transitions to snap mode — driving
 *    `swipeY` to animate the page transition. This gives a continuous,
 *    fluid gesture: scroll → hit edge → snap to next page, all in one drag.
 *
 *  • **Axis-lock.** A swipe only commits when the dominant axis is Y. A
 *    horizontal drag inside a scrollable choice row, or a diagonal tap-
 *    drag, won't trigger a vertical snap — they're treated as taps/cancels.
 *
 *  • **Rubber-band edges.** At the first/last page, dragging past the
 *    edge applies a 0.3× resistance — feels native, prevents over-scroll.
 *
 *  • **Momentum + snap.** On release, if the gesture passed the threshold
 *    (or had enough velocity), the gallery springs to the next/prev page.
 *    Otherwise it springs back to rest.
 *
 *  • **Tap detection.** A `movedRef` flag tracks whether the gesture
 *    moved >8px. If not, `onTap` is called — preserving tap-to-flip on
 *    flashcards and tap-to-reveal interactions.
 *
 *  • **Works in narrow and wide layouts.** The gallery measures its own
 *    height (via ResizeObserver) to compute the snap step. Drop it inside
 *    a 55%-wide split-mode column or a full-width single-page scroll —
 *    both work identically.
 *
 *  • **RTL aware.** In RTL layouts, swipe directions are inverted for
 *    horizontal interactions (left↔right). Vertical swipes are unaffected
 *    by RTL — up is always next, down is always prev.
 *
 *  • **Reduced-motion safe.** Springs are short (under 0.3s) and respect
 *    the global MotionConfig from AnimationsProvider.
 *
 *  • **Touch + mouse + pen.** Uses Pointer Events so the same code path
 *    works for finger, stylus, and mouse drag.
 *
 * Usage:
 *   <VerticalSnapGallery
 *     items={cards}
 *     currentIndex={index}
 *     onNavigateNext={nextCard}
 *     onNavigatePrev={prevCard}
 *     onTap={flipCard}
 *     disabled={!canSwipe}
 *     rtl={rtl}
 *     className="w-full h-full"
 *     cardClassName="w-full h-full"
 *     renderItem={(card, idx, interactive) => <CardFace card={card} />}
 *   />
 *
 * To opt a child element OUT of swipe-start detection (e.g. a sticky
 * header inside the gallery that should always scroll naturally), add
 * `data-no-swipe` to it. To opt a non-button element IN as interactive
 * (so swipes starting on it are suppressed), add `data-swipe-interactive`.
 */

import * as React from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  type MotionValue,
} from "framer-motion";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";

/* ───────────────────────── Types ──────────────────────────────── */

export interface VerticalSnapGalleryProps<T> {
  /** The full list of items in the gallery. */
  items: T[];
  /** Index of the currently visible item. */
  currentIndex: number;
  /** Called when the user swipes/scrolls to the next item. */
  onNavigateNext: () => void;
  /** Called when the user swipes/scrolls to the previous item. */
  onNavigatePrev: () => void;
  /**
   * Renders a single page. Called for the current page (interactive=true)
   * and for the prev/next preview pages (interactive=false).
   */
  renderItem: (item: T, index: number, interactive: boolean) => React.ReactNode;
  /** Called when the current page is tapped (not swiped). */
  onTap?: () => void;
  /** Disable all swipe gestures. */
  disabled?: boolean;
  /** Right-to-left layout. (Vertical swipes are unaffected; flag kept for API parity.) */
  rtl?: boolean;
  /** Additional className for the outer container. */
  className?: string;
  /** Additional className for each page wrapper. */
  cardClassName?: string;
  /**
   * Minimum drag distance in px before a snap commits. Default 80 — feels
   * like Reels/TikTok. Lower = more sensitive (e.g. 50 for flashcards).
   */
  threshold?: number;
  /**
   * Snap commit velocity in px/ms — if the gesture ends with velocity
   * above this, snap even if the threshold wasn't met. Default 0.5.
   */
  velocityThreshold?: number;
  /** Max gesture duration in ms. Default 800. */
  maxDuration?: number;
  /** Axis-lock drift ratio. Default 0.6 (primary axis must be ≥1.66× the secondary). */
  maxDriftRatio?: number;
  /**
   * Enable scroll-then-snap dual mode. When true (default), a drag inside
   * a scrollable child first scrolls that child, then snaps to the next
   * page once the child reaches its edge. When false, every drag goes
   * directly to snap mode — useful when the consumer's pages are
   * scrollable but navigation should take priority (e.g. QBank on touch).
   */
  scrollMode?: boolean;
}

/* ─────────────── Interactive-element hit-testing ──────────────── */

const INTERACTIVE_TAGS = new Set([
  "BUTTON",
  "A",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "LABEL",
  "SUMMARY",
  "DETAILS",
  "VIDEO",
  "AUDIO",
]);

/**
 * Walk the DOM from `target` up to (but not including) `root`, returning
 * true if any ancestor is an "interactive" element.
 */
function isInteractiveTarget(target: EventTarget | null, root: HTMLElement): boolean {
  let node = target as HTMLElement | null;
  while (node && node !== root) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node = node.parentElement;
      continue;
    }
    const el = node as HTMLElement;
    if (INTERACTIVE_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.hasAttribute("data-no-swipe")) return true;
    if (el.hasAttribute("data-swipe-interactive")) return true;
    const role = el.getAttribute("role");
    if (
      role === "button" || role === "link" || role === "checkbox" ||
      role === "radio" || role === "tab" || role === "menuitem" ||
      role === "option" || role === "combobox"
    ) {
      return true;
    }
    node = el.parentElement;
  }
  return false;
}

/**
 * Find the nearest scrollable ancestor of `target` that actually has
 * overflow content (scrollHeight > clientHeight). Stops at `root`.
 *
 * Because the gallery container uses `touch-action: none`, the browser
 * won't scroll at all — so the hook must manually scroll the element
 * returned by this function when the user drags inside it.
 */
function findScrollableAncestor(
  target: EventTarget | null,
  root: HTMLElement,
): HTMLElement | null {
  let node = target as HTMLElement | null;
  while (node && node !== root) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node = node.parentElement;
      continue;
    }
    const el = node as HTMLElement;
    const style = getComputedStyle(el);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      el.scrollHeight > el.clientHeight + 1
    ) {
      return el;
    }
    node = el.parentElement;
  }
  return null;
}

/**
 * Check whether a scrollable element is at its edge in the given direction.
 * `dir = 1` = scrolling up (toward scrollTop = 0).
 * `dir = -1` = scrolling down (toward scrollTop = scrollHeight).
 */
function isScrollAtEdge(el: HTMLElement, dir: 1 | -1): boolean {
  if (dir === 1) return el.scrollTop <= 0;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
}

/* ────────────────── The hook (gesture + state) ────────────────── */

interface UseVerticalSnapOptions {
  currentIndex: number;
  itemCount: number;
  onNavigateNext: () => void;
  onNavigatePrev: () => void;
  disabled?: boolean;
  threshold?: number;
  velocityThreshold?: number;
  maxDuration?: number;
  maxDriftRatio?: number;
  scrollMode?: boolean;
}

interface UseVerticalSnapState {
  containerRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  swipeY: MotionValue<number>;
  prevCardY: MotionValue<number>;
  nextCardY: MotionValue<number>;
  prevVisible: MotionValue<"visible" | "hidden">;
  nextVisible: MotionValue<"visible" | "hidden">;
  movedRef: React.MutableRefObject<boolean>;
  stageHeight: number;
}

function useVerticalSnap(options: UseVerticalSnapOptions): UseVerticalSnapState {
  const {
    currentIndex, itemCount, onNavigateNext, onNavigatePrev,
    disabled = false, threshold = 80, velocityThreshold = 0.5,
    maxDuration = 800, maxDriftRatio = 0.6, scrollMode: scrollModeProp = true,
  } = options;

  const swipeY = useMotionValue(0);
  const [stageHeight, setStageHeight] = React.useState(0);
  const movedRef = React.useRef(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);

  const stateRef = React.useRef({
    currentIndex, itemCount, onNavigateNext, onNavigatePrev,
    threshold, velocityThreshold, maxDuration, maxDriftRatio, stageHeight, scrollModeProp,
  });
  stateRef.current = {
    currentIndex, itemCount, onNavigateNext, onNavigatePrev,
    threshold, velocityThreshold, maxDuration, maxDriftRatio, stageHeight, scrollModeProp,
  };

  // ── Pointer-driven gesture handling ────────────────────────────
  // Dual-mode: scroll mode (manually scroll a child) → snap mode (drive swipeY).
  // The transition happens mid-gesture when the child hits its edge.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || disabled) return;

    let startX = 0, startY = 0, startT = 0;
    let tracking = false;
    let axisLocked: "x" | "y" | null = null;
    let startPointerId = -1;
    let lastY = 0, lastT = 0;
    // Remember the original touch target from pointerdown. After
    // setPointerCapture, all subsequent pointermove events have
    // e.target === container — so findScrollableAncestor would walk
    // from container to container (loop never runs) and return null.
    let downTarget: EventTarget | null = null;

    // Scroll-mode state
    let scrollMode = false;
    let scrollTarget: HTMLElement | null = null;
    // Y position at the moment we transitioned from scroll → snap mode.
    // swipeY is measured from this point so the snap animation starts
    // smoothly from where scrolling left off.
    let snapStartY = 0;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (isInteractiveTarget(e.target, container)) return;
      // Capture the pointer so ALL subsequent pointermove/pointerup events
      // go to THIS element — the browser won't send pointercancel even if
      // the finger moves over a scrollable child. This is what makes touch
      // behave identically to mouse: the gesture can't be hijacked mid-flight.
      try { container.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      tracking = true;
      axisLocked = null;
      scrollMode = false;
      scrollTarget = null;
      downTarget = e.target;
      snapStartY = e.clientY;
      startX = e.clientX;
      startY = e.clientY;
      lastY = e.clientY;
      startT = Date.now();
      lastT = startT;
      startPointerId = e.pointerId;
      movedRef.current = false;
    };

    const onMove = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== startPointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Axis lock
      if (axisLocked === null) {
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        if (absX > 8 || absY > 8) {
          if (absY >= absX * (1 / maxDriftRatio)) {
            axisLocked = "y";
            // Reset lastY at the moment of axis lock so the first delta
            // in scroll/snap mode is small (just the incremental move),
            // not the full distance from pointerdown.
            lastY = e.clientY;
            lastT = Date.now();
          } else {
            axisLocked = "x";
            tracking = false;
            movedRef.current = false;
            animate(swipeY, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
            return;
          }
        }
      }
      if (axisLocked !== "y") {
        // Keep lastY fresh even during axis-unlock phase so there's no
        // stale jump when we finally lock.
        lastY = e.clientY;
        lastT = Date.now();
        return;
      }

      // First time crossing 8px: decide scroll vs snap
      if (!movedRef.current && Math.abs(dy) > 8) {
        movedRef.current = true;
        if (scrollModeProp) {
          const scrollable = findScrollableAncestor(downTarget, container);
          if (scrollable) {
            const dir: 1 | -1 = dy > 0 ? 1 : -1;
            if (!isScrollAtEdge(scrollable, dir)) {
              scrollMode = true;
              scrollTarget = scrollable;
            }
          }
        }
      }
      if (!movedRef.current) return;

      const delta = e.clientY - lastY;
      lastY = e.clientY;
      lastT = Date.now();
      const { currentIndex: ci, itemCount: ic } = stateRef.current;

      if (scrollMode && scrollTarget) {
        // ── Scroll mode: manually scroll the child ──────────────
        const before = scrollTarget.scrollTop;
        scrollTarget.scrollTop -= delta;
        const consumed = before - scrollTarget.scrollTop;
        const remainder = delta - consumed;

        if (Math.abs(remainder) > 0.5) {
          // Hit edge — transition to snap mode.
          scrollMode = false;
          // Set snapStartY so that snapDy starts at `remainder` (the
          // unconsumed pixels). This makes the transition continuous:
          // swipeY goes from 0 → remainder → remainder + next_delta.
          snapStartY = e.clientY - remainder;
        }
        // swipeY stays at 0 during scroll mode — the page doesn't move.
      } else {
        // ── Snap mode: drive swipeY ─────────────────────────────
        // snapStartY is either startY (pure snap mode from the start)
        // or (transitionY - remainder) (came from scroll mode).
        const snapDy = e.clientY - snapStartY;
        let clamped = snapDy;
        if (ci === 0 && clamped > 0) clamped *= 0.3;
        if (ci === ic - 1 && clamped < 0) clamped *= 0.3;
        swipeY.set(clamped);
      }
    };

    const finishGesture = (endY: number, endT: number) => {
      if (!tracking) return;
      tracking = false;
      const dy = endY - startY;
      const dt = endT - startT;
      const o = stateRef.current;
      const { currentIndex: ci, itemCount: ic } = o;

      // ── Ended in scroll mode ───────────────────────────────────
      // If we're still in scroll mode at gesture end, it means the user
      // was scrolling content and NEVER hit the edge (no transition to
      // snap mode occurred). In this case, NEVER snap — the user was
      // reading, not navigating. Just settle in place.
      if (scrollMode && scrollTarget) {
        scrollMode = false;
        scrollTarget = null;
        movedRef.current = false;
        // swipeY should be 0 (we never drove it in scroll mode).
        if (swipeY.get() !== 0) {
          animate(swipeY, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
        }
        return;
      }

      // ── Ended in snap mode ─────────────────────────────────────
      // Distance-based snap only. No velocity-based snapping — on touch,
      // pointer event timing makes velocity unreliable (a 60px nudge in
      // 100ms reads as 0.6 px/ms, easily exceeding a velocity threshold).
      // This caused false snaps on qbank questions where the page is
      // scrollable and the user is at the top edge. Distance-only is
      // predictable: drag ≥ threshold → snap, otherwise spring back.
      const snapDy = endY - snapStartY;
      const passedThreshold = Math.abs(snapDy) >= o.threshold;

      if (dt > o.maxDuration) {
        movedRef.current = false;
        animate(swipeY, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
        return;
      }

      const wantsNext = snapDy < 0 && passedThreshold;
      const wantsPrev = snapDy > 0 && passedThreshold;

      if (wantsNext && ci < ic - 1) {
        haptic("selection");
        const h = o.stageHeight || window.innerHeight;
        animate(swipeY, -h, { type: "spring", stiffness: 380, damping: 34, mass: 0.8 })
          .then(() => { o.onNavigateNext(); swipeY.set(0); movedRef.current = false; });
      } else if (wantsPrev && ci > 0) {
        haptic("selection");
        const h = o.stageHeight || window.innerHeight;
        animate(swipeY, h, { type: "spring", stiffness: 380, damping: 34, mass: 0.8 })
          .then(() => { o.onNavigatePrev(); swipeY.set(0); movedRef.current = false; });
      } else {
        movedRef.current = false;
        animate(swipeY, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== startPointerId) return;
      try { container.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      finishGesture(e.clientY, Date.now());
    };

    const onCancel = (e: PointerEvent) => {
      if (!tracking) return;
      try { container.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      tracking = false;
      scrollMode = false;
      scrollTarget = null;
      movedRef.current = false;
      animate(swipeY, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
    };

    container.addEventListener("pointerdown", onDown, { passive: true });
    container.addEventListener("pointermove", onMove, { passive: true });
    container.addEventListener("pointerup", onUp, { passive: true });
    container.addEventListener("pointercancel", onCancel, { passive: true });

    return () => {
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onCancel);
    };
  }, [disabled, swipeY, maxDriftRatio, scrollModeProp]);

  // ── Wheel support (desktop) ────────────────────────────────────
  // Walks ancestors up to <body>. If ANY scrollable ancestor can still
  // scroll in the wheel direction, lets native scroll happen. Only snaps
  // when nothing else can scroll.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || disabled) return;

    let cooldown = false;
    let acc = 0;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (e: WheelEvent) => {
      if (isInteractiveTarget(e.target, container)) return;
      if (Math.abs(e.deltaY) < 12) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      const target = e.target as HTMLElement | null;
      let n: HTMLElement | null = target;
      while (n && n !== document.body) {
        const style = getComputedStyle(n);
        const overflowY = style.overflowY;
        if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
          const atTop = n.scrollTop <= 0;
          const atBottom = n.scrollTop + n.clientHeight >= n.scrollHeight - 1;
          if (e.deltaY < 0 && !atTop) return;
          if (e.deltaY > 0 && !atBottom) return;
        }
        n = n.parentElement;
      }

      e.preventDefault();
      acc += e.deltaY;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { acc = 0; }, 200);

      if (cooldown) return;
      const { currentIndex: ci, itemCount: ic } = stateRef.current;
      if (acc > 30 && ci < ic - 1) {
        cooldown = true;
        haptic("selection");
        stateRef.current.onNavigateNext();
        setTimeout(() => { cooldown = false; }, 450);
        acc = 0;
      } else if (acc < -30 && ci > 0) {
        cooldown = true;
        haptic("selection");
        stateRef.current.onNavigatePrev();
        setTimeout(() => { cooldown = false; }, 450);
        acc = 0;
      }
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [disabled]);

  // ── Measure stage height ───────────────────────────────────────
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => setStageHeight(stage.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stageRef]);

  const step = stageHeight;
  const prevCardY = useTransform(swipeY, (v) => v - step);
  const nextCardY = useTransform(swipeY, (v) => v + step);
  const prevVisible = useTransform(swipeY, (v) => Math.abs(v) > 3 ? "visible" : "hidden");
  const nextVisible = useTransform(swipeY, (v) => Math.abs(v) > 3 ? "visible" : "hidden");

  return {
    containerRef, stageRef, swipeY, prevCardY, nextCardY,
    prevVisible, nextVisible, movedRef, stageHeight,
  };
}

/* ────────────────────── The component ────────────────────────── */

export function VerticalSnapGallery<T>({
  items, currentIndex, onNavigateNext, onNavigatePrev, renderItem, onTap,
  disabled = false, rtl = false, className, cardClassName,
  threshold = 80, velocityThreshold = 0.5, maxDuration = 800, maxDriftRatio = 0.6,
  scrollMode: scrollModeProp = true,
}: VerticalSnapGalleryProps<T>) {
  const {
    containerRef, stageRef, swipeY, prevCardY, nextCardY,
    prevVisible, nextVisible, movedRef,
  } = useVerticalSnap({
    currentIndex, itemCount: items.length,
    onNavigateNext, onNavigatePrev, disabled,
    threshold, velocityThreshold, maxDuration, maxDriftRatio, scrollMode: scrollModeProp,
  });

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  const handlePointerDown = React.useCallback(() => {
    movedRef.current = false;
  }, [movedRef]);

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      className={cn(
        "relative overflow-y-clip overflow-x-visible",
        disabled ? "" : "overscroll-none",
        className,
      )}
      style={{
        // `none` ensures the browser never intercepts touch events —
        // pointerdown/move/up fire identically for touch and mouse.
        // The hook owns ALL gestures: manual scroll in scroll mode,
        // swipeY in snap mode.
        touchAction: disabled ? "auto" : "none",
      }}
      data-vertical-snap={disabled ? "off" : "on"}
      aria-roledescription={disabled ? undefined : "carousel"}
    >
      <div ref={stageRef} className="relative w-full h-full">
        {hasPrev && (
          <motion.div
            style={{ y: prevCardY, visibility: prevVisible, pointerEvents: "none" as const }}
            className={cn("absolute inset-0", cardClassName)}
            aria-hidden
          >
            {renderItem(items[currentIndex - 1], currentIndex - 1, false)}
          </motion.div>
        )}

        <motion.div
          style={{ y: swipeY }}
          onClick={() => {
            if (movedRef.current) return;
            onTap?.();
          }}
          className={cn("relative w-full h-full", cardClassName)}
        >
          {renderItem(items[currentIndex], currentIndex, true)}
        </motion.div>

        {hasNext && (
          <motion.div
            style={{ y: nextCardY, visibility: nextVisible, pointerEvents: "none" as const }}
            className={cn("absolute inset-0", cardClassName)}
            aria-hidden
          >
            {renderItem(items[currentIndex + 1], currentIndex + 1, false)}
          </motion.div>
        )}
      </div>
    </div>
  );
}
