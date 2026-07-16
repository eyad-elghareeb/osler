"use client";

/**
 * useSwipeBackDismiss — modular swipe-to-go-back hook for overlay panels.
 *
 * Mirrors the same iOS-style "drag the overlay away to dismiss" feel that
 * `NavigationStack` (used by Settings) provides for its subpage layer, but
 * packaged as a hook so it can be spread onto any `motion.div` overlay
 * (sidebars, bottom sheets, full-screen modals).
 *
 * Behavior:
 *   • Horizontal mode: drag toward the inline-end edge to dismiss.
 *     - LTR sidebar (slides in from right): drag right to dismiss.
 *     - RTL sidebar (slides in from left): drag left to dismiss.
 *   • Vertical mode: drag down to dismiss (for bottom sheets).
 *   • Velocity-aware commit: a fast flick triggers dismiss even below the
 *     distance threshold — matches the NavigationStack feel exactly.
 *   • Rubber-band resistance via `dragElastic` so the overlay follows the
 *     finger with a slight pull-back, just like iOS.
 *   • `dragSnapToOrigin` returns the overlay to its resting position if the
 *     threshold wasn't met — no half-dismissed states.
 *   • Haptic tick on drag start and on successful dismiss (mirrors
 *     NavigationStack's `haptic("selection")` calls).
 *
 * Usage:
 *   const dismiss = useSwipeBackDismiss({
 *     onDismiss: () => setOpen(false),
 *     direction: useFullscreen ? "vertical" : "horizontal",
 *     rtl,
 *   });
 *   return (
 *     <motion.div
 *       initial={{ x: 360, opacity: 0 }}
 *       animate={{ x: 0, opacity: 1 }}
 *       exit={{ x: 360, opacity: 0 }}
 *       {...dismiss}
 *     >
 *       {children}
 *     </motion.div>
 *   );
 *
 * The returned prop object is empty when `disabled` is true, so you can
 * safely spread it unconditionally.
 */

import * as React from "react";
import { haptic } from "@/lib/osler/native";

export type SwipeBackDirection = "horizontal" | "vertical";

export interface SwipeBackDismissOptions {
  /** Called when the user swipes far enough to dismiss. */
  onDismiss: () => void;
  /** Direction of swipe to dismiss. */
  direction: SwipeBackDirection;
  /** Right-to-left layout. For horizontal mode, flips the dismiss direction. */
  rtl?: boolean;
  /** Disable swipe (e.g., when an inner form is dirty or a sub-panel is open). */
  disabled?: boolean;
  /** Distance threshold in px to commit dismiss. Default 90. */
  threshold?: number;
  /** Velocity threshold in px/s to commit dismiss. Default 350. */
  velocityThreshold?: number;
  /** Fire haptic feedback when drag starts / dismisses. Default true. */
  hapticFeedback?: boolean;
  /**
   * Extra elastic resistance for the drag. Higher = looser. Default 0.7.
   * Set to 0 to lock the drag entirely on the off-axis.
   */
  elasticity?: number;
}

export type SwipeBackDismissProps = {
  drag?: "x" | "y";
  dragDirectionLock?: boolean;
  dragConstraints?:
    | { left: number; right: number }
    | { top: number; bottom: number };
  dragElastic?:
    | number
    | { left: number; right: number }
    | { top: number; bottom: number };
  dragSnapToOrigin?: boolean;
  onDragStart?: () => void;
  onDragEnd?: (
    e: unknown,
    info: { offset: { x: number; y: number }; velocity: { x: number; y: number } },
  ) => void;
  style?: React.CSSProperties;
};

/**
 * Returns motion.div props that add drag-to-dismiss behavior matching the
 * NavigationStack pattern. Spread the result onto any motion.div overlay.
 *
 * The returned prop object is empty when `disabled` is true, so you can
 * safely spread it unconditionally. The hook always calls `useRef` exactly
 * once (Rules of Hooks compliant).
 */
export function useSwipeBackDismiss(
  options: SwipeBackDismissOptions,
): SwipeBackDismissProps {
  const {
    onDismiss,
    direction,
    rtl = false,
    disabled = false,
    threshold = 90,
    velocityThreshold = 350,
    hapticFeedback = true,
    elasticity = 0.7,
  } = options;

  // Keep the latest onDismiss in a ref so the returned motion handlers
  // always call the freshest callback without forcing a re-render.
  // MUST be called unconditionally to comply with the Rules of Hooks.
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // Memoize the returned prop bag so it stays stable across renders when
  // the inputs don't change. Avoids needless motion.div re-renders.
  return React.useMemo<SwipeBackDismissProps>(() => {
    if (disabled) return {};

    const common = {
      dragDirectionLock: true as const,
      dragSnapToOrigin: true as const,
      onDragStart: () => {
        if (hapticFeedback) haptic("selection");
      },
    };

    if (direction === "vertical") {
      return {
        ...common,
        drag: "y" as const,
        dragConstraints: { top: 0, bottom: 0 },
        // Only allow dragging downward (toward dismiss). Upward is locked.
        dragElastic: { top: 0, bottom: elasticity },
        style: { touchAction: "pan-y" } as React.CSSProperties,
        onDragEnd: (_e, info) => {
          const isBack =
            info.offset.y > threshold || info.velocity.y > velocityThreshold;
          if (isBack) {
            if (hapticFeedback) haptic("selection");
            onDismissRef.current();
          }
        },
      };
    }

    // Horizontal mode
    return {
      ...common,
      drag: "x" as const,
      dragConstraints: { left: 0, right: 0 },
      // LTR: only allow dragging right (toward dismiss). RTL: only left.
      dragElastic: { left: rtl ? elasticity : 0, right: rtl ? 0 : elasticity },
      style: { touchAction: "pan-y" } as React.CSSProperties,
      onDragEnd: (_e, info) => {
        const isBack = rtl
          ? info.offset.x < -threshold || info.velocity.x < -velocityThreshold
          : info.offset.x > threshold || info.velocity.x > velocityThreshold;
        if (isBack) {
          if (hapticFeedback) haptic("selection");
          onDismissRef.current();
        }
      },
    };
  }, [
    disabled,
    direction,
    rtl,
    threshold,
    velocityThreshold,
    hapticFeedback,
    elasticity,
  ]);
}
