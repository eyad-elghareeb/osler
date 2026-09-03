"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { AnyContent, ContentTreeNode } from "@/lib/osler/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/osler/native";
import { useI18n } from "@/components/osler/i18n-provider";
import { loadUiLang } from "@/lib/osler/i18n";
import { generateQuizCompilationPdf, downloadPdf, type PdfExportConfig } from "@/lib/osler/pdf";
import { type PdfExportOptions } from "@/components/osler/pdf-export-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PackEntry, countQuestions } from "./shared";




































































export function PackExportDialog({
  open,
  onOpenChange,
  node,
  items,
  onLoadPack,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: ContentTreeNode;
  items: PackEntry[];
  /** Lazily fetch pack content the user never opened — without this every
   *  fresh session exports nothing ("No packs selected") because packs sit
   *  at content:null until visited. */
  onLoadPack?: (node: ContentTreeNode) => Promise<AnyContent | null>;
}) {
  const { t } = useI18n();
  const [styleMode, setStyleMode] = React.useState<"standard" | "compact" | "mcqnotes">("standard");
  const [answersMode, setAnswersMode] = React.useState<PdfExportOptions["answersMode"]>("endbook");
  const [showExplanations, setShowExplanations] = React.useState(true);
  const [twoCol, setTwoCol] = React.useState(false);
  const [fontSize, setFontSize] = React.useState<"small" | "medium" | "large">("medium");
  const [fontType, setFontType] = React.useState<"serif" | "sans">("serif");
  const [includeCover, setIncludeCover] = React.useState(true);
  const [exporting, setExporting] = React.useState(false);
  const [selectedUids, setSelectedUids] = React.useState<Set<string>>(new Set());

  // Collect all leaf (pack) nodes under the context-menu target.
  const collectLeafPacks = React.useCallback((n: ContentTreeNode): ContentTreeNode[] => {
    if (n.items.length === 0) return [n];
    return n.items.flatMap(collectLeafPacks);
  }, []);

  const leafPacks = React.useMemo(() => collectLeafPacks(node), [node, collectLeafPacks]);

  // Pre-select all leaf packs on mount.
  React.useEffect(() => {
    if (open) setSelectedUids(new Set(leafPacks.map((p) => p.uid)));
  }, [open, leafPacks]);

  const togglePack = (uid: string) => {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const handleExport = async () => {
    const selected = leafPacks.filter((p) => selectedUids.has(p.uid));
    if (selected.length === 0) {
      haptic("error");
      toast({ title: t("pdf.context.noPacks"), variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      // Resolve content for every selected pack — unopened packs sit at
      // content:null until now, which used to filter out ALL chapters and
      // surface a misleading "No packs selected" error.
      const chapters: PdfExportConfig["chapters"] = [];
      let skipped = 0;
      for (const p of selected) {
        const entry = items.find((i) => i.node.uid === p.uid);
        let content = entry?.content ?? null;
        if (!content && onLoadPack) content = await onLoadPack(p);
        if (!content || countQuestions(content) === 0) {
          skipped += 1;
          continue;
        }
        const questions = toQuestions(content);
        chapters.push({
          title: p.title,
          description: content.meta.description ?? "",
          questions: questions.map((q) => ({
            stem: q.stem,
            choices: q.choices ?? [],
            // Written prompts (correct < 0) must keep their flag — the
            // old `?? 0` coerced them to "choice A is correct" and drew
            // a false answer badge on every written question.
            correct: q.correct ?? 0,
            explanation: q.explanation ?? "",
            modelAnswer: (q as any).modelAnswer,
            rubric: (q as any).rubric,
            isWritten: q.correct !== undefined && q.correct < 0,
            difficulty: (q as any).difficulty,
            tags: (q as any).tags,
          })),
        });
      }

      if (chapters.length === 0) {
        haptic("error");
        toast({
          title: t("pdf.context.exportFailed"),
          description: t("pdf.context.contentUnavailable"),
          variant: "destructive",
        });
        return;
      }

      const cfg: PdfExportConfig = {
        page: { pageSize: "a4", orientation: "portrait" },
        cover: { title: node.title ?? t("pdf.exportQuiz"), subtitle: `${chapters.length} ${t("pdf.tpl.chapters")}  ·  ${chapters.reduce((a, c) => a + c.questions.length, 0)} ${t("pdf.tpl.questionsPlural")}` },
        includeCover,
        styleMode,
        answersMode,
        showExplanations,
        twoCol,
        fontSize,
        fontType,
        // Content export: the folder's declared language wins (an Arabic
        // pack exports an Arabic paper even in an English UI); the site
        // language is only the fallback for undeclared nodes.
        lang: node.lang?.startsWith("ar") ? "ar" : node.lang?.startsWith("en") ? "en" : loadUiLang(),
        chapters,
      };
      const doc = await generateQuizCompilationPdf(cfg);
      downloadPdf(doc, node.title ?? t("pdf.exportQuiz"));
      haptic("success");
      toast({
        title: t("pdf.pdfReady"),
        description: skipped > 0 ? t("pdf.context.skipped", { n: String(skipped) }) : t("pdf.pdfReadyDesc"),
      });
    } catch (e) {
      haptic("error");
      toast({ title: t("pdf.context.exportFailed"), description: String(e), variant: "destructive" });
    } finally {
      setExporting(false);
      onOpenChange(false);
    }
  };

  function toQuestions(content: AnyContent): Array<{ stem: string; choices?: string[]; correct?: number; explanation?: string; modelAnswer?: string; rubric?: string[] }> {
    const c = content as any;
    if (c.questions) {
      return c.questions.map((q: any) => ({
        stem: q.question ?? q.stem ?? "",
        choices: q.options ?? q.choices ?? [],
        correct: q.correct ?? 0,
        explanation: q.explanation ?? "",
        modelAnswer: q.modelAnswer,
        rubric: q.rubric,
        difficulty: q.difficulty,
        tags: q.tags,
      }));
    }
    if (c.passages) {
      return c.passages.flatMap((p: any) =>
        (p.questions ?? []).map((q: any) => ({
          stem: `${p.title ? p.title + " - " : ""}${q.question ?? q.stem ?? ""}`,
          choices: q.options ?? q.choices ?? [],
          correct: q.correct ?? 0,
          explanation: q.explanation ?? "",
          modelAnswer: q.modelAnswer,
          rubric: q.rubric,
          difficulty: q.difficulty,
          tags: q.tags,
        }))
      );
    }
    if (c.prompts) {
      // Written prompts have no correct choice index — mark them so the
      // booklet renders a model-answer/rubric block instead of MCQ choices.
      return c.prompts.map((q: any) => ({
        stem: q.question ?? q.stem ?? "",
        choices: [],
        correct: -1,
        explanation: q.explanation ?? "",
        modelAnswer: q.modelAnswer,
        rubric: q.rubric,
        difficulty: q.difficulty,
        tags: q.tags,
      }));
    }
    return [];
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-5 text-primary" />
            {t("pdf.context.title", { title: node.title })}
          </DialogTitle>
          <DialogDescription>
            {t("pdf.context.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Pack selection */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.context.packs", { n: leafPacks.length })}</Label>
            <div className="border border-border rounded-lg max-h-48 overflow-y-auto osler-scroll divide-y divide-border">
              {leafPacks.map((p) => {
                const entry = items.find((i) => i.node.uid === p.uid);
                const qCount = entry?.content ? toQuestions(entry.content).length : 0;
                return (
                  <label
                    key={p.uid}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <Checkbox
                      checked={selectedUids.has(p.uid)}
                      onCheckedChange={() => togglePack(p.uid)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.title}</div>
                      <div className="text-xs text-muted-foreground">{t("pdf.context.questions", { n: qCount })}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Style mode */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.styleMode")}</Label>
            <div className="flex gap-1.5 flex-wrap">
              {(["standard", "compact", "mcqnotes"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { haptic("selection"); setStyleMode(m); }}
                  className={cn(
                    "px-3 h-7 rounded-full text-xs font-medium transition-colors",
                    styleMode === m ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(`pdf.style.${m}` as "pdf.style.standard")}
                </button>
              ))}
            </div>
          </div>

          {/* Answers mode */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.answersMode")}</Label>
            <div className="flex gap-1.5 flex-wrap">
              {(["inline", "endchapter", "endbook", "none"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { haptic("selection"); setAnswersMode(m); }}
                  className={cn(
                    "px-3 h-7 rounded-full text-xs font-medium transition-colors capitalize",
                    answersMode === m ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t(`pdf.answer.${m}` as "pdf.answer.inline")}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
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
              <span className={cn("absolute top-0.5 size-4.5 rounded-full bg-white transition-transform", showExplanations ? "left-5" : "left-0.5")} />
            </button>
          </div>

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
              <span className={cn("absolute top-0.5 size-4.5 rounded-full bg-white transition-transform", includeCover ? "left-5" : "left-0.5")} />
            </button>
          </div>

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
              <span className={cn("absolute top-0.5 size-4.5 rounded-full bg-white transition-transform", twoCol ? "left-5" : "left-0.5")} />
            </button>
          </div>

          {/* Font size */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.fontSize")}</Label>
            <div className="flex gap-1.5">
              {(["small", "medium", "large"] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => { haptic("selection"); setFontSize(sz); }}
                  className={cn(
                    "px-2.5 h-6 rounded-md text-xs font-medium transition-colors capitalize",
                    fontSize === sz ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground"
                  )}
                >
                  {t(`pdf.fontSize.${sz}` as "pdf.fontSize.small")}
                </button>
              ))}
            </div>
          </div>

          {/* Font type */}
          <div className="space-y-1.5">
            <Label className="text-xs">{t("pdf.fontType")}</Label>
            <div className="flex gap-1.5">
              {(["serif", "sans"] as const).map((ft) => (
                <button
                  key={ft}
                  type="button"
                  onClick={() => { haptic("selection"); setFontType(ft); }}
                  className={cn(
                    "px-2.5 h-6 rounded-md text-xs font-medium transition-colors capitalize",
                    fontType === ft ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground"
                  )}
                >
                  {t(`pdf.fontType.${ft}` as "pdf.fontType.serif")}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
            {t("common.cancel")}
          </Button>
          <Button onClick={handleExport} disabled={exporting || selectedUids.size === 0} className="rounded-xl">
            <Download className="size-4 me-1.5" />
            {exporting ? t("pdf.generating") : t("pdf.context.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}