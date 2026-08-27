"use client";

import * as React from "react";
import { BarChart3, FileText, Home, ListChecks, RotateCcw, Timer } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useCountUp } from "@/hooks/use-count-up";
import type { ContentTreeNode } from "@/lib/osler/types";
import { storage, sessions } from "@/lib/osler/storage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { generateResultsPdf, downloadPdf } from "@/lib/osler/pdf";
import { type PdfExportOptions } from "@/components/osler/pdf-export-dialog";
import { PdfExportDialog } from "@/components/osler/lazy-tools";
import { MetricBar } from "@/components/osler/ui-primitives";
import { SparkTrend } from "@/components/osler/analytics-primitives";
import { choiceLetter, SessionData, SummaryRow, formatTime, formatMs } from "./shared";
import {
  difficultyBreakdown,
  pacingData,
  questionIsCorrect,
  scoreHistory,
  topicBreakdown,
  type AccuracyBucket,
} from "./results-analytics";

/** Difficulty bucket → i18n label key. */
const DIFFICULTY_LABEL_KEY = {
  easy: "qbank.results.diffEasy",
  medium: "qbank.results.diffMedium",
  hard: "qbank.results.diffHard",
} as const;

/** One labelled accuracy bar in the performance-breakdown card. */
function AccuracyRow({ label, bucket }: { label: string; bucket: AccuracyBucket }) {
  const pct = bucket.answered > 0 ? Math.round((bucket.correct / bucket.answered) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
        <span className="font-medium truncate">{label}</span>
        <span className="text-muted-foreground tabular-nums shrink-0">
          {bucket.correct}/{bucket.answered} · {pct}%
        </span>
      </div>
      <MetricBar
        value={pct}
        color={pct >= 70 ? "success" : pct >= 50 ? "warning" : "destructive"}
        label={label}
      />
    </div>
  );
}




































































