"use client";

/**
 * SwipeGallery — iOS Photos-style swipeable card gallery.
 *
 * Uses framer-motion's pan gesture (onPan) on the container element, so
 * the swipe can be initiated from ANY empty space within the container —
 * not just on the card itself. This includes margins, padding, and any
 * non-interactive area in the question/flashcard content.
 *
 * Features:
 *   • Draggable from any empty space in the page (onPan on container).
 *   • Rubber-band resistance at the first/last card.
 *   • Preview cards (prev/next) are hidden at rest — no overlapping.
 *   • Tap detection: `onTap` is only called if the gesture was a tap.
 *   • RTL aware: in RTL, swipe directions and card positions are inverted.
 *   • Input guard: panning is suppressed on INPUT/TEXTAREA/contentEditable.
 *   • Configurable gap between cards for visual breathing room.
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
 *     className="w-full"
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
    containerRef,
    swipeX,
    prevCardX,
    nextCardX,
    prevVisible,
    nextVisible,
    movedRef,
    onPointerDown,
    onPanStart,
    onPan,
    onPanEnd,
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
    <motion.div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPanStart={disabled ? undefined : onPanStart}
      onPan={disabled ? undefined : onPan}
      onPanEnd={disabled ? undefined : onPanEnd}
      className={cn("relative overflow-hidden", className)}
      style={{ touchAction: disabled ? undefined : "pan-y" }}
    >
      {/* Previous card (off-screen, hidden at rest) */}
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

      {/* Next card (off-screen, hidden at rest) */}
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
    </motion.div>
  );
}
