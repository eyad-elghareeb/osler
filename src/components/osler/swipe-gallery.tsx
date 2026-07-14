"use client";

/**
 * SwipeGallery — iOS Photos-style swipeable card gallery.
 *
 * Renders three cards (prev / current / next) positioned side-by-side. A
 * single `swipeX` motion value drives all three simultaneously, so as the
 * current card slides off-screen, the next card slides in from the other
 * side with a fixed offset — exactly like swiping through photos in the
 * iOS Photos app.
 *
 * Features:
 *   • Rubber-band resistance at the first/last card.
 *   • Preview cards (prev/next) are hidden (visibility: hidden) at rest and
 *     become visible the moment a swipe begins — no overlapping content.
 *   • Tap detection: `onTap` is only called if the gesture was a tap (not a
 *     swipe). This allows tap-to-flip on flashcards while preserving swipe.
 *   • RTL aware: in RTL, swipe directions and card positions are inverted.
 *   • Input guard: panning is suppressed on INPUT/TEXTAREA/contentEditable.
 *   • Configurable gap between cards for visual breathing room.
 *   • Preview cards have pointer-events disabled so only the current card
 *     is interactive.
 *
 * Usage:
 *   <SwipeGallery
 *     items={cards}
 *     currentIndex={index}
 *     onNavigateNext={nextCard}
 *     onNavigatePrev={prevCard}
 *     renderItem={(card, idx, interactive) => <CardFace card={card} />}
 *     onTap={flipCard}
 *     disabled={!isMobile}
 *     rtl={rtl}
 *     gap={16}
 *     className="aspect-[16/10]"
 *   />
 */

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useSwipeGallery } from "@/hooks/use-swipe-gallery";

export interface SwipeGalleryProps<T> {
  /** The full list of items in the gallery. */
  items: T[];
  /** Index of the currently visible item. */
  currentIndex: number;
  /** Called when the user swipes to the next item. */
  onNavigateNext: () => void;
  /** Called when the user swipes to the previous item. */
  onNavigatePrev: () => void;
  /**
   * Renders a single card. Called for the current card (interactive=true)
   * and for the prev/next preview cards (interactive=false).
   */
  renderItem: (item: T, index: number, interactive: boolean) => React.ReactNode;
  /** Called when the current card is tapped (not swiped). */
  onTap?: () => void;
  /** Disable all swipe gestures. */
  disabled?: boolean;
  /** Gap between adjacent cards in px. Default 0. */
  gap?: number;
  /** Right-to-left layout. Inverts swipe directions and card positions. */
  rtl?: boolean;
  /** Additional className for the outer container. */
  className?: string;
  /** Additional className for each card wrapper. */
  cardClassName?: string;
}

export function SwipeGallery<T>({
  items,
  currentIndex,
  onNavigateNext,
  onNavigatePrev,
  renderItem,
  onTap,
  disabled = false,
  gap = 0,
  rtl = false,
  className,
  cardClassName,
}: SwipeGalleryProps<T>) {
  const {
    swipeRef,
    swipeX,
    prevCardX,
    nextCardX,
    prevVisible,
    nextVisible,
    movedRef,
  } = useSwipeGallery({
    currentIndex,
    itemCount: items.length,
    onNavigateNext,
    onNavigatePrev,
    disabled,
    gap,
    rtl,
  });

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < items.length - 1;

  return (
    <div
      ref={swipeRef}
      onPointerDown={() => {
        movedRef.current = false;
      }}
      className={cn("relative overflow-x-clip overflow-y-visible", className)}
      style={{ touchAction: disabled ? undefined : "pan-y" }}
    >
      {/* Previous card (off-screen left, hidden at rest) */}
      {hasPrev && (
        <motion.div
          style={{
            x: prevCardX,
            visibility: prevVisible,
            pointerEvents: "none" as const,
          }}
          className={cn("absolute inset-0", cardClassName)}
          aria-hidden
        >
          {renderItem(items[currentIndex - 1], currentIndex - 1, false)}
        </motion.div>
      )}

      {/* Current card (centered, interactive) */}
      <motion.div
        style={{ x: swipeX }}
        onClick={() => {
          if (movedRef.current) {
            return; // This was a swipe, not a tap — suppress the click.
          }
          onTap?.();
        }}
        className={cn("relative", cardClassName)}
      >
        {renderItem(items[currentIndex], currentIndex, true)}
      </motion.div>

      {/* Next card (off-screen right, hidden at rest) */}
      {hasNext && (
        <motion.div
          style={{
            x: nextCardX,
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
  );
}
