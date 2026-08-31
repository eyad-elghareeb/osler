"use client";

import * as React from "react";
import { Flag, X, ListChecks, CheckCircle2, Circle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { haptic } from "@/lib/osler/native";
import { useI18n } from "@/components/osler/i18n-provider";
import { SwipeableSheetContent } from "@/components/osler/ui-primitives";
import { Progress } from "@/components/ui/progress";
import { SessionData } from "./shared";




































































interface QuestionNavigatorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: SessionData;
  answeredCount: number;
  flaggedCount: number;
  correctCount: number;
  incorrectCount: number;
  progressPct: number;
  onJumpTo: (idx: number) => void;
  onEndTest: () => void;
  readonly?: boolean;
}

export function QuestionNavigatorSheet(p: QuestionNavigatorSheetProps) {
  const { t } = useI18n();
  const { session, readonly = false } = p;
  const total = session.questions.length;
  const unansweredCount = total - p.answeredCount;
  // Correct/incorrect is only meaningful when answers have been revealed
  // (tutor mode, or read-only review replays).
  const showOutcome = session.mode === "tutor" || readonly;

  const jump = (i: number) => {
    haptic("selection");
    p.onJumpTo(i);
    p.onOpenChange(false);
  };

  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange}>
      <SwipeableSheetContent
        onClose={() => p.onOpenChange(false)}
        className="px-0 pt-0 pb-[max(env(safe-area-inset-bottom,0px),0.75rem)] max-h-[85vh] data-[state=open]:duration-200 data-[state=closed]:duration-150"
      >
        {/* Header */}
        <SheetHeader className="px-4 pe-10 pt-2.5 pb-3 border-b border-border text-start">
          <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
            <span className="size-7 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <ListChecks className="size-4" />
            </span>
            {t("qbank.home.questionNavigator")}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {t("qbank.session.question", { n: session.current + 1, total })}
            {"  ·  "}
            {t("qbank.home.answered", { n: p.answeredCount, total })}
          </SheetDescription>
        </SheetHeader>

        {/* Live progress summary */}
        <div className="px-4 py-3 flex flex-col gap-2.5 border-b border-border bg-muted/20">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{t("qbank.home.progress")}</span>
            <span className="tabular-nums">{p.progressPct}%</span>
          </div>
          <Progress value={p.progressPct} className="h-1.5" />

          <div className="flex flex-wrap gap-1.5">
            {showOutcome ? (
              <>
                <NavigatorChip tone="success" icon={CheckCircle2} value={p.correctCount} label={t("qbank.home.correct")} />
                <NavigatorChip tone="destructive" icon={X} value={p.incorrectCount} label={t("qbank.home.incorrect")} />
              </>
            ) : (
              <NavigatorChip tone="primary" icon={CheckCircle2} value={p.answeredCount} label={t("qbank.home.answeredLabel")} />
            )}
            <NavigatorChip tone="warning" icon={Flag} value={p.flaggedCount} label={t("qbank.home.flaggedLabel")} />
            <NavigatorChip tone="muted" icon={Circle} value={unansweredCount} label={t("qbank.home.unanswered")} />
          </div>
        </div>

        {/* Question grid — NBME compact style */}
        <div className="flex-1 overflow-y-auto osler-scroll min-h-20 px-4 py-3">
          <div className="grid grid-cols-5 gap-1.5">
            {session.questions.map((_, i) => {
              const ans = session.answers[i];
              const isCurrent = i === session.current;
              const isFlagged = session.flagged[i];
              const isRevealed = session.revealed[i];
              const isCorrect = ans !== undefined && session.questions[i]?.correct === ans;
              const isIncorrect = ans !== undefined && !isCorrect;

              let cellClass = "bg-sidebar text-muted-foreground border-border hover:border-primary/40 hover:bg-sidebar-accent";
              if (isRevealed && isCorrect) cellClass = "bg-success/15 text-success border-success/30 hover:bg-success/25";
              else if (isRevealed && isIncorrect) cellClass = "bg-destructive/15 text-destructive border-destructive/30 hover:bg-destructive/25";
              else if (ans !== undefined) cellClass = "bg-primary/15 text-primary border-primary/30 hover:bg-primary/25";

              return (
                <button
                  key={i}
                  onClick={() => jump(i)}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={t("qbank.session.question", { n: i + 1, total })}
                  className={cn(
                    "relative aspect-square rounded-lg text-xs font-semibold tabular-nums border transition-all select-none active:scale-95",
                    cellClass,
                    isCurrent && "ring-2 ring-primary ring-offset-1 ring-offset-background scale-[1.06]"
                  )}
                >
                  {i + 1}
                  {isFlagged && (
                    <span className="absolute -top-1 -end-1 size-2.5 rounded-full bg-warning border-2 border-background" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Compact legend */}
          <div className="mt-3 pt-2.5 border-t border-border flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
            <LegendSwatch className="bg-sidebar border border-border" label={t("qbank.home.unanswered")} />
            {showOutcome ? (
              <>
                <LegendSwatch className="bg-success/15 border border-success/30" label={t("qbank.home.correct")} />
                <LegendSwatch className="bg-destructive/15 border border-destructive/30" label={t("qbank.home.incorrect")} />
              </>
            ) : (
              <LegendSwatch className="bg-primary/15 border border-primary/30" label={t("qbank.home.answeredLabel")} />
            )}
            <LegendSwatch className="bg-warning border-2 border-background rounded-full" label={t("qbank.session.flag")} />
            <LegendSwatch className="ring-2 ring-primary ring-offset-1 ring-offset-background rounded-md" label={t("qbank.home.current")} />
          </div>
        </div>

        {/* Footer — safe-area aware */}
        <div className="px-4 pt-3 flex items-center gap-2 border-t border-border">
          {!readonly && (
            <Button
              variant="outline"
              size="lg"
              onClick={() => { haptic("warning"); p.onEndTest(); p.onOpenChange(false); }}
              className="h-10 rounded-xl shrink-0 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            >
              {t("qbank.session.endTest")}
            </Button>
          )}
          <Button
            variant="default"
            size="lg"
            onClick={() => { haptic("light"); p.onOpenChange(false); }}
            className="flex-1 h-10 rounded-xl"
          >
            {t("qbank.home.done")}
          </Button>
        </div>
      </SwipeableSheetContent>
    </Sheet>
  );
}

function NavigatorChip({
  tone,
  icon: Icon,
  value,
  label,
}: {
  tone: "success" | "destructive" | "primary" | "warning" | "muted";
  icon: LucideIcon;
  value: number;
  label: string;
}) {
  const toneClass =
    tone === "success"
      ? "bg-success/15 text-success border-success/30"
      : tone === "destructive"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : tone === "warning"
          ? "bg-warning/15 text-warning border-warning/30"
          : tone === "primary"
            ? "bg-primary/15 text-primary border-primary/30"
            : "bg-sidebar text-muted-foreground border-border";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold tabular-nums", toneClass)}>
      <Icon className="size-3 shrink-0" />
      <span>{value}</span>
      <span className="font-medium opacity-80">{label}</span>
    </span>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-[4px] shrink-0", className)} />
      {label}
    </span>
  );
}