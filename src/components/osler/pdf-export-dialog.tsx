"use client";

import * as React from "react";
import {
  Download,
  FileText,
  Settings2,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useI18n } from "./i18n-provider";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/osler/native";
import type { PdfPageConfig, PdfLang } from "@/lib/osler/pdf";
import { loadUiLang } from "@/lib/osler/i18n";

export interface PdfExportOptions {
  title: string;
  subtitle?: string;
  author: string;
  includeCover: boolean;
  page: PdfPageConfig;
  styleMode: "standard" | "compact" | "mcqnotes";
  answersMode: "inline" | "endchapter" | "endbook" | "none";
  showExplanations: boolean;
  twoCol: boolean;
  showScoreSummary?: boolean;
  showReview?: boolean;
  fontSize?: "small" | "medium" | "large";
  fontType?: "serif" | "sans";
  lang?: PdfLang;
}

interface PdfExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTitle: string;
  defaultSubtitle?: string;
  /** Controls which option groups make sense for the document being exported:
   *  - quiz: answers mode + two-column (question booklets)
   *  - results: score summary + question review toggles
   *  - dashboard: stats report only
   *  - article: typography only (no question-specific options) */
  variant?: "quiz" | "results" | "dashboard" | "article";
  defaultAuthor?: string;
  onExport: (options: PdfExportOptions) => void | Promise<void>;
}

const STYLE_MODES = ["standard", "compact", "mcqnotes"] as const;
const ANSWER_MODES = ["inline", "endchapter", "endbook", "none"] as const;
const PAGE_SIZES = ["a4", "a3", "a5", "letter"] as const;

