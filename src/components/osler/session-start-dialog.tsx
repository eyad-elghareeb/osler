"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowUpDown,
  BookOpen,
  ClipboardCheck,
  Layers,
  ListChecks,
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
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-24 items-start gap-3 rounded-xl border p-4 text-start transition-colors active:scale-[0.98]",
        active
          ? "border-primary bg-primary/5 text-foreground shadow-e1"
          : "border-border bg-card hover:border-primary/40 hover:bg-primary/[0.02]",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-2.5">
      <div className="text-base font-bold tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
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
  const [strategy, setStrategy] = React.useState<SessionStrategy>(
    isBank && totalQuestions > 40 ? "split" : "single",
  );
  const [order, setOrder] = React.useState<SessionOrder>("sequential");
  const [countInput, setCountInput] = React.useState(
    String(isBank && totalQuestions > 40 ? Math.min(20, totalQuestions) : totalQuestions),
  );

  React.useEffect(() => {
    if (!open) return;
    setStrategy(isBank && totalQuestions > 40 ? "split" : "single");
    setOrder("sequential");
    setCountInput(String(isBank && totalQuestions > 40 ? Math.min(20, totalQuestions) : totalQuestions));
  }, [open, isBank, totalQuestions]);

  const maxCount = Math.max(1, totalQuestions);
  const sessionCount = Math.max(1, Math.min(parseInt(countInput, 10) || 1, maxCount));
  const selectedCount = strategy === "single" ? maxCount : sessionCount;

  const adjustCount = (delta: number) => {
    setCountInput(String(Math.max(1, Math.min(maxCount, sessionCount + delta))));
  };

  const handleModeChange = (next: SessionMode) => {
    haptic("selection");
    onModeChange(next);
  };

  const handleStrategyChange = (next: SessionStrategy) => {
    haptic("selection");
    setStrategy(next);
  };

  const handleStart = () => {
    haptic("light");
    onStart({ mode, strategy, questionCount: selectedCount, order });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-h-[min(760px,calc(100dvh-2rem))] overflow-y-auto p-0 sm:max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="p-5 sm:p-6"
        >
          <DialogHeader className="text-start">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {isBank ? <BookOpen className="size-5" /> : <ClipboardCheck className="size-5" />}
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-xl font-bold tracking-tight">{item.title}</DialogTitle>
                <DialogDescription className="mt-1 text-sm leading-relaxed">
                  {content.meta.description ?? t("qbank.launch.subtitle", { title: item.title })}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t("qbank.launch.questions")} value={totalQuestions} />
            {isBank && <Stat label={t("qbank.launch.passages")} value={passageCount} />}
            <Stat label={t("qbank.launch.covered")} value={`${progress.covered}/${totalQuestions}`} />
            <Stat label={t("qbank.launch.sessions")} value={progress.sessions} />
          </div>

          {isBank && totalQuestions > 0 && (
            <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-foreground">{t("qbank.launch.coverage")}</span>
                <span className="tabular-nums text-muted-foreground">{progress.coverage}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${progress.coverage}%` }} />
              </div>
            </div>
          )}

          <div className="mt-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" />
              {t("qbank.launch.modeTitle")}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                active={mode === "tutor"}
                icon={Sparkles}
                label={t("qbank.launch.tutor")}
                description={t("qbank.launch.tutorDesc")}
                onClick={() => handleModeChange("tutor")}
              />
              <ChoiceCard
                active={mode === "timed"}
                icon={Timer}
                label={t("qbank.launch.exam")}
                description={t("qbank.launch.examDesc")}
                onClick={() => handleModeChange("timed")}
              />
            </div>
            {mode === "timed" && (
              <p className="mt-2 text-xs text-muted-foreground">{t("qbank.launch.timedHint")}</p>
            )}
          </div>

          {isBank && (
            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Layers className="size-4 text-primary" />
                {t("qbank.launch.sessionPlan")}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard
                  active={strategy === "single"}
                  icon={ListChecks}
                  label={t("qbank.launch.singleSession")}
                  description={t("qbank.launch.singleSessionDesc")}
                  onClick={() => handleStrategyChange("single")}
                />
                <ChoiceCard
                  active={strategy === "split"}
                  icon={Layers}
                  label={t("qbank.launch.splitSessions")}
                  description={t("qbank.launch.splitSessionsDesc")}
                  onClick={() => handleStrategyChange("split")}
                />
              </div>
              {strategy === "split" && (
                <div className="mt-3 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="session-question-count" className="text-sm font-medium">
                      {t("qbank.launch.questionsPerSession")}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Button type="button" variant="outline" size="iconSm" onClick={() => adjustCount(-5)} aria-label={t("qbank.launch.decreaseQuestions")}>
                        <Minus className="size-3.5" />
                      </Button>
                      <input
                        id="session-question-count"
                        type="number"
                        min={1}
                        max={maxCount}
                        value={countInput}
                        onChange={(event) => setCountInput(event.target.value)}
                        className="h-8 w-16 rounded-md border border-border bg-card text-center text-sm font-semibold tabular-nums outline-none focus:ring-2 focus:ring-ring"
                      />
                      <Button type="button" variant="outline" size="iconSm" onClick={() => adjustCount(5)} aria-label={t("qbank.launch.increaseQuestions")}>
                        <Plus className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{t("qbank.launch.questionsPerSessionHint")}</p>
                </div>
              )}
            </div>
          )}

          {isBank && (
            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <ArrowUpDown className="size-4 text-primary" />
                {t("qbank.launch.order")}
              </div>
              <div className="flex gap-2">
                {(["sequential", "random"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={order === value ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => {
                      haptic("selection");
                      setOrder(value);
                    }}
                  >
                    {value === "sequential" ? t("qbank.launch.sequential") : t("qbank.launch.random")}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="mt-7 flex-col gap-2 sm:flex-row sm:justify-between">
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
              {isBank && strategy === "split" ? t("qbank.launch.startSession") : t("qbank.launch.start")}
            </Button>
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
