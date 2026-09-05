"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Lightbulb, MousePointerClick, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { MOTION_TRANSITION, MOTION_SPRING } from "@/lib/osler/motion";
import {
  getTourSteps,
  TOUR_META,
  type TourId,
  type WalkthroughStep,
} from "./walkthrough-steps";

// v2: the tour content was overhauled (settings-panel teaching, dialog
// chains, navigation buttons) — bumping the prefix replays each tour once
// for users who completed the old v1 tours.
const STORAGE_PREFIX = "osler-walkthrough-v2-";

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
  // Bumping pulseKey replays the "tap me" bounce animation on the halo
  const [pulseKey, setPulseKey] = React.useState(0);
  const [spotlightRect, setSpotlightRect] = React.useState<SpotlightRect>({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    found: false,
  });
  // Measured coach-card height — drives above/below placement decisions.
  const [cardHeight, setCardHeight] = React.useState(170);
  const cardObsRef = React.useRef<ResizeObserver | null>(null);
  const attachCard = React.useCallback((el: HTMLDivElement | null) => {
    cardObsRef.current?.disconnect();
    cardObsRef.current = null;
    if (!el) return;
    setCardHeight(el.offsetHeight || 170);
    if (typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(() => setCardHeight(el.offsetHeight || 170));
    obs.observe(el);
    cardObsRef.current = obs;
  }, []);

  const steps = React.useMemo(() => getTourSteps(tour), [tour]);
  const total = steps.length;
  const currentStep = steps[index] ?? steps[0];
  const isLast = index === total - 1;
  // Index of the last step auto-skipped via skipIfMissing — guards the
  // skip timer so each step skips at most once.
  const skippedRef = React.useRef(-1);

  React.useEffect(() => { setMounted(true); }, []);

  React.useEffect(() => {
    if (open) {
      setIndex(0);
      setPulseKey(0);
      skippedRef.current = -1;
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || !currentStep) return;
    if (currentStep.onEnterTab && onAction) onAction(currentStep.onEnterTab);
    if (currentStep.onEnterAction && onAction) onAction(currentStep.onEnterAction);
    onStepChange?.(currentStep, index);
  }, [open, index]); // step-enter side effects deliberately key on index only

  // ── Target bounding box ──────────────────────────────────────────────────
  // Responsive duplicates (e.g. desktop + mobile footers both mounted with
  // one `display:none`) share one data-walkthrough key — pick the first
  // element with a non-zero rect so the spotlight lands on what's visible.
  const pickTarget = (selector: string): HTMLElement | null => {
    try {
      const all = Array.from(document.querySelectorAll<HTMLElement>(selector));
      return (
        all.find((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }) ?? null
      );
    } catch {
      return null;
    }
  };

  const updateTargetRect = React.useCallback(() => {
    if (!open || !currentStep) return;
    const el = currentStep.targetSelector ? pickTarget(currentStep.targetSelector) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      const p = currentStep.highlightPadding ?? 8;
      const visible =
        r.top >= 0 && r.bottom <= window.innerHeight &&
        r.left >= 0 && r.right <= window.innerWidth;
      if (!visible) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setSpotlightRect({ top: Math.max(0, r.top - p), left: Math.max(0, r.left - p), width: r.width + p * 2, height: r.height + p * 2, found: true });
    } else {
      setSpotlightRect({ top: 0, left: 0, width: 0, height: 0, found: false });
    }
  }, [open, currentStep]);

  React.useEffect(() => {
    if (!open) return;
    updateTargetRect();
    const t1 = setTimeout(updateTargetRect, 60);
    const t2 = setTimeout(updateTargetRect, 250);
    const onUpdate = () => updateTargetRect();
    window.addEventListener("resize", onUpdate, { passive: true });
    window.addEventListener("scroll", onUpdate, { passive: true, capture: true });
    let obs: ResizeObserver | null = null;
    if (currentStep?.targetSelector) {
      try {
        const el = pickTarget(currentStep.targetSelector);
        if (el && typeof ResizeObserver !== "undefined") {
          obs = new ResizeObserver(onUpdate);
          obs.observe(el);
        }
      } catch { /* ignore */ }
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener("resize", onUpdate);
      window.removeEventListener("scroll", onUpdate, { capture: true });
      obs?.disconnect();
    };
  }, [open, index, currentStep, updateTargetRect]);

  // ── Advance / back ───────────────────────────────────────────────────────
  const handleNext = React.useCallback(() => {
    if (isLast) {
      markWalkthroughCompleted(tour);
      haptic("success");
      onOpenChange(false);
    } else {
      setIndex((i) => Math.min(total - 1, i + 1));
      haptic("selection");
    }
  }, [isLast, total, tour, onOpenChange]);

  const handleBack = React.useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
    haptic("selection");
  }, []);

  const handleSkip = React.useCallback(() => {
    markWalkthroughCompleted(tour);
    haptic("light");
    onOpenChange(false);
  }, [tour, onOpenChange]);

  // ── Capture-phase click listener: detect taps inside spotlight rect ───────
  // The SVG dim is pointer-events:none, so the real button underneath is
  // naturally clickable. We listen at window capture phase to detect the click
  // and call handleNext() after letting it through to the real button.
  React.useEffect(() => {
    if (!open || !spotlightRect.found) return;
    const onCapture = (e: MouseEvent) => {
      // Card controls (Back/Next) live inside their own click handling —
      // never let a card press double-fire as a spotlight advance.
      if (e.target instanceof Element && e.target.closest("[data-walkthrough-card]")) return;
      const { clientX: x, clientY: y } = e;
      const { top, left, width, height } = spotlightRect;
      const inSpot = x >= left && x <= left + width && y >= top && y <= top + height;
      if (inSpot) requestAnimationFrame(handleNext);
    };
    window.addEventListener("click", onCapture, { capture: true });
    return () => window.removeEventListener("click", onCapture, { capture: true });
  }, [open, spotlightRect, handleNext]);

  // ── skipIfMissing: conditional targets (dialog sections, desktop-only
  // toggles) vanish gracefully — re-checked at two beats (tab switches and
  // dialog animations, then slower navigation + content fetches) and a
  // still-missing target auto-advances (or finishes on last). The checks
  // clear as soon as the target appears.
  React.useEffect(() => {
    if (!open || !currentStep?.skipIfMissing || spotlightRect.found) return;
    if (skippedRef.current === index) return;
    const timers = [600, 1500].map((delay) =>
      setTimeout(() => {
        if (skippedRef.current === index) return;
        skippedRef.current = index;
        handleNext();
      }, delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [open, index, currentStep, spotlightRect.found, handleNext]);

  // ── Backdrop click: pulse the halo instead of advancing ──────────────────
  const handleBackdropClick = React.useCallback(() => {
    haptic("light");
    setPulseKey((k) => k + 1);
  }, []);

  // ── Keyboard: ←/→ step through the tour (flipped for RTL), Enter advances,
  // Escape skips. Buttons inside the card handle their own keys.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { handleSkip(); return; }
      if (e.target instanceof Element && e.target.closest("[data-walkthrough-card]")) return;
      if (e.key === (rtl ? "ArrowLeft" : "ArrowRight") || e.key === "Enter") handleNext();
      else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) handleBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, handleSkip, handleNext, handleBack, rtl]);

  // ── Card placement ───────────────────────────────────────────────────────
  const cardPosition = React.useMemo(() => {
    if (typeof window === "undefined") return { top: 0, left: 0, placement: "bottom" as const, cardWidth: 320 };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(340, vw - 32);
    const gap = 14;

    if (!spotlightRect.found) {
      return { top: Math.max(24, vh - cardHeight - 32), left: Math.max(16, (vw - cardWidth) / 2), placement: "bottom" as const, cardWidth };
    }

    const spaceBelow = vh - (spotlightRect.top + spotlightRect.height);
    const spaceAbove = spotlightRect.top;
    const verticalFit: "top" | "bottom" = spaceBelow >= cardHeight + gap || spaceBelow >= spaceAbove ? "bottom" : "top";
    const raw = currentStep.preferredPlacement;
    let placement: "top" | "bottom" | "left" | "right" = raw && raw !== "auto" ? raw : "bottom";

    // Side placements need room beside the target — degrade to vertical when
    // the card would clamp over it (narrow viewports, edge-docked targets).
    if (placement === "left" || placement === "right") {
      const spaceStart = spotlightRect.left;
      const spaceEnd = vw - (spotlightRect.left + spotlightRect.width);
      const sideFits = placement === "left" ? spaceStart >= cardWidth + gap : spaceEnd >= cardWidth + gap;
      if (!sideFits || vw < 640) placement = verticalFit;
    }

    if (placement === "bottom" && spaceBelow < cardHeight + gap && spaceAbove > spaceBelow) placement = "top";
    else if (placement === "top" && spaceAbove < cardHeight + gap && spaceBelow > spaceAbove) placement = "bottom";

    let top = 0;
    let left = 0;
    if (placement === "bottom") { top = spotlightRect.top + spotlightRect.height + gap; left = spotlightRect.left + spotlightRect.width / 2 - cardWidth / 2; }
    else if (placement === "top") { top = spotlightRect.top - cardHeight - gap; left = spotlightRect.left + spotlightRect.width / 2 - cardWidth / 2; }
    else if (placement === "right") { top = spotlightRect.top + spotlightRect.height / 2 - cardHeight / 2; left = spotlightRect.left + spotlightRect.width + gap; }
    else { top = spotlightRect.top + spotlightRect.height / 2 - cardHeight / 2; left = spotlightRect.left - cardWidth - gap; }

    return { top: Math.max(16, Math.min(vh - cardHeight - 16, top)), left: Math.max(16, Math.min(vw - cardWidth - 16, left)), placement, cardWidth };
  }, [spotlightRect, currentStep, cardHeight]);

  if (!mounted || !open) return null;

  const StepIcon = currentStep.mainIcon;
  const radius = currentStep.highlightRadius ?? 12;

  return createPortal(
    <div className="fixed inset-0 z-[9999] overflow-hidden pointer-events-none" role="dialog" aria-modal="true" aria-label={t("walkthrough.trigger")}>

      {/* ── Dim layer: 4 strips around the spotlight so the hole stays fully
          transparent (no SVG mask to misalign) and fully click-through.
          The outer container is pointer-events-none; only these strips and
          the card re-enable pointer events, so taps in the hole reach the
          real button underneath. ── */}
      {spotlightRect.found ? (
        <>
          {/* top strip */}
          <div
            className="absolute z-10 pointer-events-auto"
            style={{ top: 0, left: 0, right: 0, height: spotlightRect.top, backgroundColor: "rgba(5,12,24,0.82)" }}
            aria-hidden="true"
            onClick={handleBackdropClick}
          />
          {/* bottom strip */}
          <div
            className="absolute z-10 pointer-events-auto"
            style={{ top: spotlightRect.top + spotlightRect.height, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(5,12,24,0.82)" }}
            aria-hidden="true"
            onClick={handleBackdropClick}
          />
          {/* left strip */}
          <div
            className="absolute z-10 pointer-events-auto"
            style={{ top: spotlightRect.top, height: spotlightRect.height, left: 0, width: spotlightRect.left, backgroundColor: "rgba(5,12,24,0.82)" }}
            aria-hidden="true"
            onClick={handleBackdropClick}
          />
          {/* right strip */}
          <div
            className="absolute z-10 pointer-events-auto"
            style={{ top: spotlightRect.top, height: spotlightRect.height, left: spotlightRect.left + spotlightRect.width, right: 0, backgroundColor: "rgba(5,12,24,0.82)" }}
            aria-hidden="true"
            onClick={handleBackdropClick}
          />
        </>
      ) : (
        /* No spotlight found — full dim backdrop catches clicks */
        <div
          className="absolute inset-0 z-10 pointer-events-auto"
          style={{ backgroundColor: "rgba(5,12,24,0.82)" }}
          aria-hidden="true"
          onClick={handleBackdropClick}
        />
      )}

      {/* ── Halo ring (pointer-events:none so clicks pass through to real button) ── */}
      {spotlightRect.found && (
        <motion.div
          key={`halo-${index}`}
          initial={false}
          animate={{ top: spotlightRect.top, left: spotlightRect.left, width: spotlightRect.width, height: spotlightRect.height }}
          transition={MOTION_SPRING.snappy}
          style={{ borderRadius: radius, position: "absolute" }}
          className="z-20 pointer-events-none border-2 border-primary/90 ring-[3px] ring-primary/20"
          aria-hidden="true"
        >
          {/* Pulse beacon */}
          <motion.span
            key={`beacon-${pulseKey}`}
            className="absolute -top-1.5 -right-1.5 flex size-3"
            animate={pulseKey > 0 ? { scale: [1, 1.8, 1], opacity: [1, 0.4, 1] } : {}}
            transition={{ duration: 0.4 }}
          >
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-70" />
            <span className="relative inline-flex rounded-full size-3 bg-primary border-2 border-background" />
          </motion.span>
        </motion.div>
      )}

      {/* ── Coach mark card ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          ref={attachCard}
          data-walkthrough-card
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1, top: cardPosition.top, left: cardPosition.left, width: cardPosition.cardWidth }}
          exit={{ opacity: 0, y: -4, scale: 0.96 }}
          transition={MOTION_TRANSITION.normal}
          className="absolute z-30 pointer-events-auto rounded-xl border border-border/70 bg-card/95 backdrop-blur-sm shadow-e3 px-4 py-3 flex flex-col gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Arrow notch */}
          {spotlightRect.found && cardPosition.placement === "bottom" && (
            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 size-3 rotate-45 border-t border-l border-border/70 bg-card pointer-events-none" />
          )}
          {spotlightRect.found && cardPosition.placement === "top" && (
            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 size-3 rotate-45 border-b border-r border-border/70 bg-card pointer-events-none" />
          )}
          {spotlightRect.found && cardPosition.placement === "right" && (
            <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 size-3 rotate-45 border-b border-l border-border/70 bg-card pointer-events-none" />
          )}
          {spotlightRect.found && cardPosition.placement === "left" && (
            <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 size-3 rotate-45 border-t border-r border-border/70 bg-card pointer-events-none" />
          )}

          {/* Icon + tour badge + step count + title + skip */}
          <div className="flex items-start gap-2.5">
            <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
              <StepIcon className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <p className="text-[11px] font-semibold text-primary tracking-wide uppercase truncate">
                  {t(TOUR_META[tour].badgeKey)}
                </p>
                <Button
                  variant="ghost"
                  size="iconSm"
                  onClick={handleSkip}
                  className="text-muted-foreground hover:text-foreground -mt-0.5 -mr-1.5 shrink-0"
                  title={t("walkthrough.skip")}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              <p className="text-[11px] font-medium text-muted-foreground tabular-nums tracking-wide">
                {t("walkthrough.step", { current: index + 1, total })}
              </p>
              <h3 className="text-sm font-semibold text-foreground leading-snug mt-0.5">
                {t(currentStep.titleKey)}
              </h3>
            </div>
          </div>

          {/* Teaching lines: 1-line summary + optional deeper description */}
          <p className="text-xs text-muted-foreground leading-relaxed ps-[42px]">
            {t(currentStep.subtitleKey)}
          </p>
          {currentStep.descriptionKey && (
            <p className="text-xs text-muted-foreground/90 leading-relaxed ps-[42px]">
              {t(currentStep.descriptionKey)}
            </p>
          )}

          {/* Optional coach tip callout */}
          {currentStep.tipKey && (
            <div className="ms-[42px] rounded-lg border border-warning/25 bg-warning/10 px-2.5 py-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-warning flex items-center gap-1">
                <Lightbulb className="size-3" />
                {t("walkthrough.coachTip")}
              </p>
              <p className="text-xs text-foreground leading-relaxed mt-0.5">
                {t(currentStep.tipKey)}
              </p>
            </div>
          )}

          {/* Progress segments */}
          <div className="flex gap-1 ps-[42px]">
            {steps.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-0.5 flex-1 rounded-full transition-all duration-300",
                  i <= index ? "bg-primary" : "bg-muted-foreground/20",
                )}
              />
            ))}
          </div>

          {/* Footer nav: Back · tap hint · Next/Done */}
          <div className="flex items-center gap-2 ps-[42px]">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              disabled={index === 0}
              className="h-7 px-2 text-xs shrink-0"
            >
              <ArrowLeft className={cn("size-3.5", rtl && "rtl-flip-x")} />
              {t("walkthrough.back")}
            </Button>
            {spotlightRect.found && (
              <p className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground/80 min-w-0 truncate">
                <MousePointerClick className="size-3 shrink-0" />
                {t("walkthrough.tapToAdvance")}
              </p>
            )}
            <Button size="sm" onClick={handleNext} className="h-7 px-3 text-xs ms-auto shrink-0">
              {isLast ? t("walkthrough.finish") : t("walkthrough.next")}
              {isLast
                ? <Check className="size-3.5" />
                : <ArrowRight className={cn("size-3.5", rtl && "rtl-flip-x")} />}
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}

// Backwards-compatible alias so existing components continue to work
export { SpotlightWalkthrough as WalkthroughDialog };
