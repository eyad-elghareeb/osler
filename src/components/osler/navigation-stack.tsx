"use client";

/**
 * NavigationStack — iOS NavigationController-style stacked pages.
 *
 * Renders a home layer that is always present underneath, with one or more
 * subpage overlays stacked on top. Each subpage slides in from the
 * inline-end side. The topmost subpage can be dragged back to dismiss
 * (calling `onBack`), revealing the subpage (or home) underneath.
 *
 * The home layer is FIXED — it does not move or parallax during the drag.
 * It only dims (opacity fade) when any subpage is open, and brightens back
 * to full opacity when all subpages are dismissed. This gives the "fixed
 * and fading in from behind" effect the user expects from iOS Settings.
 *
 * Features:
 *   • Home layer is fixed at x:0 — no horizontal movement, no parallax.
 *   • Home layer dims to 65% opacity when any subpage is open.
 *   • Subpages slide in from the right (LTR) or left (RTL) with a spring.
 *   • Supports NESTED subpages — pass an array to `subpage` to stack
 *     multiple levels (e.g. home → section → sub-section → detail).
 *     Each level slides in on top of the previous. Drag-back pops the
 *     topmost level only, revealing the one underneath.
 *   • Drag the topmost subpage to go back. dragSnapToOrigin handles
 *     snap-back when the threshold isn't met.
 *   • Velocity-aware commit: a fast flick triggers back even below the
 *     distance threshold.
 *   • Uses the shared `useSwipeBackDismiss` hook internally — the exact
 *     same drag logic as standalone overlays (AI Assistant, Lab Values,
 *     Notes Panel, Article Modal, Quiz Settings, OSCE phases), so the
 *     gesture feels identical everywhere.
 *
 * Usage (single subpage — backwards compatible):
 *   <NavigationStack
 *     home={<SettingsHomeList />}
 *     subpage={activeSection ? <SettingsSubpage section={activeSection} /> : null}
 *     onBack={goHome}
 *     rtl={rtl}
 *     className="flex-1 min-h-0"
 *   />
 *
 * Usage (nested subpages — multi-level stack):
 *   <NavigationStack
 *     home={<DecksGrid />}
 *     subpage={[
 *       activeDeck && <SubdecksView deck={activeDeck} />,
 *       activeSubdeck && <CardListView subdeck={activeSubdeck} />,
 *     ].filter(Boolean)}
 *     onBack={popOne}
 *     rtl={rtl}
 *   />
 */

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";
import { MOTION_SPRING } from "@/lib/osler/motion";

export interface NavigationStackProps {
  /** The home layer — always rendered underneath. */
  home: React.ReactNode;
  /**
   * The subpage overlay(s). Pass:
   *   • `null` / `undefined` → only home shows.
   *   • A single ReactNode → one subpage on top of home.
   *   • An array of ReactNodes → nested stack, topmost is last. Each
   *     level stacks on top of the previous; drag-back pops the topmost.
   *     Falsy entries in the array are filtered out.
   */
  subpage?: React.ReactNode | React.ReactNode[] | null;
  /**
   * Called when the user drags the topmost subpage back past the
   * threshold. The parent should update state to remove the topmost
   * subpage from the array (or set subpage to null if only one).
   */
  onBack: () => void;
  /** Right-to-left layout. Subpages enter from the left and drag-left goes back. */
  rtl?: boolean;
  /**
   * Force-disable the drag-to-dismiss gesture even when a subpage is open.
   * Used by readers while an immersive mode owns horizontal touch gestures
   * (e.g. the article highlighter — swiping to move text-selection handles
   * must never dismiss the page).
   */
  swipeDisabled?: boolean;
  /** Additional className for the outer container. */
  className?: string;
  /** Additional className for the home layer. */
  homeClassName?: string;
  /** Additional className for every subpage overlay. */
  subpageClassName?: string;
}

export function NavigationStack({
  home,
  subpage,
  onBack,
  rtl = false,
  swipeDisabled = false,
  className,
  homeClassName,
  subpageClassName,
}: NavigationStackProps) {
  // Normalize `subpage` into a flat array of non-null ReactNodes.
  // This lets callers pass a single node (backwards compatible), an
  // array of nodes (nested pages), or null/undefined (home only).
  const pages: React.ReactNode[] = React.useMemo(() => {
    if (subpage == null) return [];
    if (Array.isArray(subpage)) {
      return subpage.filter((p): p is React.ReactNode => p != null && p !== false);
    }
    if (subpage === false) return [];
    return [subpage];
  }, [subpage]);

  const hasPages = pages.length > 0;
  // Subpages enter from the right (LTR) or left (RTL).
  const enterX = rtl ? "-100%" : "100%";

  // The topmost subpage gets the drag-to-dismiss behavior. We use the
  // shared `useSwipeBackDismiss` hook — the exact same logic used by
  // standalone overlays (AI Assistant, Lab Values, etc.) — so the
  // gesture feels identical everywhere in the app.
  const dismissProps = useSwipeBackDismiss({
    onDismiss: onBack,
    direction: "horizontal",
    rtl,
    disabled: !hasPages || swipeDisabled,
  });

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Home layer — FIXED at x:0. Only opacity changes (dims when any
          subpage is open, brightens when all are dismissed). No parallax,
          no horizontal movement, no scaling. This gives the "fixed and
          fading in from behind" effect. */}
      <motion.div
        initial={false}
        animate={{ opacity: hasPages ? 0.65 : 1 }}
        transition={MOTION_SPRING.snappy}
        className={cn("absolute inset-0", homeClassName)}
      >
        {home}
      </motion.div>

      {/* Stacked subpage overlays — each slides in from the inline-end
          side. Only the topmost is draggable (gets `dismissProps`); the
          ones underneath are static layers revealed as the topmost is
          dragged away. AnimatePresence handles enter/exit for each. */}
      <AnimatePresence initial={false}>
        {pages.map((page, idx) => {
          const isTop = idx === pages.length - 1;
          return (
            <motion.div
              key={`navstack-page-${idx}`}
              initial={{ x: enterX }}
              animate={{ x: 0 }}
              exit={{ x: enterX }}
              transition={MOTION_SPRING.snappy}
              {...(isTop ? dismissProps : {})}
              className={cn(
                "absolute inset-0 bg-background shadow-e4",
                subpageClassName,
              )}
            >
              {page}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
