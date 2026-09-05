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
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Calculator,
  FlaskConical,
  NotebookPen,
  Highlighter,
  FileText,
  Type,
  Printer,
  CloudDownload,
  BookmarkCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { haptic } from "@/lib/osler/native";
import { cn } from "@/lib/utils";
import { MOTION_TRANSITION } from "@/lib/osler/motion";
import { getTourSteps, type TourId, type WalkthroughStep } from "./walkthrough-steps";

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

/**
 * Step-specific interactive visual preview mini-widget
 * Gives rich visual cues for key features like settings, bug reporting,
 * peer statistics, clinical tools, and typography.
 */
function StepVisualPreview({ stepId }: { stepId: string }) {
  const { t } = useI18n();

  switch (stepId) {
    case "qbank-settings":
      return (
        <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-primary">
            <span className="flex items-center gap-1.5">
              <Sliders className="size-3.5" />
              {t("qbank.settings.title")}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 font-mono">
              {t("walkthrough.preview.live")}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex items-center justify-between p-2 rounded-lg bg-card border border-border">
              <span className="text-muted-foreground">{t("qbank.session.tutorMode")}</span>
              <span className="font-semibold text-success flex items-center gap-1">
                <Check className="size-3" /> ON
              </span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-card border border-border">
              <span className="text-muted-foreground">{t("library.fontSize")}</span>
              <span className="font-semibold font-mono text-foreground">16px</span>
            </div>
          </div>
        </div>
      );

    case "qbank-reporting":
      return (
        <div className="rounded-xl border border-warning/20 bg-warning/[0.03] p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-warning">
            <span className="flex items-center gap-1.5">
              <MessageSquareWarning className="size-3.5" />
              {t("support.title")}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/10 font-medium">
              {t("walkthrough.preview.instantSync")}
            </span>
          </div>
          <div className="p-2 rounded-lg bg-card border border-border space-y-1 text-[11px] text-muted-foreground font-mono">
            <div className="flex items-center justify-between">
              <span>{t("support.contextQuestionId")}:</span>
              <span className="text-foreground font-medium">#Q-8492</span>
            </div>
            <div className="flex items-center justify-between">
              <span>{t("support.attachContext")}:</span>
              <span className="text-success font-medium">Auto-Attached</span>
            </div>
          </div>
        </div>
      );

    case "qbank-explanations":
      return (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">{t("qbank.session.explanation")}</span>
            <span className="text-[10px] text-muted-foreground font-medium">78% {t("walkthrough.preview.peerStats")}</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="size-5 rounded bg-success/15 text-success font-semibold flex items-center justify-center text-[10px]">
                A
              </span>
              <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                <div className="bg-success h-full rounded-full" style={{ width: "78%" }} />
              </div>
              <span className="text-[11px] font-mono font-medium text-success">78%</span>
            </div>
            <div className="flex items-center gap-2 text-xs opacity-60">
              <span className="size-5 rounded bg-muted text-muted-foreground font-semibold flex items-center justify-center text-[10px]">
                B
              </span>
              <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                <div className="bg-muted-foreground/40 h-full rounded-full" style={{ width: "14%" }} />
              </div>
              <span className="text-[11px] font-mono">14%</span>
            </div>
          </div>
        </div>
      );

    case "qbank-tools":
      return (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-primary" />
            <span>{t("walkthrough.preview.tools")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-[11px] font-medium text-foreground">
              <Calculator className="size-3 text-primary" /> {t("qbank.session.calculator")}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-[11px] font-medium text-foreground">
              <FlaskConical className="size-3 text-primary" /> {t("qbank.session.labValues")}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-[11px] font-medium text-foreground">
              <NotebookPen className="size-3 text-primary" /> {t("qbank.notes.title")}
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted text-[11px] font-medium text-foreground">
              <Highlighter className="size-3 text-primary" /> {t("highlighter.toggleOff")}
            </span>
          </div>
        </div>
      );

    case "library-display":
      return (
        <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-primary">
            <span className="flex items-center gap-1.5">
              <Type className="size-3.5" />
              {t("library.display")}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 font-mono">
              {t("walkthrough.preview.customizable")}
            </span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-card border border-border text-[11px]">
            <span className="text-muted-foreground">{t("library.fontFamily")}:</span>
            <div className="flex gap-1">
              <span className="px-2 py-0.5 rounded bg-primary text-primary-foreground font-serif text-[10px]">
                {t("library.fontSerif")}
              </span>
              <span className="px-2 py-0.5 rounded bg-muted text-muted-foreground font-sans text-[10px]">
                {t("library.fontSans")}
              </span>
            </div>
          </div>
        </div>
      );

    case "library-reporting":
      return (
        <div className="rounded-xl border border-warning/20 bg-warning/[0.03] p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-warning">
            <span className="flex items-center gap-1.5">
              <MessageSquareWarning className="size-3.5" />
              {t("support.reportProblem")}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/10 font-medium">
              {t("walkthrough.preview.editorialReview")}
            </span>
          </div>
          <div className="p-2 rounded-lg bg-card border border-border text-[11px] text-muted-foreground">
            <span className="text-foreground font-medium">{t("walkthrough.preview.editorialReview")}</span>{" — "}{t("support.attachContext")}
          </div>
        </div>
      );

    case "library-offline-pdf":
      return (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <div className="text-xs font-semibold text-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <CloudDownload className="size-3.5 text-primary" />
              {t("walkthrough.preview.offlineExport")}
            </span>
            <span className="text-[10px] text-success font-medium flex items-center gap-0.5">
              <Check className="size-3" /> {t("walkthrough.preview.ready")}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded-lg bg-muted flex items-center gap-1.5 font-medium">
              <CloudDownload className="size-3.5 text-primary" /> {t("walkthrough.preview.offlineExport")}
            </div>
            <div className="p-2 rounded-lg bg-muted flex items-center gap-1.5 font-medium">
              <Printer className="size-3.5 text-primary" /> PDF
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
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

  // Touch gesture swipe handling for mobile
  const touchStartX = React.useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchEndX - touchStartX.current;
    const threshold = 45; // px

    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        // Swipe Right
        if (rtl) handleNext();
        else handlePrev();
      } else {
        // Swipe Left
        if (rtl) handlePrev();
        else handleNext();
      }
    }
    touchStartX.current = null;
  };

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

  // Directional slide variants
  const slideVariants = React.useMemo(() => {
    const x = dir * (rtl ? -28 : 28);
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
        className={cn(
          "w-[calc(100vw-1.5rem)] sm:max-w-xl max-h-[88dvh] sm:max-h-[640px] p-0 rounded-2xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden",
          "focus-visible:outline-none"
        )}
        showCloseButton={false}
      >
        {/* Top Header with ambient subtle glow */}
        <div className="relative border-b border-border bg-muted/30 px-4 sm:px-6 pt-4 pb-3 sm:pt-5 sm:pb-4 shrink-0 overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              background:
                "radial-gradient(ellipse 70% 60% at 50% 0%, color-mix(in oklch, var(--primary) 18%, transparent), transparent 70%)",
            }}
          />

          <div className="flex items-center justify-between gap-2 mb-3 relative z-10">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-semibold bg-primary/10 text-primary border border-primary/20 truncate">
                <Compass className="size-3.5 shrink-0" />
                <span className="truncate">{t(currentStep.badgeKey)}</span>
              </span>
              <span className="text-[11px] sm:text-xs text-muted-foreground tabular-nums shrink-0">
                {t("walkthrough.step", { current: index + 1, total })}
              </span>
            </div>

            {/* Prominent Skip Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              className="text-muted-foreground hover:text-foreground text-xs h-7 px-2.5 rounded-lg shrink-0"
              title={t("walkthrough.skip")}
            >
              <span>{t("walkthrough.skip")}</span>
              <X className="size-3.5 ms-1" />
            </Button>
          </div>

          {/* Animated Progress Bar */}
          <div className="w-full bg-muted/80 rounded-full h-1.5 overflow-hidden flex gap-1 relative z-10">
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

        {/* Dialog Body with Smooth Scroll & Touch Gesture Support */}
        <div
          className="flex-1 overflow-y-auto osler-scroll px-4 sm:px-6 py-4 sm:py-5 overscroll-contain"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <AnimatePresence mode="wait">
            <motion.div key={currentStep.id} {...slideVariants} className="space-y-4 sm:space-y-5">
              {/* Step Title Header */}
              <div className="flex items-start gap-3 sm:gap-3.5">
                <div className="size-10 sm:size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-sm border border-primary/20">
                  <StepMainIcon className="size-5 sm:size-6" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-base sm:text-lg md:text-xl font-bold tracking-tight text-foreground leading-snug">
                    {t(currentStep.titleKey)}
                  </DialogTitle>
                  <DialogDescription className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">
                    {t(currentStep.subtitleKey)}
                  </DialogDescription>
                </div>
              </div>

              {/* Interactive Visual Preview Mini-Widget */}
              <StepVisualPreview stepId={currentStep.id} />

              {/* Feature Cards Grid */}
              <div className="grid gap-2 sm:gap-2.5">
                {currentStep.features.map((feat, fIdx) => {
                  const FeatIcon = feat.icon;
                  const isSpecialSettings = feat.isSpecial === "settings";
                  const isSpecialReport = feat.isSpecial === "report";

                  return (
                    <div
                      key={fIdx}
                      className={cn(
                        "rounded-xl border p-3 sm:p-3.5 transition-all text-start flex items-start gap-2.5 sm:gap-3",
                        isSpecialSettings
                          ? "bg-primary/[0.04] border-primary/30 shadow-xs"
                          : isSpecialReport
                          ? "bg-warning/[0.04] border-warning/30 shadow-xs"
                          : "bg-muted/40 border-border hover:border-primary/30 hover:bg-muted/60"
                      )}
                    >
                      <div
                        className={cn(
                          "size-7 sm:size-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                          isSpecialSettings
                            ? "bg-primary/15 text-primary"
                            : isSpecialReport
                            ? "bg-warning/15 text-warning"
                            : "bg-background text-muted-foreground border border-border"
                        )}
                      >
                        <FeatIcon className="size-3.5 sm:size-4" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-xs sm:text-sm font-semibold text-foreground leading-tight">
                            {t(feat.titleKey)}
                          </h4>
                          {feat.tag && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-background border border-border text-muted-foreground">
                              {feat.tag}
                            </span>
                          )}
                          {isSpecialSettings && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                              {t("settings.title")}
                            </span>
                          )}
                          {isSpecialReport && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning text-warning-foreground">
                              {t("support.title")}
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

        {/* Footer Navigation Bar with Safe Area Support */}
        <div className="border-t border-border bg-card px-4 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between gap-2 shrink-0 safe-pb">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrev}
            disabled={isFirst}
            className="h-8 sm:h-9 px-3 sm:px-3.5 rounded-xl gap-1 text-xs"
          >
            <ArrowLeft className={cn("size-3.5", rtl && "rtl-flip-x")} />
            <span>{t("walkthrough.back")}</span>
          </Button>

          {/* Dots Indicator */}
          <div className="hidden xs:flex sm:flex items-center gap-1.5">
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
                  i === index ? "w-5 sm:w-6 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                )}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          <Button
            size="sm"
            onClick={handleNext}
            className="h-8 sm:h-9 px-3.5 sm:px-4 rounded-xl gap-1 text-xs font-semibold"
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
      </DialogContent>
    </Dialog>
  );
}
