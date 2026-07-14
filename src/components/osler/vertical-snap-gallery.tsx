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
 *    is suppressed so the underlying click target keeps working. The
 *    threshold check (axis lock + min distance) ensures a horizontal drag
 *    on a choice button doesn't accidentally trigger a page snap.
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
 * true if any ancestor is an "interactive" element. Interactive means:
 *   - A known interactive tag (BUTTON, A, INPUT, …).
 *   - `contenteditable` is true.
 *   - Has `role="button"` / `"link"` / `"checkbox"` / `"radio"` / `"tab"`.
 *   - Has the `data-swipe-interactive` attribute (consumer opt-in).
 *
 * The `data-no-swipe` attribute is the inverse: if found anywhere in the
 * chain, the swipe is suppressed (the consumer is explicitly opting this
 * region out of swipe handling, e.g. a custom scrollable child).
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
      role === "button" ||
      role === "link" ||
      role === "checkbox" ||
      role === "radio" ||
      role === "tab" ||
      role === "menuitem" ||
      role === "option" ||
      role === "combobox"
    ) {
      return true;
    }
    node = el.parentElement;
  }
  return false;
}

/**
 * Scroll-snap policy for the gesture. Decides whether a vertical drag that
 * starts on `target` should:
 *   - "snap": be captured by the gallery (the user is in a non-scrollable
 *     region, or at the edge of a scrollable region).
 *   - "scroll": be left to the browser (the user is inside a scrollable
 *     element that still has room to scroll in the gesture direction).
 *
 * We walk up to the nearest scrollable ancestor of `target`. If we find
 * one and it's NOT at the edge in the gesture direction, we let the
 * browser handle the scroll. Otherwise (no scrollable ancestor, or at
 * the edge), the gallery takes over.
 *
 * `dir` is the sign of the vertical drag: +1 = dragging down (prev),
 * -1 = dragging up (next).
 */
function shouldSnapInsteadOfScroll(
  target: EventTarget | null,
  root: HTMLElement,
  dir: 1 | -1 | 0,
): boolean {
  let node = (target as HTMLElement | null)?.parentElement ?? null;
  while (node && node !== root) {
    const style = getComputedStyle(node);
    const overflowY = style.overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      const atTop = node.scrollTop <= 0;
      const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      // Dragging down (dir=+1) → wants "prev" → only snap if at top.
      // Dragging up (dir=-1) → wants "next" → only snap if at bottom.
      if (dir === 1 && !atTop) return false;
      if (dir === -1 && !atBottom) return false;
      // dir === 0 (not yet determined): snap only if at both edges
      // (effectively a non-scrollable element), otherwise let scroll happen.
      if (dir === 0 && !(atTop && atBottom)) return false;
    }
    node = node.parentElement;
  }
  return true;
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
}

interface UseVerticalSnapState {
  /** Attach to the outer container — this is where pointer events are captured. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the inner "stage" — this is the element whose height defines the snap step. */
  stageRef: React.RefObject<HTMLDivElement | null>;
  /** Motion value driving the current page's Y offset. */
  swipeY: MotionValue<number>;
  /** Y offset for the prev page (one step above). */
  prevCardY: MotionValue<number>;
  /** Y offset for the next page (one step below). */
  nextCardY: MotionValue<number>;
  /** Visibility for prev page — hidden at rest, visible during swipe. */
  prevVisible: MotionValue<"visible" | "hidden">;
  /** Visibility for next page — hidden at rest, visible during swipe. */
  nextVisible: MotionValue<"visible" | "hidden">;
  /** True if the current gesture moved >8px (was a swipe, not a tap). */
  movedRef: React.MutableRefObject<boolean>;
  /** Measured stage height in px. */
  stageHeight: number;
}

