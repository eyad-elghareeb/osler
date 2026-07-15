"use client";

/**
 * useSwipeTabs — horizontal swipe-to-switch for a 2-tab mobile layout
 * (e.g. QBank's "Question" / "Explanation" split-mode tabs).
 *
 * WHY THIS IS SAFE TO DROP ON TOP OF A VERTICAL SWIPE/SCROLL REGION
 * ──────────────────────────────────────────────────────────────────
 * QBank's question column already owns a VERTICAL gesture (swipe up/down
 * to move to the next/prev question, via VerticalSnapGallery), and the
 * explanation column scrolls natively (vertical). This hook needs to add a
 * HORIZONTAL gesture (swipe left/right to flip tabs) in the exact same
 * screen region without stealing anything from the vertical one.
 *
 * It's built on the existing `useSwipe` primitive (see use-gestures.ts),
 * which is deliberately "polite":
 *   - It attaches its own PASSIVE pointer listeners directly to whatever
 *     element `tabSwipeRef` is put on.
 *   - It never calls `setPointerCapture`, `preventDefault`, or
 *     `stopPropagation`.
 *
 * That means `tabSwipeRef` can be placed on an ANCESTOR that wraps a
 * vertical-swipe child (like VerticalSnapGallery's own container) and the
 * two gesture recognizers simply co-exist, each reading the same bubbled
 * pointer events and independently deciding whether the drag matches their
 * own axis:
 *   - A vertical-dominant drag never satisfies this hook's horizontal
 *     axis+threshold test, so it silently never fires — the inner vertical
 *     gallery (or native scroll) handles the whole gesture on its own,
 *     completely unaffected.
 *   - A horizontal-dominant drag DOES satisfy this hook's test. Any inner
 *     vertical gallery independently recognizes the same drag as "not
 *     mine", axis-locks away from vertical, and quietly springs back to
 *     rest (a harmless no-op) — meanwhile this hook fires `onTabChange`
 *     once the horizontal distance clears `threshold`.
 *
 * Net effect: swiping sideways flips the tab; swiping up/down (or
 * scrolling the explanation text) is untouched. Disable this hook
 * entirely (see `disabled`) for any layout that doesn't have two tabs to
 * flip between — e.g. QBank's continuous mode, where the explanation is
 * already inline in the page and there's nothing to swipe to.
 *
 * Usage:
 *   const { tabSwipeRef } = useSwipeTabs({
 *     tabs: ["question", "answer"],
 *     activeTab: mobileTutorTab,
 *     onTabChange: setMobileTutorTab,
 *     rtl,
 *     disabled: !isMobile || !isSplitMode,
 *   });
 *
 *   <div ref={tabSwipeRef}>...qcol + acol...</div>
 */

import * as React from "react";
import { useSwipe } from "./use-gestures";
import { haptic } from "@/lib/osler/native";

export interface UseSwipeTabsOptions<TabId extends string> {
  /** Ordered tab ids, left-to-right in LTR reading order (e.g. ["question", "answer"]). */
  tabs: readonly TabId[];
  /** The currently active tab id. */
  activeTab: TabId;
  /** Called with the new tab id when a swipe commits. */
  onTabChange: (tab: TabId) => void;
  /** Right-to-left layout — inverts swipe directions. Default false. */
  rtl?: boolean;
  /** Disable the gesture entirely (no listeners are attached at all). */
  disabled?: boolean;
  /**
   * Minimum horizontal distance in px before a swipe commits to switching
   * tabs. Default 64 — deliberately a bit more than a casual scroll wobble.
   */
  threshold?: number;
  /**
   * Max ratio of vertical drift allowed relative to horizontal before the
   * gesture stops counting as "horizontal". Default 0.6 (horizontal must be
   * ≥ 1.66× the vertical component) — matches VerticalSnapGallery's own
   * axis-lock ratio so the two recognizers agree on what "horizontal" means.
   */
  maxDriftRatio?: number;
  /** Called on every pointermove during a potential swipe with raw dx/dy from start. */
  onSwipeProgress?: (dx: number, dy: number) => void;
  /** Called when the gesture ends without committing to a tab switch. */
  onSwipeEnd?: () => void;
}

export interface UseSwipeTabsResult {
  /** Attach to the container that wraps both tab panels. */
  tabSwipeRef: React.RefObject<HTMLDivElement | null>;
}

export function useSwipeTabs<TabId extends string>(
  options: UseSwipeTabsOptions<TabId>
): UseSwipeTabsResult {
  const {
    tabs, activeTab, onTabChange, rtl = false, disabled = false,
    threshold = 64, maxDriftRatio = 0.6,
    onSwipeProgress, onSwipeEnd,
  } = options;

  // Kept in a ref so the swipe handlers below always see the latest tab
  // list / active tab / callback without needing to re-attach listeners
  // (useSwipe only re-runs its effect when `disabled` changes).
  const stateRef = React.useRef({ tabs, activeTab, onTabChange, rtl });
  stateRef.current = { tabs, activeTab, onTabChange, rtl };

  const cbRef = React.useRef({ onSwipeProgress, onSwipeEnd });
  cbRef.current = { onSwipeProgress, onSwipeEnd };

  const goByOffset = React.useCallback((offset: 1 | -1): boolean => {
    const { tabs: t, activeTab: cur, onTabChange: change } = stateRef.current;
    const idx = t.indexOf(cur);
    if (idx === -1) return false;
    const nextIdx = idx + offset;
    // Past the first/last tab — nothing to swipe to.
    if (nextIdx < 0 || nextIdx >= t.length) return false;
    haptic("selection");
    change(t[nextIdx]);
    return true;
  }, []);

  const tabSwipeRef = useSwipe<HTMLDivElement>({
    threshold,
    maxDriftRatio,
    disabled,
    onSwipeProgress: (dx, dy) => cbRef.current.onSwipeProgress?.(dx, dy),
    onSwipeLeft: () => {
      const moved = goByOffset(stateRef.current.rtl ? -1 : 1);
      // At the edge: gesture committed but no tab to go to — spring back.
      if (!moved) cbRef.current.onSwipeEnd?.();
    },
    onSwipeRight: () => {
      const moved = goByOffset(stateRef.current.rtl ? 1 : -1);
      if (!moved) cbRef.current.onSwipeEnd?.();
    },
    onSwipeCancel: () => cbRef.current.onSwipeEnd?.(),
  });

  return { tabSwipeRef };
}