export function ResultsView({
  session,
  item,
  onGoHome,
  onRestart,
}: {
  session: SessionData;
  item: ContentTreeNode;
  onGoHome: () => void;
  onRestart: () => void;
}) {
  const { t } = useI18n();
  const [pdfDialogOpen, setPdfDialogOpen] = React.useState(false);

  // Saved-sessions feed — reactive so the score-history trend stays current.
  // The just-finished session was persisted by endSession before this view
  // mounted, so it is always the newest point of the trend.
  const [savedTick, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const unsub = sessions.subscribe(force);
    const unsubHydrated = storage.onHydrated(force);
    return () => {
      unsub();
      unsubHydrated();
    };
  }, []);

  const total = session.questions.length;
  const answeredCount = Object.keys(session.answers).filter(
    (k) => session.answers[+k] !== undefined
  ).length;
  const correctCount = session.questions.filter(
    (q, i) => session.revealed[i] && session.answers[i] === q.correct
  ).length;
  // For non-MCQ, count rubric/rating-based correct
  const nonMcqCorrect = session.questions.filter((q, i) => {
    if (q.correct >= 0) return false;
    if (!session.revealed[i]) return false;
    if (session.engine === "flashcard" && !q.rubric?.length) return session.ratings[q.id] === "easy";
    // Per-question: if the question has a rubric, use rubric-based scoring
    // (handles mixed sessions where written questions coexist with other types).
    if (q.rubric && q.rubric.length > 0) {
      const rubric = session.rubricState[q.id] ?? [];
      return rubric.filter(Boolean).length / q.rubric.length >= 0.6;
    }
    return false;
  }).length;
  const totalCorrect = correctCount + nonMcqCorrect;
  const incorrectCount = answeredCount - correctCount;
  const flaggedCount = Object.values(session.flagged).filter(Boolean).length;
  const pct = total ? Math.round((totalCorrect / total) * 100) : 0;
  const totalTimeSec = Math.floor(
    ((session.completedAt ?? Date.now()) - session.startedAt) / 1000
  );
  const avgTimeSec = answeredCount ? Math.round(totalTimeSec / answeredCount) : 0;
  const percentile = Math.min(99, Math.max(1, Math.round(pct * 0.9 + 5)));

  // Count-up animation for the two hero numbers (reduced-motion safe).
  const scoreCount = useCountUp(pct, { suffix: "%" });
  const percentileCount = useCountUp(percentile);

  // Session analytics — difficulty/topic accuracy, per-question pacing, and
  // the score history of this content across saved sessions.
  const { history, difficulty, topics, pacing } = React.useMemo(
    () => ({
      history: scoreHistory(session, sessions.list()),
      difficulty: difficultyBreakdown(session),
      topics: topicBreakdown(session),
      pacing: pacingData(session),
    }),
    [session, savedTick],
  );
  const vsPrev =
    history.previous != null && history.scores.length > 1
      ? history.scores[history.scores.length - 1] - history.previous
      : null;
  const timedPacing = pacing.filter((p) => p.ms != null);
  const maxPacingMs = timedPacing.length > 0 ? Math.max(...timedPacing.map((p) => p.ms ?? 0)) : 0;
  const slowest =
    timedPacing.length >= 2
      ? timedPacing.reduce((a, b) => ((b.ms ?? 0) > (a.ms ?? 0) ? b : a))
      : null;

  const handleExportPdf = async (opts: PdfExportOptions) => {
    try {
      const questions = session.questions.map((q) => ({
        stem: q.stem,
        choices: q.choices,
        correct: q.correct,
        explanation: q.explanation,
        modelAnswer: q.modelAnswer,
        isWritten: q.correct < 0,
        difficulty: q.difficulty,
        tags: q.tags,
        rubric: q.rubric,
      }));

      const doc = await generateResultsPdf({
        packTitle: item.title,
        mode: session.mode,
        score: {
          pct,
          correct: totalCorrect,
          total,
          answered: answeredCount,
          incorrect: incorrectCount,
          flagged: flaggedCount,
          percentile,
          totalTime: formatTime(totalTimeSec),
          avgTime: formatTime(avgTimeSec),
        },
        questions,
        userAnswers: session.answers,
        revealed: session.revealed,
        flagged: session.flagged,
        opts,
      });
      downloadPdf(doc, `${item.title} - ${t("pdf.tpl.results")}`);
      toast({ title: t("pdf.pdfReady"), description: t("pdf.pdfReadyDesc") });
    } catch (err) {
      console.error("[osler/pdf] results export failed:", err);
      toast({ title: t("pdf.exportFailed"), description: String(err), variant: "destructive" });
    }
  };

  return (
    <div className="osler-page">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">{t("qbank.home.testResults")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {item.title} · {t("qbank.home.questions", { n: total })} ·{" "}
              {session.mode === "timed" ? t("qbank.session.timedMode") : t("qbank.session.tutorMode")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPdfDialogOpen(true)} className="rounded-xl">
              <FileText className="size-4 me-1.5" /> {t("pdf.exportResults")}
            </Button>
            <Button variant="outline" onClick={onRestart} className="rounded-xl">
              <RotateCcw className="size-4 me-1.5" /> {t("qbank.home.restart")}
            </Button>
            <Button variant="outline" onClick={onGoHome} className="rounded-xl">
              <Home className="size-4 me-1.5" /> {t("qbank.home.backToQBank")}
            </Button>
          </div>
        </div>

        <div className="osler-card--default">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
            <div className="text-center lg:border-r lg:border-border lg:pr-6">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                {t("qbank.home.yourScore")}
              </div>
              <div className="flex items-baseline justify-center gap-1">
                <span
                  ref={scoreCount.ref as React.RefObject<HTMLSpanElement>}
                  className={cn(
                    "text-5xl font-bold tabular-nums",
                    pct >= 70
                      ? "text-success"
                      : pct >= 50
                      ? "text-warning"
                      : "text-destructive"
                  )}
                >
                  {scoreCount.display}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {t("qbank.home.correctOf", { correct: totalCorrect, total })}
              </div>
              {history.scores.length >= 2 && (
                <div className="mt-3 flex items-center justify-center gap-2.5 flex-wrap">
                  <SparkTrend data={history.scores} tone="auto" />
                  {vsPrev !== null && (
                    <span
                      className={cn(
                        "text-xs font-medium tabular-nums",
                        vsPrev >= 0 ? "text-success" : "text-destructive"
                      )}
                    >
                      {t("qbank.results.vsPrevious", {
                        delta: `${vsPrev >= 0 ? "+" : "\u2212"}${Math.abs(vsPrev)}%`,
                      })}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="text-center lg:border-r lg:border-border lg:pr-6">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                {t("qbank.home.percentileRank")}
              </div>
              <div className="text-5xl font-bold tabular-nums text-primary">
                <span ref={percentileCount.ref as React.RefObject<HTMLSpanElement>}>{percentileCount.display}</span>
                <span className="text-2xl font-normal text-muted-foreground">{t("qbank.home.percentileSuffix")}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {t("qbank.home.scoredHigher", { n: percentile })}
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <SummaryRow label={t("qbank.home.answeredLabel")} value={`${answeredCount}/${total}`} />
              <SummaryRow label={t("qbank.home.incorrectLabel")} value={`${incorrectCount}`} />
              <SummaryRow label={t("qbank.home.flaggedLabel")} value={`${flaggedCount}`} />
              <SummaryRow label={t("qbank.home.totalTime")} value={formatTime(totalTimeSec)} />
              <SummaryRow label={t("qbank.home.avgPerQuestion")} value={formatTime(avgTimeSec)} />
            </div>
          </div>
        </div>

        <div className="osler-card--default">
          <h3 className="text-sm font-semibold mb-3">{t("qbank.home.scoreDistribution")}</h3>
          <div className="flex h-3 rounded-full overflow-hidden bg-muted">
            <div
              className="bg-success"
              style={{ width: `${(totalCorrect / total) * 100}%` }}
            />
            <div
              className="bg-destructive"
              style={{ width: `${(incorrectCount / total) * 100}%` }}
            />
            <div
              className="bg-muted-foreground/30"
              style={{ width: `${((total - answeredCount) / total) * 100}%` }}
            />
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-success" /> {t("qbank.home.correct")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-destructive" /> {t("qbank.home.incorrect")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-muted-foreground/30" /> {t("qbank.home.unanswered")}
            </span>
          </div>
        </div>

        {difficulty.length > 0 || topics.length > 0 ? (
          <div className="osler-card--default">
            <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="size-4 text-primary" /> {t("qbank.results.performance")}
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {difficulty.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                    {t("qbank.results.byDifficulty")}
                  </h4>
                  <div className="space-y-3">
                    {difficulty.map((b) => (
                      <AccuracyRow
                        key={b.key}
                        label={t(DIFFICULTY_LABEL_KEY[b.key])}
                        bucket={b}
                      />
                    ))}
                  </div>
                </div>
              )}
              {topics.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                    {t("qbank.results.byTopic")}
                  </h4>
                  <div className="space-y-3">
                    {topics.map((b) => (
                      <AccuracyRow key={b.key} label={b.label} bucket={b} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {timedPacing.length > 0 && (
          <div className="osler-card--default">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
              <h3 className="text-base font-semibold flex items-center gap-2">
                <Timer className="size-4 text-primary" /> {t("qbank.results.pacing")}
              </h3>
              {slowest && slowest.ms != null && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("qbank.results.slowest")} · Q{slowest.index + 1} · {formatMs(slowest.ms)}
                </span>
              )}
            </div>
            <div
              className="flex items-end gap-[3px] h-16"
              role="img"
              aria-label={t("qbank.results.pacing")}
            >
              {pacing.map((p) => (
                <div
                  key={p.index}
                  title={p.ms ? `Q${p.index + 1} · ${formatMs(p.ms)}` : undefined}
                  className={cn(
                    "flex-1 rounded-t-sm min-w-[2px]",
                    p.state === "correct"
                      ? "bg-success"
                      : p.state === "wrong"
                      ? "bg-destructive"
                      : "bg-muted-foreground/20"
                  )}
                  style={{ height: `${p.ms ? Math.max(8, Math.round((p.ms / maxPacingMs) * 100)) : 4}%` }}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-success" /> {t("qbank.home.correct")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-destructive" /> {t("qbank.home.incorrect")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-muted-foreground/30" /> {t("qbank.home.unanswered")}
              </span>
            </div>
          </div>
        )}

        <div className="osler-card--default">
          <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
            <ListChecks className="size-4 text-primary" /> {t("qbank.home.questionReview")}
          </h3>
          <div className="space-y-2">
            {session.questions.map((q, i) => {
              const ans = session.answers[i];
              const submittedQ = session.revealed[i];
              const isMCQ = q.correct >= 0;
              const isCorrect = questionIsCorrect(session, q, i);
              return (
                <div
                  key={q.id}
                  className="flex items-center gap-3 p-3 rounded-md border border-border bg-card justify-between"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div
                      className={cn(
                        "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
                        isCorrect
                          ? "bg-success/15 text-success"
                          : submittedQ
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {submittedQ ? (isCorrect ? "✓" : "✗") : i + 1}
                    </div>
                    <p className="text-xs line-clamp-2 flex-1">{q.stem}</p>
                  </div>
                  {isMCQ && submittedQ && (
                    <div className="text-[11px] shrink-0 font-medium ml-2">
                      {isCorrect ? (
                        <span className="text-success">
                          {t("qbank.explanation.correctAnswer", { letter: choiceLetter(q.correct, item.lang) })}
                        </span>
                      ) : (
                        <span className="flex flex-col sm:flex-row gap-1 sm:gap-2">
                          <span className="text-destructive">
                            {t("qbank.explanation.yourAnswer", { letter: ans !== undefined ? choiceLetter(ans, item.lang) : "—" })}
                          </span>
                          <span className="text-success">
                            ({t("qbank.explanation.correctAnswer", { letter: choiceLetter(q.correct, item.lang) })})
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <PdfExportDialog
        open={pdfDialogOpen}
        onOpenChange={setPdfDialogOpen}
        defaultTitle={item.title}
        defaultSubtitle={session.mode === "timed" ? t("qbank.session.timedMode") : t("qbank.session.tutorMode")}
        variant="results"
        onExport={handleExportPdf}
      />
    </div>
  );
}