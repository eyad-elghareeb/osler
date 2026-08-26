/**
 * Session results generator — score summary, question review (with the
 * user's answers marked tutor-style), and the complete answer key.
 */
import type { jsPDF } from "jspdf";
import { PdfDoc } from "../doc";
import type { FullQuestion, QuestionDrawOpts, QuestionReviewItem, ResultsPdfConfig } from "../types";

export function generateResultsPdf(cfg: ResultsPdfConfig): jsPDF {
  const opts = cfg.opts;
  const lang = opts.lang ?? "en";
  const doc = new PdfDoc(opts.page, cfg.packTitle, opts.styleMode, opts.fontSize, opts.fontType, lang, "session");
  const L = doc.L;
  const t = doc.t;
  doc.setMeta({ title: opts.title || cfg.packTitle, author: opts.author, subject: t("pdf.meta.quizResults") });

  if (opts.includeCover) {
    doc.drawCover(
      {
        title: opts.title || cfg.packTitle,
        subtitle: opts.subtitle || `${cfg.mode === "timed" ? t("pdf.tpl.timedMode") : t("pdf.tpl.tutorMode")}  ·  ${t("pdf.tpl.questionsCount", { n: cfg.score.total })}`,
        eyebrow: t("pdf.tpl.testResults"),
        author: opts.author,
        date: doc.formatToday(),
        features: [
          t("pdf.tpl.feature.scoreAnalysis"),
          opts.answersMode === "inline"
            ? t("pdf.tpl.feature.inlineAnswers")
            : opts.answersMode === "endbook"
              ? t("pdf.tpl.feature.endbookAnswers")
              : opts.answersMode === "endchapter"
                ? t("pdf.tpl.feature.endchapterAnswers")
                : t("pdf.tpl.feature.questionReview"),
          t("pdf.tpl.feature.performanceStats"),
        ],
      },
      cfg.score.total,
      1,
    );
    doc.addBookmark(t("pdf.tpl.cover"));
    doc.newPage({ header: { label: t("pdf.tpl.questions"), section: "questions" } });
  } else {
    doc.setHeader(t("pdf.tpl.questions"), "questions");
    doc.y = L.mt;
    doc.drawChrome();
  }
  const contentStartPage = opts.includeCover ? 2 : 1;
  doc.beginFlow(opts.twoCol);
  doc.addBookmark(t("pdf.tpl.results"));

  if (opts.showScoreSummary !== false) doc.drawScoreSummary(cfg.score);
  doc.colTopY = doc.y;

  const allAnswers: Array<{ num: number; q: FullQuestion }> = [];
  const includeExplanationsInline = opts.answersMode === "inline";
  const drawOpts: QuestionDrawOpts = {
    answersMode: opts.answersMode,
    showExplanations: includeExplanationsInline ? opts.showExplanations : false,
    styleMode: opts.styleMode,
    twoCol: opts.twoCol,
  };

  cfg.questions.forEach((q, i) => {
    doc.drawQuestion(q, i + 1, { ...drawOpts, userAnswer: cfg.userAnswers[i], revealed: !!cfg.revealed[i] });
    if (opts.answersMode !== "inline" && opts.answersMode !== "none" && !q.isWritten) {
      allAnswers.push({ num: i + 1, q });
    }
  });

  if (allAnswers.length > 0 && opts.answersMode !== "inline" && opts.answersMode !== "none") {
    doc.newPage({ header: { label: t("pdf.tpl.answerKey").toUpperCase(), section: "answers" } });
    doc.addBookmark(t("pdf.tpl.answerKey"));
    doc.drawAnswerKeyBanner(t("pdf.tpl.completeAnswerKey"));
    for (const entry of allAnswers) doc.drawAnswerBlock(entry.q, entry.num, opts.showExplanations);
    // Resolve AFTER the blocks are drawn — each block records the page it
    // landed on, so every question's link can target its own answer.
    doc.resolveAnswerKeyLinks(-1);
  }

  if (opts.showReview !== false) {
    // Review rows are full-width — force single-column flow for this section.
    doc.newPage({ header: { label: t("pdf.tpl.questionReview").toUpperCase(), section: "questions" }, twoCol: false });
    doc.addBookmark(t("pdf.tpl.questionReview"));

    const reviewItems: QuestionReviewItem[] = cfg.questions.map((q, i) => {
      const ans = cfg.userAnswers[i];
      const isSubmitted = !!cfg.revealed[i];
      const isMCQ = q.correct >= 0;
      const isCorrect = isMCQ ? isSubmitted && ans === q.correct : false;
      return { num: i + 1, stem: q.stem, correct: isCorrect, unanswered: !isSubmitted };
    });
    doc.drawQuestionReview(reviewItems);
  }

  doc.finalize(contentStartPage);
  return doc.doc;
}

