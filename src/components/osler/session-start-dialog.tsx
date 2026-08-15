"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpDown,
  BookOpen,
  ClipboardCheck,
  Clock,
  Flag,
  Layers,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  Timer,
  NotebookPen,
  type LucideIcon,
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
import type { OnlyMode } from "@/lib/osler/qbank-pool";
import type { AnyContent, ContentTreeNode } from "@/lib/osler/types";
import type {
  SessionMode,
  SessionOrder,
  SessionStartOptions,
} from "@/lib/osler/session-options";
import { sessions, storage } from "@/lib/osler/storage";
import { haptic } from "@/lib/osler/native";
import { easeOut, staggerContainer, fadeUp } from "@/lib/osler/motion";
import { useI18n } from "./i18n-provider";
import {
  MetricBar,
  Pill,
  SectionLabel,
  SelectableCard,
  SectionList,
  SectionItem,
} from "./ui-primitives";

interface SessionStartDialogProps {
  open: boolean;
  item: ContentTreeNode;
  content: AnyContent;
  mode: SessionMode;
  onModeChange: (mode: SessionMode) => void;
  onlyMode: OnlyMode;
  onOnlyModeChange: (mode: OnlyMode) => void;
  onStart: (options: SessionStartOptions) => void;
  onMoreOptions?: () => void;
  onClose: () => void;
}

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5 rounded-lg bg-muted/40 px-2.5 py-2">
      <div className="text-base font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
    </div>
  );
}

const ONLY_MODE_OPTIONS: Array<{ id: OnlyMode; icon: LucideIcon; labelKey: string }> = [
  { id: "all", icon: Layers, labelKey: "qbank.create.onlyAll" },
  { id: "new", icon: Sparkles, labelKey: "qbank.create.onlyNew" },
  { id: "wrong", icon: RotateCcw, labelKey: "qbank.create.onlyWrong" },
  { id: "flagged", icon: Flag, labelKey: "qbank.create.onlyFlagged" },
];