/** Shared pill row — one canonical recipe for the option pills. */
function PillRow<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; className?: string }>;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => {
            if (opt.value === value) return;
            haptic("selection");
            onChange(opt.value);
          }}
          className={cn(
            "px-3 h-7 rounded-full text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted/60 text-muted-foreground hover:text-foreground",
            opt.className,
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function PdfExportDialog({
  open,
  onOpenChange,
  defaultTitle,
  defaultSubtitle,
  variant = "quiz",
  defaultAuthor,
  onExport,
}: PdfExportDialogProps) {
  const { t } = useI18n();
  const [title, setTitle] = React.useState(defaultTitle);
  const [subtitle, setSubtitle] = React.useState(defaultSubtitle ?? "");
  const [author, setAuthor] = React.useState(defaultAuthor ?? "Osler");
  const [includeCover, setIncludeCover] = React.useState(true);
  const [pageSize, setPageSize] = React.useState<"a4" | "a3" | "a5" | "letter">("a4");
  const [orientation, setOrientation] = React.useState<"portrait" | "landscape">("portrait");
  const [styleMode, setStyleMode] = React.useState<"standard" | "compact" | "mcqnotes">("standard");
  const [answersMode, setAnswersMode] = React.useState<PdfExportOptions["answersMode"]>("endbook");
  const [showExplanations, setShowExplanations] = React.useState(true);
  const [twoCol, setTwoCol] = React.useState(false);
  const [showScoreSummary, setShowScoreSummary] = React.useState(true);
  const [showReview, setShowReview] = React.useState(true);
  const [fontSize, setFontSize] = React.useState<"small" | "medium" | "large">("medium");
  const [fontType, setFontType] = React.useState<"serif" | "sans">("serif");
  const [exporting, setExporting] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setSubtitle(defaultSubtitle ?? "");
    }
  }, [open, defaultTitle, defaultSubtitle]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await onExport({
        title,
        subtitle: subtitle || undefined,
        author,
        includeCover,
        page: { pageSize, orientation },
        styleMode,
        answersMode,
        showExplanations,
        twoCol,
        showScoreSummary,
        showReview,
        fontSize,
        fontType,
        lang: loadUiLang(),
      });
      // Success feedback lives here — the old pre-export haptic fired even
      // when generation threw.
      haptic("success");
      onOpenChange(false);
    } catch (err) {
      haptic("error");
      // Keep the dialog open with the user's configured options intact.
      console.error("[osler/pdf] export failed:", err);
      throw err; // caller owns the user-facing toast
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !exporting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            {t("pdf.export.title")}
          </DialogTitle>
          <DialogDescription>{t("pdf.export.desc")}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleExport();
          }}
          className="space-y-4 py-2"
        >
          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.coverTitle")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={exporting} />
          </div>

          {/* Subtitle */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.coverSubtitle")}</Label>
            <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} disabled={exporting} />
          </div>

          {/* Author */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.author")}</Label>
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} disabled={exporting} />
          </div>

          {/* Cover toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("pdf.includeCover")}</Label>
            <Switch checked={includeCover} onCheckedChange={(v) => { haptic("selection"); setIncludeCover(v); }} disabled={exporting} aria-label={t("pdf.includeCover")} />
          </div>

          {/* Style mode pills */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.styleMode")}</Label>
            <PillRow
              value={styleMode}
              onChange={setStyleMode}
              options={STYLE_MODES.map((mode) => ({
                value: mode,
                label: t(`pdf.style.${mode}` as "pdf.style.standard"),
              }))}
            />
          </div>

          {/* Answers mode (quiz only) */}
          {variant === "quiz" && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("pdf.answersMode")}</Label>
              <PillRow
                value={answersMode}
                onChange={setAnswersMode}
                options={ANSWER_MODES.map((mode) => ({
                  value: mode,
                  label:
                    mode === "endbook" ? t("pdf.answer.endbook") :
                    mode === "endchapter" ? t("pdf.answer.endchapter") :
                    mode === "inline" ? t("pdf.answer.inline") :
                    t("pdf.answer.none"),
                }))}
              />
            </div>
          )}

          {/* Advanced settings */}
          <button
            type="button"
            onClick={() => { haptic("selection"); setShowAdvanced(!showAdvanced); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings2 className="size-3.5" />
            {t("pdf.advanced")}
            {showAdvanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>

          {showAdvanced && (
            <div className="space-y-3 ps-1 border-s-2 border-border ms-1">
              {/* Page size */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("pdf.pageSize")}</Label>
                <PillRow
                  value={pageSize}
                  onChange={setPageSize}
                  options={PAGE_SIZES.map((ps) => ({
                    value: ps,
                    label: t(`pdf.pageSize.${ps}` as "pdf.pageSize.a4"),
                    className: "px-2.5 h-6 uppercase",
                  }))}
                />
              </div>

              {/* Orientation */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("pdf.orientation")}</Label>
                <PillRow
                  value={orientation}
                  onChange={setOrientation}
                  options={[
                    { value: "portrait" as const, label: t("pdf.portrait") },
                    { value: "landscape" as const, label: t("pdf.landscape") },
                  ]}
                />
              </div>

              {/* Font size option */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("pdf.fontSize")}</Label>
                <PillRow
                  value={fontSize}
                  onChange={setFontSize}
                  options={(["small", "medium", "large"] as const).map((sz) => ({
                    value: sz,
                    label: sz === "small" ? t("pdf.fontSize.small") : sz === "large" ? t("pdf.fontSize.large") : t("pdf.fontSize.medium"),
                    className: "px-2.5 h-6",
                  }))}
                />
              </div>

              {/* Font type option */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("pdf.fontType")}</Label>
                <PillRow
                  value={fontType}
                  onChange={setFontType}
                  options={[
                    { value: "serif" as const, label: t("pdf.fontType.serif") },
                    { value: "sans" as const, label: t("pdf.fontType.sans") },
                  ]}
                />
              </div>

              {/* Show explanations toggle (quiz + results only — articles have no explanations) */}
              {(variant === "quiz" || variant === "results") && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("pdf.showExplanations")}</Label>
                  <Switch checked={showExplanations} onCheckedChange={(v) => { haptic("selection"); setShowExplanations(v); }} disabled={exporting} aria-label={t("pdf.showExplanations")} />
                </div>
              )}

              {/* Two-column toggle (any question-bearing document) */}
              {(variant === "quiz" || variant === "results") && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("pdf.twoColumn")}</Label>
                  <Switch checked={twoCol} onCheckedChange={(v) => { haptic("selection"); setTwoCol(v); }} disabled={exporting} aria-label={t("pdf.twoColumn")} />
                </div>
              )}

              {/* Score summary toggle (results only) */}
              {variant === "results" && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("pdf.showScoreSummary")}</Label>
                  <Switch checked={showScoreSummary} onCheckedChange={(v) => { haptic("selection"); setShowScoreSummary(v); }} disabled={exporting} aria-label={t("pdf.showScoreSummary")} />
                </div>
              )}

              {/* Question review toggle (results only) */}
              {variant === "results" && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("pdf.showReview")}</Label>
                  <Switch checked={showReview} onCheckedChange={(v) => { haptic("selection"); setShowReview(v); }} disabled={exporting} aria-label={t("pdf.showReview")} />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={exporting} disabled={!title.trim()}>
              {!exporting && <Download className="size-4 me-1.5" />}
              {exporting ? t("pdf.generating") : t("pdf.export.button")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
