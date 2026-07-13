"use client";

/**
 * NavigationStack — iOS NavigationController-style stacked pages.
 *
 * Renders a home layer that is always present underneath, with an optional
 * subpage overlay that slides in from the inline-end side. The subpage can
 * be dragged back to dismiss — the home layer parallaxes during the drag
 * for a native iOS feel (exactly like iOS Settings / Mail / Messages).
 *
 * Features:
 *   • Home layer is always rendered, slides + dims when a subpage is open.
 *   • Subpage slides in from the right (LTR) or left (RTL) with a spring.
 *   • Drag the subpage from the leading edge to go back. dragSnapToOrigin
 *     handles the snap-back if the threshold isn't met.
 *   • Velocity-aware commit: a fast flick triggers back even below the
 *     distance threshold.
 *   • Parallax: the home layer moves at 30% of the drag offset.
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
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
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
  const backDragX = useMotionValue(0);
  // Parallax: home layer moves at 30% of the drag offset.
  const homeParallaxX = useTransform(backDragX, (v) =>
    rtl ? -v * 0.3 : v * 0.3
  );

  const hasSubpage = subpage !== null;
  // Subpages enter from the right (LTR) or left (RTL).
  const enterX = rtl ? "-100%" : "100%";

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Home layer — always rendered underneath. Slides + dims when a
          subpage is open, and parallaxes during the back drag. */}
      <motion.div
        initial={false}
        animate={{
          x: hasSubpage ? (rtl ? "30%" : "-30%") : 0,
          opacity: hasSubpage ? 0.6 : 1,
          scale: hasSubpage ? 0.96 : 1,
        }}
        style={hasSubpage ? { x: homeParallaxX } : undefined}
        transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.8 }}
        className={cn("absolute inset-0 overflow-y-auto", homeClassName)}
      >
        {home}
      </motion.div>

      {/* Subpage overlay — slides in from the inline-end side, draggable
          to dismiss. */}
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