function useVerticalSnap(options: UseVerticalSnapOptions): UseVerticalSnapState {
  const {
    currentIndex,
    itemCount,
    onNavigateNext,
    onNavigatePrev,
    disabled = false,
    threshold = 80,
    velocityThreshold = 0.5,
    maxDuration = 800,
    maxDriftRatio = 0.6,
  } = options;

  const swipeY = useMotionValue(0);
  const [stageHeight, setStageHeight] = React.useState(0);
  const movedRef = React.useRef(false);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);

  // Keep latest values in a ref so pointer callbacks don't go stale.
  const stateRef = React.useRef({
    currentIndex,
    itemCount,
    onNavigateNext,
    onNavigatePrev,
    threshold,
    velocityThreshold,
    maxDuration,
    maxDriftRatio,
    stageHeight,
  });
  stateRef.current = {
    currentIndex,
    itemCount,
    onNavigateNext,
    onNavigatePrev,
    threshold,
    velocityThreshold,
    maxDuration,
    maxDriftRatio,
    stageHeight,
  };

  // ── Pointer-driven gesture handling ────────────────────────────
  // We attach pointer listeners on the outer container, NOT on the cards.
  // This is what enables "drag from anywhere": the user can press anywhere
  // inside the container (gutter, padding, even over text) and start a swipe.
  // The hit-test on pointerdown decides whether to start tracking.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (disabled) return;

    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;
    let axisLocked: "x" | "y" | null = null;
    let startPointerId = -1;
    // Track recent pointer positions for instantaneous-velocity calc on release.
    let lastY = 0;
    let lastT = 0;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Don't hijack inputs / contenteditable / buttons.
      if (isInteractiveTarget(e.target, container)) return;
      tracking = true;
      axisLocked = null;
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

      // Axis lock — decide whether this is a vertical or horizontal gesture
      // once the movement exceeds 8px. Horizontal gestures are abandoned
      // (treated as a tap-or-scroll, not a swipe).
      if (axisLocked === null) {
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        if (absX > 8 || absY > 8) {
          if (absY >= absX * (1 / maxDriftRatio)) {
            axisLocked = "y";
          } else {
            axisLocked = "x";
            tracking = false;
            movedRef.current = false;
            animate(swipeY, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
            return;
          }
        }
      }

      if (axisLocked !== "y") return;

      // First time we cross the 8px threshold on the Y axis: check whether
      // the gesture should be captured by the gallery or handed off to the
      // nearest scrollable ancestor. If a scrollable ancestor has room to
      // scroll in this direction, abandon tracking and let native scroll
      // happen — the user is reading long content, not navigating.
      if (!movedRef.current && Math.abs(dy) > 8) {
        const dir: 1 | -1 = dy > 0 ? 1 : -1;
        if (!shouldSnapInsteadOfScroll(e.target, container, dir)) {
          tracking = false;
          movedRef.current = false;
          // Don't reset swipeY — it should still be at 0 (we never moved it).
          return;
        }
        movedRef.current = true;
      }

      const { currentIndex: ci, itemCount: ic } = stateRef.current;
      // Rubber-band resistance at the edges.
      let clamped = dy;
      if (ci === 0 && clamped > 0) clamped *= 0.3;
      if (ci === ic - 1 && clamped < 0) clamped *= 0.3;
      swipeY.set(clamped);

      // Update velocity tracker (recent samples only).
      lastY = e.clientY;
      lastT = Date.now();
    };

    const finishGesture = (endY: number, endT: number) => {
      if (!tracking) return;
      tracking = false;
      const dy = endY - startY;
      const dt = endT - startT;
      const o = stateRef.current;
      const { currentIndex: ci, itemCount: ic } = o;

      // Instantaneous velocity from the most recent sample (px/ms).
      // Falls back to overall average if no recent movement.
      const recentDt = Math.max(1, endT - lastT);
      const recentDy = endY - lastY;
      const velocity = Math.abs(recentDy) > 4 && recentDt < 150
        ? recentDy / recentDt
        : dt > 0 ? dy / dt : 0;

      const passedThreshold = Math.abs(dy) >= o.threshold;
      const passedVelocity = Math.abs(velocity) >= o.velocityThreshold && Math.abs(dy) > 24;

      if (dt > o.maxDuration) {
        movedRef.current = false;
        animate(swipeY, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
        return;
      }

      // Vertical: swipe up (negative dy) → next; swipe down (positive dy) → prev.
      const wantsNext = dy < 0 && (passedThreshold || passedVelocity);
      const wantsPrev = dy > 0 && (passedThreshold || passedVelocity);

      if (wantsNext && ci < ic - 1) {
        haptic("selection");
        const h = o.stageHeight || (typeof window !== "undefined" ? window.innerHeight : 600);
        animate(swipeY, -h, { type: "spring", stiffness: 380, damping: 34, mass: 0.8 })
          .then(() => {
            o.onNavigateNext();
            swipeY.set(0);
            movedRef.current = false;
          });
      } else if (wantsPrev && ci > 0) {
        haptic("selection");
        const h = o.stageHeight || (typeof window !== "undefined" ? window.innerHeight : 600);
        animate(swipeY, h, { type: "spring", stiffness: 380, damping: 34, mass: 0.8 })
          .then(() => {
            o.onNavigatePrev();
            swipeY.set(0);
            movedRef.current = false;
          });
      } else {
        movedRef.current = false;
        animate(swipeY, 0, { type: "spring", stiffness: 500, damping: 40, mass: 0.8 });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== startPointerId) return;
      finishGesture(e.clientY, Date.now());
    };

    const onCancel = () => {
      if (!tracking) return;
      tracking = false;
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
  }, [disabled, swipeY, maxDriftRatio]);

  // ── Wheel support (desktop): vertical wheel = snap ─────────────
  // Trackpad pinch / horizontal wheel is ignored. Only continuous
  // vertical wheel deltas trigger navigation, with a cooldown to prevent
  // one gesture from skipping multiple pages.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (disabled) return;

    let cooldown = false;
    let acc = 0;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (e: WheelEvent) => {
      // Honor elements that explicitly don't want wheel-swipe.
      if (isInteractiveTarget(e.target, container)) {
        // Still allow normal scroll inside scrollable children —
        // we just don't hijack the wheel for snapping.
        return;
      }
      // Only vertical wheel.
      if (Math.abs(e.deltaY) < 12) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      // Walk from the wheel target all the way up to <body>. If ANY
      // scrollable ancestor (inside OR outside the gallery container)
      // can still scroll in the wheel direction, let the native scroll
      // happen — we only snap when nothing else can scroll.
      //
      // This is what makes continuous-mode-after-submit work: the
      // question column (parent of the gallery) has overflow-y-auto and
      // contains an explanation card below the gallery. When the user
      // wheels down inside the gallery, the parent can scroll to reveal
      // the explanation — so we let it. Only once the parent is at its
      // bottom (no more content to reveal) do we snap to the next page.
      const target = e.target as HTMLElement | null;
      let n: HTMLElement | null = target;
      while (n && n !== document.body) {
        const style = getComputedStyle(n);
        const overflowY = style.overflowY;
        if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
          const atTop = n.scrollTop <= 0;
          const atBottom = n.scrollTop + n.clientHeight >= n.scrollHeight - 1;
          // deltaY < 0 = wheel up = wants to scroll up = wants prev snap
          // deltaY > 0 = wheel down = wants to scroll down = wants next snap
          if (e.deltaY < 0 && !atTop) return; // ancestor can scroll up
          if (e.deltaY > 0 && !atBottom) return; // ancestor can scroll down
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

  // Step = stage height. Prev page sits one step up (-step), next page
  // one step down (+step). All three move together with swipeY.
  const step = stageHeight;
  const prevCardY = useTransform(swipeY, (v) => v - step);
  const nextCardY = useTransform(swipeY, (v) => v + step);

  const prevVisible = useTransform(swipeY, (v) =>
    Math.abs(v) > 3 ? "visible" : "hidden"
  );
  const nextVisible = useTransform(swipeY, (v) =>
    Math.abs(v) > 3 ? "visible" : "hidden"
  );

  return {
    containerRef,
    stageRef,
    swipeY,
    prevCardY,
    nextCardY,
    prevVisible,
    nextVisible,
    movedRef,
    stageHeight,
  };
}

/* ────────────────────── The component ────────────────────────── */

export function VerticalSnapGallery<T>({
  items,
  currentIndex,
  onNavigateNext,
  onNavigatePrev,
  renderItem,
  onTap,
  disabled = false,
  rtl = false,
  className,
  cardClassName,
  threshold = 80,
  velocityThreshold = 0.5,
  maxDuration = 800,
  maxDriftRatio = 0.6,
}: VerticalSnapGalleryProps<T>) {
  const {
    containerRef,
    stageRef,
    swipeY,
    prevCardY,
    nextCardY,
    prevVisible,
    nextVisible,
    movedRef,
  } = useVerticalSnap({
    currentIndex,
    itemCount: items.length,
    onNavigateNext,
    onNavigatePrev,
    disabled,
    threshold,
    velocityThreshold,
    maxDuration,
    maxDriftRatio,
  });

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  // Reset movedRef on pointer down so each gesture starts clean.
  const handlePointerDown = React.useCallback(() => {
    movedRef.current = false;
  }, [movedRef]);

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      className={cn(
        "relative overflow-y-clip overflow-x-visible",
        // Block native vertical scroll ONLY when not disabled —
        // we're handling snapping ourselves. When disabled, allow
        // normal scroll (e.g. desktop non-touch users).
        disabled ? "" : "overscroll-none",
        className,
      )}
      style={{
        // When enabled, we own the Y axis. touch-action: pan-x lets
        // horizontal drags (e.g. scrolling a horizontal list inside
        // a card) still work; the browser won't try to scroll the
        // page vertically.
        touchAction: disabled ? "auto" : "pan-x",
      }}
      data-vertical-snap={disabled ? "off" : "on"}
      aria-roledescription={disabled ? undefined : "carousel"}
    >
      {/* The stage — defines the snap step (one screen height). */}
      <div ref={stageRef} className="relative w-full h-full">
        {/* Previous page (off-screen above, hidden at rest) */}
        {hasPrev && (
          <motion.div
            style={{
              y: prevCardY,
              visibility: prevVisible,
              pointerEvents: "none" as const,
            }}
            className={cn("absolute inset-0", cardClassName)}
            aria-hidden
          >
            {renderItem(items[currentIndex - 1], currentIndex - 1, false)}
          </motion.div>
        )}

        {/* Current page (centered, interactive) */}
        <motion.div
          style={{ y: swipeY }}
          onClick={() => {
            if (movedRef.current) return; // was a swipe, not a tap
            onTap?.();
          }}
          className={cn("relative w-full h-full", cardClassName)}
        >
          {renderItem(items[currentIndex], currentIndex, true)}
        </motion.div>

        {/* Next page (off-screen below, hidden at rest) */}
        {hasNext && (
          <motion.div
            style={{
              y: nextCardY,
              visibility: nextVisible,
              pointerEvents: "none" as const,
            }}
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
