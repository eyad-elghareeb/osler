"use client";

/**
 * NavigationStack — iOS NavigationController-style stacked pages.
 *
 * Renders a home layer that is always present underneath, with an optional
 * subpage overlay that slides in from the inline-end side. The subpage can
 * be dragged back to dismiss.
 *
 * The home layer is FIXED — it does not move or parallax during the drag.
 * It only dims (opacity fade) when a subpage is open, and brightens back
 * to full opacity when the subpage is dismissed. This gives the "fixed and
 * fading in from behind" effect the user expects from iOS Settings.
 *
 * Features:
 *   • Home layer is fixed at x:0 — no horizontal movement, no parallax.
 *   • Home layer dims to 65% opacity when a subpage is open.
 *   • Subpage slides in from the right (LTR) or left (RTL) with a spring.
 *   • Drag the subpage to go back. dragSnapToOrigin handles snap-back.
 *   • Velocity-aware commit: a fast flick triggers back even below the
 *     distance threshold.
 *
 * Usage:
 *   <NavigationStack
 *     home={<SettingsHomeList />}
 *     subpage={activeSection ? <SettingsSubpage section={activeSection} /> : null}
 *     onBack={goHome}
 *     rtl={rtl}
 *     className="flex-1 min-h-0"
 *   />
 */

import * as React from "react";
import { motion, AnimatePresence, useMotionValue } from "framer-motion";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";

export interface NavigationStackProps {
  /** The home layer — always rendered underneath. */
  home: React.ReactNode;
  /** The subpage overlay. Pass `null` to show only the home layer. */
  subpage: React.ReactNode | null;
  /** Called when the user drags the subpage back past the threshold. */
  onBack: () => void;
  /** Right-to-left layout. Subpages enter from the left and drag-left goes back. */
  rtl?: boolean;
  /** Additional className for the outer container. */
  className?: string;
  /** Additional className for the home layer. */
  homeClassName?: string;
  /** Additional className for the subpage overlay. */
  subpageClassName?: string;
}

export function NavigationStack({
  home,
  subpage,
  onBack,
  rtl = false,
  className,
  homeClassName,
  subpageClassName,
}: NavigationStackProps) {
  // backDragX drives the subpage's horizontal position during the drag.
  // The home layer does NOT use this — it stays fixed at x:0.
  const backDragX = useMotionValue(0);

  const hasSubpage = subpage !== null;
  // Subpages enter from the right (LTR) or left (RTL).
  const enterX = rtl ? "-100%" : "100%";

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Home layer — FIXED at x:0. Only opacity changes (dims when a
          subpage is open, brightens when dismissed). No parallax, no
          horizontal movement, no scaling. This gives the "fixed and
          fading in from behind" effect. */}
      <motion.div
        initial={false}
        animate={{ opacity: hasSubpage ? 0.65 : 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.8 }}
        className={cn("absolute inset-0 overflow-y-auto", homeClassName)}
      >
        {home}
      </motion.div>

      {/* Subpage overlay — slides in from the inline-end side, draggable
          to dismiss. The home layer is revealed underneath as the subpage
          slides away. */}
      <AnimatePresence initial={false}>
        {hasSubpage && (
          <motion.div
            initial={{ x: enterX }}
            animate={{ x: 0 }}
            exit={{ x: enterX }}
            transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.8 }}
            style={{ x: backDragX }}
            drag="x"
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: rtl ? 0.7 : 0, right: rtl ? 0 : 0.7 }}
            dragSnapToOrigin
            onDragStart={() => haptic("selection")}
            onDragEnd={(_e, info) => {
              // For LTR: back swipe is dragging right (positive offset).
              // For RTL: back swipe is dragging left (negative offset).
              // Velocity-aware: a fast flick commits even below the distance
              // threshold.
              const threshold = 90;
              const velocityThreshold = 350;
              const isBack = rtl
                ? info.offset.x < -threshold ||
                  info.velocity.x < -velocityThreshold
                : info.offset.x > threshold ||
                  info.velocity.x > velocityThreshold;
              if (isBack) {
                haptic("selection");
                onBack();
              }
              // Otherwise dragSnapToOrigin snaps the subpage back to 0.
            }}
            className={cn(
              "absolute inset-0 bg-background shadow-2xl overflow-y-auto",
              subpageClassName
            )}
          >
            {subpage}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
