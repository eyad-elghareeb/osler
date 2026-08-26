/**
 * Quiz booklet generator — multi-chapter compilations with cover, linked
 * TOC, per-chapter question flows and chapter/end-book answer keys.
 */
import { hasArabic } from "@/lib/osler/arabic";
import type { jsPDF } from "jspdf";
import { C } from "../tokens";
import { lh, sp } from "../layout";
import { F, hs } from "../fonts";
import { tlabel } from "../text";
import { PdfDoc } from "../doc";
import type { FullQuestion, PdfExportConfig, QuestionDrawOpts } from "../types";

interface CompilationResult {
  doc: jsPDF;
  chapterPages: number[];
}

function renderCompilation(cfg: PdfExportConfig, knownChapterPages: number[] | null): CompilationResult {
  const lang = cfg.lang ?? "en";
  const doc = new PdfDoc(cfg.page, cfg.cover.title, cfg.styleMode, cfg.fontSize, cfg.fontType, lang, "content");
  const L = doc.L;
  const t = doc.t;
  const multiChapter = cfg.chapters.length > 1;
  const totalQ = cfg.chapters.reduce((a, ch) => a + ch.questions.length, 0);
  doc.setMeta({ title: cfg.cover.title, author: cfg.author, subject: t("pdf.meta.quizBooklet") });

  const showToc = multiChapter && cfg.includeCover;

  if (cfg.includeCover) {
    doc.drawCover(cfg.cover, totalQ, cfg.chapters.length);
    doc.addBookmark(t("pdf.tpl.cover"));
    doc.newPage({
      header: showToc ? { label: t("pdf.tpl.contents").toUpperCase(), section: "contents" } : { label: t("pdf.tpl.questions"), section: "questions" },
    });
  } else {
    doc.setHeader(t("pdf.tpl.questions"), "questions");
    doc.y = L.mt;
    doc.drawChrome();
  }
  const contentStartPage = cfg.includeCover ? 2 : 1;

  if (showToc) {
    doc.addBookmark(t("pdf.tpl.contents"));

    doc.doc.setFont(F.H, hs("bold"));
    doc.doc.setFontSize(18 * L.typeScale);
    doc.doc.setTextColor(...C.INK);
    const tocTitle = t("pdf.tpl.tableOfContents");
    const tocTitleIsAr = hasArabic(tocTitle);
    if (tocTitleIsAr) {
      doc.doc.setFont("Cairo", hs("bold"));
      doc.doc.text(tocTitle, L.ms + L.fw, doc.y, { align: "right" });
    } else {
      doc.doc.text(tocTitle, L.ms, doc.y);
    }
    doc.y += sp(4, L.density);
    doc.y = doc.doubleRule(doc.y, L.fw);
    doc.y += sp(1.5, L.density);

    cfg.chapters.forEach((ch, i) => {
      const targetPage = knownChapterPages ? knownChapterPages[i + 1] : doc.page;
      doc.drawTocEntry(i + 1, ch.title, ch.questions.length, ch.description ?? "", targetPage);
    });
    doc.newPage({ header: { label: t("pdf.tpl.questions"), section: "questions" } });
  }

  let globalQ = 0;
  const allAnswers: Array<{ num: number; q: FullQuestion }> = [];

  cfg.chapters.forEach((ch, ci) => {
    const drawOpts: QuestionDrawOpts = {
      answersMode: cfg.answersMode,
      showExplanations: cfg.answersMode === "inline" ? cfg.showExplanations : false,
      styleMode: cfg.styleMode,
      twoCol: cfg.twoCol,
      chapterIdx: ci,
    };
    if (ci > 0) {
      // Chapter openers are full-width — suspend the column flow so the
      // fresh page's chrome doesn't draw the divider through the title.
      doc.twoColEnabled = false;
      doc.newPage({ header: { label: t("pdf.tpl.questions"), section: "questions" } });
    }
    const chapterItem = doc.addBookmark(`${String(ci + 1).padStart(2, "0")}. ${ch.title}`);
    doc.drawChapterHeader(ci + 1, ch.title, ch.description ?? "", !multiChapter);
    doc.beginFlow(cfg.twoCol);

    for (const q of ch.questions) {
      globalQ++;
      doc.drawQuestion(q, globalQ, drawOpts);
      if (cfg.answersMode !== "inline" && cfg.answersMode !== "none" && !q.isWritten) {
        allAnswers.push({ num: globalQ, q });
      }
    }

    if (cfg.answersMode === "endchapter" && allAnswers.length > 0) {
      const chapterAnswers = allAnswers.splice(0);
      doc.newPage({ header: { label: t("pdf.tpl.answerKey").toUpperCase(), section: "answers" } });
      doc.addBookmark(t("pdf.tpl.answerKey"), chapterItem);
      doc.drawAnswerKeyBanner(t("pdf.tpl.chapterAnswerKey", { n: ci + 1 }));
      for (const entry of chapterAnswers) doc.drawAnswerBlock(entry.q, entry.num, cfg.showExplanations);
      // Resolve AFTER the blocks are drawn — each block records the page it
      // landed on, so every question's link can target its own answer.
      doc.resolveAnswerKeyLinks(ci);
    }
  });

  if (cfg.answersMode === "endbook" && allAnswers.length > 0) {
    doc.newPage({ header: { label: t("pdf.tpl.answerKey").toUpperCase(), section: "answers" } });
    doc.addBookmark(t("pdf.tpl.answerKey"));
    doc.drawAnswerKeyBanner(t("pdf.tpl.completeAnswerKey"));
    for (const entry of allAnswers) doc.drawAnswerBlock(entry.q, entry.num, cfg.showExplanations);
    // Resolve ALL pending links (endbook mode) once every block's page is known.
    doc.resolveAnswerKeyLinks(-1);
  }

  doc.finalize(contentStartPage);
  return { doc: doc.doc, chapterPages: doc.chapterPages };
}

/**
 * Multi-chapter quiz booklet — cover, hyperlinked & bookmarked table of
 * contents, per-chapter questions, and answer keys. Uses a silent measure
 * pass to learn real chapter page numbers before rendering final TOC links,
 * so links stay correct no matter how long each chapter runs.
 */
export function generateQuizCompilationPdf(cfg: PdfExportConfig): jsPDF {
  const multiChapter = cfg.chapters.length > 1;
  let chapterPages: number[] | null = null;
  if (multiChapter && cfg.includeCover) {
    chapterPages = renderCompilation(cfg, null).chapterPages;
  }
  return renderCompilation(cfg, chapterPages).doc;
}

