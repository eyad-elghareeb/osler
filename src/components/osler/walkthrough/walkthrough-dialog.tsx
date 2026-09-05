"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  X,
  Sparkles,
  Sliders,
  MessageSquareWarning,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { getTourSteps, type TourId } from "./walkthrough-steps";

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

interface WalkthroughDialogProps {
  tour: TourId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalkthroughDialog({
  tour,
  open,
  onOpenChange,
}: WalkthroughDialogProps) {
  const { t, rtl } = useI18n();
  const [index, setIndex] = React.useState(0);
  const [dir, setDir] = React.useState(1);

  const steps = React.useMemo(() => getTourSteps(tour), [tour]);
  const total = steps.length;
  const currentStep = steps[index] ?? steps[0];
  const isFirst = index === 0;
  const isLast = index === total - 1;

  // Reset index when opened
  React.useEffect(() => {
    if (open) {
      setIndex(0);
      setDir(1);
    }
  }, [open]);

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
      if (e.key === "ArrowRight") {
        if (rtl) handlePrev();
        else handleNext();
      } else if (e.key === "ArrowLeft") {
        if (rtl) handleNext();
        else handlePrev();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, rtl, handleNext, handlePrev]);

  // Slide animation tuned for walkthrough cards
  const slideVariants = React.useMemo(() => {
    const x = dir * (rtl ? -30 : 30);
    return {
      initial: { opacity: 0, x },
      animate: { opacity: 1, x: 0, transition: MOTION_TRANSITION.normal },
      exit: { opacity: 0, x: -x, transition: MOTION_TRANSITION.quick },
    };
  }, [dir, rtl]);

  const StepMainIcon = currentStep.mainIcon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl max-h-[90vh] overflow-hidden p-0 rounded-2xl border border-border bg-card shadow-2xl flex flex-col"
        showCloseButton={false}
      >
        {/* Top Accent Gradient Header */}
        <div className="relative border-b border-border bg-muted/30 px-6 pt-5 pb-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                <Compass className="size-3.5" />
                {t(currentStep.badgeKey)}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {t("walkthrough.step", { current: index + 1, total })}
              </span>
            </div>

            {/* Prominent Skip Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              className="text-muted-foreground hover:text-foreground text-xs h-7 px-2.5 rounded-lg"
            >
              {t("walkthrough.skip")}
              <X className="size-3.5 ms-1" />
            </Button>
          </div>

          {/* Animated Progress Bar */}
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden flex gap-1">
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

        {/* Dialog Body with Animated Step Transitions */}
        <div className="flex-1 overflow-y-auto osler-scroll px-6 py-5">
          <AnimatePresence mode="wait">
            <motion.div key={currentStep.id} {...slideVariants} className="space-y-5">
              {/* Step Title Header */}
              <div className="flex items-start gap-3.5">
                <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-sm border border-primary/20">
                  <StepMainIcon className="size-6" />
                </div>
                <div>
                  <DialogTitle className="text-lg md:text-xl font-bold tracking-tight text-foreground">
                    {t(currentStep.titleKey)}
                  </DialogTitle>
                  <DialogDescription className="text-xs md:text-sm text-muted-foreground mt-1 leading-relaxed">
                    {t(currentStep.subtitleKey)}
                  </DialogDescription>
                </div>
              </div>

              {/* Feature Cards Grid */}
              <div className="grid gap-2.5 sm:grid-cols-1">
                {currentStep.features.map((feat, fIdx) => {
                  const FeatIcon = feat.icon;
                  const isSpecialSettings = feat.isSpecial === "settings";
                  const isSpecialReport = feat.isSpecial === "report";

                  return (
                    <div
                      key={fIdx}
                      className={cn(
                        "rounded-xl border p-3.5 transition-all text-start flex items-start gap-3",
                        isSpecialSettings
                          ? "bg-primary/5 border-primary/30 shadow-xs"
                          : isSpecialReport
                          ? "bg-warning/5 border-warning/30 shadow-xs"
                          : "bg-muted/40 border-border hover:border-primary/30 hover:bg-muted/60"
                      )}
                    >
                      <div
                        className={cn(
                          "size-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                          isSpecialSettings
                            ? "bg-primary/15 text-primary"
                            : isSpecialReport
                            ? "bg-warning/15 text-warning"
                            : "bg-background text-muted-foreground border border-border"
                        )}
                      >
                        <FeatIcon className="size-4" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs md:text-sm font-semibold text-foreground leading-tight">
                            {t(feat.titleKey)}
                          </h4>
                          {feat.tag && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-background border border-border text-muted-foreground">
                              {feat.tag}
                            </span>
                          )}
                          {isSpecialSettings && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                              Settings
                            </span>
                          )}
                          {isSpecialReport && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning text-warning-foreground">
                              Support
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          {t(feat.descKey)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Special Tip Callout if Present */}
              {currentStep.tip && (
                <div
                  className={cn(
                    "rounded-xl border p-3 flex items-start gap-2.5 text-xs",
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
                  <div>
                    <span className="font-semibold block mb-0.5">
                      {t(currentStep.tip.titleKey)}
                    </span>
                    <span className="text-muted-foreground leading-relaxed">
                      {t(currentStep.tip.bodyKey)}
                    </span>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer Navigation Bar */}
        <div className="border-t border-border bg-card px-6 py-3.5 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrev}
            disabled={isFirst}
            className="h-9 px-3.5 rounded-xl gap-1.5 text-xs"
          >
            <ArrowLeft className={cn("size-3.5", rtl && "rtl-flip-x")} />
            {t("walkthrough.back")}
          </Button>

          {/* Dots Indicator */}
          <div className="hidden sm:flex items-center gap-1.5">
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
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                )}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          <Button
            size="sm"
            onClick={handleNext}
            className="h-9 px-4 rounded-xl gap-1.5 text-xs font-semibold"
          >
            {isLast ? (
              <>
                <Check className="size-3.5" />
                {t("walkthrough.finish")}
              </>
            ) : (
              <>
                {t("walkthrough.next")}
                <ArrowRight className={cn("size-3.5", rtl && "rtl-flip-x")} />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