export function SessionStartDialog({
  open,
  item,
  content,
  mode,
  onModeChange,
  onlyMode,
  onOnlyModeChange,
  onStart,
  onMoreOptions,
  onClose,
}: SessionStartDialogProps) {
  const { t } = useI18n();
  const isBank = content.type === "bank" || content.type === "written";
  const totalQuestions = countQuestions(content);
  const passageCount = content.type === "bank" ? content.passages?.length ?? 0 : 0;
  const progress = storageProgress(item.uid, totalQuestions);
  const description = content.meta.description?.startsWith("Content pack:")
    ? t("qbank.launch.subtitle", { title: item.title })
    : content.meta.description ?? t("qbank.launch.subtitle", { title: item.title });
  const strategy = isBank ? "split" : "single";
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
      onlyMode,
      timerMinutes: mode === "timed" ? Math.max(1, Math.min(720, timerMinutes || 1)) : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="flex max-h-[min(920px,calc(100dvh-1.5rem))] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={easeOut}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Scrollable body — stagger-animated so each section fades + lifts in sequence */}
          <SectionList className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6 space-y-4">

            {/* Header */}
            <SectionItem>
              <DialogHeader className="text-start">
                <div className="mb-2 flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                    {content.type === "written" ? <NotebookPen className="size-5" /> : isBank ? <BookOpen className="size-5" /> : <ClipboardCheck className="size-5" />}
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-lg font-bold tracking-tight sm:text-xl">{item.title}</DialogTitle>
                    <DialogDescription className="mt-0.5 text-xs leading-relaxed sm:text-sm">
                      {description}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
            </SectionItem>

            {/* Stats row */}
            {isBank && (
              <SectionItem>
                <div className="flex gap-2.5">
                  <StatPill label={t("qbank.launch.questions")} value={totalQuestions} />
                  <StatPill label={t("qbank.launch.passages")} value={passageCount} />
                  <StatPill label={t("qbank.launch.covered")} value={`${progress.covered}/${totalQuestions}`} />
                  <StatPill label={t("qbank.launch.sessions")} value={progress.sessions} />
                </div>
              </SectionItem>
            )}

            {/* Coverage bar */}
            {isBank && totalQuestions > 0 && (
              <SectionItem>
                <div className="rounded-xl border border-border bg-muted/20 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-foreground">{t("qbank.launch.coverage")}</span>
                    <span className="tabular-nums text-muted-foreground">{progress.coverage}%</span>
                  </div>
                  <MetricBar value={progress.coverage} label={t("qbank.launch.coverage")} className="mt-2" />
                </div>
              </SectionItem>
            )}

            {/* Mode picker */}
            <SectionItem>
              <div>
                <SectionLabel icon={Sparkles}>{t("qbank.launch.modeTitle")}</SectionLabel>
                <div className="grid grid-cols-2 gap-2.5">
                  <SelectableCard
                    active={mode === "tutor"}
                    icon={Sparkles}
                    label={t("qbank.launch.tutor")}
                    description={t("qbank.launch.tutorDesc")}
                    onClick={() => handleModeChange("tutor")}
                  />
                  <SelectableCard
                    active={mode === "timed"}
                    icon={Timer}
                    label={t("qbank.launch.exam")}
                    description={t("qbank.launch.examDesc")}
                    onClick={() => handleModeChange("timed")}
                  />
                </div>
                <AnimatePresence>
                  {mode === "timed" && (
                    <motion.div
                      key="timer-row"
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: "auto", marginTop: 8 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.2, ease: easeOut.ease }}
                      className="overflow-hidden"
                    >
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
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
                          className="ms-auto h-7 w-16 rounded-md border border-border bg-card text-center text-sm font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        />
                        <span className="text-xs text-muted-foreground">{t("qbank.launch.minutes")}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </SectionItem>

            {/* Filter by progress — bank packs only */}
            {isBank && (
              <SectionItem>
                <div>
                  <SectionLabel icon={Flag}>{t("qbank.create.onlyMode")}</SectionLabel>
                  <div className="flex flex-wrap gap-2">
                    {ONLY_MODE_OPTIONS.map((opt) => (
                      <Pill
                        key={opt.id}
                        active={onlyMode === opt.id}
                        icon={opt.icon}
                        onClick={() => { haptic("selection"); onOnlyModeChange(opt.id); }}
                      >
                        {t(opt.labelKey as Parameters<typeof t>[0])}
                      </Pill>
                    ))}
                  </div>
                </div>
              </SectionItem>
            )}

            {/* Session size / question count — bank packs only */}
            {isBank && (
              <SectionItem>
                <div>
                  <SectionLabel icon={Layers}>{t("qbank.create.countStepper")}</SectionLabel>
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
                    {/* Questions count stepper */}
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs font-medium text-foreground">{t("qbank.launch.questions")}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="iconSm"
                          onClick={() => { haptic("light"); adjustCount(-5); }}
                          aria-label={t("qbank.launch.decreaseQuestions")}
                        >
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
                          className="h-7 w-14 rounded-md border border-border bg-card text-center text-sm font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="iconSm"
                          onClick={() => { haptic("light"); adjustCount(5); }}
                          aria-label={t("qbank.launch.increaseQuestions")}
                        >
                          <Plus className="size-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Question order toggle */}
                    <div className="flex items-center gap-2 ms-auto sm:ms-0">
                      <ArrowUpDown className="size-3.5 text-primary shrink-0" />
                      <span className="text-xs font-medium text-foreground">{t("qbank.launch.order")}</span>
                      <div className="flex overflow-hidden rounded-lg border border-border bg-card">
                        <button
                          type="button"
                          onClick={() => { haptic("selection"); setOrder("sequential"); }}
                          className={cn(
                            "px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none",
                            order === "sequential" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {t("qbank.launch.sequential")}
                        </button>
                        <button
                          type="button"
                          onClick={() => { haptic("selection"); setOrder("random"); }}
                          className={cn(
                            "border-s border-border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none",
                            order === "random" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {t("qbank.launch.random")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </SectionItem>
            )}
          </SectionList>

          {/* Footer — compact padding */}
          <DialogFooter className="shrink-0 border-t border-border/80 bg-card px-5 py-3 sm:px-6 sm:py-3.5">
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                  {t("qbank.launch.back")}
                </Button>
                {isBank && onMoreOptions && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { haptic("selection"); onMoreOptions(); }}
                  >
                    {t("qbank.launch.moreOptions")}
                  </Button>
                )}
              </div>
              <Button type="button" onClick={handleStart} disabled={totalQuestions === 0}>
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
