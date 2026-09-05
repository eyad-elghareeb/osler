"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  X,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { MOTION_TRANSITION, MOTION_SPRING } from "@/lib/osler/motion";
import {
  getTourSteps,
  type TourId,
  type WalkthroughStep,
} from "./walkthrough-steps";

const STORAGE_PREFIX = "osler-walkthrough-completed-";

export function isWalkthroughCompleted(tour: TourId): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${tour}`) === "1";
  } catch {
    return true;
  }
}

export function markWalkthroughCompleted(tour: TourId): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${tour}`, "1");
  } catch {
    // Ignore storage errors in private browsing
  }
}

export function clearWalkthroughCompleted(tour: TourId): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${tour}`);
  } catch {
    // Ignore
  }
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  found: boolean;
}

export interface SpotlightWalkthroughProps {
  tour: TourId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStepChange?: (step: WalkthroughStep, index: number) => void;
  onAction?: (actionKey: string) => void;
}

export function SpotlightWalkthrough({
  tour,
  open,
  onOpenChange,
  onStepChange,
  onAction,
}: SpotlightWalkthroughProps) {
  const { t, rtl } = useI18n();
  const [mounted, setMounted] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const [dir, setDir] = React.useState(1);
  const [spotlightRect, setSpotlightRect] = React.useState<SpotlightRect>({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    found: false,
  });

  const steps = React.useMemo(() => getTourSteps(tour), [tour]);
  const total = steps.length;
  const currentStep = steps[index] ?? steps[0];
  const isFirst = index === 0;
  const isLast = index === total - 1;

  // Mount detection for client portal
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Reset index when opened
  React.useEffect(() => {
    if (open) {
      setIndex(0);
      setDir(1);
    }
  }, [open]);

  // Handle step triggers & notify parent
  React.useEffect(() => {
    if (!open || !currentStep) return;
    if (currentStep.onEnterTab && onAction) {
      onAction(currentStep.onEnterTab);
    }
    onStepChange?.(currentStep, index);
  }, [open, index, currentStep, onAction, onStepChange]);

  // Target element bounding box resolution & auto-scroll
  const updateTargetRect = React.useCallback(() => {
    if (!open || !currentStep) return;

    const selector = currentStep.targetSelector;
    let targetEl: HTMLElement | null = null;

    if (selector) {
      try {
        targetEl = document.querySelector<HTMLElement>(selector);
      } catch {
        targetEl = null;
      }
    }

    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const padding = currentStep.highlightPadding ?? 8;
      const isVisible =
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.left >= 0 &&
        rect.right <= window.innerWidth;

      if (!isVisible) {
        targetEl.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
      }

      setSpotlightRect({
        top: Math.max(0, rect.top - padding),
        left: Math.max(0, rect.left - padding),
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
        found: true,
      });
    } else {
      // Fallback: centered spotlight or viewport center
      setSpotlightRect({
        top: Math.max(0, window.innerHeight / 2 - 120),
        left: Math.max(0, window.innerWidth / 2 - 160),
        width: 320,
        height: 240,
        found: false,
      });
    }
  }, [open, currentStep]);

  // Target element tracking with ResizeObserver, window resize, and scroll listeners
  React.useEffect(() => {
    if (!open) return;

    updateTargetRect();
    const timer1 = setTimeout(updateTargetRect, 60);
    const timer2 = setTimeout(updateTargetRect, 220);

    const onScrollOrResize = () => {
      updateTargetRect();
    };

    window.addEventListener("resize", onScrollOrResize, { passive: true });
    window.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });

    let observer: ResizeObserver | null = null;
    const selector = currentStep?.targetSelector;
    if (selector) {
      try {
        const el = document.querySelector<HTMLElement>(selector);
        if (el && typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(() => updateTargetRect());
          observer.observe(el);
        }
      } catch {
        // Ignore invalid selectors
      }
    }

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, { capture: true });
      observer?.disconnect();
    };
  }, [open, index, currentStep, updateTargetRect]);

  const handleNext = React.useCallback(() => {
    if (isLast) {
      markWalkthroughCompleted(tour);
      haptic("success");
      onOpenChange(false);
    } else {
      setDir(1);
      setIndex((i) => Math.min(total - 1, i + 1));
      haptic("selection");
    }
  }, [isLast, total, tour, onOpenChange]);

  const handlePrev = React.useCallback(() => {
    if (!isFirst) {
      setDir(-1);
      setIndex((i) => Math.max(0, i - 1));
      haptic("selection");
    }
  }, [isFirst]);

  const handleSkip = React.useCallback(() => {
    markWalkthroughCompleted(tour);
    haptic("light");
    onOpenChange(false);
  }, [tour, onOpenChange]);

  // Keyboard navigation
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleSkip();
      } else if (e.key === "ArrowRight") {
        if (rtl) handlePrev();
        else handleNext();
      } else if (e.key === "ArrowLeft") {
        if (rtl) handleNext();
        else handlePrev();
      } else if (e.key === "Enter") {
        handleNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, rtl, handleNext, handlePrev, handleSkip]);

  // Touch gesture swipe handling for mobile
  const touchStartX = React.useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchEndX - touchStartX.current;
    const threshold = 45;

    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        if (rtl) handleNext();
        else handlePrev();
      } else {
        if (rtl) handlePrev();
        else handleNext();
      }
    }
    touchStartX.current = null;
  };

  // Smart Popper Placement Calculation
  const cardPosition = React.useMemo(() => {
    if (typeof window === "undefined") return { top: 0, left: 0, placement: "bottom", cardWidth: 380 };

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(420, vw - 32);
    const cardHeight = 360;
    const gap = 16;
    const isMobile = vw < 640;

    if (!spotlightRect.found || isMobile) {
      if (spotlightRect.found && spotlightRect.top > vh / 2) {
        return {
          top: 24,
          left: Math.max(16, (vw - cardWidth) / 2),
          placement: "top" as const,
          cardWidth,
        };
      }
      return {
        top: Math.max(24, vh - cardHeight - 24),
        left: Math.max(16, (vw - cardWidth) / 2),
        placement: "bottom" as const,
        cardWidth,
      };
    }

    const spaceBelow = vh - (spotlightRect.top + spotlightRect.height);
    const spaceAbove = spotlightRect.top;
    const spaceRight = vw - (spotlightRect.left + spotlightRect.width);
    const spaceLeft = spotlightRect.left;

    const rawPlacement = currentStep.preferredPlacement;
    let placement: "top" | "bottom" | "left" | "right" =
      rawPlacement && rawPlacement !== "auto" ? rawPlacement : "bottom";

    if (placement === "bottom" && spaceBelow < cardHeight && spaceAbove > spaceBelow) {
      placement = "top";
    } else if (placement === "top" && spaceAbove < cardHeight && spaceBelow > spaceAbove) {
      placement = "bottom";
    } else if (placement === "right" && spaceRight < cardWidth && spaceLeft > spaceRight) {
      placement = "left";
    } else if (placement === "left" && spaceLeft < cardWidth && spaceRight > spaceLeft) {
      placement = "right";
    }

    let top = 0;
    let left = 0;

    if (placement === "bottom") {
      top = spotlightRect.top + spotlightRect.height + gap;
      left = spotlightRect.left + spotlightRect.width / 2 - cardWidth / 2;
    } else if (placement === "top") {
      top = spotlightRect.top - cardHeight - gap;
      left = spotlightRect.left + spotlightRect.width / 2 - cardWidth / 2;
    } else if (placement === "right") {
      top = spotlightRect.top + spotlightRect.height / 2 - cardHeight / 2;
      left = spotlightRect.left + spotlightRect.width + gap;
    } else if (placement === "left") {
      top = spotlightRect.top + spotlightRect.height / 2 - cardHeight / 2;
      left = spotlightRect.left - cardWidth - gap;
    }

    // Viewport boundary containment
    top = Math.max(16, Math.min(vh - cardHeight - 16, top));
    left = Math.max(16, Math.min(vw - cardWidth - 16, left));

    return { top, left, placement, cardWidth };
  }, [spotlightRect, currentStep]);

  if (!mounted || !open) return null;

  const StepMainIcon = currentStep.mainIcon;
  const radius = currentStep.highlightRadius ?? 12;

  const overlayContent = (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden select-none"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      role="dialog"
      aria-modal="true"
      aria-label={t("walkthrough.trigger")}
    >
      {/* ── 1. Hardware-Accelerated SVG Cutout Mask (Dims entire screen except active UI) ── */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      >
        <defs>
          <mask id="osler-spotlight-cutout">
            {/* White fills everything (opaque mask) */}
            <rect x="0" y="0" width="100%" height="100%" fill="#ffffff" />
            {/* Black cuts out the spotlight hole with smooth transition */}
            {spotlightRect.found && (
              <rect
                x={spotlightRect.left}
                y={spotlightRect.top}
                width={spotlightRect.width}
                height={spotlightRect.height}
                rx={radius}
                ry={radius}
                fill="#000000"
                style={{
                  transition: "x 0.28s cubic-bezier(0.32, 0.72, 0, 1), y 0.28s cubic-bezier(0.32, 0.72, 0, 1), width 0.28s cubic-bezier(0.32, 0.72, 0, 1), height 0.28s cubic-bezier(0.32, 0.72, 0, 1)",
                }}
              />
            )}
          </mask>
        </defs>
        {/* Dark Dimmed Backdrop with Cutout */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(5, 12, 24, 0.78)"
          mask="url(#osler-spotlight-cutout)"
          className="backdrop-blur-[1.5px]"
        />
      </svg>

      {/* ── 2. Click-away background layer to advance / dismiss ── */}
      <div
        className="absolute inset-0 z-10 cursor-pointer"
        onClick={handleNext}
        aria-hidden="true"
      />

      {/* ── 3. Animated Spotlight Glowing Halo Ring ── */}
      {spotlightRect.found && (
        <motion.div
          layoutId="osler-spotlight-halo"
          initial={false}
          animate={{
            top: spotlightRect.top,
            left: spotlightRect.left,
            width: spotlightRect.width,
            height: spotlightRect.height,
          }}
          transition={MOTION_SPRING.snappy}
          style={{ borderRadius: radius }}
          className={cn(
            "absolute z-20 pointer-events-auto cursor-pointer",
            "border-2 border-primary ring-4 ring-primary/30",
            "shadow-[0_0_35px_rgba(var(--primary-rgb),0.55),inset_0_0_15px_rgba(var(--primary-rgb),0.2)]",
            "transition-shadow duration-300 hover:ring-primary/50"
          )}
          onClick={(e) => {
            e.stopPropagation();
            handleNext();
          }}
          title={t("walkthrough.clickToContinue")}
        >
          {/* Subtle pulsating beacon dot */}
          <span className="absolute -top-1.5 -right-1.5 flex size-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full size-3.5 bg-primary border-2 border-background" />
          </span>
        </motion.div>
      )}

      {/* ── 4. Interactive Floating Coach Mark Card ── */}
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.94, y: dir * 12 }}
        animate={{
          opacity: 1,
          scale: 1,
          y: 0,
          top: cardPosition.top,
          left: cardPosition.left,
          width: cardPosition.cardWidth,
        }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={MOTION_TRANSITION.normal}
        className={cn(
          "absolute z-30 rounded-2xl border border-border/80 bg-card shadow-2xl overflow-hidden",
          "max-h-[85vh] flex flex-col pointer-events-auto",
          "focus-visible:outline-none focus:ring-2 focus:ring-primary"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ambient Top Glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% 0%, color-mix(in oklch, var(--primary) 22%, transparent), transparent 70%)",
          }}
        />

        {/* Card Header */}
        <div className="relative z-10 px-4 sm:px-5 pt-4 pb-3 border-b border-border/60 bg-muted/30">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20 truncate">
                <Compass className="size-3.5 shrink-0" />
                <span className="truncate">{t(currentStep.badgeKey)}</span>
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                {t("walkthrough.step", { current: index + 1, total })}
              </span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              className="text-muted-foreground hover:text-foreground text-xs h-7 px-2 rounded-lg shrink-0"
              title={t("walkthrough.skip")}
            >
              <span>{t("walkthrough.skip")}</span>
              <X className="size-3.5 ms-1" />
            </Button>
          </div>

          {/* Stepped Progress Bar */}
          <div className="w-full bg-muted rounded-full h-1 overflow-hidden flex gap-1">
            {steps.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-full rounded-full transition-all duration-300 flex-1",
                  i <= index ? "bg-primary" : "bg-muted-foreground/20"
                )}
              />
            ))}
          </div>
        </div>

        {/* Card Body */}
        <div className="relative z-10 p-4 sm:p-5 overflow-y-auto osler-scroll space-y-3.5 max-h-[55vh]">
          {/* Step Title Header */}
          <div className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-xs border border-primary/20 mt-0.5">
              <StepMainIcon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base sm:text-lg font-bold tracking-tight text-foreground leading-snug">
                {t(currentStep.titleKey)}
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
                {t(currentStep.subtitleKey)}
              </p>
            </div>
          </div>

          {/* Key Feature Highlights */}
          {currentStep.features && currentStep.features.length > 0 && (
            <div className="space-y-2 pt-1">
              {currentStep.features.map((feat, fIdx) => {
                const FeatIcon = feat.icon;
                return (
                  <div
                    key={fIdx}
                    className="rounded-xl border border-border/80 bg-muted/30 p-2.5 flex items-start gap-2.5 text-xs transition-colors hover:bg-muted/50"
                  >
                    <div className="size-6 rounded-lg bg-background text-primary border border-border flex items-center justify-center shrink-0 mt-0.5">
                      <FeatIcon className="size-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground">
                          {t(feat.titleKey)}
                        </span>
                        {feat.tag && (
                          <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-primary/10 text-primary border border-primary/20">
                            {feat.tag}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground text-[11px] mt-0.5 leading-relaxed">
                        {t(feat.descKey)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pro Tip / Settings Callout */}
          {currentStep.tip && (
            <div
              className={cn(
                "rounded-xl border p-2.5 flex items-start gap-2 text-xs",
                currentStep.tip.type === "settings"
                  ? "bg-primary/5 border-primary/20 text-foreground"
                  : "bg-warning/5 border-warning/20 text-foreground"
              )}
            >
              <currentStep.tip.icon
                className={cn(
                  "size-4 shrink-0 mt-0.5",
                  currentStep.tip.type === "settings" ? "text-primary" : "text-warning"
                )}
              />
              <div className="min-w-0 flex-1">
                <span className="font-semibold block text-[11px] mb-0.5">
                  {t(currentStep.tip.titleKey)}
                </span>
                <span className="text-muted-foreground text-[11px] leading-relaxed block">
                  {t(currentStep.tip.bodyKey)}
                </span>
              </div>
            </div>
          )}

          {/* Action Hint */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80 pt-1">
            <Info className="size-3.5 text-primary shrink-0" />
            <span>{t("walkthrough.clickToContinue")}</span>
          </div>
        </div>

        {/* Card Footer Navigation */}
        <div className="relative z-10 border-t border-border/60 bg-muted/20 px-4 sm:px-5 py-3 flex items-center justify-between gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrev}
            disabled={isFirst}
            className="h-8 px-3 rounded-xl gap-1 text-xs"
          >
            <ArrowLeft className={cn("size-3.5", rtl && "rtl-flip-x")} />
            <span>{t("walkthrough.back")}</span>
          </Button>

          {/* Step Dots */}
          <div className="hidden xs:flex items-center gap-1">
            {steps.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setDir(i > index ? 1 : -1);
                  setIndex(i);
                  haptic("selection");
                }}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === index ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                )}
                aria-label={`Step ${i + 1}`}
              />
            ))}
          </div>

          <Button
            size="sm"
            onClick={handleNext}
            className="h-8 px-3.5 rounded-xl gap-1.5 text-xs font-semibold shadow-xs"
          >
            {isLast ? (
              <>
                <Check className="size-3.5" />
                <span>{t("walkthrough.finish")}</span>
              </>
            ) : (
              <>
                <span>{t("walkthrough.next")}</span>
                <ArrowRight className={cn("size-3.5", rtl && "rtl-flip-x")} />
              </>
            )}
          </Button>
        </div>
      </motion.div>
    </div>
  );

  return createPortal(overlayContent, document.body);
}

// Backwards-compatible alias so existing components continue to work
export { SpotlightWalkthrough as WalkthroughDialog };
