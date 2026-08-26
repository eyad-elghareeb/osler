/**
 * Performance report generator — overall accuracy summary plus a
 * pack-by-pack breakdown.
 */
import { hasArabic } from "@/lib/osler/arabic";
import type { jsPDF } from "jspdf";
import { C } from "../tokens";
import { sp } from "../layout";
import { F, hs } from "../fonts";
import { makeT, tlabel, tracked, trunc } from "../text";
import { PdfDoc } from "../doc";
import type { DashboardPdfConfig } from "../types";

export function generateDashboardPdf(cfg: DashboardPdfConfig): jsPDF {
  const opts = cfg.opts;
  const lang = opts.lang ?? "en";
  const doc = new PdfDoc(opts.page, opts.title || makeT(lang)("pdf.tpl.defaultReportTitle"), opts.styleMode, opts.fontSize, opts.fontType, lang, "session");
  const L = doc.L;
  const t = doc.t;
  doc.setMeta({ title: opts.title || t("pdf.tpl.userProgress", { name: cfg.username }), author: opts.author || cfg.username, subject: t("pdf.meta.performanceReport") });

  if (opts.includeCover) {
    doc.drawCover(
      {
        title: opts.title || t("pdf.tpl.userProgress", { name: cfg.username }),
        subtitle: opts.subtitle || t("pdf.tpl.report"),
        eyebrow: t("pdf.tpl.oslerReport"),
        author: opts.author || cfg.username,
        date: doc.formatToday(),
        features: [t("pdf.tpl.feature.overallAccuracy"), t("pdf.tpl.feature.packBreakdownFeature"), t("pdf.tpl.feature.studyStats")],
        footerNote: t("pdf.tpl.preparedByOsler"),
      },
      cfg.stats.attempted,
      cfg.stats.packs,
    );
    doc.addBookmark(t("pdf.tpl.cover"));
    doc.newPage({ header: { label: t("pdf.tpl.report"), section: "report" } });
  } else {
    doc.setHeader(t("pdf.tpl.report"), "report");
    doc.y = L.mt;
    doc.drawChrome();
  }
  const contentStartPage = opts.includeCover ? 2 : 1;
  doc.addBookmark(t("pdf.tpl.report"));

  doc.drawScoreSummary({
    pct: cfg.stats.accuracy,
    correct: cfg.stats.correct,
    total: cfg.stats.attempted,
    answered: cfg.stats.attempted,
    incorrect: cfg.stats.attempted - cfg.stats.correct,
    flagged: 0,
    percentile: Math.min(99, Math.max(1, Math.round(cfg.stats.accuracy * 0.9 + 5))),
    totalTime: "—",
    avgTime: "—",
  });

  if (cfg.recentPacks.length > 0) {
    const d = doc.doc;
    const density = L.density;
    const ts = L.typeScale;
    doc.checkPage(sp(5, density));
    d.setFont(F.H, hs("bold"));
    d.setFontSize(10 * ts);
    d.setTextColor(...C.INK);
    d.text(tlabel(t("pdf.tpl.packBreakdown")), L.ms, doc.y);
    doc.y += sp(3.5, density);

    for (const pack of cfg.recentPacks) {
      doc.checkPage(sp(6, density));
      const rowY = doc.y;
      const acc = pack.attempted > 0 ? Math.round((pack.correct / pack.attempted) * 100) : 0;

      d.setFillColor(...C.PALE_BLUE);
      d.roundedRect(L.ms, rowY - 3, 22, 6.4, 1, 1, "F");
      d.setFont(F.H, hs("bold"));
      d.setFontSize(5.6 * ts);
      d.setTextColor(...C.ROYAL);
      d.text(tracked(pack.engine.toUpperCase()), L.ms + 11, rowY + 0.4, { align: "center" });

      d.setFont(F.H, hs("bold"));
      d.setFontSize(8.6 * ts);
      d.setTextColor(...C.INK);
      const titleStr = trunc(pack.title, 44);
      const titleAr = hasArabic(titleStr);
      d.setFont(titleAr ? "Cairo" : F.H, hs("bold"));
      if (titleAr) {
        d.text(titleStr, L.ms + L.fw - 27, rowY, { align: "right" });
      } else {
        d.text(titleStr, L.ms + 27, rowY);
      }
      if (pack.lastAttempt) {
        d.setFont(F.Hn, hs("normal"));
        d.setFontSize(6.6 * ts);
        d.setTextColor(...C.MUTED);
        d.text(doc.formatDate(pack.lastAttempt), L.ms + L.fw, rowY, { align: "right" });
      }

      d.setFont(F.Hn, hs("normal"));
      d.setFontSize(6.6 * ts);
      d.setTextColor(...C.MUTED);
      d.text(tlabel(`${pack.attempted} ${t("pdf.tpl.attempted")}  ·  ${pack.correct} ${t("pdf.tpl.correct")}  ·  ${acc}%`), L.ms + 27, rowY + 4.6);

      const barY = rowY + 7.4;
      const barW = L.fw - 27;
      d.setFillColor(...C.RULE_SOFT);
      d.roundedRect(L.ms + 27, barY, barW, 2.2, 1, 1, "F");
      if (pack.attempted > 0) {
        d.setFillColor(...C.ROYAL);
        d.roundedRect(L.ms + 27, barY, (pack.correct / pack.attempted) * barW, 2.2, 1, 1, "F");
      }

      doc.y = barY + sp(3.5, density);
      doc.y = doc.hRule(doc.y, L.fw, 0.2);
      doc.y += sp(0.5, density);
    }
  }

  doc.finalize(contentStartPage);
  return doc.doc;
}

