"use client";

import * as React from "react";
import {
  Download,
  FileText,
  Settings2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { PdfPageConfig } from "@/lib/osler/pdf";

export interface PdfExportOptions {
  title: string;
  subtitle?: string;
  author: string;
  includeCover: boolean;
  page: PdfPageConfig;
  styleMode: "standard" | "styled" | "compact" | "detailed" | "mcqnotes";
  answersMode: "inline" | "endchapter" | "endbook" | "none";
  showExplanations: boolean;
  twoCol: boolean;
  showScoreSummary?: boolean;
  showReview?: boolean;
}

interface PdfExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTitle: string;
  defaultSubtitle?: string;
  variant?: "quiz" | "results" | "dashboard";
  onExport: (options: PdfExportOptions) => void | Promise<void>;
}

const STYLE_MODES = ["standard", "styled", "compact", "detailed", "mcqnotes"] as const;
const ANSWER_MODES = ["inline", "endchapter", "endbook", "none"] as const;
const PAGE_SIZES = ["a4", "a3", "a5", "letter"] as const;

export function PdfExportDialog({
  open,
  onOpenChange,
  defaultTitle,
  defaultSubtitle,
  variant = "quiz",
  onExport,
}: PdfExportDialogProps) {
  const { t } = useI18n();
  const [title, setTitle] = React.useState(defaultTitle);
  const [subtitle, setSubtitle] = React.useState(defaultSubtitle ?? "");
  const [author, setAuthor] = React.useState("Osler");
  const [includeCover, setIncludeCover] = React.useState(true);
  const [pageSize, setPageSize] = React.useState<"a4" | "a3" | "a5" | "letter">("a4");
  const [orientation, setOrientation] = React.useState<"portrait" | "landscape">("portrait");
  const [styleMode, setStyleMode] = React.useState<"standard" | "styled" | "compact" | "detailed" | "mcqnotes">("styled");
  const [answersMode, setAnswersMode] = React.useState<PdfExportOptions["answersMode"]>("endbook");
  const [showExplanations, setShowExplanations] = React.useState(true);
  const [twoCol, setTwoCol] = React.useState(false);
  const [showScoreSummary, setShowScoreSummary] = React.useState(true);
  const [showReview, setShowReview] = React.useState(true);
  const [exporting, setExporting] = React.useState(false);
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setTitle(defaultTitle);
      setSubtitle(defaultSubtitle ?? "");
    }
  }, [open, defaultTitle, defaultSubtitle]);

  const handleExport = async () => {
    haptic("success");
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
      });
    } finally {
      setExporting(false);
      onOpenChange(false);
    }
  };

  const styleLabels: Record<string, () => string> = {
    standard: () => t("pdf.style.standard"),
    styled: () => t("pdf.style.styled"),
    compact: () => t("pdf.style.compact"),
    detailed: () => t("pdf.style.detailed"),
    mcqnotes: () => t("pdf.style.mcqnotes"),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-primary" />
            {t("pdf.export.title")}
          </DialogTitle>
          <DialogDescription>{t("pdf.export.desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.coverTitle")}</Label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm"
            />
          </div>

          {/* Subtitle */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.coverSubtitle")}</Label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm"
            />
          </div>

          {/* Author */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.author")}</Label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm"
            />
          </div>

          {/* Cover toggle */}
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t("pdf.includeCover")}</Label>
            <button
              type="button"
              onClick={() => { haptic("selection"); setIncludeCover(!includeCover); }}
              className={cn(
                "w-10 h-5.5 rounded-full transition-colors relative",
                includeCover ? "bg-primary" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4.5 rounded-full bg-white transition-transform",
                  includeCover ? "left-5" : "left-0.5"
                )}
              />
            </button>
          </div>

          {/* Style mode pills */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.styleMode")}</Label>
            <div className="flex gap-1.5 flex-wrap">
              {STYLE_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { haptic("selection"); setStyleMode(mode); }}
                  className={cn(
                    "px-3 h-7 rounded-full text-xs font-medium transition-colors",
                    styleMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {styleLabels[mode]()}
                </button>
              ))}
            </div>
          </div>

          {/* Answers mode (quiz only) */}
          {variant === "quiz" && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("pdf.answersMode")}</Label>
              <div className="flex gap-1.5 flex-wrap">
                {ANSWER_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => { haptic("selection"); setAnswersMode(mode); }}
                    className={cn(
                      "px-3 h-7 rounded-full text-xs font-medium transition-colors capitalize",
                      answersMode === mode
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {mode === "endbook" ? t("pdf.answer.endbook") :
                     mode === "endchapter" ? t("pdf.answer.endchapter") :
                     mode === "inline" ? t("pdf.answer.inline") :
                     t("pdf.answer.none")}
                  </button>
                ))}
              </div>
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
            <div className="space-y-3 pl-1 border-l-2 border-border ml-1">
              {/* Page size */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("pdf.pageSize")}</Label>
                <div className="flex gap-1.5">
                  {PAGE_SIZES.map((ps) => (
                    <button
                      key={ps}
                      type="button"
                      onClick={() => { haptic("selection"); setPageSize(ps); }}
                      className={cn(
                        "px-2.5 h-6 rounded-md text-xs font-medium uppercase transition-colors",
                        pageSize === ps
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/60 text-muted-foreground"
                      )}
                    >
                      {ps}
                    </button>
                  ))}
                </div>
              </div>

              {/* Orientation */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t("pdf.orientation")}</Label>
                <div className="flex gap-1.5">
                  {(["portrait", "landscape"] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => { haptic("selection"); setOrientation(o); }}
                      className={cn(
                        "px-3 h-6 rounded-md text-xs font-medium transition-colors capitalize",
                        orientation === o
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/60 text-muted-foreground"
                      )}
                    >
                      {o === "portrait" ? t("pdf.portrait") : t("pdf.landscape")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Show explanations toggle */}
              {variant !== "dashboard" && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("pdf.showExplanations")}</Label>
                  <button
                    type="button"
                    onClick={() => { haptic("selection"); setShowExplanations(!showExplanations); }}
                    className={cn(
                      "w-10 h-5.5 rounded-full transition-colors relative",
                      showExplanations ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-4.5 rounded-full bg-white transition-transform",
                        showExplanations ? "left-5" : "left-0.5"
                      )}
                    />
                  </button>
                </div>
              )}

              {/* Two-column toggle */}
              {variant === "quiz" && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("pdf.twoColumn")}</Label>
                  <button
                    type="button"
                    onClick={() => { haptic("selection"); setTwoCol(!twoCol); }}
                    className={cn(
                      "w-10 h-5.5 rounded-full transition-colors relative",
                      twoCol ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-4.5 rounded-full bg-white transition-transform",
                        twoCol ? "left-5" : "left-0.5"
                      )}
                    />
                  </button>
                </div>
              )}

              {/* Score summary toggle (results only) */}
              {variant === "results" && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("pdf.showScoreSummary")}</Label>
                  <button
                    type="button"
                    onClick={() => { haptic("selection"); setShowScoreSummary(!showScoreSummary); }}
                    className={cn(
                      "w-10 h-5.5 rounded-full transition-colors relative",
                      showScoreSummary ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-4.5 rounded-full bg-white transition-transform",
                        showScoreSummary ? "left-5" : "left-0.5"
                      )}
                    />
                  </button>
                </div>
              )}

              {/* Question review toggle (results only) */}
              {variant === "results" && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t("pdf.showReview")}</Label>
                  <button
                    type="button"
                    onClick={() => { haptic("selection"); setShowReview(!showReview); }}
                    className={cn(
                      "w-10 h-5.5 rounded-full transition-colors relative",
                      showReview ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-4.5 rounded-full bg-white transition-transform",
                        showReview ? "left-5" : "left-0.5"
                      )}
                    />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting || !title.trim()}
            className="rounded-xl"
          >
            <Download className="size-4 mr-1.5" />
            {exporting ? t("pdf.generating") : t("pdf.export.button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
