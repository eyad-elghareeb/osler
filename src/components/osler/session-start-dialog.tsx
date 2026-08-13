"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowUpDown,
  BookOpen,
  ClipboardCheck,
  Clock,
  Layers,
  Minus,
  Plus,
  Sparkles,
  Timer,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { countQuestions } from "@/lib/osler/qbank-pool";
import type { AnyContent, ContentTreeNode } from "@/lib/osler/types";
import type {
  SessionMode,
  SessionOrder,
  SessionStartOptions,
  SessionStrategy,
} from "@/lib/osler/session-options";
import { sessions, storage } from "@/lib/osler/storage";
import { haptic } from "@/lib/osler/native";
import { useI18n } from "./i18n-provider";
import { MetricBar } from "./ui-primitives";

interface SessionStartDialogProps {
  open: boolean;
  item: ContentTreeNode;
  content: AnyContent;
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
  onStart: (options: SessionStartOptions) => void;
  onMoreOptions?: () => void;
  onClose: () => void;
}

function ChoiceCard({
  active,
  icon: Icon,
  label,
  description,
  onClick,
  compact = false,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-start rounded-xl border text-start transition-[border-color,background-color,box-shadow,transform] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        compact ? "min-h-0 gap-2.5 p-3" : "min-h-24 gap-3 p-4",
        active
          ? "border-primary bg-primary/5 text-foreground shadow-e1"
          : "border-border bg-card hover:border-primary/40 hover:bg-primary/[0.02] hover:shadow-e1",
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          compact ? "size-8 rounded-md" : "size-9 rounded-lg",
          active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className={cn("block font-semibold", compact ? "text-xs" : "text-sm")}>{label}</span>
        <span className={cn("block text-muted-foreground", compact ? "mt-0.5 text-[11px] leading-snug" : "mt-1 text-xs leading-relaxed")}>
          {description}
        </span>
      </span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <div className="text-sm font-semibold tabular-nums text-foreground">{value}</div>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function SessionStartDialog({
  open,
  item,
  content,
  mode,
  onModeChange,
  onStart,
  onMoreOptions,
  onClose,
}: SessionStartDialogProps) {
  const { t } = useI18n();
  const isBank = content.type === "bank";
  const totalQuestions = countQuestions(content);
  const passageCount = isBank ? content.passages?.length ?? 0 : 0;
  const progress = storageProgress(item.uid, totalQuestions);
  const description = content.meta.description?.startsWith("Content pack:")
    ? t("qbank.launch.subtitle", { title: item.title })
    : content.meta.description ?? t("qbank.launch.subtitle", { title: item.title });
  const strategy: SessionStrategy = isBank ? "split" : "single";
  const [order, setOrder] = React.useState<SessionOrder>("sequential");
  const [countInput, setCountInput] = React.useState(
    String(isBank ? Math.min(20, totalQuestions) : totalQuestions),
  );
  const [timerMinutes, setTimerMinutes] = React.useState(Math.max(1, isBank ? Math.min(20, totalQuestions) : totalQuestions));
  const timerEditedRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    setOrder("sequential");
    setCountInput(String(isBank ? Math.min(20, totalQuestions) : totalQuestions));
    timerEditedRef.current = false;
    setTimerMinutes(Math.max(1, isBank ? Math.min(20, totalQuestions) : totalQuestions));
  }, [open, isBank, totalQuestions]);

  const maxCount = Math.max(1, totalQuestions);
  const sessionCount = Math.max(1, Math.min(parseInt(countInput, 10) || 1, maxCount));
  const selectedCount = isBank ? sessionCount : maxCount;

  React.useEffect(() => {
    if (open && !timerEditedRef.current) setTimerMinutes(selectedCount);
  }, [open, selectedCount]);

  const adjustCount = (delta: number) => {
    const nextCount = Math.max(1, Math.min(maxCount, sessionCount + delta));
    setCountInput(String(nextCount));
    if (!timerEditedRef.current) setTimerMinutes(nextCount);
  };

  const handleModeChange = (next: SessionMode) => {
    haptic("selection");
    onModeChange(next);
  };

  const handleStart = () => {
    haptic("light");
    onStart({
      mode,
      strategy,
      questionCount: selectedCount,
      order,
      timerMinutes: mode === "timed" ? Math.max(1, Math.min(720, timerMinutes || 1)) : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="flex max-h-[min(720px,calc(100dvh-1.5rem))] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
            <DialogHeader className="text-start">
              <div className="mb-3 flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  {isBank ? <BookOpen className="size-5" /> : <ClipboardCheck className="size-5" />}
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-lg font-bold tracking-tight sm:text-xl">{item.title}</DialogTitle>
                  <DialogDescription className="mt-0.5 text-xs leading-relaxed sm:text-sm">
                    {description}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {isBank && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-y border-border py-2.5 sm:grid-cols-4">
                <Stat label={t("qbank.launch.questions")} value={totalQuestions} />
                <Stat label={t("qbank.launch.passages")} value={passageCount} />
                <Stat label={t("qbank.launch.covered")} value={`${progress.covered}/${totalQuestions}`} />
                <Stat label={t("qbank.launch.sessions")} value={progress.sessions} />
              </div>
            )}

            {isBank && totalQuestions > 0 && (
              <div className="mt-2.5 rounded-xl border border-border bg-muted/20 p-2.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-foreground">{t("qbank.launch.coverage")}</span>
                  <span className="tabular-nums text-muted-foreground">{progress.coverage}%</span>
                </div>
                <MetricBar value={progress.coverage} label={t("qbank.launch.coverage")} className="mt-2" />
              </div>
            )}

            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-primary" />
                {t("qbank.launch.modeTitle")}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ChoiceCard
                  active={mode === "tutor"}
                  icon={Sparkles}
                  label={t("qbank.launch.tutor")}
                  description={t("qbank.launch.tutorDesc")}
                  compact
                  onClick={() => handleModeChange("tutor")}
                />
                <ChoiceCard
                  active={mode === "timed"}
                  icon={Timer}
                  label={t("qbank.launch.exam")}
                  description={t("qbank.launch.examDesc")}
                  compact
                  onClick={() => handleModeChange("timed")}
                />
              </div>
              {mode === "timed" && (
                <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2.5 py-2">
                  <Clock className="size-3.5 shrink-0 text-primary" />
                  <label htmlFor="session-timer-minutes" className="text-xs font-medium text-foreground">
                    {t("qbank.launch.timerMinutes")}
                  </label>
                  <input
                    id="session-timer-minutes"
                    type="number"
                    min={1}
                    max={720}
                    value={timerMinutes}
                    onChange={(e) => {
                      timerEditedRef.current = true;
                      setTimerMinutes(Math.max(1, Math.min(720, parseInt(e.target.value, 10) || 1)));
                    }}
                    className="ms-auto h-7 w-16 rounded-md border border-border bg-card text-center text-sm font-semibold tabular-nums outline-none focus:ring-2 focus:ring-ring"
                  />
                  <span className="text-xs text-muted-foreground">{t("qbank.launch.minutes")}</span>
                </div>
              )}
            </div>

            {isBank && (
              <div className="mt-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Layers className="size-4 text-primary" />
                  {t("qbank.launch.sessionSize")}
                </div>
              <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{t("qbank.launch.splitSessions")}</div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {t("qbank.launch.splitSessionsDesc")}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button type="button" variant="outline" size="iconSm" onClick={() => { haptic("light"); adjustCount(-5); }} aria-label={t("qbank.launch.decreaseQuestions")}>
                        <Minus className="size-3" />
                      </Button>
                      <input
                        id="session-question-count"
                        type="number"
                        min={1}
                        max={maxCount}
                        value={countInput}
                        onChange={(event) => {
                          const value = event.target.value;
                          setCountInput(value);
                          const nextCount = parseInt(value, 10);
                          if (!timerEditedRef.current && Number.isFinite(nextCount)) {
                            setTimerMinutes(Math.max(1, Math.min(maxCount, nextCount)));
                          }
                        }}
                        aria-describedby="session-question-count-hint"
                        className="h-7 w-14 rounded-md border border-border bg-card text-center text-sm font-semibold tabular-nums outline-none focus:ring-2 focus:ring-ring"
                      />
                      <Button type="button" variant="outline" size="iconSm" onClick={() => { haptic("light"); adjustCount(5); }} aria-label={t("qbank.launch.increaseQuestions")}>
                        <Plus className="size-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2">
                    <p id="session-question-count-hint" className="text-[11px] text-muted-foreground">
                      {t("qbank.launch.questionsPerSessionHint")}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <ArrowUpDown className="size-3.5 text-primary" />
                      <span className="text-xs font-medium text-foreground">{t("qbank.launch.order")}</span>
                      <div className="flex overflow-hidden rounded-md border border-border bg-card">
                        <button
                          type="button"
                          onClick={() => { haptic("selection"); setOrder("sequential"); }}
                          className={cn("px-2 py-1 text-[11px] font-medium transition-colors", order === "sequential" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
                        >
                          {t("qbank.launch.sequential")}
                        </button>
                        <button
                          type="button"
                          onClick={() => { haptic("selection"); setOrder("random"); }}
                          className={cn("border-s border-border px-2 py-1 text-[11px] font-medium transition-colors", order === "random" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
                        >
                          {t("qbank.launch.random")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t border-border bg-card/95 px-5 py-3 safe-pb backdrop-blur-md sm:px-6">
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={onClose}>
                  {t("qbank.launch.back")}
                </Button>
                {isBank && onMoreOptions && (
                  <Button type="button" variant="outline" onClick={() => {
                    haptic("selection");
                    onMoreOptions();
                  }}>
                    {t("qbank.launch.moreOptions")}
                  </Button>
                )}
              </div>
              <Button type="button" size="lg" onClick={handleStart} disabled={totalQuestions === 0}>
                {isBank ? t("qbank.launch.startSession") : t("qbank.launch.start")}
              </Button>
            </div>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

function storageProgress(uid: string, totalQuestions: number) {
  const progress = storage.packProgress(uid);
  const covered = Math.min(totalQuestions, progress.attempted);
  const coverage = totalQuestions > 0 ? Math.round((covered / totalQuestions) * 100) : 0;
  return {
    covered,
    coverage,
    sessions: sessions.list().filter((session) => session.packUid === uid).length,
  };
}
