"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { RotateCcw, Home, ListChecks, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useCountUp } from "@/hooks/use-count-up";
import type { ContentTreeNode } from "@/lib/osler/types";
import { sessions } from "@/lib/osler/storage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/osler/i18n-provider";
import { generateResultsPdf, downloadPdf } from "@/lib/osler/pdf";
import { type PdfExportOptions } from "@/components/osler/pdf-export-dialog";
import { PdfExportDialog } from "@/components/osler/lazy-tools";
import { choiceLetter, SessionData, SummaryRow, formatTime } from "./shared";




































































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
  const total = session.questions.length;  const answeredCount = Object.keys(session.answers).filter(
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

      const doc = generateResultsPdf({
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

        <div className="osler-card--default">
          <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
            <ListChecks className="size-4 text-primary" /> {t("qbank.home.questionReview")}
          </h3>
          <div className="space-y-2">
            {session.questions.map((q, i) => {
              const ans = session.answers[i];
              const submittedQ = session.revealed[i];
              const isMCQ = q.correct >= 0;
              const isCorrect = isMCQ
                ? submittedQ && ans === q.correct
                : session.engine === "flashcard" && !q.rubric?.length
                ? session.ratings[q.id] === "easy"
                : submittedQ &&
                  q.rubric &&
                  q.rubric.length > 0 &&
                  (session.rubricState[q.id] ?? []).filter(Boolean).length /
                    q.rubric.length >=
                    0.6;
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